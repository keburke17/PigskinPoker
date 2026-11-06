/* Last Digit - the screens (OQ-37, Scott's design rounds of 2026-11-05).
 *
 * Board, Schedule, Rules and the commissioner's tools. Every number on them comes from
 * src/engine/lastDigit.js run over the season's real NFL scores; nothing here decides a
 * rule, and nothing here is stored. Who may hand out a team is the server's call - the
 * buttons are only drawn to match.
 *
 * WHAT SCOTT PICKED, so nobody "tidies" it back:
 *   - a square shows just the points (1A); a bye is a blue square marked BYE (2A)
 *   - the NFL teams nobody holds sit in a strip under the board (3A)
 *   - this week's scores run in a strip above the board, with arrows to step through the
 *     weeks (4A); the Schedule tab is a card per game, any week (5A)
 *   - the Tiebreaker is a small table of points, 9s, 8s, 7s and 6s, with names (6B)
 *   - the team column AND the total stay on screen while the weeks scroll
 *   - a faded line between weeks
 *   - after Week 18, a champion banner with the 1st/2nd/3rd podium under it
 *   - the Game Program colours: cream paper, navy and red (.ld-theme in global.css)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LAST_DIGIT_MAX_PLAYERS,
  LAST_DIGIT_WEEKS,
  NFL_ABBRS,
  NFL_TEAM_ABBR,
  lastDigitBoard,
  lastDigitLockAt,
  lastDigitTies,
} from "../engine/index.js";
import { CP } from "../engine/constants.js";
import { ErrorBanner, Tag } from "./atoms.jsx";
import { CommDeleteLeaguePanel } from "./commissioner.jsx";

const LEFT = CP(0x2039);
const RIGHT = CP(0x203a);
const DOT = CP(0x00b7);

/* Abbreviation -> full name, the flip of the one-to-one table in nflTeams.js. */
const NAME_OF = Object.fromEntries(Object.entries(NFL_TEAM_ABBR).map(([name, abbr]) => [abbr, name]));
export const nflName = (abbr) => NAME_OF[abbr] || abbr || "";

/* --------------------------------------------------------------- data -- */

/**
 * The season's games, read through the server, and read again every few minutes and
 * whenever the page comes back into view - so a Sunday board fills in without a reload.
 */
export function useLastDigitGames(store, enabled) {
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);
  const [readAt, setReadAt] = useState(null);
  const load = useCallback(async () => {
    if (!enabled || !store.lastDigitGames) return;
    const r = await store.lastDigitGames();
    if (r && r.ok) { setGames(r.games || []); setReadAt(r.readAt || null); setError(null); }
    else setError((r && r.message) || "The NFL scores could not be read.");
  }, [store, enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [enabled, load]);
  return { games, error, readAt, reload: load };
}

/** Everything a screen needs, worked out once per render. */
export function useBoard(state, games) {
  return useMemo(() => {
    const meta = state._meta || {};
    const entries = state.teams.map((t) => ({ teamId: t.id, name: t.name, nflTeam: (meta.nflTeams || {})[t.id] || null }));
    const board = lastDigitBoard({ games: games || [], entries, startWeek: meta.startWeek || 1 });
    const lockAt = lastDigitLockAt({ games: games || [], startWeek: meta.startWeek || 1, createdAt: meta.createdAt });
    return { board, entries, lockAt, startWeek: meta.startWeek || 1, teamDraw: meta.teamDraw || "random" };
  }, [state, games]);
}

/* ------------------------------------------------------------ helpers -- */

const fmtKick = (iso, opts) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, opts); } catch { return ""; }
};
const dayOf = (iso) => fmtKick(iso, { weekday: "short" }).toUpperCase();
const kickLabel = (iso) => fmtKick(iso, { weekday: "short", hour: "numeric", minute: "2-digit" });
const rankText = (r) => (r.tied ? "T-" : "") + r.rank;
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

function weekGames(games, week, heldSet) {
  return (games || [])
    .filter((g) => g.week === week)
    .slice()
    .sort((a, b) => {
      const ha = heldSet.has(a.home) || heldSet.has(a.away) ? 0 : 1;
      const hb = heldSet.has(b.home) || heldSet.has(b.away) ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
    });
}
const isFinal = (g) => g.homeScore != null && g.awayScore != null;

function Trophy({ size = 32, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4" /><path d="M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v4" /><path d="M8 20h8" /><path d="M10 17h4" />
    </svg>
  );
}

/* ------------------------------------------------------------- board -- */

export function LastDigitBoardTab({ state, myTeam, data, onSeeSchedule }) {
  const { board, startWeek } = useBoard(state, data.games);
  const heldSet = useMemo(() => new Set(board.rows.map((r) => r.nflTeam)), [board]);
  const holder = useMemo(() => Object.fromEntries(board.rows.map((r) => [r.nflTeam, r])), [board]);
  const [glanceWeek, setGlanceWeek] = useState(null);
  const [detail, setDetail] = useState(null);
  const week = glanceWeek || board.currentWeek;

  if (data.games == null && !data.error) return <p className="pp-sub">Reading the NFL scores...</p>;

  const weeks = [];
  for (let w = startWeek; w <= LAST_DIGIT_WEEKS; w++) weeks.push(w);
  const ties = new Set(lastDigitTies(board.rows).flatMap((t) => [t.ahead, t.behind]));

  return (
    <div className="ld-stack">
      {data.error ? <ErrorBanner message={{ headline: "The NFL scores could not be read just now", detail: data.error }} /> : null}

      {board.complete ? <Champion board={board} year={state._meta.seasonYear} /> : null}

      {/* 4A: this week's scores at a glance, with arrows through the weeks. */}
      <section className="ld-stack-tight">
        <div className="ld-glance-head">
          <div className="ld-gnav">
            <button className="ld-navbtn" aria-label="Week before" disabled={week <= 1} onClick={() => setGlanceWeek(Math.max(1, week - 1))}>{LEFT}</button>
            <h2 className="pp-h2" style={{ margin: 0 }}>Week {week} scores</h2>
            <button className="ld-navbtn" aria-label="Week after" disabled={week >= LAST_DIGIT_WEEKS} onClick={() => setGlanceWeek(Math.min(LAST_DIGIT_WEEKS, week + 1))}>{RIGHT}</button>
            {week !== board.currentWeek ? <button className="ld-linkbtn" onClick={() => setGlanceWeek(null)}>Back to this week</button> : null}
          </div>
          <button className="ld-linkbtn" onClick={() => onSeeSchedule(week)}>Full schedule {RIGHT}</button>
        </div>
        <div className="ld-strip">
          {weekGames(data.games, week, heldSet).map((g, i) => {
            const fin = isFinal(g);
            const line = (team, score, won) => (
              <div className={"ld-mini-ln" + (fin && !won ? " lose" : "")}>
                <span className={"ld-mini-t" + (heldSet.has(team) ? " held" : "")}>{team}</span>
                <span>{fin ? score : ""}</span>
              </div>
            );
            return (
              <div key={i} className={"ld-mini" + (heldSet.has(g.home) || heldSet.has(g.away) ? " ours" : "")}>
                <span className={"ld-mini-st" + (fin ? " done" : "")}>{fin ? "Final" : kickLabel(g.kickoff) || "TBD"}</span>
                {line(g.away, g.awayScore, fin && g.awayScore > g.homeScore)}
                {line(g.home, g.homeScore, fin && g.homeScore > g.awayScore)}
              </div>
            );
          })}
          {weekGames(data.games, week, heldSet).length === 0 ? <p className="pp-sub">No games listed for Week {week}.</p> : null}
        </div>
      </section>

      <div className="ld-legend">
        <span><i className="ld-key ld-key-me" />Your row</span>
        <span><i className="ld-key ld-key-bye" />Bye: keeps last week's points</span>
        <span>Day shown: game not final yet</span>
      </div>

      {board.rows.length === 0 ? (
        <div className="pp-card">
          <p className="pp-sub" style={{ margin: 0 }}>
            Nobody has an NFL team yet. {board.waiting.length} player{board.waiting.length === 1 ? " has" : "s have"} joined
            - the board fills in once the commissioner hands out the teams.
          </p>
        </div>
      ) : (
        <div className="ld-board-wrap">
          <table className="ld-board" aria-label="Season board">
            <thead>
              <tr>
                <th className="ld-sticky ld-teamcell" style={{ paddingLeft: 46 }}>Team</th>
                {weeks.map((w) => <th key={w} className={"ld-wk" + (w === board.currentWeek && !board.complete ? " now" : "")}>{w === board.currentWeek && !board.complete ? "Wk " : ""}{w}</th>)}
                <th className="ld-tot">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr key={r.teamId} className={myTeam && myTeam.id === r.teamId ? "me" : ""}>
                  <td className="ld-sticky ld-teamcell">
                    <div className="ld-teamrow">
                      <span className="ld-rank">{rankText(r)}</span>
                      <span className="ld-abbr">{r.nflTeam}</span>
                      <span className="ld-who"><span className="ld-tn">{nflName(r.nflTeam)}</span><span className="ld-mn">{r.name}</span></span>
                    </div>
                  </td>
                  {weeks.map((w) => {
                    const c = r.cells[w - 1];
                    const now = w === board.currentWeek && !board.complete;
                    const tap = () => setDetail({ r, c });
                    if (c.kind === "upcoming") {
                      return (
                        <td key={w} className={"ld-cell" + (now ? " now" : "")} tabIndex={0} onClick={tap}>
                          <span className="ld-pend">{w <= board.currentWeek ? dayOf(c.kickoff) : DOT}</span>
                        </td>
                      );
                    }
                    if (c.kind === "bye" || c.kind === "nogame") {
                      return (
                        <td key={w} className={"ld-cell ld-bye" + (now ? " now" : "")} tabIndex={0} onClick={tap}>
                          {c.pts != null ? <span className={"ld-dig d" + c.pts}>{c.pts}</span> : null}
                          <span className="ld-tag">{c.kind === "bye" ? "BYE" : "NO GAME"}</span>
                        </td>
                      );
                    }
                    return (
                      <td key={w} className={"ld-cell" + (now ? " now" : "")} tabIndex={0} onClick={tap}>
                        <span className={"ld-dig d" + c.pts}>{c.pts}</span>
                      </td>
                    );
                  })}
                  <td className="ld-tot">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {board.rows.length ? (
        <div className="ld-detail">{detail ? <Detail {...detail} /> : "Tap any square to see the game behind it."}</div>
      ) : null}

      {board.waiting.length ? (
        <p className="pp-sub" style={{ margin: 0 }}>
          Waiting for a team: {board.waiting.map((e) => e.name).join(", ")}.
        </p>
      ) : null}

      <div className="ld-split">
        {board.rows.length ? (
          <div className="ld-panel">
            <h2 className="pp-h2" style={{ margin: 0 }}>Tiebreaker</h2>
            <p className="ld-note">Same points? More 9s wins, then 8s, then 7s...</p>
            <div style={{ overflowX: "auto" }}>
              <table className="ld-tbt">
                <thead><tr><th /><th>Pts</th><th>9s</th><th>8s</th><th>7s</th><th>6s</th></tr></thead>
                <tbody>
                  {board.rows.map((r) => (
                    <tr key={r.teamId} className={ties.has(r.teamId) ? "tied" : ""}>
                      <td>{rankText(r)} {r.nflTeam} <span className="ld-tbm">{r.name}</span></td>
                      <td>{r.total}</td><td>{r.counts[9]}</td><td>{r.counts[8]}</td><td>{r.counts[7]}</td><td>{r.counts[6]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ld-note">Highlighted rows are tied on points.</p>
          </div>
        ) : null}
        <div className="ld-panel">
          <h2 className="pp-h2" style={{ margin: 0 }}>Not in this game</h2>
          <p className="pp-sub" style={{ margin: 0 }}>{board.unheld.length} team{board.unheld.length === 1 ? "" : "s"} nobody holds. They are not on the board and cannot win.</p>
          <div className="ld-chips">{board.unheld.map((a) => <span key={a} className="ld-chip">{a}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function Detail({ r, c }) {
  const team = <b>{nflName(r.nflTeam)}, Week {c.week}:</b>;
  if (c.kind === "final") {
    const won = c.raw > c.oppScore ? "beat" : c.raw < c.oppScore ? "lost to" : "tied";
    return <>{team} {won} {c.opp} {c.raw}-{c.oppScore}, so the square is worth {c.pts} point{c.pts === 1 ? "" : "s"}.</>;
  }
  if (c.kind === "bye") return <>{team} bye week. {c.pts != null ? "Keeps Week " + (c.week - 1) + "'s " + c.pts + " point" + (c.pts === 1 ? "" : "s") + "." : "Takes last week's points once that game is final."}</>;
  if (c.kind === "nogame") return <>{team} the game against {c.opp} was never played, so it counts like a bye{c.pts != null ? " - " + c.pts + " point" + (c.pts === 1 ? "" : "s") : ""}.</>;
  return <>{team} {c.home ? "vs " : "@ "}{c.opp}{c.kickoff ? ", " + kickLabel(c.kickoff) : ""}. The square fills when the game is final.</>;
}

/* After Week 18: the banner, and the podium under it (Scott, 2026-11-05: "I like both"). */
function Champion({ board, year }) {
  const champs = board.champions;
  const top = board.rows[0];
  const names = champs.map((r) => r.name + " (" + r.nflTeam + ")").join(" and ");
  const podium = [board.rows[1], board.rows[0], board.rows[2]];
  return (
    <div className="ld-stack-tight">
      <div className="ld-banner">
        <span className="ld-trophy"><Trophy size={32} /></span>
        <div className="ld-bt">
          <div className="ld-eb">{champs.length > 1 ? (year || "") + " co-champions" : (year || "") + " Last Digit champion"}</div>
          <div className="ld-champ">{champs.length > 1 ? names : top.name + ", " + nflName(top.nflTeam)}</div>
          <div className="ld-champ-sub">Final standings after Week 18</div>
        </div>
        <div className="ld-big">{top.total}<small>points</small></div>
      </div>
      <div className="ld-podium">
        {podium.map((r, i) => (r ? (
          <div key={r.teamId} className={"ld-step" + (i === 1 ? " first" : "")}>
            {i === 1 ? <Trophy size={26} /> : null}
            <span className="ld-place">{r.tied ? "Tied " + r.rank + (r.rank === 1 ? "st" : "") : ordinal(r.rank)}</span>
            <span className="ld-abbr">{r.nflTeam}</span>
            <span className="ld-step-tm">{nflName(r.nflTeam)}</span>
            <span className="ld-step-mg">{r.name}</span>
            <span className="ld-step-pt">{r.total}</span>
          </div>
        ) : <div key={"empty" + i} />))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- schedule -- */

export function LastDigitScheduleTab({ state, data, initialWeek }) {
  const { board } = useBoard(state, data.games);
  const holder = useMemo(() => Object.fromEntries(board.rows.map((r) => [r.nflTeam, r])), [board]);
  const heldSet = useMemo(() => new Set(board.rows.map((r) => r.nflTeam)), [board]);
  const [week, setWeek] = useState(initialWeek || board.currentWeek);
  const [onlyOurs, setOnlyOurs] = useState(false);
  useEffect(() => { if (initialWeek) setWeek(initialWeek); }, [initialWeek]);

  if (data.games == null && !data.error) return <p className="pp-sub">Reading the NFL schedule...</p>;

  const games = weekGames(data.games, week, heldSet).filter((g) => !onlyOurs || heldSet.has(g.home) || heldSet.has(g.away));
  const playing = new Set((data.games || []).filter((g) => g.week === week).flatMap((g) => [g.home, g.away]));
  const byes = NFL_ABBRS.filter((a) => !playing.has(a) && (!onlyOurs || heldSet.has(a)));

  const side = (team, score, other, g) => {
    const fin = isFinal(g);
    const h = holder[team];
    return (
      <div className={"ld-side" + (fin && score < other ? " lose" : "")}>
        <span className="ld-abbr">{team}</span>
        <span className="ld-side-nm">
          <span className="ld-tn">{nflName(team)}</span>
          {h ? <span className="ld-side-mn">{h.name}</span> : null}
        </span>
        {h && fin ? <span className="ld-pts">+{score % 10}</span> : null}
        <span className="ld-side-sc">{fin ? score : ""}</span>
      </div>
    );
  };

  return (
    <div className="ld-stack">
      {data.error ? <ErrorBanner message={{ headline: "The NFL schedule could not be read just now", detail: data.error }} /> : null}
      <div className="ld-weeks" role="group" aria-label="Pick a week">
        {Array.from({ length: LAST_DIGIT_WEEKS }, (_, i) => i + 1).map((w) => (
          <button key={w} className={"ld-wkbtn" + (w === board.currentWeek ? " now" : "")} aria-pressed={w === week} onClick={() => setWeek(w)}>{w}</button>
        ))}
      </div>
      <div className="ld-sched-bar">
        <h2 className="pp-h2" style={{ margin: 0 }}>
          Week {week}{week === board.currentWeek ? " (this week)" : week > board.currentWeek ? " (still to play)" : ""}
        </h2>
        <label className="ld-check" htmlFor="ld-only-ours">
          <input type="checkbox" id="ld-only-ours" checked={onlyOurs} onChange={(e) => setOnlyOurs(e.target.checked)} /> Only teams in this game
        </label>
      </div>
      {games.length ? (
        <div className="ld-games">
          {games.map((g, i) => (
            <div key={i} className={"ld-game" + (heldSet.has(g.home) || heldSet.has(g.away) ? " ours" : "")}>
              <span className={"ld-mini-st" + (isFinal(g) ? " done" : "")}>{isFinal(g) ? "Final" : kickLabel(g.kickoff) || "Time to be announced"}</span>
              {side(g.away, g.awayScore, g.homeScore, g)}
              {side(g.home, g.homeScore, g.awayScore, g)}
            </div>
          ))}
        </div>
      ) : (
        <p className="pp-sub">{onlyOurs ? "No games for teams in this game this week." : "No games listed for this week yet."}</p>
      )}
      {byes.length ? (
        <p className="pp-sub" style={{ margin: 0 }}>
          <b className="ld-bye-ink">On a bye:</b>{" "}
          {byes.map((a) => (holder[a] ? a + " (" + holder[a].name + ", keeps last week's points)" : a)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- rules -- */

export function LastDigitRulesTab({ state }) {
  const start = (state._meta && state._meta.startWeek) || 1;
  return (
    <div className="pp-card">
      <h2 className="pp-h2">How Last Digit scores</h2>
      <p className="pp-sub">
        Every player holds one NFL team for the whole season. Each week you score the last digit of
        your team's final score: 31 scores 1, 45 scores 5, 30 scores 0, and 7 scores 7.
      </p>
      <p className="pp-sub">
        On a bye, or if your team's game is never played, you keep the points from the week before.
      </p>
      <p className="pp-sub">
        This game runs from Week {start} to Week 18{start > 1 ? ", so earlier weeks do not count" : ""}. Most points
        after Week 18 wins. Teams level on points are ranked by most 9s, then most 8s, and so on down.
        Teams still level after that share the spot.
      </p>
      <p className="pp-sub" style={{ marginBottom: 0 }}>
        Scores come from the real NFL results, usually within a few hours of each game ending.
        Nobody makes a move during the season: once the teams are handed out, the season plays itself.
      </p>
    </div>
  );
}

/* --------------------------------------------------------- commissioner -- */

export function LastDigitCommishTab({ state, data, invites, onCreateInvite, onRevokeInvite, onDeal, onSetTeam, onDeleteLeague }) {
  const { board, entries, lockAt, startWeek, teamDraw } = useBoard(state, data.games);
  const locked = lockAt != null && Date.now() >= Date.parse(lockAt);
  const taken = new Set(entries.map((e) => e.nflTeam).filter(Boolean));
  const waiting = entries.filter((e) => !e.nflTeam);

  return (
    <div className="ld-stack">
      <div className="pp-card">
        <h3 className="pp-h3">This Game</h3>
        <p className="pp-sub" style={{ margin: 0 }}>
          Starts in Week {startWeek}. Teams are {teamDraw === "random" ? "dealt at random" : "picked by you, one player at a time"}.
          {" "}{entries.length} of {LAST_DIGIT_MAX_PLAYERS} players so far.
        </p>
        <p className="pp-sub" style={{ margin: "6px 0 0" }}>
          {locked
            ? "The game has kicked off, so joining has closed and the teams are fixed for the season."
            : lockAt
              ? "Joining and handing out teams close at kickoff: " + kickLabel(lockAt) + " (" + fmtKick(lockAt, { month: "short", day: "numeric" }) + ")."
              : "Joining and handing out teams close at the first kickoff of the game."}
        </p>
      </div>

      <JoinLinkPanel state={state} invites={invites} onCreateInvite={onCreateInvite} onRevokeInvite={onRevokeInvite} locked={locked} />

      <div className="pp-card">
        <h3 className="pp-h3">Hand Out Teams</h3>
        <p className="pp-sub">
          {teamDraw === "random"
            ? "Everyone who has joined is listed below. Press Deal Teams when everyone is in, and each player without a team gets one at random. Anyone who joins after that can be dealt in with another press."
            : "Everyone who has joined is listed below. Pick an NFL team for each player - a team already picked drops off everyone else's list."}
        </p>
        <div className="ld-assign">
          {entries.map((e, i) => (
            <div key={e.teamId} className="ld-arow">
              <span className="ld-abbr" style={e.nflTeam ? null : { opacity: 0.3 }}>{e.nflTeam || "--"}</span>
              <span style={{ minWidth: 0 }}>
                <span className="ld-tn">{e.name}</span>
                {teamDraw === "manual" ? (
                  <select
                    id={"ld-pick-" + i}
                    className="pp-select ld-pick"
                    value={e.nflTeam || ""}
                    disabled={locked}
                    onChange={(ev) => onSetTeam(e.teamId, ev.target.value || null)}
                  >
                    <option value="">Pick a team...</option>
                    {NFL_ABBRS.filter((a) => !taken.has(a) || a === e.nflTeam).map((a) => <option key={a} value={a}>{a} {nflName(a)}</option>)}
                  </select>
                ) : (
                  <span className="ld-mn">{e.nflTeam ? nflName(e.nflTeam) : "Joined. Waiting for a team"}</span>
                )}
              </span>
            </div>
          ))}
        </div>
        {teamDraw === "random" ? (
          <button className="pp-btn pp-btn-gold" style={{ marginTop: 12 }} disabled={locked || waiting.length === 0} onClick={onDeal}>
            {waiting.length === 0 ? "Everyone has a team" : "Deal Teams to " + waiting.length + " player" + (waiting.length === 1 ? "" : "s")}
          </button>
        ) : null}
        <p className="pp-hint">
          {board.rows.length} of {entries.length} players have a team. {locked ? "Teams are fixed now." : ""}
        </p>
      </div>

      <CommDeleteLeaguePanel state={state} onDeleteLeague={onDeleteLeague} />
    </div>
  );
}

/* One join link for everybody (Scott, 2026-11-05: "I don't want to have to invite everyone
 * individually"), plus the rare invite that hands an existing player's team to someone new. */
function JoinLinkPanel({ state, invites, onCreateInvite, onRevokeInvite, locked }) {
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [teamId, setTeamId] = useState("");
  const issue = async (forTeam) => {
    setError(null); setIssued(null); setCopied(false);
    const r = await onCreateInvite(forTeam, "manager");
    if (!r || r.ok === false) { setError((r && r.message) || "Could not create that invite."); return; }
    setIssued(r.code);
  };
  const link = issued ? (globalThis.location?.origin ?? "") + "/join/" + issued : "";
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Join Link</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        One link for everyone: paste it in the group chat or the office email. Each person opens it, signs
        up with their email, and is in the game with no team yet - up to {LAST_DIGIT_MAX_PLAYERS} players.
        {locked ? " The game has kicked off, so the link no longer lets anyone in." : ""}
      </p>
      <button className="pp-btn pp-btn-gold" onClick={() => issue(null)}>Create Join Link</button>
      {error ? <div className="pp-hint pp-hint-bad">{error}</div> : null}
      {issued ? (
        <div style={{ marginTop: 12 }}>
          <div className="pp-hint pp-hint-good">Copy this now - it is shown once. Lost it? Just make another.</div>
          <div className="pp-input" style={{ margin: "6px 0", fontSize: 12, wordBreak: "break-all" }}>{link}</div>
          <button
            className="pp-btn pp-btn-sm"
            onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}
          >{copied ? "Copied" : "Copy Link"}</button>
        </div>
      ) : null}

      {(invites || []).length ? (
        <>
          <h3 className="pp-h3" style={{ marginTop: 18 }}>Links Out There</h3>
          {(invites || []).map((i) => (
            <div key={i.id} className="pp-roster-slot">
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{i.ref}</span>
                <span className="pp-roster-slot-meta">
                  {"  " + (i.teamId ? (state.teams.find((t) => t.id === i.teamId)?.name ?? "a player") + "'s team" : "join link") + "  -  used " + i.uses + " times"}
                </span>
              </div>
              {i.revoked ? <Tag>revoked</Tag> : <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => onRevokeInvite(i.id)}>Revoke</button>}
            </div>
          ))}
        </>
      ) : null}

      <h3 className="pp-h3" style={{ marginTop: 18 }}>Someone Quit?</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Their team stays on the board and keeps scoring. To hand it to somebody new, make an invite for it.
      </p>
      <div className="ld-handover">
        <select className="pp-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Whose team">
          <option value="">Whose team...</option>
          {state.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="pp-btn pp-btn-sm" disabled={!teamId} onClick={() => issue(teamId)}>Create Invite For It</button>
      </div>
    </div>
  );
}
