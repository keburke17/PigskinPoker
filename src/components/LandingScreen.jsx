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
import { ErrorBanner } from "./atoms.jsx";
import { FILL_CHOICES } from "./table.jsx";
import { TABLE_SEATS_MAX } from "../engine/index.js";
import { ChevronIcon, GAMES, GameIcon, TitleBall, accentForGame, badgeTone, iconForGame } from "./games.jsx";
import { gameName, leagueStatus, leagueSubtitle } from "./homeStatus.js";

export function LandingScreen({
  account,
  leagues,
  leaguesLoading,
  initialCode = "",
  initialMode = null,
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
  const [mode, setMode] = useState(initialCode ? "code" : initialMode);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [leagueName, setLeagueName] = useState("");
  /* Issue #75: a season or a table, chosen once. A table also needs its seats and a
   * name for the dealer's own team, because the dealer plays at it. */
  const [leagueMode, setLeagueMode] = useState("season");
  /* OQ-39: the most dealt into one hand (12, unless the dealer wants a smaller game),
   * and who sits in from the lobby. */
  const [seats, setSeats] = useState(12);
  const [fill, setFill] = useState("line");
  const [myTeamName, setMyTeamName] = useState("");
  /* The name of the team an open invite makes for you (OQ-35). Blank is fine: it starts
   * as the front of your email address. Ignored by an invite for an existing team. */
  const [joinTeamName, setJoinTeamName] = useState("");
  /* OQ-37, Last Digit: the week it starts in, and how teams are handed out. */
  const [startWeek, setStartWeek] = useState(() => nflWeekGuess());
  const [teamDraw, setTeamDraw] = useState("random");
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
    await onRedeemInvite(code, joinTeamName.trim() || null);
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    await onCreateLeague(
      leagueName,
      leagueMode === "table"
        ? { mode: "table", seats, fill, teamName: myTeamName.trim() || null }
        : leagueMode === "lastdigit"
          ? { mode: "lastdigit", startWeek, teamDraw, teamName: myTeamName.trim() || null }
          : { teamName: myTeamName.trim() || null }
    );
    setBusy(false);
  };

  return (
    <div className="pp-login-wrap">
      <div className="pp-login-card">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div className="pp-eyebrow">{signedIn ? "Welcome back" : "Welcome to"}</div>
          <h1 className="pp-h1 pp-title-with-ball" style={{ fontSize: 32 }}><TitleBall size={32} /> Pigskin Poker</h1>
          <p className="pp-sub">A new hand every week. Play the deal, work the scheme.</p>
        </div>

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {/* THE HOMEPAGE (Scott, 2026-11-04 - "option A" on the design canvas).
          * Your leagues on top, each with its game's picture and what is happening in it
          * this week; then every game the site offers. Sleeper's shape, the site's look. */}
        {signedIn && !mode && (
          <section className="pp-home-section">
            <h2 className="pp-h2 pp-home-h">Your Leagues</h2>
            {leaguesLoading && leagues.length === 0 ? (
              <p className="pp-sub">Looking for your leagues...</p>
            ) : leagues.length === 0 ? (
              <p className="pp-sub">
                You are not in a league yet. Start a game below, or redeem an invite someone sent you.
              </p>
            ) : (
              leagues.map((l) => <LeagueRow key={l.id} league={l} onOpen={() => onOpenLeague(l.id)} />)
            )}
            <button className="pp-btn pp-btn-ghost pp-btn-block pp-home-tap" onClick={() => { setMode("code"); setError(null); }}>
              Redeem an invite
            </button>
          </section>
        )}

        {!signedIn && !mode && (
          <div className="pp-card">
            <button className="pp-btn pp-btn-gold pp-btn-block pp-home-tap" style={{ marginBottom: 10 }} onClick={() => { setMode("signin"); setError(null); }}>
              Sign In
            </button>
            <button className="pp-btn pp-btn-block pp-home-tap" onClick={() => { setMode("code"); setError(null); }}>
              I Have An Invite Code
            </button>
          </div>
        )}

        {/* Shown signed out as well: a first-time visitor sees what there is to play
          * before being asked for an email. PLAY on a game opens its create screen, which
          * asks them to sign in if they have not. */}
        {!mode && (
          <GameList onPlay={(g) => { setLeagueMode(g.mode); setMode("create"); setError(null); }} />
        )}

        {/* LOG OUT LIVES HERE, and only here (Scott, 2026-11-04). Inside a league the
          * header's corner is Home, which brings you to this page still signed in; this is
          * the one place to actually sign out, set apart from the leagues so nobody taps it
          * meaning "go back". */}
        {signedIn && !mode && (
          <div className="pp-account-foot">
            <span className="pp-hint">Signed in as {account.email}</span>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onSignOut}>Log Out</button>
          </div>
        )}

        {mode === "signin" && (
          <div className="pp-card">
            <h3 className="pp-h3">Sign In</h3>
            {sent ? (
              <p className="pp-sub">
                Check your email - we sent a sign-in link to <strong>{email}</strong>. Open it on
                this device. The link works once, and this is now the ONLY one that will - any
                earlier email has just been cancelled.
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
              <>
                <div className="pp-field">
                  <label className="pp-label">Your Team Name</label>
                  <input className="pp-input" type="text" value={joinTeamName} onChange={(e) => setJoinTeamName(e.target.value)} placeholder="Name your team" maxLength={40} />
                  <span className="pp-sub" style={{ display: "block", marginTop: 4 }}>Leave it blank and it starts as the front of your email address.</span>
                </div>
                <button className="pp-btn pp-btn-gold" disabled={!code.trim() || busy} onClick={redeem}>
                  {busy ? "Joining..." : "Join League"}
                </button>
              </>
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
            <div className="pp-create-head">
              <span className="pp-game-badge"><GameIcon icon={iconForGame(leagueMode)} size={28} tone="gold" /></span>
              <h3 className="pp-h3" style={{ margin: 0 }}>New {gameName(leagueMode)}</h3>
            </div>
            {signedIn ? (
              <>
                {/* The game was picked on the homepage, so there is no Season / Table
                  * toggle here any more - Back is how you choose the other one. */}
                <p className="pp-sub" style={{ marginBottom: 10 }}>
                  {leagueMode === "season"
                    ? "The same teams every week, a standings table, and playoffs at the end."
                    : leagueMode === "lastdigit"
                      ? "Everyone holds one NFL team for the season and scores the last digit of its real score every week. Most points after Week 18 wins. Up to 32 players."
                      : "One hand at a time. Players sit out a week or leave whenever they like, and the table keeps a tally of hands won and lost. No playoffs."}
                </p>
                <div className="pp-field">
                  <label className="pp-label">{leagueMode === "table" ? "Table Name" : leagueMode === "lastdigit" ? "Game Name" : "League Name"}</label>
                  <input className="pp-input" type="text" value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder={leagueMode === "table" ? "Tuesday Night Table" : leagueMode === "lastdigit" ? "The Office Pool" : "The Sunday Boys"} />
                </div>
                {leagueMode === "lastdigit" ? (
                  <>
                    <div className="pp-field">
                      <label className="pp-label" htmlFor="ld-start-week">Starts In</label>
                      <select id="ld-start-week" className="pp-select" value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))}>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                          <option key={w} value={w}>
                            Week {w}{w < nflWeekGuess() ? " (already played)" : w === nflWeekGuess() ? " (this week)" : ""}
                          </option>
                        ))}
                      </select>
                      <span className="pp-sub" style={{ display: "block", marginTop: 4 }}>
                        Weeks before it are left off the board. A week already played fills in straight away from the real scores.
                      </span>
                    </div>
                    <div className="pp-field">
                      <label className="pp-label">How Teams Are Handed Out</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className={"pp-btn pp-btn-sm" + (teamDraw === "random" ? " pp-btn-gold" : "")} aria-pressed={teamDraw === "random"} onClick={() => setTeamDraw("random")}>Random</button>
                        <button type="button" className={"pp-btn pp-btn-sm" + (teamDraw === "manual" ? " pp-btn-gold" : "")} aria-pressed={teamDraw === "manual"} onClick={() => setTeamDraw("manual")}>Individual draw</button>
                      </div>
                      <span className="pp-sub" style={{ display: "block", marginTop: 4 }}>
                        {teamDraw === "random"
                          ? "Once everyone has joined, you press Deal Teams and the app gives each player a team at random."
                          : "Once everyone has joined, you pick each player's team yourself - from a hat, a draft, however you like."}
                      </span>
                    </div>
                    <div className="pp-field">
                      <label className="pp-label">Your Name</label>
                      <input className="pp-input" type="text" value={myTeamName} onChange={(e) => setMyTeamName(e.target.value)} placeholder="Scott" />
                    </div>
                  </>
                ) : leagueMode === "table" ? (
                  <>
                    <div className="pp-field">
                      <label className="pp-label">Most Players In A Hand</label>
                      <select className="pp-input" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                        {Array.from({ length: TABLE_SEATS_MAX - 1 }, (_, i) => i + 2).map((n) => (
                          <option key={n} value={n}>{n} players{n === TABLE_SEATS_MAX ? " (the most)" : ""}</option>
                        ))}
                      </select>
                      <span className="pp-sub">Anyone else you invite waits in the lobby.</span>
                    </div>
                    <div className="pp-field">
                      <label className="pp-label">Who Sits In</label>
                      <select className="pp-input" value={fill} onChange={(e) => setFill(e.target.value)}>
                        {FILL_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.title}</option>)}
                      </select>
                      <span className="pp-sub">{(FILL_CHOICES.find((c) => c.value === fill) || FILL_CHOICES[0]).body} You can change this any time.</span>
                    </div>
                    <div className="pp-field">
                      <label className="pp-label">Your Team Name</label>
                      <input className="pp-input" type="text" value={myTeamName} onChange={(e) => setMyTeamName(e.target.value)} placeholder="The House" />
                    </div>
                  </>
                ) : (
                  <div className="pp-field">
                    <label className="pp-label">Your Team Name</label>
                    <input className="pp-input" type="text" value={myTeamName} onChange={(e) => setMyTeamName(e.target.value)} placeholder="The Commish" />
                  </div>
                )}
                <div className="pp-hint">
                  {leagueMode === "table"
                    ? "You will be its dealer, and you take one of the seats yourself. Tables are private - people join the lobby with an invite you send them."
                    : leagueMode === "lastdigit"
                      ? "You will be its commissioner, and you hold a team too. Then send one join link to everyone else - up to 32 players. Joining closes at kickoff. Games are private - only players can see them."
                      : "You will be its commissioner, and you play in it with a team of your own. Then send your invite link to everyone else - up to 12 teams. New leagues are private - only members can see them."}
                </div>
                <button className="pp-btn pp-btn-gold" style={{ marginTop: 8 }} disabled={!leagueName.trim() || busy} onClick={create}>
                  {busy ? "Creating..." : leagueMode === "table" ? "Open The Table" : leagueMode === "lastdigit" ? "Create Game" : "Create League"}
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

/**
 * Roughly which NFL week it is, for the Last Digit start-week picker's default. Week 1
 * opens the Thursday after Labor Day (the first Monday of September) and each week runs
 * Tuesday to Monday. Only a default - the commissioner picks the week, and the server
 * checks it is 1 to 18. Exported for the test.
 */
export function nflWeekGuess(now = new Date()) {
  const year = now.getFullYear();
  const sept1 = new Date(year, 8, 1);
  const laborDay = new Date(year, 8, 1 + ((8 - sept1.getDay()) % 7));
  const tuesdayBefore = new Date(laborDay.getFullYear(), laborDay.getMonth(), laborDay.getDate() + 1);
  const week = Math.floor((now - tuesdayBefore) / (7 * 24 * 3600 * 1000)) + 1;
  return Math.min(Math.max(week, 1), 18);
}

/* One of your leagues: its game's picture, its name, who you are in it, and what is
 * happening this week. The whole row is the button - a 44px-plus target, unlike the
 * header pills OQ-8 is about. */
function LeagueRow({ league, onOpen }) {
  const status = leagueStatus(league);
  return (
    <button type="button" className="pp-home-row" onClick={onOpen}>
      <span className={"pp-league-badge pp-accent pp-accent-" + accentForGame(league.game)}>
        <GameIcon icon={iconForGame(league.game)} size={26} tone={badgeTone(accentForGame(league.game))} />
      </span>
      <span className="pp-home-row-text">
        <span className="pp-home-row-name">{league.name}</span>
        <span className="pp-home-row-sub">{leagueSubtitle(league)}</span>
        {status ? <span className="pp-home-row-status">{status}</span> : null}
      </span>
      <ChevronIcon />
    </button>
  );
}

/* Every game on the site. A coming-soon game is drawn but is NOT a button: there is
 * nothing behind it to open yet (games.jsx says how one goes live). */
function GameList({ onPlay }) {
  return (
    <section className="pp-home-section">
      <div>
        <h2 className="pp-h2 pp-home-h">Start a Game</h2>
        <p className="pp-sub" style={{ margin: 0 }}>Pick a game, set the rules, invite your crew.</p>
      </div>
      {GAMES.map((g) =>
        g.comingSoon ? (
          <div key={g.key} className="pp-game-card pp-game-soon">
            <span className="pp-game-badge pp-game-badge-soon"><GameIcon icon={g.icon} size={30} tone="dim" /></span>
            <span className="pp-home-row-text">
              <span className="pp-game-name">{g.name}</span>
              <span className="pp-home-row-sub">{g.blurb}</span>
            </span>
            <span className="pp-soon-tag">Coming soon</span>
          </div>
        ) : (
          <div key={g.key} className={"pp-game-card pp-accent pp-accent-" + (g.accent || "gold")}>
            <span className="pp-game-badge"><GameIcon icon={g.icon} size={30} tone={badgeTone(g.accent)} /></span>
            <span className="pp-home-row-text">
              <span className="pp-game-eyebrow">{g.eyebrow}</span>
              <span className="pp-game-name">{g.name}</span>
              <span className="pp-home-row-sub">{g.blurb}</span>
              {g.great ? <span className="pp-game-great"><b>Great for</b>{g.great}</span> : null}
            </span>
            <button type="button" className="pp-play-btn" aria-label={"Play " + g.name} onClick={() => onPlay(g)}>PLAY</button>
          </div>
        )
      )}
    </section>
  );
}
