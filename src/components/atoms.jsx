/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 859-991.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useEffect, useState } from "react";
import { SUIT_GLYPH, formatClock, periodLabel } from "../engine/index.js";

export function SuitBadge({ position }) {
  return <span className={"pp-suit-badge pp-suit-" + position} title={position}>{SUIT_GLYPH[position] || "?"}</span>;
}

export function Tag({ children }) {
  return <span className="pp-tag">{children}</span>;
}

export function ErrorBanner({ message, onDismiss }) {
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
      {onDismiss ? <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onDismiss}>Dismiss</button> : null}
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

export function TypedConfirm({ phrase, onConfirm, label }) {
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
          Confirm & Wipe League
        </button>
        <button className="pp-btn pp-btn-ghost" onClick={() => { setActive(false); setValue(""); }}>Cancel</button>
      </div>
    </div>
  );
}

export function SaveStatusBar({ status, lastSavedAt, onSaveNow, error }) {
  const color = status === "saving" ? "#d9b64c" : status === "error" ? "#e2564b" : "#5cb37f";
  const text = status === "saving" ? "Saving..." : status === "error" ? "Save failed" : (lastSavedAt ? "Saved at " + formatClock(lastSavedAt) : "Saved");
  return (
    <div className="pp-savebar">
      <span><span className="pp-savedot" style={{ background: color }} />{text}</span>
      <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onSaveNow}>Save Now</button>
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
