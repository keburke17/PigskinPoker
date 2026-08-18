/* Backup validation and schema migration.
 *
 * Fixes two problems the artifact shipped with:
 *
 *   P4 - `schemaVersion: 1` existed but nothing ever read it. There was no migration
 *        path, so the moment the shape changed, old backups and stored leagues broke.
 *   P9 - restore trusted its input. It checked that `teams` and `playerPool` were
 *        arrays and then put the file straight into app state. A malformed or
 *        truncated file became a corrupted league, and the auto-save wrote it back.
 *
 * The rule here: validate the WHOLE shape, and refuse rather than half-load. A refusal
 * the person can read beats a league that renders wrong three screens later.
 */

const CURRENT_SCHEMA_VERSION = 1;

/* ---------------------------------------------------------------------------
 *  Migrations. Each entry upgrades a document FROM its key version TO the next.
 *  Add one when the shape changes; never edit an old one.
 *
 *  Keeping this empty-but-real is deliberate: the chain, the version check and the
 *  tests all exist now, so the first genuine shape change is a five-line addition
 *  rather than a retrofit under pressure.
 * ------------------------------------------------------------------------- */
export const MIGRATIONS = {
  // 1: (doc) => ({ ...doc, schemaVersion: 2, /* ... */ }),
};

export function migrate(doc) {
  let out = doc;
  let guard = 0;
  while ((out.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION) {
    const from = out.schemaVersion ?? 1;
    const step = MIGRATIONS[from];
    if (!step) throw new Error("No migration from schemaVersion " + from);
    out = step(out);
    if (++guard > 50) throw new Error("Migration chain did not terminate");
  }
  return out;
}

/* --------------------------------- shape --------------------------------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const POSITIONS = ["Coach", "QB", "RB", "WR", "TE"];
const STATUSES = ["Active", "OUT", "IR", "BYE"];
const PHASES = ["pre-deal", "dealt", "schemes-processed", "stats", "finalized"];

/**
 * @returns {{ok: true, state: object} | {ok: false, problems: string[]}}
 */
export function validateBackup(input) {
  const problems = [];
  const fail = (m) => problems.push(m);

  if (!isObj(input)) return { ok: false, problems: ["The file isn't a JSON object."] };

  let doc = input;
  try {
    doc = migrate(input);
  } catch (e) {
    return { ok: false, problems: [e.message] };
  }

  if (typeof doc.schemaVersion !== "number") fail("Missing schemaVersion.");
  if (doc.schemaVersion > CURRENT_SCHEMA_VERSION) {
    fail(
      "This backup is from a newer version of the app (schemaVersion " +
        doc.schemaVersion +
        "; this app understands " +
        CURRENT_SCHEMA_VERSION +
        "). Update the app before restoring it."
    );
  }

  if (!Array.isArray(doc.teams)) fail("Missing or invalid `teams`.");
  if (!Array.isArray(doc.playerPool)) fail("Missing or invalid `playerPool`.");
  if (!Array.isArray(doc.weeklyResults)) fail("Missing or invalid `weeklyResults`.");
  if (!Array.isArray(doc.activityLog)) fail("Missing or invalid `activityLog`.");
  if (!isObj(doc.scoringConfig)) fail("Missing or invalid `scoringConfig`.");
  if (!isObj(doc.currentPeriod)) fail("Missing or invalid `currentPeriod`.");
  if (!isObj(doc.playoffConfig)) fail("Missing or invalid `playoffConfig`.");

  if (problems.length) return { ok: false, problems };

  /* scoring */
  for (const k of ["yardsPerPoint", "pointsPerTD", "coachWin", "coachTie", "coachLoss"]) {
    if (typeof doc.scoringConfig[k] !== "number") fail("scoringConfig." + k + " must be a number.");
  }

  /* current period */
  const cp = doc.currentPeriod;
  if (cp.type !== "week" && cp.type !== "playoff") fail("currentPeriod.type must be 'week' or 'playoff'.");
  if (typeof cp.number !== "number" || cp.number < 1) fail("currentPeriod.number must be a positive number.");
  if (!PHASES.includes(cp.phase)) fail("currentPeriod.phase is not a recognised phase.");

  /* players */
  const playerIds = new Set();
  doc.playerPool.forEach((p, i) => {
    if (!isObj(p)) return fail("playerPool[" + i + "] is not an object.");
    if (typeof p.id !== "string") fail("playerPool[" + i + "].id must be a string.");
    if (!POSITIONS.includes(p.position)) fail("playerPool[" + i + "] has an unknown position.");
    if (!STATUSES.includes(p.status)) fail("playerPool[" + i + "] has an unknown status.");
    if (playerIds.has(p.id)) fail("Duplicate player id " + p.id + ".");
    playerIds.add(p.id);
  });

  /* teams, and every roster reference resolving to a real player */
  const teamIds = new Set();
  doc.teams.forEach((t, i) => {
    if (!isObj(t)) return fail("teams[" + i + "] is not an object.");
    if (typeof t.id !== "string") fail("teams[" + i + "].id must be a string.");
    if (typeof t.name !== "string") fail("teams[" + i + "].name must be a string.");
    if (teamIds.has(t.id)) fail("Duplicate team id " + t.id + ".");
    teamIds.add(t.id);

    if (t.roster != null) {
      if (!isObj(t.roster) || !isObj(t.roster.starters) || !Array.isArray(t.roster.bench)) {
        return fail("teams[" + i + "].roster is malformed.");
      }
      if (t.roster.bench.length !== 6) fail("teams[" + i + "] must have exactly 6 bench slots.");
      const refs = [...Object.values(t.roster.starters), ...t.roster.bench].filter(Boolean);
      refs.forEach((pid) => {
        if (!playerIds.has(pid)) fail("teams[" + i + "] references unknown player " + pid + ".");
      });
    }
  });

  /* results reference real teams */
  doc.weeklyResults.forEach((r, i) => {
    if (!isObj(r)) return fail("weeklyResults[" + i + "] is not an object.");
    if (r.teamId && !teamIds.has(r.teamId)) fail("weeklyResults[" + i + "] references unknown team " + r.teamId + ".");
  });

  if (problems.length) return { ok: false, problems: problems.slice(0, 8) };
  return { ok: true, state: doc };
}
