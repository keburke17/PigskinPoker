/* Pigskin Poker UI - the injury pill and the notepad. OQ-29.
 *
 * SCOTT'S CALL, 2026-10-17, after four rounds of mockups - "N1 with the practice key":
 *
 *   - A PILL on the name line - QUES, DOUBT or OUT - only when the NFL has given him a
 *     game status. Coloured by how likely he is to sit.
 *   - A NOTEPAD beside it whenever he is on the report at all, even with no game status (a
 *     player practising through a sore hip). Tapping it opens the injury and the three
 *     practice days under the player, so the row itself stays as quiet as it was: "it
 *     doesn't take up quite as much room as everything else that's already listed there".
 *   - A KEY at the bottom of every opened notepad, behind an asterisk on "Practice", saying
 *     what DNP, LP and FP mean. He asked for that by name.
 *   - A GOLD DOT on the notepad when the report changed since you last opened it.
 *
 * DISPLAY ONLY. Nothing here reaches the deal, schemes or scoring - see
 * src/engine/injuries.js.
 */

import { useState } from "react";
import { PRACTICE_KEY, playerInjury } from "../engine/index.js";

/* Per-viewer memory of which reports you have opened - a convenience, not state anybody
 * else needs, so it lives in this browser and nowhere else. Every access is guarded: a
 * private window or blocked storage must cost the dot, never the row. */
const SEEN_KEY = "pp-injury-seen";
function readSeen() {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function markSeen(key, updatedAt) {
  try {
    const seen = readSeen();
    seen[key] = updatedAt;
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage refused - the dot simply stays */
  }
}

/* A report you have never opened is only "new" if it changed recently. Otherwise the
 * first visit after this ships would light every notepad in the league. */
const FRESH_MS = 24 * 60 * 60 * 1000;
function isFresh(key, updatedAt, now = Date.now()) {
  if (!updatedAt) return false;
  const seen = readSeen()[key];
  if (seen) return String(updatedAt) > String(seen);
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && now - t < FRESH_MS;
}

function NotepadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M4 2.5h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M5.5 1.5v2M8 1.5v2M10.5 1.5v2M5.5 7h5M5.5 9.5h5M5.5 12h3" />
    </svg>
  );
}

/**
 * The pill and notepad for one player, and the report the notepad opens.
 *
 * A hook rather than one component because the two halves live in different places on a
 * row: the pill and the notepad sit on the name line, and the report opens UNDER the
 * player, below his opponent and kickoff. Every row that shows a player calls this and
 * puts `tag` and `report` where they belong.
 *
 * @returns {{ tag: JSX|null, report: JSX|null }} both null when he is not on the report
 */
export function useInjuryNotes(state, player) {
  const [open, setOpen] = useState(false);
  const info = playerInjury(state, player);
  if (!info) return { tag: null, report: null };

  const leagueId = (state._meta && state._meta.leagueId) || "";
  const seenKey = leagueId + ":" + player.id + ":" + info.nflWeek;
  const fresh = !open && isFresh(seenKey, info.updatedAt);

  const toggle = () => {
    if (!open && info.updatedAt) markSeen(seenKey, info.updatedAt);
    setOpen(!open);
  };

  const tag = (
    <>
      {info.pill ? (
        <span className={"pp-inj-pill pp-inj-" + info.pill.toLowerCase()} title={info.status + (info.lastWeek ? " (last week)" : "")}>
          {info.pill}
        </span>
      ) : null}
      <button
        type="button"
        className={"pp-inj-pad" + (open ? " open" : "")}
        onClick={toggle}
        aria-expanded={open}
        aria-label={"Injury report for " + player.name}
        title="Injury report"
      >
        <NotepadIcon />
        {fresh ? <span className="pp-inj-new" aria-label="new update" /> : null}
      </button>
    </>
  );

  const report = open ? <InjuryReport info={info} /> : null;
  return { tag, report };
}

function reportWhen(info) {
  if (info.lastWeek) return "Last week's final report - this week's first is Wednesday";
  if (info.isFinal) return info.status ? "Final report" : "No game status - expected to play";
  const latest = info.days.filter((d) => d.code).slice(-1)[0];
  return latest ? latest.label + "'s report - game status comes with the final one" : "On this week's report";
}

function InjuryReport({ info }) {
  return (
    <div className="pp-inj-report">
      <div className="pp-inj-head">
        <span className="pp-inj-what">{info.injury || "Injury not given"}</span>
        <span className="pp-inj-when">{reportWhen(info)}</span>
      </div>
      {info.days.length ? (
        <>
          <div className="pp-inj-label">Practice<sup>*</sup></div>
          <div className="pp-inj-days">
            {info.days.map((d) => (
              <div key={d.date} className="pp-inj-day">
                <span>{d.label}</span>
                <b className={d.code ? "pp-inj-" + d.code.toLowerCase() : "pp-inj-none"}>{d.code || "-"}</b>
              </div>
            ))}
          </div>
          <div className="pp-inj-key">
            {PRACTICE_KEY.map((k, i) => (
              <span key={k.code}>
                {i === 0 ? <span className="pp-inj-star">* </span> : null}
                <b className={"pp-inj-" + k.code.toLowerCase()}>{k.code}</b> {k.label}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
