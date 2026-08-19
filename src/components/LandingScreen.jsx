/* The front door, Phase 3d.
 *
 * Before multi-league there was one league and the app simply WAS it, so the first
 * screen could go straight to "which team are you". With leagues that are created and
 * joined, the first question changes, and the plan named three doors:
 *
 *   1. Sign in            - then your leagues. One league, go straight in.
 *   2. I have a code      - type the code FIRST. That is the texted-to-you flow, and
 *                           gating it behind a sign-in wall gets it abandoned.
 *   3. Create a league    - sign in, name it, and you are its commissioner.
 *
 * Door 2 leading before sign-in is the deliberate bit. Redemption still requires an
 * account - it mints a membership, and a membership belongs to a person - but the code
 * is what arrives in a text message, so it is what the screen asks for first.
 */

import { useEffect, useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { ErrorBanner } from "./atoms.jsx";

export function LandingScreen({
  account,
  leagues,
  leaguesLoading,
  initialCode = "",
  onSignInWithEmail,
  onRedeemInvite,
  onCreateLeague,
  onOpenLeague,
  onSignOut,
  error,
  setError,
}) {
  // An invite link (/join/<code>) lands here with the code already in hand, so the
  // redeem door opens itself rather than making someone find it.
  const [mode, setMode] = useState(initialCode ? "code" : null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [leagueName, setLeagueName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialCode) { setCode(initialCode); setMode("code"); }
  }, [initialCode]);

  const signedIn = !!account;

  const submitEmail = async () => {
    const r = await onSignInWithEmail(email);
    if (r?.ok) setSent(true);
  };

  const redeem = async () => {
    setBusy(true);
    await onRedeemInvite(code);
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    await onCreateLeague(leagueName);
    setBusy(false);
  };

  return (
    <div className="pp-login-wrap">
      <div className="pp-login-card">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="pp-eyebrow">Welcome to</div>
          <h1 className="pp-h1" style={{ fontSize: 32 }}>{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
          <p className="pp-sub">A new hand every week. Play the deal, work the scheme.</p>
        </div>

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {/* Signed in: your leagues ARE the landing page. */}
        {signedIn && !mode && (
          <div className="pp-card">
            <h3 className="pp-h3">Your Leagues</h3>
            {leaguesLoading ? (
              <p className="pp-sub">Looking for your leagues...</p>
            ) : leagues.length === 0 ? (
              <p className="pp-sub">
                You are not in a league yet. Redeem an invite code, or create one of your own.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {leagues.map((l) => (
                  <button key={l.id} className="pp-btn pp-btn-gold pp-btn-block" onClick={() => onOpenLeague(l.id)}>
                    {l.name}
                    <span style={{ opacity: 0.75, fontWeight: 400 }}>
                      {"  -  " + (l.role === "commissioner" ? "Commissioner" : l.teamName || "Manager")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="pp-btn pp-btn-sm" onClick={() => setMode("code")}>Redeem an invite</button>
              <button className="pp-btn pp-btn-sm" onClick={() => setMode("create")}>Create a league</button>
              <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onSignOut}>Sign out</button>
            </div>
            <div className="pp-hint">Signed in as {account.email}</div>
          </div>
        )}

        {!signedIn && !mode && (
          <div className="pp-card">
            <button className="pp-btn pp-btn-gold pp-btn-block" style={{ marginBottom: 10 }} onClick={() => { setMode("signin"); setError(null); }}>
              Sign In
            </button>
            <button className="pp-btn pp-btn-block" style={{ marginBottom: 10 }} onClick={() => { setMode("code"); setError(null); }}>
              I Have An Invite Code
            </button>
            <button className="pp-btn pp-btn-block" onClick={() => { setMode("create"); setError(null); }}>
              Create A League
            </button>
          </div>
        )}

        {mode === "signin" && (
          <div className="pp-card">
            <h3 className="pp-h3">Sign In</h3>
            {sent ? (
              <p className="pp-sub">
                Check your email - we sent a sign-in link to <strong>{email}</strong>. Open it on
                this device. The link works once.
              </p>
            ) : (
              <>
                <p className="pp-sub" style={{ marginBottom: 10 }}>No password. We email you a link and you tap it.</p>
                <div className="pp-field">
                  <label className="pp-label">Email</label>
                  <input className="pp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <button className="pp-btn pp-btn-gold" disabled={!email.trim()} onClick={submitEmail}>Email Me A Link</button>
              </>
            )}
            <button className="pp-btn pp-btn-ghost pp-btn-sm" style={{ marginTop: 10 }} onClick={() => { setMode(null); setSent(false); }}>Back</button>
          </div>
        )}

        {mode === "code" && (
          <div className="pp-card">
            <h3 className="pp-h3">Redeem An Invite</h3>
            <div className="pp-field">
              <label className="pp-label">Invite Code</label>
              <input
                className="pp-input"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCDEF-GHJKMNPQRS"
                style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", letterSpacing: "0.06em" }}
              />
            </div>
            {signedIn ? (
              <button className="pp-btn pp-btn-gold" disabled={!code.trim() || busy} onClick={redeem}>
                {busy ? "Joining..." : "Join League"}
              </button>
            ) : (
              /* The code is kept in the box across sign-in, so nobody has to find the
                 text message again after tapping the magic link. */
              <>
                <div className="pp-hint">
                  Codes are per-person from here on, so we need to know who you are. Sign in
                  and this code will be waiting.
                </div>
                <div className="pp-field" style={{ marginTop: 8 }}>
                  <label className="pp-label">Email</label>
                  <input className="pp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                {sent ? (
                  <p className="pp-sub">Check {email} for your sign-in link.</p>
                ) : (
                  <button className="pp-btn pp-btn-gold" disabled={!email.trim()} onClick={submitEmail}>Email Me A Link</button>
                )}
              </>
            )}
            <button className="pp-btn pp-btn-ghost pp-btn-sm" style={{ marginTop: 10 }} onClick={() => { setMode(null); setSent(false); }}>Back</button>
          </div>
        )}

        {mode === "create" && (
          <div className="pp-card">
            <h3 className="pp-h3">Create A League</h3>
            {signedIn ? (
              <>
                <div className="pp-field">
                  <label className="pp-label">League Name</label>
                  <input className="pp-input" type="text" value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder="The Sunday Boys" />
                </div>
                <div className="pp-hint">
                  You will be its commissioner. New leagues are private - only members can
                  see them - and you can change that later.
                </div>
                <button className="pp-btn pp-btn-gold" style={{ marginTop: 8 }} disabled={!leagueName.trim() || busy} onClick={create}>
                  {busy ? "Creating..." : "Create League"}
                </button>
              </>
            ) : (
              <>
                <p className="pp-sub" style={{ marginBottom: 10 }}>
                  Sign in first - a league belongs to a person, so it needs to know who you are.
                </p>
                <div className="pp-field">
                  <label className="pp-label">Email</label>
                  <input className="pp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                {sent ? (
                  <p className="pp-sub">Check {email} for your sign-in link.</p>
                ) : (
                  <button className="pp-btn pp-btn-gold" disabled={!email.trim()} onClick={submitEmail}>Email Me A Link</button>
                )}
              </>
            )}
            <button className="pp-btn pp-btn-ghost pp-btn-sm" style={{ marginTop: 10 }} onClick={() => { setMode(null); setSent(false); }}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
