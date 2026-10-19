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
 * The lines are picked with a seeded random choice per team per week, so a recap does not
 * change when it is reopened. Variety is exactly as wide as the lists below: add lines to
 * a list and the recaps get more varied, which is the whole cost of the free version.
 */

import { computeStarterPoints, getPlayer, roundPoints, seededRng, slotForPlayer } from "../engine/index.js";
import { standingsThrough } from "../components/weekByWeek.jsx";

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

  return {
    week,
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

/* ------------------------------ the lines ------------------------------ */

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

const HEADLINES = {
  win: ["Bow Down, Peasants", "King of the Hill, For Now", "Somebody Frame This Week", "The Whole League Got Cooked", "Top of the Mountain"],
  closeWin: ["Won By a Whisker", "Photo Finish, and You Got the Photo", "Survived by the Skin of Your Teeth"],
  closeLoss: ["So Close You Can Taste It", "A Rounding Error From Glory", "Beaten by a Hair"],
  robbed: ["Robbed in Broad Daylight", "Somebody Call the Cops", "Your Best Player Got a New Address"],
  bench: ["Your Bench Would Like a Word", "Wrong Guys, Coach", "The Bench Mob Strikes Again", "Started the Wrong Half"],
  stealBust: ["That Wasn't a Steal, It Was a Donation", "Shoplifted a Dud", "Crime Doesn't Pay"],
  stealHit: ["Grand Theft Fantasy", "The Heist Paid Off", "Five-Finger Discount"],
  redrawHit: ["Scratch-Off Winner", "Hit the Jackpot at the Free Agent Bin"],
  redrawBust: ["Swapped a Body for a Ghost", "The Redraw Ate Your Lunch"],
  injury: ["Thoughts and Prayers", "The Injury Report Tried to Warn You"],
  top: ["Podium Finish", "So Close to the Top", "Knocking on the Door"],
  mid: ["Aggressively Medium", "The Beige Sedan of Fantasy Football", "Perfectly Forgettable", "Middle of the Pack, Middle of the Road"],
  bottom: ["Rough Week at the Office", "Let's Never Speak of This", "Thoughts on Next Week?"],
  last: ["Rock Bottom Has a Basement", "Dead Last, Dead Serious", "The Only Way Is Up"],
};

const OPENERS = {
  win: ["{score} points and the top spot. You were the best team in the league this week and nobody can say otherwise.", "You posted {score} and won Week {week}. Everyone else was playing for second."],
  top: ["{score} points, {place} place. A strong week, just not quite strong enough.", "{place} out of {of} with {score}. Close enough to see the top, not close enough to touch it.", "{score} points and a spot on the podium at {place}. Not bad at all."],
  mid: ["{score} points, {place} place. Not good, not bad, just there.", "You finished {place} with {score}. The kind of week nobody will remember, including you.", "{place} place, {score} points. The vanilla ice cream of fantasy weeks.", "{score} points got you {place}. Your mom would say she's proud of you."],
  bottom: ["{score} points, {place} out of {of}. That's a rough one.", "You scored {score} and finished {place}. The rest of the league thanks you for your service.", "{place} with {score}. You weren't last, which is the nicest thing anyone can say about this week."],
  last: ["{score} points and dead last. Somebody had to be, and this week it was you.", "{place} out of {of}. You scored {score}, which in this league is what we call a cry for help."],
};

const STANDINGS = {
  up: ["You climbed {move} to {rankNow} overall.", "Up {move} in the standings to {rankNow}."],
  down: ["You slid {move} to {rankNow} overall.", "Down {move} in the standings to {rankNow}. Gravity is undefeated."],
  flat: ["You're holding at {rankNow} overall.", "Still {rankNow} overall. Treading water."],
};

const MVP_NOTES = ["Carried the whole roster", "The only one who showed up", "Earned his paycheck", "Put the team on his back"];
const DUD_NOTES = ["Hope he's ok", "Woof", "Thanks for nothing", "Was he even there?", "Somebody check on him"];
const DECENT_DUD_NOTES = ["Your worst starter, which says a lot about this week", "Even your dud was fine. Annoying."];
const ZERO_NOTES = ["Didn't play. Started anyway.", "Zero. Zilch. Nada.", "Inactive. Still in your lineup."];

function pickWith(rng) {
  return (list) => list[Math.floor(rng() * list.length)];
}

function band(fx) {
  if (fx.place === 1) return "win";
  if (fx.place <= 3) return "top";
  if (fx.place === fx.of) return "last";
  if (fx.place > fx.of - 3) return "bottom";
  return "mid";
}

/** Facts in, recap out - in the shape WeeklyRecap.jsx draws. */
export function writeRecap(fx) {
  let seed = fx.week * 1000;
  for (const c of fx.teamId) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const pick = pickWith(seededRng(seed));
  const b = band(fx);
  const s = fx.scheme;
  const v = { ...fx, score: f(fx.score), place: ord(fx.place), rankNow: ord(fx.rankNow), move: Math.abs(fx.rankMove) + (Math.abs(fx.rankMove) === 1 ? " spot" : " spots") };

  /* Every notable thing, scored by how much it should lead the recap. */
  const moments = [];

  if (fx.robbed) {
    moments.push({
      weight: fx.robbed.pts >= 15 ? 9 : fx.robbed.pts < 5 ? 3 : 5, headline: fx.robbed.pts >= 10 ? "robbed" : null,
      note: { kind: "steal", title: "Crime scene", text: fill(pick([
        "{thief} stole {name} off your roster and he scored {pts} for them. {thiefLine}",
        "{name} got stolen by {thief} and put up {pts} on their roster. {thiefLine}",
      ]), { ...fx.robbed, pts: f(fx.robbed.pts), thiefLine: fx.robbed.pts < 5 ? "Joke's on them." : fx.robbed.thiefPlace === 1 ? "They won the week. With your guy. Cool." : fx.robbed.thiefPlace ? "They finished " + ord(fx.robbed.thiefPlace) + "." : "" }) },
    });
  }

  if (s.type === "steal" && s.skipped) {
    moments.push({ weight: 4, note: { kind: "steal", title: "Steal review", text: "You tried to steal a " + s.position + ", but every " + s.position + " worth taking was blocked. Your scheme did nothing, which matched your team's effort." } });
  } else if (s.type === "steal" && s.got) {
    const net = roundPoints(s.got.pts - s.dropped.pts);
    const hit = net >= 8;
    const bust = net <= -6;
    moments.push({
      weight: hit || bust ? 8 : 3, headline: hit ? "stealHit" : bust ? "stealBust" : null,
      note: { kind: "steal", title: hit ? "The steal of the week" : bust ? "Steal review" : "Your steal", text:
        "You dropped " + s.dropped.name + " (" + f(s.dropped.pts) + ") and stole " + s.got.name + " from " + s.fromName + ". He scored " + f(s.got.pts) + ". " +
        (hit ? pick(["Net gain: " + f(net) + " points. Crime pays.", "That's how you rob a bank."]) :
          bust ? pick(["Net: " + f(net) + ". That isn't a steal, it's a donation with extra steps.", "You'd have been better off stealing nothing. Literally."]) :
            pick(["A wash. All that sneaking around for nothing.", "Net: " + f(net) + ". Not exactly a heist."])) +
        (s.fromPlace === fx.of ? " And you took it from the last-place team, you monster." : ""),
      },
    });
  } else if (s.type === "redraw" && s.got) {
    const net = roundPoints(s.got.pts - s.dropped.pts);
    const hit = net >= 8;
    const bust = net <= -6;
    moments.push({
      weight: hit || bust ? 7 : 2, headline: hit ? "redrawHit" : bust ? "redrawBust" : null,
      note: { kind: "redraw", title: "Redraw review", text:
        "Dropped " + s.dropped.name + " (" + f(s.dropped.pts) + "), got " + s.got.name + " (" + f(s.got.pts) + "). " +
        (hit ? pick(["A scratch-off ticket that paid out.", "The free-agent bin smiled on you."]) :
          bust ? pick(["Net: " + f(net) + ", plus your dignity.", "You traded a body for a ghost."]) :
            pick(["Net: " + f(net) + ". Somewhere an accountant is very proud of you.", "The most sideways move since a crab changed lanes."])) +
        (s.droppedLanded ? " And " + s.dropped.name + " ended up starting for " + s.droppedLanded + "." : ""),
      },
    });
  } else if (s.type === "block") {
    const wasted = s.attempts === 0;
    moments.push({
      weight: wasted && s.player.pts < 6 ? 6 : s.attempts >= 2 ? 6 : 2,
      note: { kind: "block", title: "Block review", text: wasted
        ? "You blocked " + s.player.name + ". Number of teams trying to steal a " + s.player.pos + ": zero. " + (s.player.pts < 6 ? "He scored " + f(s.player.pts) + ". You protected him like the crown jewels." : "At least he scored " + f(s.player.pts) + ".")
        : s.attempts + (s.attempts === 1 ? " team" : " teams") + " went after a " + s.player.pos + " and your block kept " + s.player.name + " home. He scored " + f(s.player.pts) + ". " + (s.player.pts < 8 ? pick(["So they didn't miss much.", "You guarded the vault and it was empty."]) : pick(["Big-brain move.", "For once, you saw it coming."])),
      },
    });
  } else {
    moments.push({ weight: 1, note: { kind: "league", title: "No scheme", text: pick(["You didn't run a scheme this week. Bold of you to just... sit there.", "No Action. You played it safe, which is a choice."]) } });
  }

  if (fx.swap && fx.swap.gain >= 5) {
    moments.push({
      weight: fx.swap.wouldPlace <= fx.place - 3 ? 8 : 4, headline: fx.swap.wouldPlace <= fx.place - 3 && fx.swap.gain >= 15 ? "bench" : null,
      note: { kind: "bench", title: "Bench check", text:
        fx.swap.bench.name + " scored " + f(fx.swap.bench.pts) + " on your bench while " + fx.swap.starter.name + " scored " + f(fx.swap.starter.pts) + " in your lineup. " +
        (fx.swap.wouldPlace < fx.place ? "Starting him would have put you " + ord(fx.swap.wouldPlace) + "." : "Bench points don't count. We checked.") },
    });
  } else if (fx.benchTotal > fx.score) {
    moments.push({ weight: 5, headline: "bench", note: { kind: "bench", title: "Bench check", text: "Your bench scored " + f(fx.benchTotal) + ". Your starters scored " + f(fx.score) + ". Your bench was a better team than your team." } });
  }

  fx.hurt.forEach((h) => {
    if (h.pts >= 8) return;
    moments.push({ weight: 6, headline: "injury", note: { kind: "injury", title: "The injury report", text: h.name + " was listed " + (h.tag === "QUES" ? "Questionable" : "Doubtful") + " and scored " + f(h.pts) + ". " + pick(["The notepad doesn't lie. You just didn't open it.", "You rolled the dice. The dice rolled you."]) } });
  });

  if (fx.place === 1 && fx.below && fx.below.gap < 3) {
    moments.push({ weight: 7, headline: "closeWin", note: { kind: "close", title: "By a hair", text: fx.below.gap === 0 ? "You and " + fx.below.name + " tied on points and you won it on the tiebreaker. Lucky." : fx.below.name + " finished " + f(fx.below.gap) + " behind you. One more catch from anybody and this recap is about them." } });
  } else if (fx.above && fx.above.gap < 3) {
    moments.push({ weight: 6, headline: fx.place === 2 ? "closeLoss" : null, note: { kind: "close", title: "So close", text: fx.above.gap === 0 ? "You tied " + fx.above.name + " on points and lost the tiebreaker. Brutal." : "You finished " + f(fx.above.gap) + " behind " + fx.above.name + ". " + pick(["That's one catch.", "Think about that until Sunday.", "Somebody in your lineup owes you a yard or two."]) } });
  }

  if (fx.coach && fx.coach.result === "Loss" && fx.above && fx.above.gap < 2) {
    moments.push({ weight: 5, note: { kind: "close", title: "Coach card", text: fx.coach.name + "'s team lost. A win was worth 2 points and you missed " + ord(fx.place - 1) + " by " + f(fx.above.gap) + "." } });
  }

  /* One jab around the league, always last. */
  const jab = fx.place === fx.of
    ? pick(["Fresh deal Tuesday. New cards, new hope, same you.", fx.winner.name + " won with " + f(fx.winner.score) + ". You scored " + f(fx.score) + ". Let that sink in."])
    : fx.place === 1
      ? pick([fx.last.name + " finished last with " + f(fx.last.score) + ". Somebody send them a sympathy card.", "Everyone else in the league would like a word with you."])
      : pick(["At least you're not " + fx.last.name + ", who scored " + f(fx.last.score) + " and finished dead last.", fx.winner.name + " won it with " + f(fx.winner.score) + ". Take notes.", "On the bright side, " + fx.last.name + " exists."]);
  const notes = moments.sort((a, b) => b.weight - a.weight).slice(0, 2).map((m) => m.note);
  notes.push({ kind: "league", title: "Around the league", text: jab });

  const lead = moments.find((m) => m.headline && m.weight >= 6);
  const headline = pick(HEADLINES[fx.place === 1 && (!lead || !["closeWin", "stealHit"].includes(lead.headline)) ? "win" : lead ? lead.headline : b]);

  const story = fill(pick(OPENERS[b]), v) + " " +
    fill(pick(STANDINGS[fx.rankMove > 0 ? "up" : fx.rankMove < 0 ? "down" : "flat"]), v);

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
    mvp: { name: fx.best.name, pos: fx.best.pos, pts: fx.best.pts, note: pick(MVP_NOTES) },
    dud: { name: fx.worst.name, pos: fx.worst.pos, pts: fx.worst.pts, note: fx.worst.pts === 0 ? pick(ZERO_NOTES) : fx.worst.pts >= 8 ? pick(DECENT_DUD_NOTES) : pick(DUD_NOTES) },
    notes,
  };
}

/** Every team's free recap for one finished week, best finish first. */
export function freeRecapsFor(league, week) {
  return league.state.teams
    .map((t) => writeRecap(gatherFacts(league, week, t.id)))
    .sort((a, b) => a.place - b.place);
}
