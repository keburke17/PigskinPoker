#!/usr/bin/env node
/* Pigskin Poker - PUT BACK A WEEK THE CLOCK FINALIZED BEFORE IT WAS DEALT.
 *
 * THE INCIDENT, 2026-11-24. A season league's Week 12 was finalized by the scheduled
 * cycle before it had ever been dealt: the clock had checked Week 11, something else
 * finalized Week 11 while it was reading results, and the clock then finalized whatever
 * week was current - an empty Week 12. Every team scored 0, the tiebreakers handed out
 * the whole standings ladder and a week win anyway, and the clock went on to deal Week 13
 * against NFL week 13's schedule. The code is fixed (samePeriodStill / wrongPhase in
 * server/operations.js); this script repairs a league it already happened to.
 *
 * WHAT IT DOES, for `--week N`:
 *   - takes Week N's results out of the league and out of every team's season totals
 *     (standings points, week wins, coach wins, TDs, yards, best player);
 *   - removes Week N+1 entirely - its rosters, schemes, stat lines and deal email row
 *     go with it (every period-scoped table cascades);
 *   - puts Week N back to "ready to deal", keeping its NFL week mapping, with its
 *     finalize stamp, deal seed and kickoff times cleared;
 *   - drops Week N's weekly recaps, and writes one line in the activity log saying what
 *     happened.
 * Then the commissioner presses Deal for Week N, as normal - which re-reads Week N's
 * schedule and emails every manager the new roster.
 *
 * IT REFUSES unless the league looks exactly like the incident: a season league whose
 * current week is N+1, whose Week N is finalized, was NEVER DEALT (no deal time), and
 * scored 0 for every team. Anything else and it stops and says why, changing nothing.
 *
 * DRY RUN BY DEFAULT. Without --apply it prints the plan and the standings before and
 * after, and writes nothing.
 *
 * HOSTED DATABASE: this is Kyle's to run, and it has no undo. Take `npm run db:backup`
 * first.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
 *     node scripts/repair-skipped-week.mjs --league <league uuid> --week 12          # look
 *   ... same ... --apply                                                             # do it
 */

import { pathToFileURL } from "node:url";
import { createSecretClient } from "../server/supabase.js";
import { fetchLeagueRows, hydrate, persistBlob } from "../server/league.js";

const label = (n) => "Week " + n;
const isWeek = (p, n) => p && p.type === "week" && p.number === n;

/**
 * Work out the repair, without writing anything.
 * @returns {{ error: string } | { blob, plan, rows, weekRow, nextRow }}
 */
export function planRepair(rows, week) {
  const view = hydrate(rows);
  if (!view) return { error: "Could not read the league." };
  const mode = rows.leagues[0]?.mode ?? "season";
  if (mode !== "season") return { error: "This is a '" + mode + "' league; the repair is for season leagues." };

  const seasonId = view._meta.seasonId;
  const periods = rows.periods.filter((p) => p.season_id === seasonId);
  const weekRow = periods.find((p) => isWeek(p, week));
  const nextRow = periods.find((p) => isWeek(p, week + 1));
  const later = periods.filter((p) => p.type === "week" && p.number > week + 1);

  if (!isWeek(view.currentPeriod, week + 1)) {
    return { error: "The league is on " + label(view.currentPeriod.number) + ", not " + label(week + 1) + "." };
  }
  if (!weekRow) return { error: label(week) + " does not exist." };
  if (weekRow.phase !== "finalized") return { error: label(week) + " is '" + weekRow.phase + "', not finalized." };
  if (weekRow.dealt_at) {
    return { error: label(week) + " WAS dealt (at " + weekRow.dealt_at + "), so it is not the skipped week. Stopping." };
  }
  if (later.length) return { error: "There are weeks after " + label(week + 1) + "; this is not the incident." };
  if (periods.some((p) => p.type === "playoff")) return { error: "The playoffs have started; not repairing." };

  const bogus = view.weeklyResults.filter((r) => isWeek(r.period, week));
  if (!bogus.length) return { error: label(week) + " has no results to remove." };
  if (bogus.some((r) => Number(r.rawScore) !== 0)) {
    return { error: "Somebody scored points in " + label(week) + ", so it was played. Stopping." };
  }

  const blob = JSON.parse(JSON.stringify(view));
  blob.weeklyResults = blob.weeklyResults.filter((r) => !isWeek(r.period, week));

  const plan = [];
  for (const team of blob.teams) {
    const r = bogus.find((x) => x.teamId === team.id);
    const cum = team.cumulative;
    if (!r || !cum) continue;
    const before = { sp: cum.standingsPoints, wins: cum.weekWins };
    cum.standingsPoints -= r.standingsPoints || 0;
    if (r.rank === 1) cum.weekWins -= 1;
    if (r.coachResult === "Win") cum.coachWins -= 1;
    cum.totalTDs -= r.tds || 0;
    cum.totalYards -= r.yards || 0;
    if (cum.bestPlayer && cum.bestPlayer.periodLabel === label(week)) {
      const kept = blob.weeklyResults
        .filter((x) => x.teamId === team.id && x.bestPlayer && x.period.type === "week")
        .map((x) => ({ ...x.bestPlayer, periodLabel: x.periodLabel }))
        .sort((a, b) => b.points - a.points)[0];
      cum.bestPlayer = kept
        ? { name: kept.name, position: kept.position, points: kept.points, periodLabel: kept.periodLabel }
        : null;
    }
    plan.push({
      team: team.name, rank: r.rank,
      standingsPoints: before.sp + " -> " + cum.standingsPoints,
      weekWins: before.wins + " -> " + cum.weekWins,
    });
  }

  blob.currentPeriod = { type: "week", number: week, phase: "pre-deal" };
  blob.teams.forEach((t) => { t.roster = null; });
  blob.schemes = {};
  blob.statsEntry = {};
  blob.lockedPlayerIds = {};
  blob.rosterLocked = false;
  /* Week N+1's entries go with it; so do Week N's bogus "final" lines. Everything
   * else in the log stays exactly as it was. */
  blob.activityLog = blob.activityLog.filter(
    (e) => !isWeek(e.period, week + 1) &&
      !(isWeek(e.period, week) && (e.type === "result" || e.type === "auto"))
  );
  blob.activityLog.push({
    id: "act_repair_week" + week,
    period: { ...blob.currentPeriod },
    periodLabel: label(week),
    ts: new Date().toISOString(),
    type: "auto",
    text:
      label(week) + " was finalized by mistake before it was dealt, and " + label(week + 1) +
      " was dealt in its place. Both are undone: " + label(week) + "'s zero scores and " +
      "standings points are gone, and " + label(week) + " will be dealt again.",
  });

  return { blob, plan, rows, weekRow, nextRow };
}

export async function repairSkippedWeek(db, { leagueId, week, apply = false, log = console.log }) {
  const rows = await fetchLeagueRows(db, leagueId);
  if (!rows) return { ok: false, error: "No such league." };
  const planned = planRepair(rows, week);
  if (planned.error) return { ok: false, error: planned.error };

  const { blob, plan, weekRow, nextRow } = planned;
  log("League:   " + rows.leagues[0].name + " (" + leagueId + ")");
  log(label(week) + ":  finalized, never dealt, NFL week " + weekRow.nfl_week + " -> back to ready to deal");
  log(label(week + 1) + ":  " + (nextRow ? "'" + nextRow.phase + "', NFL week " + nextRow.nfl_week + " -> removed" : "absent"));
  log("Standings:");
  for (const p of plan) log("  " + p.team.padEnd(28) + " points " + p.standingsPoints.padEnd(12) + " week wins " + p.weekWins);

  if (!apply) {
    log("\nDry run - nothing written. Add --apply to do it.");
    return { ok: true, applied: false, plan };
  }

  await persistBlob(db, rows, blob, { leagueKey: leagueId, year: rows.seasons[0].year });

  /* The server-owned columns decompose does not carry. Week N was never really dealt,
   * so it goes back to exactly what a fresh week looks like; its NFL week stays. */
  const { error: pErr } = await db.from("periods").update({
    finalized_at: null, deal_seed: null, dealt_at: null, scheme_seed: null,
    kickoffs: null, kickoffs_read_at: null, scheme_moves: null, roster_locked: false,
  }).eq("id", weekRow.id);
  if (pErr) return { ok: false, error: "Week row update failed: " + pErr.message };
  await db.from("weekly_recaps").delete().eq("period_id", weekRow.id);
  if (nextRow) await db.from("periods").delete().eq("id", nextRow.id);

  const after = hydrate(await fetchLeagueRows(db, leagueId));
  log("\nDone. The league is on " + label(after.currentPeriod.number) + ", '" + after.currentPeriod.phase + "'.");
  log("Next: the commissioner presses Deal.");
  return { ok: true, applied: true, plan, view: after };
}

/* ---------------------------------------------------------------- the CLI -- */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const leagueId = val("--league");
  const week = Number(val("--week"));
  if (!leagueId || !Number.isInteger(week)) {
    console.error("usage: node scripts/repair-skipped-week.mjs --league <uuid> --week <n> [--apply]");
    process.exit(1);
  }
  const db = createSecretClient();
  const out = await repairSkippedWeek(db, { leagueId, week, apply: args.includes("--apply") });
  if (!out.ok) {
    console.error("\nNOT REPAIRED: " + out.error + "\n");
    process.exit(1);
  }
}
