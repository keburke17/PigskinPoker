/* Deciding what an injury pull writes. OQ-29.
 *
 * Split out of operations.js and kept free of I/O for the same reason server/stats.js is:
 * the rule that matters is testable on its own, and this one runs every few hours with
 * nobody watching.
 *
 * DISPLAY ONLY. These rows are the pill and the notepad on a roster row. Nothing deals,
 * schemes, scores, locks or finalizes from them, and nothing here touches `players.status`
 * - the field the deal does read. Scott, 2026-10-17: "Don't touch the deal quite yet."
 *
 * WHAT A PULL DOES TO A ROW:
 *
 *   - The game status and the injury are REPLACED by the newest reading. A Questionable
 *     who is downgraded on Saturday is Out, and a player cleared to play loses his tag.
 *   - The practice days are MERGED. The file only holds each player's latest day, so
 *     Wednesday survives Thursday's pull only because it is already in the row. A reading
 *     adds its day or corrects it; it never removes another one.
 *   - A reading dated OUTSIDE the player's three practice days is not a practice day and
 *     records none. nflverse republishes on days with no report (Saturday for a Sunday
 *     game, Sunday morning), and without this the notepad would grow a fourth box saying
 *     Friday's answer again under a day nobody practised.
 *   - `updated_at` moves only when something the manager can SEE changed. The notepad's
 *     "new since you last looked" dot reads it, and a pull that found the same report
 *     again must not light every notepad in the league.
 *
 * A PLAYER WHO DROPS OFF THE REPORT keeps his row. nflverse does not take a player out of a
 * week once he is in it - it overwrites him - so "absent" in practice means "never on it",
 * and there is nothing to clear.
 */

import {
  gameStatusOf,
  practiceCode,
  practiceDays,
  reportDateOf,
} from "../src/engine/injuries.js";

export const FEED_PROVIDER = "nflverse";

/**
 * Work out the player_injuries rows a pull implies.
 *
 * @param {Array}  players     the league's players rows
 * @param {Array}  feedRows    `fetchInjuries(...).rows`
 * @param {Array}  existing    the league's player_injuries rows for those weeks
 * @param {number[]} weeks     the NFL weeks to write - this one and the one before
 * @param {object} kickoffsByWeek  nfl_week -> periods.kickoffs for that week, when known
 * @param {string|null} publishedAt  when nflverse published the file (Last-Modified)
 * @param {string} at          when this pull ran - also the fallback publish time
 * @returns {{ rows: Array, report: { matched, changed, weeks, reportDate } }}
 */
export function planInjuryRows({
  players,
  feedRows,
  existing,
  weeks,
  kickoffsByWeek = {},
  publishedAt,
  at,
  leagueId,
  seasonId,
}) {
  /* Without a Last-Modified header the best evidence of when the file was published is
   * that it was there when we looked. It cannot be earlier than that, and the 4pm rule
   * then dates it no later than the report it could hold. */
  const reportDate = reportDateOf(publishedAt || at);

  const wanted = new Set(weeks.map(Number));
  const byKey = new Map();
  for (const r of feedRows) {
    if (!r.gsis || !wanted.has(Number(r.week))) continue;
    byKey.set(String(r.gsis) + "|" + Number(r.week), r);
  }
  const before = new Map(existing.map((e) => [e.player_id + "|" + e.nfl_week, e]));

  const rows = [];
  let changed = 0;
  for (const player of players) {
    if (player.position === "Coach") continue;
    const gsis = player.external_ids && player.external_ids.gsis;
    if (!gsis) continue;

    for (const week of wanted) {
      const reading = byKey.get(String(gsis) + "|" + week);
      if (!reading) continue;
      const prior = before.get(player.id + "|" + week) || null;

      const practice = { ...((prior && prior.practice) || {}) };
      const code = practiceCode(reading.practice);
      const window = practiceWindow(kickoffsByWeek[week], player.nfl_team);
      if (code && reportDate && (!window || window.includes(reportDate))) {
        practice[reportDate] = code;
      }

      const next = {
        season_id: seasonId,
        player_id: player.id,
        league_id: leagueId,
        nfl_week: week,
        game_status: gameStatusOf(reading.gameStatus),
        injury: reading.injury || null,
        practice,
        report_date: latest(prior && prior.report_date, reportDate),
        feed_provider: FEED_PROVIDER,
      };
      const different = !prior || visiblyDifferent(prior, next);
      if (different) changed += 1;
      next.updated_at = different ? at : prior.updated_at;
      rows.push(next);
    }
  }

  return {
    rows,
    report: { matched: rows.length, changed, weeks: [...wanted], reportDate },
  };
}

/** The three practice days for a team's game that week, or null when not known. */
function practiceWindow(kickoffs, nflTeam) {
  if (!kickoffs || !nflTeam) return null;
  const entry = kickoffs[nflTeam];
  if (!entry) return null;
  return practiceDays(typeof entry === "string" ? entry : entry.at);
}

function latest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) > String(b) ? String(a) : String(b);
}

/* Only what a manager can see on screen. A report_date that moved on its own - nflverse
 * republishing the same report - is not news. */
function visiblyDifferent(prior, next) {
  if ((prior.game_status || null) !== next.game_status) return true;
  if ((prior.injury || null) !== next.injury) return true;
  const a = prior.practice || {};
  const b = next.practice;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return true;
  return false;
}
