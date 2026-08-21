/* Pigskin Poker UI - the sign-in screen.
 *
 * Originally extracted verbatim from LegacyProject/PigskinPokerCode.jsx lines 1046-1130,
 * which offered two code boxes: "I'm a Team Manager" and "I'm the Commissioner". Both
 * are gone. A join code WAS the identity - sharing it was account sharing, rotating it
 * signed people out, and it could never be read back to whoever lost it. An invitation
 * authorizes one join and is then spent, which is what people wanted from a code all
 * along. See docs/AUTH.md.
 *
 * So there is one door: an email address and a link. No password to store, no reset
 * flow to build, and it suits a dozen people who sign in a few times a season.
 */

import { useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { ErrorBanner } from "./atoms.jsx";

export function LoginScreen({ onSignInWithEmail, loginError, setLoginError }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <div className="pp-login-wrap">
      <div className="pp-login-card">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="pp-eyebrow">Welcome to</div>
          <h1 className="pp-h1" style={{ fontSize: 32 }}>{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
          <p className="pp-sub">A new hand every week. Play the deal, work the scheme.</p>
        </div>

        <div className="pp-card">
          <h3 className="pp-h3">Sign In</h3>
          {sent ? (
            <>
              <p className="pp-sub">
                Check your email - we sent a sign-in link to <strong>{email}</strong>. Open it on
                this device and you will be signed straight in. The link works once, and this is
                now the ONLY one that will - any earlier email has just been cancelled.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="pp-btn pp-btn-ghost" onClick={() => setSent(false)}>Back</button>
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
              {/* Said up front rather than discovered as a failure. Signing in proves who
                  you are; it does not make you a member of anything. An address nobody
                  invited lands nowhere, and that is the point of it. */}
              <div className="pp-hint">
                First time? Ask your commissioner for an invite link - signing in on its own
                does not join you to a league.
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
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
