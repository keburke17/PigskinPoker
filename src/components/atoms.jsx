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


/* The "make this stick" prompt, Phase 3c.
 *
 * This is the entire migration-by-invitation flow as the league experiences it. It is
 * an OFFER: it appears once you are already in, it can be ignored forever, and dismissing
 * or declining it costs nothing. Your join code keeps working either way.
 *
 * It renders nothing at all in three cases - accounts unavailable (the in-memory demo),
 * the account check still in flight (so it cannot flicker into view and out again), and
 * the job already done. The last one matters: a prompt that keeps asking after you have
 * complied is how people learn to ignore an interface.
 */
export function AccountBar({ account, accountChecked, available, notice, onLink, onSignInWithEmail, onDismissNotice }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!available || !accountChecked) return null;

  if (notice) {
    return (
      <div className={"pp-account-bar " + (notice.bad ? "pp-account-bar-bad" : "pp-account-bar-good")}>
        <span>{notice.text}</span>
        <button className="pp-btn pp-btn-ghost pp-btn-sm" onClick={onDismissNotice}>OK</button>
      </div>
    );
  }

  // Signed in with an account already: say so quietly and get out of the way.
  if (account) {
    return <div className="pp-account-bar"><span>Signed in as {account.email}</span></div>;
  }

  if (dismissed) return null;

  if (!open) {
    return (
      <div className="pp-account-bar">
        <span>Connect your email so you do not need the join code on every device.</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button className="pp-btn pp-btn-sm pp-btn-gold" onClick={() => setOpen(true)}>Connect</button>
          <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setDismissed(true)}>Not now</button>
        </span>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="pp-account-bar">
        <span>
          Check {email} for a sign-in link. Open it on this device and your account will be
          connected to this team.
        </span>
      </div>
    );
  }

  return (
    <div className="pp-account-bar">
      <input
        className="pp-input"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{ maxWidth: 260 }}
      />
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button
          className="pp-btn pp-btn-sm pp-btn-gold"
          disabled={!email.trim()}
          onClick={async () => {
            const r = await onSignInWithEmail(email);
            if (r?.ok) setSent(true);
          }}
        >
          Send Link
        </button>
        <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </span>
    </div>
  );
}
