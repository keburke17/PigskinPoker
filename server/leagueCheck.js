/* The hourly league checker: read every league, find what is wrong, tell the admins.
 *
 * docs/PLAN-AUTOMATIC-LEAGUES.md, step 3. The rules - what counts as wrong - are in
 * server/leagueHealth.js and are pure. This file is the reading and the writing:
 *
 *   1. read every league, its season, its periods, the current period in full, the
 *      last finished week's results, team counts and roster-email times - in a fixed
 *      number of queries however many leagues there are (paged, and chunked by id);
 *   2. read the NFL schedule ONCE per season year, through the shared feed;
 *   3. ask leagueHealth.js what is wrong with each league;
 *   4. record each problem in `league_alerts`, one row per (league, kind, key), and mark
 *      anything no longer found as resolved;
 *   5. email every site admin ONE message listing the problems not yet emailed, each
 *      with the league's name, id and link.
 *
 * READ-ONLY TOWARDS THE GAME. It never deals, processes, finalizes or repairs anything:
 * it only writes `league_alerts`. Fixing a league stays a decision a person makes.
 *
 * Local development never emails anybody - sendEmail captures to the console when the
 * database is local (server/email/resend.js), the same rule league mail follows.
 */

import { createHash } from "node:crypto";
import { selectAll } from "../src/storage/selectAll.js";
import { selectFeed } from "./feed/index.js";
import { sharedFeed } from "./feed/shared.js";
import { sendEmail, siteUrl } from "./email/resend.js";
import { currentPeriodOf, findLeagueProblems, lastFinalizedOf } from "./leagueHealth.js";

/* PostgREST puts `in.(...)` in the URL, so long id lists go in chunks. */
const CHUNK = 150;
async function inChunks(ids, read) {
  const out = [];
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await read(list.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
const must = ({ data, error }, what) => {
  if (error) throw new Error("Could not read " + what + ": " + error.message);
  return data ?? [];
};

/** Read everything the rules need, for every league. */
export async function readLeaguesForCheck(db) {
  const leagues = must(await selectAll(() =>
    db.from("leagues")
      .select("id, name, mode, tz, auto_process_schemes, auto_advance_week, auto_pull_stats, notify_members")
      .order("id")), "leagues");

  const seasons = must(await selectAll(() =>
    db.from("seasons").select("id, league_id, year, status, playoff_completed").order("id")), "seasons");
  /* The active season, else the newest - the same choice the homepage makes. */
  const seasonOf = new Map();
  for (const s of seasons) {
    const had = seasonOf.get(s.league_id);
    if (!had || (s.status === "active" && had.status !== "active") ||
        (s.status === had.status && s.year > had.year)) seasonOf.set(s.league_id, s);
  }

  const seasonIds = [...seasonOf.values()].map((s) => s.id);
  const periods = await inChunks(seasonIds, (ids) =>
    db.from("periods")
      .select("id, season_id, type, number, phase, nfl_week, dealt_at, deal_seed, finalized_at, participant_team_ids")
      .in("season_id", ids));
  const periodsBySeason = new Map();
  for (const p of periods) {
    if (!periodsBySeason.has(p.season_id)) periodsBySeason.set(p.season_id, []);
    periodsBySeason.get(p.season_id).push(p);
  }

  const currentIds = [];
  const lastIds = [];
  for (const list of periodsBySeason.values()) {
    const cur = currentPeriodOf(list);
    if (cur) currentIds.push(cur.id);
    const last = lastFinalizedOf(list);
    if (last) lastIds.push(last.id);
  }

  const fullCurrent = await inChunks(currentIds, (ids) => db.from("periods").select("*").in("id", ids));
  const results = await inChunks(lastIds, (ids) =>
    db.from("period_results").select("period_id, raw_score").in("period_id", ids));
  const emails = await inChunks(currentIds, (ids) =>
    db.from("notifications").select("period_id, created_at").eq("kind", "week_dealt").in("period_id", ids));
  const leagueIds = leagues.map((l) => l.id);
  const teams = await inChunks(leagueIds, (ids) =>
    db.from("teams").select("league_id").eq("active", true).in("league_id", ids));

  const currentById = new Map(fullCurrent.map((p) => [p.id, p]));
  const resultsByPeriod = new Map();
  for (const r of results) {
    if (!resultsByPeriod.has(r.period_id)) resultsByPeriod.set(r.period_id, []);
    resultsByPeriod.get(r.period_id).push(r);
  }
  const firstEmail = new Map();
  for (const e of emails) {
    const had = firstEmail.get(e.period_id);
    if (!had || e.created_at < had) firstEmail.set(e.period_id, e.created_at);
  }
  const teamCount = new Map();
  for (const t of teams) teamCount.set(t.league_id, (teamCount.get(t.league_id) ?? 0) + 1);

  return leagues.map((league) => {
    const season = seasonOf.get(league.id) ?? null;
    const list = season ? (periodsBySeason.get(season.id) ?? []) : [];
    const light = currentPeriodOf(list);
    const current = light ? (currentById.get(light.id) ?? light) : null;
    const last = lastFinalizedOf(list);
    const playing = Array.isArray(current?.participant_team_ids) && current.participant_team_ids.length
      ? current.participant_team_ids.length
      : (teamCount.get(league.id) ?? 0);
    return {
      league,
      season,
      periods: list,
      current,
      lastResults: last ? (resultsByPeriod.get(last.id) ?? []) : [],
      teamCount: playing,
      dealtEmailAt: current ? (firstEmail.get(current.id) ?? null) : null,
    };
  });
}

/** The season's games, once per year, or null if the schedule cannot be read. */
async function gamesByYear(feed, years) {
  const out = new Map();
  for (const year of years) {
    try {
      const { games } = await feed.fetchSeasonGames({ season: year });
      out.set(year, games);
    } catch (err) {
      console.log("[league-check] schedule for " + year + " not read: " + err.message);
      out.set(year, null);
    }
  }
  return out;
}

/** Record what was found; returns the alerts that still need emailing. */
async function recordAlerts(db, found, now) {
  const stamp = new Date(now).toISOString();
  const open = must(await selectAll(() =>
    db.from("league_alerts").select("*").is("resolved_at", null).order("id")), "league_alerts");
  const id = (a) => a.league_id + "|" + a.kind + "|" + a.key;
  const openById = new Map(open.map((a) => [id(a), a]));
  const foundIds = new Set(found.map(id));

  for (const a of found) {
    const had = openById.get(id(a));
    if (had) {
      const { error } = await db.from("league_alerts")
        .update({ last_seen: stamp, message: a.message }).eq("id", had.id);
      if (error) throw new Error("league_alerts update: " + error.message);
    } else {
      /* A problem seen before and resolved comes back as the same row, reopened, so it
       * is emailed again rather than lost behind the unique key. */
      const { error } = await db.from("league_alerts").upsert(
        { league_id: a.league_id, kind: a.kind, key: a.key, message: a.message,
          first_seen: stamp, last_seen: stamp, resolved_at: null, emailed_at: null },
        { onConflict: "league_id,kind,key" });
      if (error) throw new Error("league_alerts insert: " + error.message);
    }
  }
  const gone = open.filter((a) => !foundIds.has(id(a))).map((a) => a.id);
  if (gone.length) {
    const { error } = await db.from("league_alerts").update({ resolved_at: stamp }).in("id", gone);
    if (error) throw new Error("league_alerts resolve: " + error.message);
  }

  return must(await selectAll(() =>
    db.from("league_alerts").select("*").is("resolved_at", null).is("emailed_at", null).order("first_seen")),
  "unemailed alerts");
}

/** The admins' email: every new problem, grouped by league. */
export function alertEmail(alerts, names, site) {
  const byLeague = new Map();
  for (const a of alerts) {
    if (!byLeague.has(a.league_id)) byLeague.set(a.league_id, []);
    byLeague.get(a.league_id).push(a);
  }
  const n = alerts.length;
  const subject = "Pigskin Poker: " + n + " league problem" + (n === 1 ? "" : "s") + " found";
  const blocks = [...byLeague.entries()].map(([leagueId, list]) => {
    const name = names.get(leagueId) ?? "(league gone)";
    return [
      name,
      "  League id: " + leagueId,
      "  Open it:   " + site + "/l/" + leagueId,
      ...list.map((a) => "  - " + a.message),
    ].join("\n");
  });
  const text = [
    "The hourly league checker found " + n + " new problem" + (n === 1 ? "" : "s") + ".",
    "Nothing has been changed - this is only a report. Each problem is emailed once; you",
    "will not hear about it again unless it clears and comes back.",
    "",
    ...blocks.flatMap((b) => [b, ""]),
  ].join("\n");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html =
    "<p>The hourly league checker found " + n + " new problem" + (n === 1 ? "" : "s") +
    ". Nothing has been changed - this is only a report.</p>" +
    [...byLeague.entries()].map(([leagueId, list]) =>
      "<h3 style=\"margin-bottom:4px\">" + esc(names.get(leagueId) ?? "(league gone)") + "</h3>" +
      "<p style=\"margin-top:0;color:#555\">League id " + esc(leagueId) + " - <a href=\"" +
      esc(site + "/l/" + leagueId) + "\">open it</a></p><ul>" +
      list.map((a) => "<li>" + esc(a.message) + "</li>").join("") + "</ul>").join("");
  return { subject, text, html };
}

/**
 * One run of the checker. Returns a summary for the log line.
 *
 * @param {object} db   a secret-key client
 * @param {object} opts { now, feed, env }
 */
export async function scheduledLeagueCheck(db, { now = Date.now(), feed: given, env = process.env } = {}) {
  const leagues = await readLeaguesForCheck(db);
  const feed = sharedFeed(given || (await selectFeed(env)));
  const years = [...new Set(leagues.map((l) => l.season?.year).filter(Boolean))];
  const games = await gamesByYear(feed, years);

  const found = [];
  for (const item of leagues) {
    const problems = findLeagueProblems({ ...item, games: games.get(item.season?.year) ?? null, now });
    for (const p of problems) found.push({ league_id: item.league.id, ...p });
  }

  const unemailed = await recordAlerts(db, found, now);

  let emailed = 0;
  let emailWhy = "nothing new";
  if (unemailed.length) {
    const admins = must(await db.from("site_admins").select("email"), "site_admins").map((a) => a.email);
    const names = new Map(leagues.map((l) => [l.league.id, l.league.name]));
    const message = alertEmail(unemailed, names, siteUrl(env));
    let allOk = admins.length > 0;
    for (const to of admins) {
      const sent = await sendEmail({ to, ...message }, {
        /* The same set of alerts to the same admin is the same message, so a retry after a
         * lost response is not a second email. Hashed: Resend caps the key's length. */
        idempotencyKey: "league-check-" + createHash("sha256")
          .update(to + ":" + unemailed.map((a) => a.id).sort().join(",")).digest("hex"),
        env,
      });
      if (!sent.ok) allOk = false;
      emailWhy = sent.why;
    }
    if (!admins.length) emailWhy = "no site admins to email";
    /* Only marked once every admin was sent it, so a failed send is retried next hour. */
    if (allOk) {
      const { error } = await db.from("league_alerts")
        .update({ emailed_at: new Date(now).toISOString() })
        .in("id", unemailed.map((a) => a.id));
      if (error) throw new Error("league_alerts emailed: " + error.message);
      emailed = unemailed.length;
    }
  }

  return {
    ok: true,
    leagues: leagues.length,
    problems: found.length,
    emailed,
    emailWhy,
    found: found.map((f) => ({ league: f.league_id, kind: f.kind })),
  };
}
