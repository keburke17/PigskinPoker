/* Deciding what a stats pull fills in.
 *
 * Split out of operations.js and kept free of I/O for the same reason server/pool.js is:
 * the rule that matters is testable on its own. And it is the same rule, because it is
 * the same promise -
 *
 *   A PULL MAY WRITE ITS OWN WORK AND NOTHING A PERSON TYPED.
 *
 * `stat_lines.source` says who last set a line. 'feed' is the pull's own and it may
 * correct it; 'manual' is the commissioner's and it is never overwritten - the feed's
 * opinion goes into the `feed_*` mirror columns beside it, which is what lets the screen
 * say "the feed says 91, you set 84" and offer a revert (stage 6). The mirrors are
 * written EITHER WAY, so that sentence is available whether or not anybody has typed
 * over the numbers yet.
 *
 * WHAT A MISSING PLAYER MEANS. A player who did not play is simply absent from the
 * file, and Scott's answer to OQ-4c is that such a starter scores zero. So do nothing:
 * an empty line already scores zero (src/engine/scoring.js reads a blank as nothing),
 * and writing an explicit 0 would claim the feed reported a zero when what actually
 * happened is that it reported nothing. The difference matters on a Sunday afternoon,
 * when half the games have not kicked off - the report names those slots instead.
 *
 * See docs/PHASE-4-PLAN.md sections 5 and 7.
 */

import { randomUUID } from "node:crypto";

import { STAT_CATEGORIES } from "../src/engine/index.js";
import {
  SPLIT_COLUMN,
  FEED_COLUMN,
  SPLIT_STAT_FIELDS,
  rowHasSplit,
} from "../src/storage/statLine.js";

/* The commissioner reads this report, so it says "Pass Yds" rather than `passYards`.
 * Taken from the engine's own category list, so the screen and the report cannot drift. */
const LABEL = Object.fromEntries(STAT_CATEGORIES.map((c) => [c.field, c.label]));

export const FEED_PROVIDER = "nflverse";

/** How many stat lines go in one write. A period holds at most one per team per slot -
 * 12 teams x 6 starters is 72 - so this is one request in every realistic league, and
 * the chunking is here for the same reason it is in pool.js rather than because anyone
 * expects to need it. */
export const STAT_WRITE_CHUNK = 200;

/**
 * Work out the writes a pull implies.
 *
 * @param {Array}  starters  roster_slots rows for the period, area 'starter'
 * @param {Array}  players   the league's players rows
 * @param {Array}  teams     the league's teams rows, for a readable report
 * @param {Array}  statLines existing stat_lines rows for the period
 * @param {Array}  feedLines what the feed reported (server/feed/nflverse.js)
 * @param {Map}    results   team name -> 'Win' | 'Tie' | 'Loss', for the Coach slot
 * @param {string} at        ISO timestamp of the pull
 * @param {string} periodId
 * @returns {{ writes, report }}
 */
export function planStatsPull({
  starters,
  players,
  teams,
  statLines,
  feedLines,
  results,
  at,
  periodId,
}) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const lineFor = new Map(statLines.map((s) => [s.team_id + "|" + s.slot, s]));

  const byGsis = new Map();
  for (const line of feedLines) {
    if (line.gsis) byGsis.set(String(line.gsis), line);
  }

  const writes = [];
  const filled = [];
  const kept = [];
  const missing = [];

  for (const slotRow of starters) {
    const where = {
      team: teamName.get(slotRow.team_id) || "a team",
      slot: slotRow.slot,
    };

    const player = slotRow.player_id ? playerById.get(slotRow.player_id) : null;
    if (!player) {
      missing.push({ ...where, player: null, why: "no player in this slot" });
      continue;
    }
    where.player = player.name;

    const found = feedValuesFor(player, { byGsis, results });
    if (!found) {
      /* Named, not filled. A bye week, a game that has not kicked off, and a player the
       * feed has never heard of all land here, and the commissioner is the one who can
       * tell them apart. */
      missing.push({ ...where, why: whyMissing(player) });
      continue;
    }

    const existing = lineFor.get(slotRow.team_id + "|" + slotRow.slot) || null;
    const manual = existing && existing.source === "manual";

    const row = {
      ...(existing || {}),
      period_id: periodId,
      team_id: slotRow.team_id,
      slot: slotRow.slot,
      /* Denormalized at entry time so per-player season queries work, and re-read here
       * because a lineup swap may have moved somebody since the line was created. */
      player_id: slotRow.player_id,
      ...found.mirrors,
      feed_provider: FEED_PROVIDER,
      feed_updated_at: at,
      version: existing ? (existing.version ?? 1) + 1 : 1,
      updated_at: at,
    };

    if (manual) {
      /* His numbers stand. Only the mirrors move, so the difference is on the record
       * rather than being resolved behind him. */
      kept.push({ ...where, differences: disagreements(existing, found) });
    } else {
      Object.assign(row, found.effective, { source: "feed" });
      filled.push(where);
    }

    writes.push(row);
  }

  /* Only the lines that actually differ are worth a commissioner's attention; the rest
   * are ones he typed that the feed agrees with, and listing those buries the real
   * ones. The agreeing count is still reported, because "we checked 6 and all matched"
   * is a different message from "we checked none". */
  const disputed = kept.filter((k) => k.differences.length);

  return {
    writes,
    report: {
      at,
      provider: FEED_PROVIDER,
      filled,
      kept: disputed,
      keptAgreeing: kept.length - disputed.length,
      missing,
    },
  };
}

/** Why the feed had nothing for this player, in the commissioner's terms. */
function whyMissing(player) {
  if (player.position === "Coach") return "no finished game for " + (player.nfl_team || "his team");
  if (!(player.external_ids && player.external_ids.gsis)) {
    return "no provider id - refresh the pool to attach one";
  }
  return "no line in the feed for this week";
}

/**
 * What the feed says about one player, as database columns.
 *
 * Two identity spaces, on purpose. A skill player is matched on `gsis`, the id the depth
 * charts and the stats file share - never on name, because a wrong number that looks
 * right is the worst outcome available here. A head coach has no player id at all, so
 * the Coach slot is matched BY TEAM: the pool's coach rows carry the team they belong
 * to, and a team that changed coach mid-season still resolves to the right game.
 */
function feedValuesFor(player, { byGsis, results }) {
  if (player.position === "Coach") {
    const result = player.nfl_team ? results.get(player.nfl_team) : null;
    if (!result) return null;
    return {
      mirrors: { feed_coach_result: result },
      effective: { coach_result: result },
    };
  }

  const gsis = player.external_ids && player.external_ids.gsis;
  const line = gsis ? byGsis.get(String(gsis)) : null;
  if (!line) return null;

  const mirrors = {};
  const effective = {};
  for (const field of SPLIT_STAT_FIELDS) {
    mirrors[FEED_COLUMN[field]] = line[field];
    effective[SPLIT_COLUMN[field]] = line[field];
  }
  return { mirrors, effective };
}

/** Where a commissioner's typed line and the feed's numbers differ, field by field. */
function disagreements(existing, found) {
  const out = [];
  if (found.effective.coach_result !== undefined) {
    if (existing.coach_result !== found.effective.coach_result) {
      out.push({
        field: "result",
        label: "result",
        yours: existing.coach_result ?? null,
        feed: found.effective.coach_result,
      });
    }
    return out;
  }

  /* A LINE FROM BEFORE THE SPLIT CANNOT BE COMPARED FIELD BY FIELD. It carries one
   * combined `yards` figure, and a total does not say how much of it was passing - so
   * every split column reads blank and a naive comparison reports six disagreements
   * ("you have passing yards blank, the feed says 295") about a line the commissioner
   * filled in perfectly well. Said once, honestly, instead. Only historical rows and
   * the demo seed reach this; nothing written since 2026-08-28 has the old shape. */
  if (!rowHasSplit(existing) && (existing.yards != null || existing.tds != null)) {
    const total = statTotals(found.effective);
    const mine = { yards: existing.yards ?? 0, tds: existing.tds ?? 0 };
    /* Only when the TOTALS differ. Matching totals in two different shapes is the same
     * statement made twice, and the commissioner has nothing to do about it. */
    if (mine.yards !== total.yards || mine.tds !== total.tds) {
      out.push({
        field: "legacy",
        label: "totals from before the scoring split:",
        yours: mine.yards + " yds, " + mine.tds + " TD",
        feed: total.yards + " yds, " + total.tds + " TD",
      });
    }
    return out;
  }

  for (const field of SPLIT_STAT_FIELDS) {
    const mine = existing[SPLIT_COLUMN[field]];
    const theirs = found.effective[SPLIT_COLUMN[field]];
    /* A blank he never filled in is not a disagreement with a zero - it is the same
     * statement made two ways, and reporting it would bury the real ones. */
    if ((mine ?? 0) !== (theirs ?? 0)) {
      out.push({ field, label: LABEL[field] || field, yours: mine ?? null, feed: theirs });
    }
  }
  return out;
}

/** Combined totals of a feed line's split columns, for comparing against a legacy row. */
function statTotals(effective) {
  let yards = 0;
  let tds = 0;
  for (const c of STAT_CATEGORIES) {
    const v = Number(effective[SPLIT_COLUMN[c.field]]) || 0;
    if (c.kind === "yards") yards += v;
    else tds += v;
  }
  return { yards, tds };
}

/**
 * The writes, batched, with an id on every row.
 *
 * WHY THE ids ARE MINTED HERE. A pull writes new lines and corrections to existing ones
 * in the same upsert, and PostgREST builds ONE insert statement whose column list is the
 * union of the keys across the batch - so the moment any row carries `id`, every row
 * without one is sent an explicit NULL, and `default gen_random_uuid()` never gets to
 * run. It fails loudly (not-null violation) rather than corrupting anything, but only
 * once a league has both kinds of row in one pull, which is every pull after the first.
 *
 * This is the same shape as the bug poolWriteRows documents - a batched write is not
 * just a faster loop, it is a different statement - and it is the second time on this
 * project, which is why it is written down here too.
 *
 * `newId` is injectable for the same reason `rng` is: so a test can be deterministic.
 */
export function statWriteRows({ writes, chunkSize = STAT_WRITE_CHUNK, newId = randomUUID }) {
  const withIds = writes.map((row) => (row.id ? row : { ...row, id: newId() }));
  const size = Math.max(1, Math.floor(chunkSize) || 0);
  const chunks = [];
  for (let i = 0; i < withIds.length; i += size) chunks.push(withIds.slice(i, i + size));
  return chunks;
}
