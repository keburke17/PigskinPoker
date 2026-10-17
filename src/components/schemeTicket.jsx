/* The ticket: your scheme at the top of every screen, all week - and what it did.
 *
 * WHY THIS EXISTS. Scott, 2026-10-16: "the notification for what scheme you pick needs
 * to be louder and stick with your team throughout the week until it processes." The
 * confirmation lived only on My Team - the summary at the top of that screen and the
 * one beside the button (issue #27) - so the moment you went back to the Week screen
 * there was no sign you had played anything at all. He chose these out of several
 * rounds of mockups.
 *
 * TWO PIECES, DRAWN FOR A MANAGER ONLY:
 *
 *   - SchemeTicket, above the tab content on EVERY tab, while the week is `dealt` and
 *     you have submitted a scheme: what you played, and when it locks. Tap it to go and
 *     change it on My Team.
 *   - ResultStrip, on My Team and Rosters only, once schemes have processed and until
 *     the week is finalized: one line saying what your scheme did, with the moves as
 *     small tags. Deliberately small. The Week screen is where the app opens and it
 *     carries the full answer in your gold tile at the top of Around the league
 *     (activity.jsx), so a big banner there was the same news twice - Scott's call.
 *
 * IT READS, IT DOES NOT ACT. The scheme comes from state.schemes, the result from the
 * activity log through weekMoves.js. Nothing here touches how a scheme resolves.
 */

import {
  ICON,
  autoProcessSchemes,
  getPlayer,
  periodTeams,
  schemeDeadlineWords,
} from "../engine/index.js";
import { moveChip, moveHeadline, weekMoves } from "./weekMoves.js";

const SCHEME_CLASS = { block: "pp-tk-block", steal: "pp-tk-steal", redraw: "pp-tk-redraw", noaction: "pp-tk-quiet" };
const SCHEME_LABEL = { block: "Block", steal: "Steal", redraw: "Redraw", noaction: "No Action" };

function roundWord(state) {
  return state.currentPeriod.type === "playoff" ? "round" : "week";
}

/** The words on the ticket, as plain data so they can be tested. */
export function schemeTicketWords(state, sc) {
  if (!sc) return null;
  const player = getPlayer(state, sc.playerId);
  const who = player ? player.name : "?";
  if (sc.type === "block") return { big: "Blocking " + who, sub: (player ? player.position + " - " : "") + "nobody can steal him this " + roundWord(state) };
  if (sc.type === "steal") return { big: "Stealing a " + sc.position, sub: "dropping " + who + " to make room" };
  if (sc.type === "redraw") return { big: "Redrawing a " + sc.position, sub: "dropping " + who + " for a free agent" };
  return { big: "No Action this " + roundWord(state), sub: "your roster stays as dealt" };
}

export function SchemeTicket({ state, team, onOpen }) {
  if (!team || state.currentPeriod.phase !== "dealt") return null;
  const sc = state.schemes[team.id];
  if (!sc) return null;
  const words = schemeTicketWords(state, sc);
  const clock = autoProcessSchemes(state);
  return (
    <button type="button" className={"pp-ticket " + (SCHEME_CLASS[sc.type] || "pp-tk-quiet")} onClick={onOpen}>
      <span className="pp-ticket-main">
        <span className="pp-tk-chip">{SCHEME_LABEL[sc.type] || "Scheme"}</span>
        <span className="pp-ticket-big">{words.big}</span>
        <span className="pp-ticket-sub"><span className="pp-ticket-dot" />Locked in - {words.sub}</span>
      </span>
      <span className="pp-ticket-when">
        <b>{clock ? "Locks" : "Holds"}</b>
        <span>{clock ? schemeDeadlineWords(state) : "until schemes process"}</span>
        <span className="pp-ticket-change">Tap to change</span>
      </span>
    </button>
  );
}

/* The strip's tags, shorter than a transaction line: just the move and the player. */
export function stripTags(lines) {
  return (lines || []).map((l) => {
    if (l.kind === "add") return { cls: "add", text: "+ " + l.player + (l.note.startsWith("from free agency") ? " (FA)" : "") };
    if (l.kind === "drop") return { cls: "drop", text: "- " + l.player };
    if (l.kind === "stolen") return { cls: "stolen", text: "Stolen: " + l.player };
    if (l.kind === "block") return { cls: "add", text: "Safe: " + l.player };
    if (l.kind === "empty") return { cls: "stolen", text: l.player };
    return { cls: "drop", text: "Roster unchanged" };
  });
}

const RESULT_PHASES = { "schemes-processed": true, stats: true };

export function ResultStrip({ state, team, onSeeWeek }) {
  const period = state.currentPeriod;
  if (!team || !RESULT_PHASES[period.phase]) return null;
  if (!periodTeams(state).some((t) => t.id === team.id)) return null;
  const tm = weekMoves(state).teams.find((t) => t.teamId === team.id);
  if (!tm) return null;
  const chip = moveChip(tm);
  const headline = tm.lines.length > 0 || tm.scheme ? moveHeadline(tm) : "Nothing changed on your roster";
  const tags = stripTags(tm.lines);
  return (
    <div className={"pp-strip " + chip.cls.replace("pp-chip-", "pp-tk-")}>
      <div className="pp-strip-line">
        <span className="pp-tk-chip">{chip.label}</span>
        <span className="pp-strip-head">{headline}</span>
        {onSeeWeek ? (
          <button type="button" className="pp-linkbtn" onClick={onSeeWeek}>See the week {ICON.caretRight}</button>
        ) : null}
      </div>
      {tags.length > 0 ? (
        <div className="pp-strip-tags">
          {tags.map((t, i) => <span key={i} className={"pp-strip-tag pp-strip-" + t.cls}>{t.text}</span>)}
        </div>
      ) : null}
    </div>
  );
}
