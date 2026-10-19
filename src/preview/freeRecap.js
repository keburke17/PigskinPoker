/* The FREE weekly recap: fill-in-the-blank lines, chosen by what actually happened.
 *
 * No AI and no account. The game already knows everything this reads - the week's
 * results, every starter's and bench player's points, the scheme each team ran and what
 * it did to the rosters, the injury tags, the standings before and after. This file only
 * picks which lines to use and fills in the blanks.
 *
 * Two halves:
 *   gatherFacts  - turns a finished week into plain facts about one team
 *   writeRecap   - turns those facts into the same recap shape the pop-up shows
 *
 * The lines live in recapLines.js and are dealt like cards (makeDeck below), so nobody in
 * a week shares a line and a line does not come back until its whole list has gone round.
 * Variety is exactly as wide as those lists: adding lines is the whole cost of free.
 */

import { computeStarterPoints, getPlayer, roundPoints, seededRng, slotForPlayer } from "../engine/index.js";
import { standingsThrough } from "../components/weekByWeek.jsx";
import * as L from "./recapLines.js";

const SLOTS = ["Coach", "QB", "WR", "RB", "TE", "FLEX"];

function pointsFor(state, lines, pid) {
  const p = getPlayer(state, pid);
  if (!p) return 0;
  return computeStarterPoints(state, lines[pid], p.position);
}

/* The same standings the Week screen pages through, tiebreakers and all. */
function standingsAfter(weeklyResults, week) {
  const rank = new Map();
  if (week < 1) return rank;
  standingsThrough(weeklyResults, { type: "week", number: week }).forEach((row) => rank.set(row.teamId, row.rank));
  return rank;
}

function findOwner(state, pid) {
  for (const t of state.teams) {
    if (!t.roster) continue;
    if (Object.values(t.roster.starters).includes(pid)) return { team: t, starter: true };
    if (t.roster.bench.includes(pid)) return { team: t, starter: false };
  }
  return null;
}

/** Plain facts about one team's finished week. */
export function gatherFacts(league, week, teamId) {
  const { beforeSchemes, scored, lines, injuries } = league.weeks[week];
  const results = league.state.weeklyResults
    .filter((r) => r.period.type === "week" && r.period.number === week)
    .sort((a, b) => a.rank - b.rank);
  const mine = results.find((r) => r.teamId === teamId);
  const team = scored.teams.find((t) => t.id === teamId);
  const before = beforeSchemes.teams.find((t) => t.id === teamId);
  const pts = (pid) => pointsFor(scored, lines, pid);
  const player = (pid) => getPlayer(scored, pid);

  const starters = SLOTS.map((slot) => {
    const pid = team.roster.starters[slot];
    const p = player(pid);
    return p ? { id: pid, slot, name: p.name, pos: p.position, pts: pts(pid), played: !!lines[pid] } : null;
  }).filter(Boolean);
  const bench = team.roster.bench.map((pid) => {
    const p = player(pid);
    return p ? { id: pid, name: p.name, pos: p.position, pts: pts(pid) } : null;
  }).filter(Boolean);

  /* The best single bench-for-starter swap the lineup rules allow. */
  let swap = null;
  bench.forEach((b) => {
    starters.forEach((s) => {
      const fits = s.slot === b.pos || (s.slot === "FLEX" && (b.pos === "WR" || b.pos === "RB"));
      if (!fits) return;
      const gain = roundPoints(b.pts - s.pts);
      if (gain > 0 && (!swap || gain > swap.gain)) swap = { bench: b, starter: s, gain };
    });
  });
  if (swap) {
    const better = roundPoints(mine.rawScore + swap.gain);
    swap.wouldPlace = 1 + results.filter((r) => r.teamId !== teamId && r.rawScore > better).length;
  }

  /* The scheme, read off the rosters either side of processing. */
  const sc = beforeSchemes.schemes[teamId] || null;
  let scheme = { type: "none" };
  if (sc && sc.type === "block") {
    const p = player(sc.playerId);
    const attempts = Object.entries(beforeSchemes.schemes).filter(([id, o]) => id !== teamId && o.type === "steal" && o.position === sc.position).length;
    scheme = { type: "block", player: { name: p.name, pos: p.position, pts: pts(sc.playerId) }, attempts };
  } else if (sc && (sc.type === "steal" || sc.type === "redraw")) {
    const loc = slotForPlayer(before, sc.playerId);
    const gotId = loc && loc.area === "starters" ? team.roster.starters[loc.slot] : null;
    const dropped = player(sc.playerId);
    const got = player(gotId);
    const landed = findOwner(scored, sc.playerId);
    scheme = {
      type: sc.type,
      skipped: gotId === sc.playerId,
      position: sc.position,
      dropped: { name: dropped.name, pos: dropped.position, pts: pts(sc.playerId) },
      got: got ? { name: got.name, pos: got.position, pts: pts(gotId) } : null,
      from: sc.type === "steal" && gotId !== sc.playerId ? findOwner(beforeSchemes, gotId) : null,
      droppedLanded: landed && landed.team.id !== teamId && landed.starter ? landed.team.name : null,
    };
    if (scheme.from) {
      const r = results.find((x) => x.teamId === scheme.from.team.id);
      scheme.fromName = scheme.from.team.name;
      scheme.fromPlace = r ? r.rank : null;
    }
  }

  /* Did someone take one of ours? A starter we had before schemes, now on another team. */
  let robbed = null;
  SLOTS.forEach((slot) => {
    const pid = before.roster.starters[slot];
    if (!pid || (sc && sc.playerId === pid)) return;
    if (team.roster.starters[slot] === pid) return;
    const owner = findOwner(scored, pid);
    if (owner && owner.team.id !== teamId) {
      const thief = results.find((r) => r.teamId === owner.team.id);
      const rep = player(team.roster.starters[slot]);
      robbed = {
        name: player(pid).name, pos: player(pid).position, pts: pts(pid),
        thief: owner.team.name, thiefPlace: thief ? thief.rank : null,
        replacement: rep ? { name: rep.name, pts: pts(team.roster.starters[slot]) } : null,
      };
    }
  });

  const hurt = starters.filter((s) => injuries[s.id]).map((s) => ({ ...s, tag: injuries[s.id] }));

  const rankBefore = standingsAfter(league.state.weeklyResults, week - 1);
  const rankAfter = standingsAfter(league.state.weeklyResults, week);
  const above = results.find((r) => r.rank === mine.rank - 1) || null;
  const below = results.find((r) => r.rank === mine.rank + 1) || null;
  const coach = starters.find((s) => s.pos === "Coach");
  const coachLine = coach ? lines[coach.id] : null;
  const scorers = starters.filter((s) => s.pos !== "Coach").sort((a, b) => b.pts - a.pts);

  const history = league.state.weeklyResults
    .filter((r) => r.teamId === teamId && r.period.type === "week" && r.period.number <= week)
    .sort((a, b) => a.period.number - b.period.number)
    .map((r) => r.rank);

  return {
    week,
    history,
    team: team.name,
    teamId,
    place: mine.rank,
    of: results.length,
    score: mine.rawScore,
    points: mine.standingsPoints,
    rankNow: rankAfter.get(teamId),
    rankMove: (rankBefore.get(teamId) || rankAfter.get(teamId)) - rankAfter.get(teamId),
    above: above ? { name: above.teamName, gap: roundPoints(above.rawScore - mine.rawScore) } : null,
    below: below ? { name: below.teamName, gap: roundPoints(mine.rawScore - below.rawScore) } : null,
    winner: { name: results[0].teamName, score: results[0].rawScore, teamId: results[0].teamId },
    last: { name: results[results.length - 1].teamName, score: results[results.length - 1].rawScore, teamId: results[results.length - 1].teamId },
    best: scorers[0],
    worst: scorers[scorers.length - 1],
    coach: coach ? { name: coach.name, result: coachLine ? coachLine.result : null, pts: coach.pts } : null,
    benchTotal: roundPoints(bench.reduce((n, b) => n + b.pts, 0)),
    swap,
    scheme,
    robbed,
    hurt,
  };
}

/* ------------------------------ the writing ------------------------------ */


const ord = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/* {name} style blanks, filled from an object. */
function fill(line, v) {
  return line.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/* A DECK per list. Lines are dealt from a shuffled list and not dealt again until the
 * whole list has gone round, so twelve teams in one week never share a line while a
 * list has twelve in it, and the next week carries on from where this one stopped.
 * The real feature would keep the deck's position in the database between weeks. */
export function makeDeck(seed) {
  const lists = new Map();
  let thisWeek = new Set();
  const draw = (name, list) => {
    let d = lists.get(name);
    if (!d || d.pos >= d.order.length) {
      const cycle = d ? d.cycle + 1 : 0;
      const rng = seededRng(hash(seed + ":" + name + ":" + cycle));
      const order = list.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      d = { order, pos: 0, cycle };
      lists.set(name, d);
    }
    return list[d.order[d.pos++]];
  };
  return {
    /* A new week: anything may be dealt again, but nothing twice inside one week. */
    newWeek() {
      thisWeek = new Set();
    },
    pick(name, list) {
      for (let tries = 0; tries <= list.length; tries++) {
        const line = draw(name, list);
        if (!thisWeek.has(line)) {
          thisWeek.add(line);
          return line;
        }
      }
      return draw(name, list);
    },
  };
}

function band(fx) {
  if (fx.place === 1) return "win";
  if (fx.place <= 3) return "top";
  if (fx.place === fx.of) return "last";
  if (fx.place > fx.of - 3) return "bottom";
  return "mid";
}

/* How many weeks running, ending this one, `test` held. */
function streak(history, test) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && test(history[i]); i--) n++;
  return n;
}

/** Facts in, recap out - in the shape WeeklyRecap.jsx draws. */
export function writeRecap(fx, deck) {
  const pick = (name) => deck.pick(name, L[name]);
  const b = band(fx);
  const s = fx.scheme;
  const base = {
    score: f(fx.score), place: ord(fx.place), of: fx.of, week: fx.week,
    winner: fx.winner.name, winnerScore: f(fx.winner.score), last: fx.last.name, lastScore: f(fx.last.score),
    gapTop: f(roundPoints(fx.winner.score - fx.score)), weeks: fx.week,
  };
  const moments = [];
  const add = (weight, headline, kind, title, line) => moments.push({ weight, headline, note: { kind, title, text: line } });

  /* Streaks first - they are what a league remembers. */
  const winRun = streak(fx.history, (p) => p === 1);
  const bottomRun = streak(fx.history, (p) => p > fx.of - 3);
  const firstWin = fx.place === 1 && fx.history.filter((p) => p === 1).length === 1 && fx.week > 2;
  if (winRun >= 2) add(9, "winStreak", "close", "The streak", fill(pick("STREAK_WIN"), { count: winRun }));
  else if (firstWin) add(6, "firstWin", "close", "Milestone", fill(pick("FIRST_WIN"), base));
  if (bottomRun >= 2) add(8, fx.place === fx.of ? "lastStreak" : null, "bench", "The streak", fill(pick("STREAK_BOTTOM"), { count: bottomRun }));

  if (fx.robbed) {
    const big = fx.robbed.pts >= 10;
    const v = { ...fx.robbed, pts: f(fx.robbed.pts), week: fx.week };
    let text = fill(pick(big ? "ROBBED_BIG" : "ROBBED_SMALL"), v);
    if (big && fx.robbed.thiefPlace === 1) text += " " + fill(pick("ROBBED_AFTER_WIN"), v);
    add(big ? (fx.robbed.pts >= 15 ? 9 : 6) : 3, big ? "robbed" : null, "steal", "Crime scene", text);
  }

  if (s.type === "steal" && s.skipped) {
    add(5, "stealSkipped", "steal", "Steal review", fill(pick("STEAL_SKIPPED"), { pos: s.position }));
  } else if ((s.type === "steal" || s.type === "redraw") && s.got) {
    const net = roundPoints(s.got.pts - s.dropped.pts);
    const kind = net >= 8 ? "HIT" : net <= -6 ? "BUST" : "MEH";
    const v = { dropped: s.dropped.name, droppedPts: f(s.dropped.pts), got: s.got.name, gotPts: f(s.got.pts), from: s.fromName, net: f(net), team: s.droppedLanded };
    let text = fill(pick((s.type === "steal" ? "STEAL_" : "REDRAW_") + kind), v);
    if (s.type === "steal" && s.fromPlace === fx.of) text += " " + pick("STEAL_FROM_LAST");
    if (s.type === "redraw" && s.droppedLanded) text += " " + fill(pick("DROPPED_LANDED"), v);
    const title = s.type === "steal" ? (kind === "HIT" ? "Steal of the week" : "Steal review") : kind === "HIT" ? "Redraw of the week" : "Redraw review";
    add(kind === "MEH" ? 2 : s.type === "steal" ? 8 : 7, kind === "MEH" ? null : (s.type === "steal" ? "steal" : "redraw") + (kind === "HIT" ? "Hit" : "Bust"), s.type, title, text);
  } else if (s.type === "block") {
    const v = { player: s.player.name, pos: s.player.pos, pts: f(s.player.pts), attempts: s.attempts + (s.attempts === 1 ? " team" : " teams") };
    const low = s.player.pts < 8;
    const list = s.attempts === 0 ? (low ? "BLOCK_WASTED_LOW" : "BLOCK_WASTED_OK") : low ? "BLOCK_SAVED_LOW" : "BLOCK_SAVED_GOOD";
    add(s.attempts === 0 ? (low ? 6 : 2) : low ? 4 : 6, null, "block", "Block review", fill(pick(list), v));
  } else {
    add(1, null, "league", "No scheme", pick("NO_SCHEME"));
  }

  const v = { score: f(fx.score), benchTotal: f(fx.benchTotal) };
  if (fx.swap) Object.assign(v, { benchName: fx.swap.bench.name, benchPts: f(fx.swap.bench.pts), starterName: fx.swap.starter.name, starterPts: f(fx.swap.starter.pts), wouldPlace: ord(fx.swap.wouldPlace) });
  if (fx.benchTotal > fx.score) {
    add(7, fx.benchTotal > fx.score + 10 ? "bench" : null, "bench", "Bench check", fill(pick("BENCH_BETTER"), v));
  } else if (fx.swap && fx.swap.gain >= 5 && fx.swap.wouldPlace < fx.place) {
    const jump = fx.place - fx.swap.wouldPlace;
    add(jump >= 3 ? 8 : 5, jump >= 5 ? "bench" : null, "bench", "Bench check", fill(pick("BENCH_COST"), v));
  } else if (fx.swap && fx.swap.gain >= 8) {
    add(3, null, "bench", "Bench check", fill(pick("BENCH_NOTED"), v));
  }

  const zero = fx.worst && fx.worst.pts === 0 ? fx.worst : null;
  if (zero) add(5, "zero", "injury", "Missing person", fill(pick("ZERO_STARTER"), { name: zero.name, pos: zero.pos }));

  fx.hurt.forEach((h) => {
    if (h.pts >= 8 || h === zero) return;
    add(6, "injury", "injury", "The injury report", fill(pick("INJURY"), { name: h.name, tag: h.tag === "QUES" ? "Questionable" : "Doubtful", pts: f(h.pts) }));
  });

  if (fx.place === 1 && fx.below && fx.below.gap < 3) {
    add(7, "closeWin", "close", "By a hair", fill(pick(fx.below.gap === 0 ? "TIE_WIN" : "CLOSE_WIN"), { other: fx.below.name, gap: f(fx.below.gap) }));
  } else if (fx.above && fx.above.gap < 3) {
    const tie = fx.above.gap === 0;
    add(tie ? 7 : 5, tie ? "tieLoss" : fx.place === 2 ? "closeLoss" : null, "close", tie ? "Tiebreaker" : "So close",
      fill(pick(tie ? "TIE" : "CLOSE_LOSS"), { other: fx.above.name, gap: f(fx.above.gap), nextPlace: ord(fx.place - 1) }));
  }

  if (fx.coach && fx.coach.result === "Loss" && fx.above && fx.above.gap > 0 && fx.above.gap < 2) {
    add(5, null, "close", "Coach card", fill(pick("COACH_LOSS_COSTLY"), { coach: fx.coach.name, gap: f(fx.above.gap), nextPlace: ord(fx.place - 1) }));
  }

  /* Two moments, then always one jab around the league. */
  const top = moments.sort((a, b2) => b2.weight - a.weight);
  const notes = top.slice(0, 2).map((m) => m.note);
  const jab = fx.place === fx.of ? "JAB_FROM_LAST" : fx.place === 1 ? "JAB_TO_LAST" : "JAB_MID";
  notes.push({ kind: "league", title: "Around the league", text: fill(pick(jab), base) });

  /* The headline follows the biggest story; a win is always about the win. */
  const lead = top.find((m) => m.headline && m.weight >= 5);
  let headlineKey = lead ? lead.headline : b;
  if (fx.place === 1) {
    const blowout = fx.below && fx.below.gap >= 15;
    headlineKey = winRun >= 2 ? "winStreak" : firstWin ? "firstWin" : lead && lead.headline === "closeWin" ? "closeWin" : blowout ? "winBlowout" : lead && lead.headline === "stealHit" ? "stealHit" : "win";
  }
  const headline = pick("HEADLINES_" + headlineKey);

  const sv = { ...base, rankNow: ord(fx.rankNow), move: Math.abs(fx.rankMove) + (Math.abs(fx.rankMove) === 1 ? " spot" : " spots") };
  const standingsKey = fx.rankNow === 1 ? "firstOverall" : fx.rankNow === fx.of ? "lastOverall" : fx.rankMove > 0 ? "up" : fx.rankMove < 0 ? "down" : "flat";
  let standingsLine = fill(pick("STANDINGS_" + standingsKey), sv);
  if ((standingsKey === "firstOverall" || standingsKey === "lastOverall") && fx.rankMove !== 0) {
    standingsLine = fill(pick("STANDINGS_" + (fx.rankMove > 0 ? "up" : "down")), sv) + " " + standingsLine;
  }
  const story = fill(pick("OPENERS_" + b), base) + " " + standingsLine;

  const margin = fx.place === 1
    ? (fx.below.gap === 0 ? "Tied " + fx.below.name + " and won the tiebreaker" : "Won the week by " + f(fx.below.gap) + " over " + fx.below.name)
    : (fx.above.gap === 0 ? "Tied with " + ord(fx.place - 1) + ", lost the tiebreaker" : f(fx.above.gap) + " behind " + ord(fx.place - 1)) +
      (fx.below ? (fx.below.gap === 0 ? ", tied with " + ord(fx.place + 1) : ", " + f(fx.below.gap) + " ahead of " + ord(fx.place + 1)) : "");

  return {
    id: "free-" + fx.week + "-" + fx.teamId,
    label: ord(fx.place) + " - " + fx.team,
    team: fx.team,
    week: fx.week,
    place: fx.place,
    of: fx.of,
    score: fx.score,
    points: fx.points,
    rankNow: fx.rankNow,
    rankMove: fx.rankMove,
    margin,
    headline,
    story,
    mvp: { name: fx.best.name, pos: fx.best.pos, pts: fx.best.pts, note: pick("MVP_NOTES") },
    dud: { name: fx.worst.name, pos: fx.worst.pos, pts: fx.worst.pts, note: pick(fx.worst.pts === 0 ? "ZERO_NOTES" : fx.worst.pts >= 8 ? "DECENT_DUD_NOTES" : "DUD_NOTES") },
    notes,
  };
}

/** Every team's free recap for every recap week, best finish first, from one deck. */
export function freeRecapsByWeek(league, weeks) {
  const deck = makeDeck("league");
  const out = {};
  weeks.slice().sort((a, b) => a - b).forEach((w) => {
    deck.newWeek();
    const facts = league.state.teams.map((t) => gatherFacts(league, w, t.id)).sort((a, b) => a.place - b.place);
    out[w] = facts.map((fx) => writeRecap(fx, deck));
  });
  return out;
}
