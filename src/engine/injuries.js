/* Pigskin Poker - the NFL injury report, as a manager reads it. OQ-29.
 *
 * Scott, 2026-10-17: "I just want to be able to look at my roster and see what players are
 * currently injured and who may or may not play ... but I need that to be updated
 * throughout the week." He chose, from four rounds of mockups, a pill beside the name
 * (QUES / DOUBT / OUT) and a notepad that opens the week's practice report, with a key
 * saying what DNP, LP and FP mean.
 *
 * DISPLAY ONLY. Nothing in the deal, the schemes, scoring, the lineup lock or finalize
 * reads anything in this file, and he asked twice for it to stay that way: "This has
 * nothing to do with the deal, correct?" A player's `status` - the field the deal DOES
 * read - is untouched by the injury report. See the migration for why they are separate.
 *
 * Shared by the server (which uses the date arithmetic to decide which day a reading
 * belongs to) and the browser (which uses the same arithmetic to draw the three boxes),
 * so the two cannot disagree about what "Thursday's report" means.
 */

/* The NFL publishes the report in Eastern time, and every date below is an Eastern date. */
export const INJURY_TZ = "America/New_York";

/* The report's own words -> the short forms the screen uses. Anything else is not a
 * practice reading at all (the file has a handful of blanks) and records nothing. */
export const PRACTICE_CODES = {
  "Did Not Participate In Practice": "DNP",
  "Limited Participation in Practice": "LP",
  "Full Participation in Practice": "FP",
};

/* Spelled out once, for the key at the bottom of every notepad. Scott asked for it by
 * name: "make sure that people would know what DNP, LP, and FP mean". */
export const PRACTICE_KEY = [
  { code: "DNP", label: "Did not participate" },
  { code: "LP", label: "Limited participant" },
  { code: "FP", label: "Full participant" },
];

export const GAME_STATUSES = ["Questionable", "Doubtful", "Out"];

/* What the pill says. Short, because it sits on the name line beside the team chip. */
export const GAME_STATUS_PILL = { Questionable: "QUES", Doubtful: "DOUBT", Out: "OUT" };

/** The report's practice wording as DNP / LP / FP, or null. Case-insensitive, because the
 * file is not consistent about "In" and "in". */
export function practiceCode(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  for (const [words, code] of Object.entries(PRACTICE_CODES)) {
    if (words.toLowerCase() === t) return code;
  }
  return null;
}

/** 'Questionable' | 'Doubtful' | 'Out' | null, from the report's game-status column. */
export function gameStatusOf(text) {
  const t = String(text || "").trim().toLowerCase();
  return GAME_STATUSES.find((s) => s.toLowerCase() === t) || null;
}

/* ------------------------------------------------------------- dates -- */

let formatter = null;
function easternParts(ms) {
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: INJURY_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  }
  const out = {};
  for (const p of formatter.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);

/** The Eastern calendar date of an instant, as YYYY-MM-DD. Null for anything unreadable. */
export function easternDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const p = easternParts(ms);
  return isoDate(p.year, p.month, p.day);
}

/** A YYYY-MM-DD date moved by whole days. Calendar arithmetic, so no clock is involved. */
export function addDays(date, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Sunday .. 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Wed" for a YYYY-MM-DD date. */
export function dayLabel(date) {
  const w = weekdayOf(date);
  return w == null ? "" : DAY_NAMES[w];
}

/* Teams put out the day's report in the late afternoon, Eastern. */
export const REPORT_HOUR = 16;

/**
 * Which day's report a copy of the file published at `publishedAt` holds.
 *
 * WHY THIS IS NEEDED AT ALL. nflverse's injury file keeps one row per player per week and
 * overwrites it with each new report - there is no date column. So a Wednesday reading
 * and a Thursday reading only exist side by side if we save each one, and to save one we
 * have to say which day it is from.
 *
 * WHY THE PUBLISH TIME AND NOT OURS. Our pull runs every few hours; the file changes about
 * once a day. Dating a reading by when WE looked would file Wednesday's report under
 * Thursday every time the pull happened to run on Thursday morning. The file's own
 * Last-Modified time says when nflverse published it, which is the thing that actually
 * moves.
 *
 * THE RULE: a copy published before 4pm Eastern holds YESTERDAY'S report, one published
 * at or after 4pm holds TODAY'S. Teams release the day's report in the late afternoon, and
 * on 2026-10-17 the file was last published at 7:33am Eastern on a Saturday, carrying
 * Friday's final report - which is exactly the case this gets right.
 *
 * @returns {string|null} YYYY-MM-DD, Eastern
 */
export function reportDateOf(publishedAt) {
  const ms = Date.parse(publishedAt);
  if (!Number.isFinite(ms)) return null;
  const p = easternParts(ms);
  const today = isoDate(p.year, p.month, p.day);
  return p.hour >= REPORT_HOUR ? today : addDays(today, -1);
}

/**
 * The three practice-report days before a game, ending with the final report - the one
 * that carries the Q / D / O.
 *
 * Sunday, Monday and Saturday games put out their final report two days before (Friday,
 * Saturday, Thursday). A game on any other day - Thursday nights, Thanksgiving, a Friday
 * - has a short week and puts it out the day before. So a Sunday game reads
 * Wed / Thu / Fri, a Monday game Thu / Fri / Sat, and a Thursday game Mon / Tue / Wed.
 *
 * Null when the kickoff is not known, and every caller treats that as "do not filter"
 * rather than "no days" - a week whose schedule has not been read must not throw a
 * player's report away.
 *
 * @returns {string[]|null} three YYYY-MM-DD dates, oldest first
 */
export function practiceDays(kickoffIso) {
  const game = easternDate(kickoffIso);
  if (!game) return null;
  const w = weekdayOf(game);
  const final = addDays(game, w === 0 || w === 1 || w === 6 ? -2 : -1);
  return [addDays(final, -2), addDays(final, -1), final];
}

/* ------------------------------------------------------- the browser -- */

function injuriesFor(state, playerId) {
  const all = state && state._meta && state._meta.injuries;
  return (all && playerId != null && all[playerId]) || null;
}

function anyInjuriesForWeek(state, week) {
  const all = state && state._meta && state._meta.injuries;
  if (!all) return false;
  for (const weeks of Object.values(all)) if (weeks && weeks[week]) return true;
  return false;
}

/**
 * What the injury report says about this player this week, ready to draw - or null when
 * he is not on it.
 *
 * LAST WEEK'S FINAL REPORT STANDS IN UNTIL THIS WEEK'S FIRST ONE ARRIVES. Rosters are
 * dealt on Tuesday and the NFL's first report of the new week is Wednesday afternoon, so
 * for a day or two "this week's report" does not exist yet. Showing nothing would tell a
 * manager his Out-last-Sunday receiver is fine; showing last week's verdict, and saying
 * that is what it is, tells him what is actually known. The moment ANY player has a row
 * for the new week, the old week's rows stop being shown, so a player who is off the new
 * report is shown as off it.
 *
 * @param {object} state  hydrated league state
 * @param {object} player a pool player
 * @returns {null | {
 *   status: 'Questionable'|'Doubtful'|'Out'|null,
 *   pill: string|null,
 *   injury: string|null,
 *   days: Array<{ date: string, label: string, code: 'DNP'|'LP'|'FP'|null }>,
 *   reportDate: string|null,
 *   isFinal: boolean,       the newest reading is the final report before his game
 *   lastWeek: boolean,      this is last week's report, standing in
 *   nflWeek: number,
 *   updatedAt: string|null,
 * }}
 */
export function playerInjury(state, player) {
  if (!player || player.position === "Coach") return null;
  const weeks = injuriesFor(state, player.id);
  if (!weeks) return null;
  const current = Number(state && state._meta ? state._meta.nflWeek : NaN);
  if (!Number.isFinite(current)) return null;

  let week = current;
  let row = weeks[current] || null;
  let lastWeek = false;
  if (!row && !anyInjuriesForWeek(state, current) && weeks[current - 1]) {
    week = current - 1;
    row = weeks[current - 1];
    lastWeek = true;
  }
  if (!row) return null;

  const practice = row.practice || {};
  /* The boxes follow HIS game: a Thursday-night player's boxes read Mon / Tue / Wed. The
   * current week's kickoffs are the only ones the browser holds, so last week's stand-in
   * shows the days it has instead, newest three. */
  const kickoff = !lastWeek ? gameKickoff(state, player) : null;
  const window = kickoff ? practiceDays(kickoff) : null;
  const dates = window || Object.keys(practice).sort().slice(-3);
  const days = dates.map((date) => ({ date, label: dayLabel(date), code: practice[date] || null }));

  const status = row.status || null;
  const isFinal = !!(status || (window && row.reportDate && row.reportDate >= window[2]));
  return {
    status,
    pill: status ? GAME_STATUS_PILL[status] : null,
    injury: row.injury || null,
    days,
    reportDate: row.reportDate || null,
    isFinal,
    lastWeek,
    nflWeek: week,
    updatedAt: row.updatedAt || null,
  };
}

/* Kept local rather than imported from lineupLock.js so this file stays a leaf that the
 * server can load without the rest of the engine's lock rules. Both shapes of a kickoff
 * entry are read, for the reason lineupLock.js gives. */
function gameKickoff(state, player) {
  const k = state && state._meta && state._meta.kickoffs;
  const entry = k && player.team ? k[player.team] : null;
  if (!entry) return null;
  return typeof entry === "string" ? entry : entry.at || null;
}
