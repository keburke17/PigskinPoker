/* What every team's scheme did this week, as transaction lines.
 *
 * WHY THIS EXISTS. Scott's call on 2026-10-16, after three rounds of mockups: the week's
 * action should read like a fantasy app's transaction list - ADD, DROP, STOLEN, BLOCK -
 * with every line saying where the player came from or went. "Sunday Scaries stole Puka
 * Nacua" is half a sentence unless it also says from whom, and a fill-in should say it
 * came from free agency.
 *
 * WHERE THE FACTS COME FROM. An activity entry is { id, period, type, text } and nothing
 * else - see the note at the top of activity.jsx for why it cannot carry structured
 * fields (parity compares entries field for field, and decompose.js keeps only type and
 * text). But the sentences are written by the engine from fixed templates in
 * src/engine/schemes.js, and every one of them already names the player taken, the team
 * it came from, the drop and the free agent who filled the gap. So this file reads those
 * sentences back into parts. Nothing here changes what a scheme does.
 *
 * THE SOFT EDGE, and what happens on it. A sentence is matched against the league's
 * CURRENT team names, so a team renamed after its move, or an entry from a template this
 * file does not know, will not parse. That entry is returned as `{ raw: entry }` and the
 * screen shows the engine's own sentence instead - never a guess, and never nothing.
 * tests/weekMoves.test.js pins each template against the engine's real output.
 */

/* Kept here rather than imported from activity.jsx, which imports this file. */
function periodEntries(log, period) {
  if (!period) return [];
  return (log || []).filter((e) => e.period && e.period.type === period.type && e.period.number === period.number);
}

const FREE_AGENT = " (free agent)";
const NO_REPLACEMENT = "no replacement - free-agent pool empty at ";

/* Longest first, so "Blitz Brothers II" is not read as "Blitz Brothers". */
function namesLongestFirst(teamNames) {
  return (teamNames || []).filter(Boolean).slice().sort((a, b) => b.length - a.length);
}

function leadingTeam(text, names) {
  return names.find((n) => text.startsWith(n + " ")) || null;
}

/* "Josh Allen (QB)" -> { name, position } */
function nameAndPosition(s) {
  const m = /^(.*) \(([A-Z]+)\)$/.exec(s);
  return m ? { name: m[1], position: m[2] } : null;
}

/* The tail of a steal or redraw: a free agent's name, or the engine's "pool empty" words. */
function replacement(s) {
  if (s.endsWith(FREE_AGENT)) return s.slice(0, -FREE_AGENT.length);
  if (s.startsWith(NO_REPLACEMENT)) return null;
  return undefined;
}

/**
 * One activity entry -> one move, or null for entries that are not a manager's scheme
 * (a finalized week, the clock, a warning). `{ raw }` when it is a scheme the sentence
 * of which could not be read.
 */
export function parseMove(entry, teamNames) {
  if (!entry) return null;
  const type = entry.type;
  if (type !== "block" && type !== "steal" && type !== "redraw" && type !== "steal-failed") return null;
  const text = String(entry.text || "");
  const names = namesLongestFirst(teamNames);
  const team = leadingTeam(text, names);
  if (!team) return { raw: entry };
  const rest = text.slice(team.length + 1);

  if (type === "block") {
    const m = /^blocked (.*) from being stolen this (?:week|round)\.$/.exec(rest);
    const p = m ? nameAndPosition(m[1]) : null;
    return p ? { type, team, player: p.name, position: p.position } : { raw: entry };
  }

  if (type === "steal-failed") {
    const m = /^tried to steal a ([A-Z]+) but /.exec(rest);
    return m ? { type, team, position: m[1] } : { raw: entry };
  }

  if (type === "redraw") {
    const m = /^redrew (.*) \(([A-Z]+)\) for (.*)\.$/.exec(rest);
    if (!m) return { raw: entry };
    const fill = replacement(m[3]);
    if (fill === undefined) return { raw: entry };
    return { type, team, position: m[2], dropped: m[1], added: fill };
  }

  /* steal: "<team> stole <POS> <player> from <victim> (dropped <player>). <victim>
   * received <free agent> (free agent) in return." The victim is found by trying every
   * other team's name, because a player's name can contain anything. */
  const head = /^stole ([A-Z]+) /.exec(rest);
  if (!head) return { raw: entry };
  const position = head[1];
  const body = rest.slice(head[0].length);
  for (const victim of names) {
    if (victim === team) continue;
    const fromAt = body.indexOf(" from " + victim + " (dropped ");
    if (fromAt === -1) continue;
    const stolen = body.slice(0, fromAt);
    const afterDropped = body.slice(fromAt + (" from " + victim + " (dropped ").length);
    const tail = "). " + victim + " received ";
    const tailAt = afterDropped.indexOf(tail);
    if (tailAt === -1) continue;
    const dropped = afterDropped.slice(0, tailAt);
    let got = afterDropped.slice(tailAt + tail.length);
    if (!got.endsWith(" in return.")) continue;
    got = got.slice(0, -" in return.".length);
    const fill = replacement(got);
    if (fill === undefined) continue;
    return { type, team, victim, position, stolen, dropped, fill };
  }
  return { raw: entry };
}

function blankTeam(team) {
  return { teamId: team.id, teamName: team.name, scheme: null, lines: [], hit: false, raw: [] };
}

/**
 * Every team's week, as transaction lines, for the open period. Lines are
 * { kind, player, position, note }, kind one of add / drop / stolen / block / none /
 * empty. A team that played no scheme and was not touched comes back with no lines.
 *
 * `scheme` is what THAT TEAM played - block, steal, steal-failed, redraw - or null.
 * `hit` is true when somebody stole from them, whatever they played.
 */
export function weekMoves(state, period) {
  const p = period || (state && state.currentPeriod);
  const teams = (state && state.teams) || [];
  const byName = new Map(teams.map((t) => [t.name, blankTeam(t)]));
  const names = teams.map((t) => t.name);
  /* Oldest first, so the lines read in the order the schemes ran: blocks, then steals,
   * then redraws (src/engine/schemes.js). */
  const entries = periodEntries(state && state.activityLog, p);
  const unread = [];
  let any = false;

  entries.forEach((entry) => {
    const mv = parseMove(entry, names);
    if (!mv) return;
    any = true;
    if (mv.raw) {
      unread.push(mv.raw);
      return;
    }
    const mine = byName.get(mv.team);
    if (!mine) return;
    mine.scheme = mv.type;
    if (mv.type === "block") {
      mine.lines.push({ kind: "block", player: mv.player, position: mv.position, note: "blocked - could not be stolen" });
    } else if (mv.type === "steal-failed") {
      mine.lines.push({ kind: "none", player: "No " + mv.position + " to steal", position: mv.position, note: "every " + mv.position + " was blocked or unavailable - roster unchanged" });
    } else if (mv.type === "redraw") {
      mine.lines.push({ kind: "drop", player: mv.dropped, position: mv.position, note: "dropped to free agency" });
      mine.lines.push(mv.added
        ? { kind: "add", player: mv.added, position: mv.position, note: "from free agency" }
        : { kind: "empty", player: "Empty " + mv.position + " spot", position: mv.position, note: "no free agent " + mv.position + " was left" });
    } else if (mv.type === "steal") {
      mine.lines.push({ kind: "add", player: mv.stolen, position: mv.position, note: "stolen from " + mv.victim });
      mine.lines.push({ kind: "drop", player: mv.dropped, position: mv.position, note: "dropped to free agency" });
      const victim = byName.get(mv.victim);
      if (victim) {
        victim.hit = true;
        victim.lines.push({ kind: "stolen", player: mv.stolen, position: mv.position, note: "stolen by " + mv.team });
        victim.lines.push(mv.fill
          ? { kind: "add", player: mv.fill, position: mv.position, note: "from free agency, fills " + mv.stolen + "'s spot" }
          : { kind: "empty", player: "Empty " + mv.position + " spot", position: mv.position, note: "no free agent " + mv.position + " was left to fill it" });
      }
    }
  });

  return { any, teams: teams.map((t) => byName.get(t.name)), unread };
}

/** The ticket's headline for one team's week. */
export function moveHeadline(tm) {
  if (!tm) return "";
  const first = (kind) => tm.lines.find((l) => l.kind === kind);
  const stolen = first("stolen");
  if (tm.scheme === "steal") {
    const got = tm.lines.find((l) => l.kind === "add" && l.note.startsWith("stolen from "));
    return "You stole " + got.player + (stolen ? ", but lost " + stolen.player : "");
  }
  if (tm.scheme === "redraw") {
    const got = tm.lines.find((l) => l.kind === "add" && l.note === "from free agency");
    const base = got ? "You redrew " + got.player : "Your redraw found no free agent";
    return base + (stolen ? ", but lost " + stolen.player : "");
  }
  if (tm.scheme === "block") {
    const b = first("block");
    return stolen ? b.player + " was safe. " + stolen.player + " was not." : b.player + " was protected";
  }
  if (tm.scheme === "steal-failed") {
    return "Your steal found no one to take" + (stolen ? ", and you lost " + stolen.player : "");
  }
  if (stolen) return tm.lines.filter((l) => l.kind === "stolen").length > 1
    ? "You had players stolen"
    : stolen.note.replace("stolen by ", "") + " stole " + stolen.player;
  return "No scheme this week";
}

/** The chip for one team's week - its own scheme, or what happened to it. */
export function moveChip(tm) {
  if (!tm) return null;
  if (tm.scheme === "steal") return { label: "Steal", cls: "pp-chip-steal" };
  if (tm.scheme === "redraw") return { label: "Redraw", cls: "pp-chip-redraw" };
  if (tm.scheme === "block") return { label: "Block", cls: "pp-chip-block" };
  if (tm.scheme === "steal-failed") return { label: "No target", cls: "pp-chip-miss" };
  if (tm.hit) return { label: "Stolen from", cls: "pp-chip-lost" };
  return { label: "No scheme", cls: "pp-chip-quiet" };
}
