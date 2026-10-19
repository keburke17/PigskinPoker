/* Pigskin Poker - the weekly recap pop-up. A PROTOTYPE, for Scott to look at.
 *
 * The idea: when a week is finalized and the next one dealt, a manager opening the app
 * lands on a brand new roster with nothing saying how last week went. This card is what
 * they would see first - the finish, the standings move, a short funny write-up of what
 * happened, and a way through to the Week and League screens.
 *
 * Nothing in the app imports this yet. The words come from recapExamples.js, written by
 * hand; generating them from a week's real results is the part not built.
 *
 * Built on the welcome card's overlay (pp-overlay, WelcomeOverlay.jsx) so the two read as
 * one mechanism: background tap and a 44px x both close it.
 */

import { CP, ICON } from "../engine/index.js";

const UP = CP(0x25b2);
const DOWN = CP(0x25bc);

/* Glyphs by moment, built with CP() like every other glyph in the app. */
const KIND = {
  steal: { glyph: CP(0x1f4b0), tone: "gold" },
  redraw: { glyph: ICON.redraw, tone: "blue" },
  block: { glyph: ICON.shield, tone: "blue" },
  bench: { glyph: CP(0x1fa91), tone: "red" },
  injury: { glyph: CP(0x1f691), tone: "red" },
  close: { glyph: CP(0x1f62c), tone: "gold" },
  league: { glyph: CP(0x1f4e3), tone: "dim" },
};

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* Top three gold, bottom three red, everyone else plain. */
function finishTone(place, of) {
  if (place === 1) return "first";
  if (place <= 3) return "top";
  if (place > of - 3) return "bottom";
  return "mid";
}

function moveWords(move) {
  if (move > 0) return { cls: "up", text: UP + " " + move };
  if (move < 0) return { cls: "down", text: DOWN + " " + -move };
  return { cls: "flat", text: "-" };
}

function pts(n) {
  return Number.isInteger(n) ? n + ".0" : String(n);
}

export function WeeklyRecap({ recap, onClose, onGoTo }) {
  const tone = finishTone(recap.place, recap.of);
  const move = moveWords(recap.rankMove);
  const go = (tab) => {
    onGoTo(tab);
    onClose();
  };

  return (
    <div className="pp-overlay" onClick={onClose}>
      <div className={"pp-overlay-card pp-recap pp-recap-" + tone} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={"Week " + recap.week + " recap"}>
        <button className="pp-overlay-x" onClick={onClose} aria-label="Close">x</button>

        <div className="pp-eyebrow">
          Week {recap.week} Recap {ICON.dot} {recap.team}
        </div>
        <h2 className="pp-recap-headline">{recap.headline}</h2>

        {/* The scoreline: finish, score, what it earned, where it left you. */}
        <div className="pp-recap-line">
          <div className="pp-recap-place">
            <span className="pp-recap-place-num">{ordinal(recap.place)}</span>
            <span className="pp-recap-place-of">of {recap.of}</span>
          </div>
          <div className="pp-recap-stats">
            <div className="pp-recap-stat">
              <span className="pp-recap-stat-val">{pts(recap.score)}</span>
              <span className="pp-recap-stat-lbl">points</span>
            </div>
            <div className="pp-recap-stat">
              <span className="pp-recap-stat-val">+{recap.points}</span>
              <span className="pp-recap-stat-lbl">standings</span>
            </div>
            <div className="pp-recap-stat">
              <span className="pp-recap-stat-val">
                {ordinal(recap.rankNow)} <span className={"pp-recap-move " + move.cls}>{move.text}</span>
              </span>
              <span className="pp-recap-stat-lbl">overall</span>
            </div>
          </div>
        </div>
        <div className="pp-recap-margin">{recap.margin}</div>

        <p className="pp-recap-story">{recap.story}</p>

        <div className="pp-recap-players">
          <PlayerChip label="MVP" glyph={CP(0x1f525)} player={recap.mvp} tone="good" />
          <PlayerChip label="Dud" glyph={CP(0x1f480)} player={recap.dud} tone="bad" />
        </div>

        <div className="pp-recap-notes">
          {recap.notes.map((n, i) => {
            const k = KIND[n.kind] || KIND.league;
            return (
              <div key={i} className={"pp-recap-note tone-" + k.tone}>
                <span className="pp-recap-note-glyph" aria-hidden="true">{k.glyph}</span>
                <div>
                  <div className="pp-recap-note-title">{n.title}</div>
                  <div className="pp-recap-note-text">{n.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pp-overlay-actions">
          <button className="pp-btn pp-btn-gold" onClick={() => go("results")}>See the Scoreboard</button>
          <button className="pp-btn" onClick={() => go("home")}>See the Standings</button>
          <button className="pp-btn pp-btn-ghost" onClick={onClose}>On to Week {recap.week + 1}</button>
        </div>
        <p className="pp-recap-foot">This recap stays on My Team until next week's arrives.</p>
      </div>
    </div>
  );
}

function PlayerChip({ label, glyph, player, tone }) {
  return (
    <div className={"pp-recap-player " + tone}>
      <div className="pp-recap-player-head">
        <span aria-hidden="true">{glyph}</span> {label}
      </div>
      <div className="pp-recap-player-name">{player.name} <span className="pp-recap-player-pos">{player.pos}</span></div>
      <div className="pp-recap-player-pts">{pts(player.pts)} pts</div>
      <div className="pp-recap-player-note">{player.note}</div>
    </div>
  );
}

/* The quiet, permanent half - on My Team after the card is closed, so it can be read
 * again. Same pattern as NextStepNote under the welcome card. */
export function RecapReminder({ recap, onOpen }) {
  const tone = finishTone(recap.place, recap.of);
  return (
    <button className={"pp-recap-reminder pp-recap-" + tone} onClick={onOpen}>
      <span className="pp-recap-reminder-label">Week {recap.week}</span>
      <span className="pp-recap-reminder-text">
        {ordinal(recap.place)} of {recap.of} {ICON.dot} {recap.headline}
      </span>
      <span className="pp-recap-reminder-link">Read recap</span>
    </button>
  );
}
