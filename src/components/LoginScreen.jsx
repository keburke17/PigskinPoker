/* Pigskin Poker UI - extracted verbatim from
 * LegacyProject/PigskinPokerCode.jsx lines 1046-1130.
 * Only module boundaries were added: imports at the top, `export` on each
 * declaration. No component body was edited.
 */

import { useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { ErrorBanner } from "./atoms.jsx";

export function LoginScreen({ state, onCommissionerLogin, onManagerLogin, loginError, setLoginError }) {
  const [mode, setMode] = useState(null); // 'commish' | 'manager'
  const [code, setCode] = useState("");
  const [teamId, setTeamId] = useState("");
  const [joinCode, setJoinCode] = useState("");

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

