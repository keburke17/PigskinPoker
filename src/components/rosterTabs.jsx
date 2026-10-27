/* Pigskin Poker UI - the Rosters hub's two panels.
 *
 * Extracted from LegacyProject/PigskinPokerCode.jsx lines 1474-1528. Neither panel is
 * verbatim any more:
 *   AllRostersTab was rebuilt for issues #29 and #30 - see the note on it.
 *   FreeAgentsTab hides players a pool refresh retired (2026-09-04). The artifact had
 *     no feed, so it had no such player, and its OUT tab could safely show everyone.
 *     See the comment on that filter. */

import { useState } from "react";
import {
  FA_TABS,
  ICON,
  STARTER_SLOTS,
  allRosteredPlayerIds,
  computeStarterPoints,
  getPlayer,
  isOnByeThisWeek,
  isPlayerAvailable,
  playerSeasonAverage,
  playerWeekLine,
  playerInjury,
  playerWeekPoints,
  shortPlayerName,
  teamPeriodScore,
} from "../engine/index.js";
import { EmptyState, PositionCard, statLineText } from "./atoms.jsx";
import { PlayerIdLine, PlayerName, PointsColumn, TeamRosterBlock, slotMetaLine } from "./roster.jsx";
import { useInjuryNotes } from "./injury.jsx";
import { TxLines } from "./activity.jsx";
import { isPastWeek } from "./pastWeek.js";
import { moveChip, weekMoves } from "./weekMoves.js";

/* A FINISHED WEEK CARRIES ITS SCHEMES (Scott, 2026-10-27): each team's chip - Steal,
 * Block, Redraw, Stolen from - and the transaction lines, read back from the week's
 * activity exactly as the Week screen's "Around the league" reads them. The week being
 * played does not show them here; it has the Week screen for that. */
function pastMovesByTeam(state) {
  if (!isPastWeek(state)) return null;
  const { any, teams } = weekMoves(state, state.currentPeriod);
  if (!any) return null;
  return new Map(teams.map((tm) => [tm.teamId, tm]));
}

/* The tag a grid box wears for a player who arrived by a scheme or was blocked - matched
 * on name, since that is all the week's activity carries. */
const GRID_TAG = { block: "BLK", stolen: "STOLE", fa: "FA" };
function gridMoveTag(tm, player) {
  if (!tm || !player) return null;
  const line = tm.lines.find((l) => l.player === player.name && (l.kind === "add" || l.kind === "block"));
  if (!line) return null;
  if (line.kind === "block") return { label: GRID_TAG.block, cls: "pp-tx-block" };
  return line.note.startsWith("stolen from ")
    ? { label: GRID_TAG.stolen, cls: "pp-tx-stolen" }
    : { label: GRID_TAG.fa, cls: "pp-tx-add" };
}

/* One team's card: the headline everybody wants, and the twelve rows only some people do.
 *
 * Collapsed by default so the whole league fits on one phone screen (issue #30 asked for
 * "compact"), with the answer - name and total - on the line you can already see. Your
 * own team opens by itself, because the one card you came for should not need a tap. */
function TeamRosterCard({ team, state, showStats, isMine, move }) {
  const chip = move ? moveChip(move) : null;
  const [open, setOpen] = useState(isMine);
  return (
    <div className={"pp-card pp-card-tight" + (isMine ? " pp-my-card" : "")}>
      <button className="pp-roster-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="pp-roster-head-caret">{open ? ICON.caretDown : ICON.caretRight}</span>
        <span className="pp-roster-head-name">
          {team.name}
          {isMine ? <span className="pp-you-tag">You</span> : null}
          {chip ? <span className={"pp-chip " + chip.cls}>{chip.label}</span> : null}
        </span>
        {showStats && team.roster ? (
          <span className="pp-roster-head-pts">{teamPeriodScore(state, team)}</span>
        ) : null}
      </button>
      {open ? (
        <div style={{ marginTop: 8 }}>
          {move && move.lines.length > 0 ? (
            <div className="pp-rh-moves">
              <div className="pp-eyebrow" style={{ marginBottom: 6 }}>Schemes</div>
              <TxLines lines={move.lines} state={state} />
            </div>
          ) : null}
          <TeamRosterBlock team={team} state={state} showStats={showStats} showBench={true} showTotal={false} />
        </div>
      ) : null}
    </div>
  );
}

/* Who has who. It is a browse, not a dashboard - the scoreboard tab is the dashboard now,
 * so this does not have to be the place anyone adds numbers up.
 *
 * `myTeam` first, then everybody else in the order the league stores them. The list stays
 * complete; your team is lifted out of it, not filtered from it. */
export function AllRostersTab({ state, myTeam }) {
  if (state.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  const mine = myTeam ? state.teams.filter((t) => t.id === myTeam.id) : [];
  const rest = state.teams.filter((t) => !myTeam || t.id !== myTeam.id);
  const showStats = state.currentPeriod.phase !== "pre-deal";
  const moves = pastMovesByTeam(state);
  return (
    <div>
      {mine.concat(rest).map((team) => (
        <TeamRosterCard
          key={team.id}
          team={team}
          state={state}
          showStats={showStats}
          isMine={!!myTeam && team.id === myTeam.id}
          move={moves ? moves.get(team.id) : null}
        />
      ))}
    </div>
  );
}

/* ============================== Roster Grid ================================ */

/* THE DRAFT BOARD (Scott, 2026-10-22, five mockup rounds; style E). Every team's twelve
 * players on one screen: a column per team, a row per slot, your team first. It is the
 * quick glance - Full Rosters is still there for the opponent, the kickoff and the
 * injury notepad, and the free agents stay on their own tab, which he asked for by name.
 *
 * THE POSITION BUTTONS ONLY LIGHT THINGS UP. Picking QB fades every box that is not a
 * quarterback and leaves the grid where it is, so "who has a QB to spare" is read across
 * the rows without the shape of anybody's roster changing under you.
 *
 * THE TEAM NAMES STAY PINNED, ON A SOLID BAR. He asked for the header to stay put while
 * scrolling down and NOT to be see-through. That needs the grid to scroll inside its own
 * box (a sticky header cannot stick to the page from inside a box that scrolls sideways),
 * so the box is capped at most of the screen's height.
 *
 * The injury PILL rides on the name; the notepad does not, because there is no room for
 * the report in a box this size. Full Rosters has it. */
const GRID_FILTERS = ["ALL", "QB", "WR", "RB", "TE", "Coach"];

/* The same numbers the Full Rosters rows show: a starter scores the commissioner's stat
 * entry for his slot, a bench man scores the feed's line and does not count. */
function gridPoints(state, team, slot, player, bench, showStats) {
  if (!showStats || !player) return null;
  if (bench) {
    const line = playerWeekLine(state, player);
    return line ? computeStarterPoints(state, line, player.position) : null;
  }
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  return computeStarterPoints(state, stats[slot], player.position);
}

function GridCell({ state, team, slot, pid, bench, showStats, filter, isMine, move }) {
  const player = getPlayer(state, pid);
  const hit = filter !== "ALL" && !!player && player.position === filter;
  const dim = filter !== "ALL" && !hit;
  const cls = "pp-grid-cell" + (isMine ? " pp-grid-mine" : "") + (hit ? " pp-grid-hit" : "") + (dim ? " pp-grid-dim" : "");
  if (!player) return <td className={cls}><span className="pp-grid-empty">-</span></td>;
  const injury = playerInjury(state, player);
  const pts = gridPoints(state, team, slot, player, bench, showStats);
  const tag = gridMoveTag(move, player);
  return (
    <td className={cls}>
      <div className="pp-grid-name" title={player.name}>
        <span>{shortPlayerName(player.name)}</span>
        {injury && injury.pill ? (
          <span className={"pp-inj-pill pp-inj-" + injury.pill.toLowerCase()} title={injury.status}>{injury.pill}</span>
        ) : null}
      </div>
      <PlayerIdLine player={player} state={state} />
      {tag ? <span className={"pp-tx-tag pp-grid-tag " + tag.cls}>{tag.label}</span> : null}
      {pts != null ? (
        <div className={"pp-grid-pts" + (bench ? " pp-pts-not-counting" : "")}>{Number(pts).toFixed(1)}</div>
      ) : null}
    </td>
  );
}

export function RosterGridTab({ state, myTeam }) {
  const [filter, setFilter] = useState("ALL");
  if (state.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  const mine = myTeam ? state.teams.filter((t) => t.id === myTeam.id) : [];
  const teams = mine.concat(state.teams.filter((t) => !myTeam || t.id !== myTeam.id));
  if (!teams.some((t) => t.roster)) return <EmptyState>No rosters dealt yet this period.</EmptyState>;
  const showStats = state.currentPeriod.phase !== "pre-deal";
  const moves = pastMovesByTeam(state);
  const benchSize = Math.max(0, ...teams.map((t) => (t.roster ? t.roster.bench.length : 0)));
  const count = (pos) =>
    teams.reduce((n, t) => {
      if (!t.roster) return n;
      const ids = STARTER_SLOTS.map((s) => t.roster.starters[s]).concat(t.roster.bench);
      return n + ids.filter((id) => {
        const p = getPlayer(state, id);
        return p && p.position === pos;
      }).length;
    }, 0);
  const rows = STARTER_SLOTS.map((slot) => ({ slot, bench: false, pick: (t) => t.roster.starters[slot] }));
  for (let i = 0; i < benchSize; i++) {
    rows.push({ slot: "BN", bench: true, first: i === 0, pick: (t) => t.roster.bench[i] });
  }
  return (
    <div>
      <div className="pp-subnav">
        {GRID_FILTERS.map((f) => (
          <button key={f} className={"pp-subnav-btn" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
            {f === "ALL" ? "All" : f}
            {f === "ALL" ? null : <span className="pp-grid-count">{count(f)}</span>}
          </button>
        ))}
      </div>
      <div className="pp-grid-wrap">
        <table className="pp-grid">
          <thead>
            <tr>
              <th className="pp-grid-slot" aria-label="Slot" />
              {teams.map((t) => {
                const isMine = !!myTeam && t.id === myTeam.id;
                const chip = moves ? moveChip(moves.get(t.id)) : null;
                return (
                  <th key={t.id} className={"pp-grid-team" + (isMine ? " pp-grid-team-mine" : "")}>
                    <span className="pp-grid-team-name">
                      {t.name}
                      {isMine ? <span className="pp-you-tag">You</span> : null}
                    </span>
                    {showStats && t.roster ? <span className="pp-grid-total">{teamPeriodScore(state, t)}</span> : null}
                    {chip ? <span className={"pp-chip pp-grid-chip " + chip.cls}>{chip.label}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={row.first ? "pp-grid-bench-start" : undefined}>
                <th className="pp-grid-slot">
                  <PositionCard slot={row.slot} position={row.slot} />
                  {row.first ? <span className="pp-grid-bench-label">BENCH</span> : null}
                </th>
                {teams.map((t) => (
                  <GridCell
                    key={t.id} state={state} team={t} slot={row.slot}
                    pid={t.roster ? row.pick(t) : null}
                    bench={row.bench} showStats={showStats} filter={filter}
                    isMine={!!myTeam && t.id === myTeam.id}
                    move={moves ? moves.get(t.id) : null}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== Free Agents ================================ */

export function FreeAgentsTab({ state }) {
  const [tab, setTab] = useState("QB");
  const rostered = allRosteredPlayerIds(state);
  /* RETIRED PLAYERS ARE NOT SHOWN HERE AT ALL - added 2026-09-04, and the reason this
   * screen is no longer verbatim from the artifact.
   *
   * A player the refresh dropped used to land under the OUT tab, because retiring him
   * set his status to OUT and this tab lists every player with that status. So the
   * misspelling the feed had just replaced went on show to every manager in the league:
   * "James Cook" sitting under OUT while "James Cook III" started for somebody. OUT, IR
   * and BYE are football statements about a player who is still in the pool, and they
   * belong here. A retired player is not in the pool, and belongs only to the
   * commissioner's Player Pool screen. */
  const pool = state.playerPool.filter((p) => !p.retired);
  let list;
  if (tab === "BYE") {
    /* THE BYE TAB FILLS ITSELF NOW (OQ-25, Scott 2026-09-08). It used to list only players
     * a commissioner had marked BYE by hand, which in practice meant it was empty all
     * season while forty players a week sat out. It now also holds everyone the schedule
     * says has no game - the same question that keeps them out of the deal - so the tab
     * finally answers "who is unavailable this week" rather than "who did somebody
     * remember to flag". */
    list = pool.filter((p) => p.status === "BYE" || isOnByeThisWeek(state, p));
  } else if (tab === "IR" || tab === "OUT") {
    list = pool.filter((p) => p.status === tab);
  } else {
    /* A player on a bye is NOT a free agent at his position, because no redraw or steal can
     * reach him. Listing him here would be the screen offering something the rules refuse. */
    list = pool.filter(
      (p) => p.position === tab && isPlayerAvailable(state, p) && !rostered.has(p.id)
    );
  }
  list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <div className="pp-subnav">
        {FA_TABS.map((t) => (
          <button key={t} className={"pp-subnav-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="pp-card">
        {list.length === 0 ? (
          <EmptyState>
            {tab === "BYE"
              ? "Nobody is sitting out this week."
              : tab === "IR" || tab === "OUT"
                ? "No players marked " + tab + " right now."
                : "No " + tab + " free agents right now."}
          </EmptyState>
        ) : (
          list.map((p) => <FreeAgentRow key={p.id} state={state} p={p} />)
        )}
      </div>
    </div>
  );
}

/* One free agent. Its own component since OQ-29, because the injury notepad remembers
 * whether it is open - and a hook cannot live inside the list's .map(). */
/*
 * THE SAME ROW AS A ROSTERED PLAYER (Scott, 2026-10-19). It used to be a small suit
 * square, the full name and "WR - SEA" in faint grey, with no game on it at all. He asked
 * for it to match the roster row he picked: the ivory card, J. Goff, SEA | WR, then the
 * opponent and kickoff - which matters here more than anywhere, since this is the list a
 * redraw or a steal is chosen from.
 */
function FreeAgentRow({ state, p }) {
  const injury = useInjuryNotes(state, p);
  const line = playerWeekLine(state, p);
  const meta = slotMetaLine(state, p.position, p);
  /* A player the SCHEDULE has sitting out is still "Active" - nothing wrote a status on
   * him - so he would otherwise appear in the BYE list with no tag, looking like an
   * ordinary free agent who had wandered in. */
  const status = p.status !== "Active" ? p.status : isOnByeThisWeek(state, p) ? "BYE" : null;
  return (
    <div className="pp-roster-slot">
      <PositionCard slot={p.position} position={p.position} />
      <div className="pp-roster-slot-body">
        <div className="pp-roster-slot-top">
          <span className="pp-roster-slot-who">
            <PlayerName player={p} />
            {injury.tag}
          </span>
          {status ? <span className="pp-status-pill">{status}</span> : null}
        </div>
        <PlayerIdLine player={p} state={state} />
        {meta ? <div className="pp-roster-slot-meta">{meta}</div> : null}
        {line ? <div className="pp-roster-slot-stats">{statLineText(state, p, line)}</div> : null}
        {injury.report}
      </div>
      {/* OQ-28: what he is scoring for nobody this week, and his season average -
          the same column a rostered player carries, greyed because it counts for
          no team. */}
      <PointsColumn pts={playerWeekPoints(state, p)} average={playerSeasonAverage(state, p)} notCounting />
    </div>
  );
}

/* =============================== Live Stats ================================= */

