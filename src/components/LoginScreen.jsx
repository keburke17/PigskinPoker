/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1046-1130.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { ErrorBanner } from "./atoms.jsx";

export function LoginScreen({ state, onCommissionerLogin, onManagerLogin, onSignInWithEmail, accountsAvailable, loginError, setLoginError }) {
  const [mode, setMode] = useState(null); // 'commish' | 'manager' | 'email'
  const [code, setCode] = useState("");
  const [teamId, setTeamId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const hasCode = !!state.commissionerCodeSet;

  return (
    <div className="pp-login-wrap">
      <div className="pp-login-card">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="pp-eyebrow">Welcome to</div>
          <h1 className="pp-h1" style={{ fontSize: 32 }}>{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
          <p className="pp-sub">A new hand every week. Play the deal, work the scheme.</p>
        </div>

        {!mode && (
          <div className="pp-card">
            <button className="pp-btn pp-btn-gold pp-btn-block" style={{ marginBottom: 10 }} onClick={() => { setMode("manager"); setLoginError(null); }}>
              I'm a Team Manager
            </button>
            <button className="pp-btn pp-btn-block" onClick={() => { setMode("commish"); setLoginError(null); }}>
              I'm the Commissioner
            </button>
            {/* An ADDITION beside the code boxes, never a replacement. Anyone who has
                not connected an email yet must still find the door they already know
                exactly where it was. */}
            {accountsAvailable ? (
              <>
                <div className="pp-or">or</div>
                <button className="pp-btn pp-btn-ghost pp-btn-block" onClick={() => { setMode("email"); setLoginError(null); }}>
                  Sign in with email
                </button>
              </>
            ) : null}
          </div>
        )}

        {mode === "email" && (
          <div className="pp-card">
            <h3 className="pp-h3">Sign In With Email</h3>
            {sent ? (
              <>
                <p className="pp-sub">
                  Check your email - we sent a sign-in link to <strong>{email}</strong>. Open it on
                  this device and you will be signed straight in. The link works once.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="pp-btn pp-btn-ghost" onClick={() => { setSent(false); setMode(null); }}>Back</button>
                </div>
              </>
            ) : (
              <>
                <p className="pp-sub" style={{ marginBottom: 10 }}>
                  No password. We email you a link and you tap it.
                </p>
                <div className="pp-field">
                  <label className="pp-label">Email</label>
                  <input
                    className="pp-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                {/* Said up front rather than discovered as a failure. An account is only
                    connected to a team by redeeming a join code once, so signing in with
                    an address nobody has connected lands you nowhere. */}
                <div className="pp-hint">
                  First time? Log in with your team&apos;s join code, then connect your email
                  from inside - after that this is all you need.
                </div>
                {loginError ? <ErrorBanner message={loginError} onDismiss={() => setLoginError(null)} /> : null}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className="pp-btn pp-btn-gold"
                    disabled={!email.trim()}
                    onClick={async () => {
                      const r = await onSignInWithEmail(email);
                      if (r?.ok) setSent(true);
                    }}
                  >
                    Email Me A Link
                  </button>
                  <button className="pp-btn pp-btn-ghost" onClick={() => setMode(null)}>Back</button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === "commish" && (
          <div className="pp-card">
            <h3 className="pp-h3">Commissioner Login</h3>
            <p className="pp-sub" style={{ marginBottom: 10 }}>
              {hasCode ? "Enter the commissioner code to continue." : "No commissioner code is set yet. Choose one now - you'll use it to log back in later."}
            </p>
            <div className="pp-field">
              <label className="pp-label">Commissioner Code</label>
              <input className="pp-input" type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" />
            </div>
            {loginError ? <ErrorBanner message={loginError} onDismiss={() => setLoginError(null)} /> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pp-btn pp-btn-gold" onClick={() => onCommissionerLogin(code)}>
                {hasCode ? "Log In" : "Create & Log In"}
              </button>
              <button className="pp-btn pp-btn-ghost" onClick={() => setMode(null)}>Back</button>
            </div>
          </div>
        )}

        {mode === "manager" && (
          <div className="pp-card">
            <h3 className="pp-h3">Team Manager Login</h3>
            {state.teams.length === 0 ? (
              <p className="pp-sub">No teams have been created yet - ask your commissioner to add your team first.</p>
            ) : (
              <>
                <div className="pp-field">
                  <label className="pp-label">Your Team</label>
                  <select className="pp-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    <option value="">Select your team...</option>
                    {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="pp-field">
                  <label className="pp-label">Join Code</label>
                  <input className="pp-input" type="text" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Enter your team's join code" />
                </div>
                {loginError ? <ErrorBanner message={loginError} onDismiss={() => setLoginError(null)} /> : null}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="pp-btn pp-btn-gold" onClick={() => onManagerLogin(teamId, joinCode)} disabled={!teamId}>Log In</button>
                  <button className="pp-btn pp-btn-ghost" onClick={() => setMode(null)}>Back</button>
                </div>
              </>
            )}
            {state.teams.length === 0 ? (
              <button className="pp-btn pp-btn-ghost" style={{ marginTop: 10 }} onClick={() => setMode(null)}>Back</button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== League Home ============================== */

