/* Pigskin Poker - writing the FREE weekly recap: facts in, funny words out.
 *
 * Scott, 2026-10-19: free for now - no AI, no account - "as many free version lines i can
 * get to make it so it isnt repetitive at all". So every word comes from lines.js, picked
 * by what happened to the team (facts.js) and dealt from a deck that never deals the same
 * line twice in a season.
 *
 * THE DECK IS SAVED BETWEEN WEEKS. Its state is the set of lines already used this season,
 * by list - kept as short hashes of the line text, not positions, so adding lines to a
 * list mid-season cannot shuffle a used line back into the unused pile. The server keeps
 * it on the season (`seasons.recap_deck`) and hands it back each finalize.
 *
 * When a list runs dry the recap falls back - to another list, to a plain sentence of
 * fact, or for an optional note to leaving it out - rather than repeat a joke.
 * scripts/recap-season-check.mjs plays whole simulated seasons through this to check that
 * a 12-team, 18-week season neither repeats a line nor runs a list dry.
 */

import { roundPoints, seededRng } from "../engine/index.js";
import * as L from "./lines.js";

const ord = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/* {name} style blanks, filled from an object. */
function fill(line, v) {
  if (line == null) return null;
  return line.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * A deck per list, for one season.
 *
 * @param seed   anything stable for the season (the server uses the season id), so the
 *               order lines come out in is fixed for that season
 * @param saved  a previous `deck.save()`, or nothing for a fresh season
 */
export function makeDeck(seed, saved) {
  const used = new Map(Object.entries((saved && saved.used) || {}).map(([k, v]) => [k, new Set(v)]));
  const orders = new Map();
  const orderFor = (name, list) => {
    let order = orders.get(name);
    if (!order || order.length !== list.length) {
      const rng = seededRng(hash(seed + ":" + name));
      order = list.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      orders.set(name, order);
    }
    return order;
  };
  return {
    /** A line never dealt before this season from this list, or null when it is spent. */
    fresh(name, list) {
      if (!list || !list.length) return null;
      const spent = used.get(name) || new Set();
      for (const i of orderFor(name, list)) {
        const key = hash(list[i]).toString(36);
        if (!spent.has(key)) {
          spent.add(key);
          used.set(name, spent);
          return list[i];
        }
      }
      return null;
    },
    /** What to keep until next week: plain JSON. */
    save() {
      return { used: Object.fromEntries([...used.entries()].map(([k, v]) => [k, [...v]])) };
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

/** Facts in, recap out - in the shape the pop-up draws (src/components/weeklyRecap.jsx). */
export function writeRecap(fx, deck) {
  /* The first list with a fresh line wins; `fallback` (plain fact) when all are spent. */
  const pick = (names, fallback) => {
    for (const n of [].concat(names)) {
      const line = deck.fresh(n, L[n]);
      if (line) return line;
    }
    return fallback;
  };
  const b = band(fx);
  const s = fx.scheme;
  const base = {
    score: f(fx.score), place: ord(fx.place), of: fx.of, week: fx.week,
    winner: fx.winner.name, winnerScore: f(fx.winner.score), last: fx.last.name, lastScore: f(fx.last.score),
    gapTop: f(roundPoints(fx.winner.score - fx.score)), weeks: fx.week,
  };
  const moments = [];
  /* A moment's words are only dealt if it makes the recap, so a list is not spent on
   * notes nobody reads; one whose list is spent is left out rather than repeated. */
  const add = (weight, headline, kind, title, write) => moments.push({ weight, headline, kind, title, write });

  /* Streaks first - they are what a league remembers. */
  const winRun = streak(fx.history, (p) => p === 1);
  const bottomRun = streak(fx.history, (p) => p > fx.of - 3);
  const firstWin = fx.place === 1 && fx.history.filter((p) => p === 1).length === 1 && fx.week > 2;
  if (winRun >= 2) add(9, "winStreak", "close", "The streak", () => fill(pick("STREAK_WIN"), { count: winRun }));
  else if (firstWin) add(6, "firstWin", "close", "Milestone", () => fill(pick("FIRST_WIN"), base));
  if (bottomRun >= 2) add(8, fx.place === fx.of ? "lastStreak" : null, "bench", "The streak", () => fill(pick("STREAK_BOTTOM"), { count: bottomRun }));

  if (fx.robbed) {
    const big = fx.robbed.pts >= 10;
    const v = { ...fx.robbed, pts: f(fx.robbed.pts), week: fx.week };
    add(big ? (fx.robbed.pts >= 15 ? 9 : 6) : 3, big ? "robbed" : null, "steal", "Crime scene", () => {
      const text = fill(pick(big ? "ROBBED_BIG" : "ROBBED_SMALL"), v);
      const after = text && big && fx.robbed.thiefPlace === 1 ? fill(pick("ROBBED_AFTER_WIN"), v) : null;
      return text && after ? text + " " + after : text;
    });
  }

  if (s.type === "steal" && s.skipped) {
    add(5, "stealSkipped", "steal", "Steal review", () => fill(pick("STEAL_SKIPPED"), { pos: s.position }));
  } else if ((s.type === "steal" || s.type === "redraw") && s.got && s.dropped && s.got.pts != null && s.dropped.pts != null) {
    const net = roundPoints(s.got.pts - s.dropped.pts);
    const kind = net >= 8 ? "HIT" : net <= -6 ? "BUST" : "MEH";
    const v = { dropped: s.dropped.name, droppedPts: f(s.dropped.pts), got: s.got.name, gotPts: f(s.got.pts), from: s.fromName, net: f(net), team: s.droppedLanded };
    const write = () => {
      const text = fill(pick((s.type === "steal" ? "STEAL_" : "REDRAW_") + kind), v);
      const extra = !text ? null : s.type === "steal" && s.fromPlace === fx.of ? pick("STEAL_FROM_LAST") : s.type === "redraw" && s.droppedLanded ? fill(pick("DROPPED_LANDED"), v) : null;
      return text && extra ? text + " " + extra : text;
    };
    const title = s.type === "steal" ? (kind === "HIT" ? "Steal of the week" : "Steal review") : kind === "HIT" ? "Redraw of the week" : "Redraw review";
    add(kind === "MEH" ? 2 : s.type === "steal" ? 8 : 7, kind === "MEH" ? null : (s.type === "steal" ? "steal" : "redraw") + (kind === "HIT" ? "Hit" : "Bust"), s.type, title, write);
  } else if (s.type === "block" && s.player.pts != null) {
    const v = { player: s.player.name, pos: s.player.pos, pts: f(s.player.pts), attempts: s.attempts + (s.attempts === 1 ? " team" : " teams") };
    const low = s.player.pts < 8;
    const list = s.attempts === 0 ? (low ? "BLOCK_WASTED_LOW" : "BLOCK_WASTED_OK") : low ? "BLOCK_SAVED_LOW" : "BLOCK_SAVED_GOOD";
    add(s.attempts === 0 ? (low ? 6 : 2) : low ? 4 : 6, null, "block", "Block review", () => fill(pick(list), v));
  } else if (s.type === "none") {
    add(1, null, "league", "No scheme", () => pick("NO_SCHEME"));
  }

  const v = { score: f(fx.score), benchTotal: f(fx.benchTotal) };
  if (fx.swap) Object.assign(v, { benchName: fx.swap.bench.name, benchPts: f(fx.swap.bench.pts), starterName: fx.swap.starter.name, starterPts: f(fx.swap.starter.pts), wouldPlace: ord(fx.swap.wouldPlace) });
  if (fx.benchTotal != null && fx.benchTotal > fx.score) {
    add(7, fx.benchTotal > fx.score + 10 ? "bench" : null, "bench", "Bench check", () => fill(pick("BENCH_BETTER"), v));
  } else if (fx.swap && fx.swap.gain >= 5 && fx.swap.wouldPlace < fx.place) {
    const jump = fx.place - fx.swap.wouldPlace;
    add(jump >= 3 ? 8 : 5, jump >= 5 ? "bench" : null, "bench", "Bench check", () => fill(pick("BENCH_COST"), v));
  } else if (fx.swap && fx.swap.gain >= 8) {
    add(3, null, "bench", "Bench check", () => fill(pick("BENCH_NOTED"), v));
  }

  const zero = fx.worst && fx.worst.pts === 0 ? fx.worst : null;
  if (zero) add(5, "zero", "injury", "Missing person", () => fill(pick("ZERO_STARTER"), { name: zero.name, pos: zero.pos }));

  fx.hurt.forEach((h) => {
    if (h.pts >= 8 || h === zero) return;
    add(6, "injury", "injury", "The injury report", () => fill(pick("INJURY"), { name: h.name, tag: h.tag, pts: f(h.pts) }));
  });

  if (fx.place === 1 && fx.below && fx.below.gap < 3) {
    add(7, "closeWin", "close", "By a hair", () => fill(pick(fx.below.gap === 0 ? "TIE_WIN" : "CLOSE_WIN"), { other: fx.below.name, gap: f(fx.below.gap) }));
  } else if (fx.above && fx.above.gap < 3) {
    const tie = fx.above.gap === 0;
    add(tie ? 7 : 5, tie ? "tieLoss" : fx.place === 2 ? "closeLoss" : null, "close", tie ? "Tiebreaker" : "So close",
      () => fill(pick(tie ? "TIE" : "CLOSE_LOSS"), { other: fx.above.name, gap: f(fx.above.gap), nextPlace: ord(fx.place - 1) }));
  }

  if (fx.coach && fx.coach.result === "Loss" && fx.above && fx.above.gap > 0 && fx.above.gap < 2) {
    add(5, null, "close", "Coach card", () => fill(pick("COACH_LOSS_COSTLY"), { coach: fx.coach.name, gap: f(fx.above.gap), nextPlace: ord(fx.place - 1) }));
  }

  /* Two moments, then always one jab around the league. */
  const top = moments.sort((a, b2) => b2.weight - a.weight);
  const notes = [];
  for (const m of top) {
    if (notes.length === 2) break;
    const text = m.write();
    if (text && !/\{\w+\}/.test(text)) notes.push({ kind: m.kind, title: m.title, text });
  }
  const jab = fx.place === fx.of ? "JAB_FROM_LAST" : fx.place === 1 ? "JAB_TO_LAST" : "JAB_MID";
  const neighbor = fx.above || fx.below;
  const jv = { ...base, other: neighbor ? neighbor.name : fx.winner.name, otherPlace: ord(neighbor === fx.above ? fx.place - 1 : fx.place + 1) };
  notes.push({ kind: "league", title: "Around the league", text: fill(pick([jab, "JAB_NEIGHBOR", "JAB_ANY"], fx.winner.name + " won the week with {winnerScore}. " + fx.last.name + " finished last with {lastScore}."), jv) });

  /* The headline follows the biggest story; a win is always about the win. */
  const lead = top.find((m) => m.headline && m.weight >= 5);
  let headlineKey = lead ? lead.headline : b;
  if (fx.place === 1) {
    const blowout = fx.below && fx.below.gap >= 15;
    headlineKey = winRun >= 2 ? "winStreak" : firstWin ? "firstWin" : lead && lead.headline === "closeWin" ? "closeWin" : blowout ? "winBlowout" : lead && lead.headline === "stealHit" ? "stealHit" : "win";
  }
  const headline = pick(["HEADLINES_" + headlineKey, "HEADLINES_" + b, "HEADLINES_any"], "Week " + fx.week + ": " + ord(fx.place) + " of " + fx.of);

  const sv = { ...base, rankNow: ord(fx.rankNow), move: Math.abs(fx.rankMove) + (Math.abs(fx.rankMove) === 1 ? " spot" : " spots") };
  const standingsKey = fx.rankNow === 1 ? "firstOverall" : fx.rankNow === fx.of ? "lastOverall" : fx.rankMove > 0 ? "up" : fx.rankMove < 0 ? "down" : "flat";
  const moveKey = fx.rankMove > 0 ? "up" : fx.rankMove < 0 ? "down" : "flat";
  const plain = fx.rankMove === 0 ? "You're {rankNow} overall." : "You're {rankNow} overall, " + (fx.rankMove > 0 ? "up " : "down ") + "{move}.";
  let standingsLine = fill(pick(["STANDINGS_" + standingsKey, "STANDINGS_" + moveKey], plain), sv);
  if ((standingsKey === "firstOverall" || standingsKey === "lastOverall") && fx.rankMove !== 0) {
    standingsLine = fill(pick("STANDINGS_" + moveKey, ""), sv) + " " + standingsLine;
  }
  const story = fill(pick(["OPENERS_" + b, "OPENERS_any"], "{score} points, {place} of {of} in Week {week}."), base) + " " + standingsLine.trim();

  const margin = !fx.above && !fx.below ? "" : fx.place === 1 || !fx.above
    ? (fx.below.gap === 0 ? "Tied " + fx.below.name + " and won the tiebreaker" : "Won the week by " + f(fx.below.gap) + " over " + fx.below.name)
    : (fx.above.gap === 0 ? "Tied with " + ord(fx.place - 1) + ", lost the tiebreaker" : f(fx.above.gap) + " behind " + ord(fx.place - 1)) +
      (fx.below ? (fx.below.gap === 0 ? ", tied with " + ord(fx.place + 1) : ", " + f(fx.below.gap) + " ahead of " + ord(fx.place + 1)) : "");

  return {
    v: 1,
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
    /* The quip when there is a fresh one, otherwise his actual stat line. */
    mvp: fx.best ? { name: fx.best.name, pos: fx.best.pos, pts: fx.best.pts, note: pick("MVP_NOTES", fx.best.statText) } : null,
    dud: fx.worst && fx.worst !== fx.best ? { name: fx.worst.name, pos: fx.worst.pos, pts: fx.worst.pts, note: pick(fx.worst.pts === 0 ? "ZERO_NOTES" : fx.worst.pts >= 8 ? ["DECENT_DUD_NOTES", "DUD_NOTES"] : "DUD_NOTES", fx.worst.statText) } : null,
    notes,
  };
}

