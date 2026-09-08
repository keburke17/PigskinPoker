/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 859-991.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useEffect, useState } from "react";
import { SUIT_GLYPH, formatClock, hasSplitStats, periodLabel, statLineTotals } from "../engine/index.js";

export function SuitBadge({ position }) {
  return <span className={"pp-suit-badge pp-suit-" + position} title={position}>{SUIT_GLYPH[position] || "?"}</span>;
}

/* THE SLOT, DEALT AS A CARD (issue #33).
 *
 * A roster row used to open with two separate things saying nearly the same word: a
 * small grey "QB" label, then a coloured suit badge, then "QB - Detroit Lions" again in
 * the meta line. Scott's note on 2026-09-07 was that the position deserves to be the
 * loud thing on the left and should be said once. So the label and the badge are one
 * object now - a miniature playing card, rank in the corner and the position's own pip
 * under it, which is what this game has been calling these all along.
 *
 * `slot` is the lineup place (COACH, QB, WR, RB, TE, FLEX, BN) and is the rank. The pip
 * and the ink come from the PLAYER'S position, so a running back in the FLEX deals as a
 * club under a FLEX rank and the two facts stay distinguishable. An empty slot gets the
 * outline of a card with no pip on it, which is exactly what it is.
 */
export function PositionCard({ slot, position }) {
  const suited = position && SUIT_GLYPH[position] ? position : null;
  const title = position ? (position === slot ? slot : slot + " - " + position) : slot;
  return (
    <span className={"pp-pos-card " + (suited ? "pp-pos-" + suited : "pp-pos-empty")} title={title}>
      <span className="pp-pos-card-rank">{slot}</span>
      <span className="pp-pos-card-pip">{position ? SUIT_GLYPH[position] || "?" : ""}</span>
    </span>
  );
}

export function Tag({ children }) {
  return <span className="pp-tag">{children}</span>;
}

/* `action` is an optional { label, onClick } shown beside Dismiss. It exists so a banner
 * that reports something the reader can DO about it can offer that thing where the report
 * is, rather than parking a permanent control somewhere else on the page - see the
 * save-failure banner in App.jsx, and issue #69. */
export function ErrorBanner({ message, onDismiss, action }) {
  if (!message) return null;
  const isObj = typeof message === "object";
  const headline = isObj ? message.headline : message;
  const detail = isObj ? message.detail : null;
  return (
    <div className="pp-error-banner">
      <div>
        <div>{headline}</div>
        {detail ? <code>{detail}</code> : null}
      </div>
      {action || onDismiss ? (
        <div className="pp-error-banner-actions">
          {action ? <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={action.onClick}>{action.label}</button> : null}
          {onDismiss ? <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onDismiss}>Dismiss</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConfirmButton({ label, confirmLabel, onConfirm, className, danger, big }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);
  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 8 }}>
        <button
          className={"pp-btn " + (danger ? "pp-btn-danger" : "pp-btn-gold") + (big ? "" : " pp-btn-sm")}
          onClick={() => { setConfirming(false); onConfirm(); }}
        >
          {confirmLabel || "Are you sure? Yes"}
        </button>
        <button className="pp-btn pp-btn-ghost pp-btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button className={className || ("pp-btn " + (danger ? "pp-btn-danger" : "") + (big ? "" : " pp-btn-sm"))} onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}

/* The confirm button says what it is about to do. It defaulted to wiping a league
   because that was the only thing it guarded; deleting one needs its own words, and a
   button that lies about which of the two you pressed is the last thing this control
   should do. */
export function TypedConfirm({ phrase, onConfirm, label, confirmLabel = "Confirm & Wipe League" }) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(false);
  if (!active) {
    return <button className="pp-btn pp-btn-danger" onClick={() => setActive(true)}>{label}</button>;
  }
  return (
    <div className="pp-card-tight" style={{ border: "1px solid #7a2e29", borderRadius: 8, background: "rgba(226,86,75,0.08)" }}>
      <p className="pp-sub" style={{ marginTop: 0 }}>
        Type <strong style={{ color: "#ffb4a8" }}>{phrase}</strong> below to confirm. This cannot be undone.
      </p>
      <input className="pp-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={phrase} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="pp-btn pp-btn-danger"
          disabled={value !== phrase}
          onClick={() => { onConfirm(); setActive(false); setValue(""); }}
        >
          {confirmLabel}
        </button>
        <button className="pp-btn pp-btn-ghost" onClick={() => { setActive(false); setValue(""); }}>Cancel</button>
      </div>
    </div>
  );
}

/* NO Save Now BUTTON HERE, DELIBERATELY - issue #69. The artifact had one and it was a
 * real escape hatch there: the league was a single blob saved on every change, so a failed
 * write left it stale and pressing the button rewrote the lot. In the port the button called
 * `queue.flush()`, which returns immediately when nothing is pending - so in the "Saved"
 * state, which is what this bar reads almost all of the time, it did nothing at all while
 * claiming to save. The one thing it could still do - skip the retry backoff after a failed
 * write - now lives as "Retry now" INSIDE the save-failure banner, where it is shown only
 * when there is something to retry. Do not put it back on the bar. */
export function SaveStatusBar({ status, lastSavedAt }) {
  const color = status === "saving" ? "var(--gold)" : status === "error" ? "var(--danger)" : "var(--ok)";
  const text = status === "saving" ? "Saving..." : status === "error" ? "Save failed" : (lastSavedAt ? "Saved at " + formatClock(lastSavedAt) : "Saved");
  return (
    <div className="pp-savebar">
      <span><span className="pp-savedot" style={{ background: color }} />{text}</span>
    </div>
  );
}

export function LabeledSelect({ label, value, onChange, options, placeholder, disabled }) {
  return (
    <div className="pp-field">
      {label ? <label className="pp-label">{label}</label> : null}
      <select className="pp-select" value={value == null ? "" : value} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="pp-empty">{children}</div>;
}

export function phaseText(state) {
  const phase = state.currentPeriod.phase;
  if (phase === "pre-deal") return "Not dealt yet";
  if (phase === "dealt") return state.rosterLocked ? "Rosters locked" : "Schemes open";
  if (phase === "schemes-processed") return "Stats in progress";
  return phase;
}

export function PeriodBanner({ state, extra }) {
  return (
    <div className="pp-period-banner">
      <span className="pp-period-banner-label">{periodLabel(state.currentPeriod)}</span>
      <span className="pp-period-banner-phase">{phaseText(state)}</span>
      {extra ? <span className="pp-period-banner-extra">{extra}</span> : null}
    </div>
  );
}

export function statLineText(state, player, line) {
  if (!player) return "";
  if (player.position === "Coach") {
    return line && line.result ? line.result : "no result entered";
  }
  /* Split lines read out only the categories that actually have something in them, so a
   * receiver says "84 rec yds, 1 TD" rather than dragging six zeroes behind him. Lines
   * recorded before the 2026-08-28 split still read the way they always did. */
  if (hasSplitStats(line)) {
    const parts = [];
    const add = (v, label) => {
      const n = Number(v) || 0;
      if (n !== 0) parts.push(n + " " + label);
    };
    add(line.passYards, "pass yds");
    add(line.rushYards, "rush yds");
    add(line.recYards, "rec yds");
    const tds = statLineTotals(line).tds;
    if (tds !== 0) parts.push(tds + " TD");
    return parts.length ? parts.join(", ") : "0 yds, 0 TD";
  }
  const yards = line && line.yards != null ? line.yards : 0;
  const tds = line && line.tds != null ? line.tds : 0;
  return yards + " yds, " + tds + " TD";
}


/* Who you are signed in as, and nothing else.
 *
 * This used to be the whole migration-by-invitation flow: an offer to connect an email
 * to a join-code session, dismissible forever, so nobody was forced off a code they
 * were happily using. There are no code sessions left to migrate - signing in IS an
 * account now - so all that remains is saying whose account it is, which matters on a
 * shared laptop.
 *
 * It renders nothing until the account check has settled, so it cannot flicker into
 * view and back out on every load.
 */
export function AccountBar({ account, accountChecked }) {
  if (!accountChecked || !account) return null;
  return <div className="pp-account-bar"><span>Signed in as {account.email}</span></div>;
}
