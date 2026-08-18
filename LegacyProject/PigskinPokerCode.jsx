import React, { useState, useEffect, useCallback, useRef } from "react";

/* =========================================================================
   PIGSKIN POKER - League Manager
   Single-file React artifact. Persistence via window.storage.
   ========================================================================= */

/* ----------------------------- Style block ------------------------------ */

const GLOBAL_CSS = `
:root{
 --bg: #0d2a20;
 --bg-2: #0a2118;
 --felt-line: rgba(217,182,76,0.08);
 --surface: #16332a;
 --surface-2: #1d3f33;
 --surface-3: #24493b;
 --border: #2c5445;
 --border-soft: rgba(217,182,76,0.22);
 --text: #f3ecd9;
 --text-dim: #b9c9bc;
 --text-faint: #7f9488;
 --gold: #d9b64c;
 --gold-bright: #f0cf6b;
 --gold-dim: #a9873a;
 --red: #d1594f;
 --red-dim: #7a2e29;
 --blue: #5893d4;
 --green: #55a884;
 --purple: #9b7fd4;
 --danger: #e2564b;
 --danger-dim: #4a201c;
 --ok: #5cb37f;
 --radius: 10px;
 --radius-sm: 6px;
 --shadow-card: 0 2px 0 rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.35);
 --font-display: Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif;
 --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
 --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.pp-root{
  min-height:100vh;
  background:
    radial-gradient(ellipse at 50% -10%, #143c2e 0%, transparent 60%),
    repeating-linear-gradient(45deg, var(--felt-line) 0px, var(--felt-line) 1px, transparent 1px, transparent 26px),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
  color: var(--text);
  font-family: var(--font-body);
  padding-bottom: 48px;
  box-sizing:border-box;
}
.pp-root *, .pp-root *::before, .pp-root *::after{ box-sizing:border-box; }

.pp-container{ max-width: 880px; margin: 0 auto; padding: 0 14px; }

.pp-h1{ font-family: var(--font-display); font-weight:700; font-size: 26px; letter-spacing:0.3px; margin:0; color:var(--text); }
.pp-h2{ font-family: var(--font-display); font-weight:700; font-size: 19px; margin:0 0 10px 0; color:var(--gold-bright); }
.pp-h3{ font-family: var(--font-display); font-weight:700; font-size: 15px; margin:0 0 6px 0; color:var(--text); }
.pp-eyebrow{ font-size:11px; letter-spacing:1.6px; text-transform:uppercase; color:var(--gold-dim); font-weight:700; }

.pp-period-banner{
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  border:1px solid var(--gold-dim); border-radius: var(--radius-sm);
  padding: 9px 12px; margin-bottom: 12px;
}
.pp-period-banner-label{ font-family: var(--font-display); font-weight:700; font-size:15px; color: var(--gold-bright); }
.pp-period-banner-phase{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim); background: rgba(0,0,0,0.25); border-radius:999px; padding:3px 9px; }
.pp-period-banner-extra{ font-size:12px; color: var(--text-faint); margin-left:auto; }
.pp-sub{ color:var(--text-dim); font-size:13px; line-height:1.5; }

.pp-card{
  background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow-card);
  margin-bottom: 14px;
}
.pp-card-tight{ padding: 12px; }

.pp-header{
  position: sticky; top:0; z-index: 40;
  background: linear-gradient(180deg, #0a2118 0%, #0d2a20 90%, rgba(13,42,32,0) 100%);
  padding: 10px 0 6px 0;
  border-bottom: 1px solid var(--border-soft);
}

.pp-suit-badge{
  display:inline-flex; align-items:center; justify-content:center;
  width:22px; height:22px; border-radius:5px;
  font-size:13px; font-weight:800; line-height:1;
  border:1px solid rgba(0,0,0,0.25);
  flex:none;
}
.pp-suit-Coach{ background:#e9e4d4; color:#171717; }
.pp-suit-QB{ background: var(--red-dim); color:#ffd4cf; }
.pp-suit-WR{ background:#1c3a63; color:#bcd7ff; }
.pp-suit-RB{ background:#173a2f; color:#b7ecd2; }
.pp-suit-TE{ background:#3c2f5c; color:#e0d3ff; }
.pp-suit-FLEX{ background:#5a3f16; color:#ffdf9e; }

.pp-tag{
  display:inline-flex; align-items:center; gap:5px;
  font-size:11px; font-weight:700; letter-spacing:0.3px;
  padding: 2px 7px; border-radius: 999px;
  border:1px solid var(--border-soft); color:var(--text-dim);
  background: rgba(0,0,0,0.18); white-space:nowrap;
}

.pp-btn{
  font-family: var(--font-body); font-weight:700; font-size:13px;
  padding: 9px 14px; border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--surface-3); color: var(--text);
  cursor:pointer; transition: transform 0.05s ease, background 0.15s ease;
  user-select:none;
}
.pp-btn:hover{ background:#2c5644; }
.pp-btn:active{ transform: translateY(1px); }
.pp-btn:disabled{ opacity:0.45; cursor:not-allowed; }
.pp-btn-gold{ background: linear-gradient(180deg, var(--gold-bright), var(--gold)); color:#22200f; border-color: var(--gold-dim); }
.pp-btn-gold:hover{ background: linear-gradient(180deg, #f7dc86, #e0bd56); }
.pp-btn-danger{ background: var(--danger-dim); color:#ffd9d4; border-color:#7a2e29; }
.pp-btn-danger:hover{ background:#5c2621; }
.pp-btn-ghost{ background:transparent; border-color:var(--border-soft); }
.pp-btn-sm{ padding:6px 10px; font-size:12px; }
.pp-btn-block{ width:100%; text-align:center; }

.pp-input, .pp-select, .pp-textarea{
  width:100%; font-family: var(--font-body); font-size:14px;
  background: #0f241c; color: var(--text);
  border:1px solid var(--border); border-radius: var(--radius-sm);
  padding: 9px 10px; outline:none;
}
.pp-input:focus, .pp-select:focus, .pp-textarea:focus{ border-color: var(--gold-dim); }
.pp-select{ color-scheme: dark; }
/* Forced dark styling on option elements themselves (color-scheme hint alone is not enough) */
.pp-select option{
  background-color: #14251c !important;
  color: #f3ecd9 !important;
}
.pp-select optgroup{
  background-color: #14251c !important;
  color: #d9b64c !important;
}
.pp-label{ font-size:12px; font-weight:700; color:var(--text-dim); margin-bottom:5px; display:block; }
.pp-field{ margin-bottom:12px; }

.pp-nav{ display:flex; gap:6px; overflow-x:auto; padding: 8px 0 2px 0; -webkit-overflow-scrolling:touch; }
.pp-nav::-webkit-scrollbar{ height:0px; }
.pp-nav-btn{
  flex:none; font-family: var(--font-body); font-weight:700; font-size:12.5px;
  padding: 8px 12px; border-radius: 999px; border:1px solid var(--border-soft);
  background: rgba(0,0,0,0.18); color: var(--text-dim); cursor:pointer; white-space:nowrap;
}
.pp-nav-btn.active{ background: var(--gold); color:#22200f; border-color:var(--gold-dim); }

.pp-subnav{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.pp-subnav-btn{
  font-size:12px; font-weight:700; padding:6px 10px; border-radius:6px;
  border:1px solid var(--border-soft); background:transparent; color:var(--text-dim); cursor:pointer;
}
.pp-subnav-btn.active{ background: var(--surface-3); color:var(--gold-bright); border-color: var(--gold-dim); }

.pp-table{ width:100%; border-collapse:collapse; font-size:13px; }
.pp-table-scroll{ overflow-x:auto; -webkit-overflow-scrolling:touch; margin:0 -4px; padding:0 4px; }
.pp-table-wide{ min-width: 560px; font-size:12.5px; }
.pp-table-wide th{ white-space:nowrap; }

.pp-qr-grid{ display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; }
@media (min-width: 520px){ .pp-qr-grid{ grid-template-columns: repeat(3, 1fr); } }
.pp-qr-tile{ background: rgba(0,0,0,0.2); border:1px solid var(--border-soft); border-radius: var(--radius-sm); padding:10px; text-align:center; }
.pp-qr-value{ font-family: var(--font-mono); font-weight:700; font-size:15px; color: var(--gold-bright); }
.pp-qr-label{ font-size:10.5px; color: var(--text-faint); margin-top:3px; text-transform:uppercase; letter-spacing:0.4px; }

.pp-rule-list{ margin:0; padding-left:18px; list-style:none; }
.pp-rule-list li{ position:relative; padding-left:2px; margin-bottom:7px; font-size:13px; color: var(--text-dim); line-height:1.45; }
.pp-rule-list li::before{ content:"\\2666"; position:absolute; left:-16px; color: var(--gold-dim); font-size:11px; top:2px; }
.pp-rule-list li:last-child{ margin-bottom:0; }
.pp-table th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.6px; color:var(--gold-dim); padding:6px 8px; border-bottom:1px solid var(--border-soft); }
.pp-table td{ padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); vertical-align:top; }

.pp-standings-row td{ padding-top:10px; padding-bottom:2px; }
.pp-standings-sub{ padding-top:0 !important; padding-bottom:10px !important; }
.pp-standings-sub-inner{
  font-size:11px; color:var(--text-faint); line-height:1.7;
  display:flex; flex-wrap:wrap; gap: 4px 14px;
}
.pp-standings-first td{ background: rgba(217,182,76,0.08); }
.pp-crown{ margin-right:4px; }

.pp-roster-slot{
  display:flex; align-items:center; gap:10px; padding:9px 10px;
  border:1px solid var(--border-soft); border-radius: var(--radius-sm);
  background: rgba(0,0,0,0.15); margin-bottom:6px;
}
.pp-roster-slot-label{ font-size:10px; font-weight:800; color:var(--text-faint); width:38px; flex:none; text-transform:uppercase; }
.pp-roster-slot-name{ font-weight:700; font-size:13.5px; flex:1; min-width:0; }
.pp-roster-slot-meta{ font-size:11px; color:var(--text-faint); }
.pp-roster-slot-pts{ font-family: var(--font-mono); font-weight:700; color:var(--gold-bright); font-size:13px; }
.pp-locked-pill{ font-size:9px; font-weight:800; color:#ffb4a8; border:1px solid #7a2e29; border-radius:4px; padding:1px 5px; }

.pp-error-banner{
  background: var(--danger-dim); border:1px solid #7a2e29; color:#ffdcd7;
  border-radius: var(--radius-sm); padding:10px 12px; margin-bottom:12px;
  font-size:12.5px; display:flex; gap:10px; align-items:flex-start; justify-content:space-between;
}
.pp-error-banner code{ display:block; margin-top:4px; font-family:var(--font-mono); font-size:11px; opacity:0.9; word-break:break-word; }

.pp-savebar{
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  font-size:11.5px; color:var(--text-faint); padding: 4px 2px 0 2px;
}
.pp-savedot{ width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:6px; }

.pp-empty{ text-align:center; padding: 26px 10px; color:var(--text-faint); font-size:13px; }

.pp-divider{ height:1px; background:var(--border-soft); margin:14px 0; border:none; }

.pp-grid-2{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
@media (max-width: 480px){ .pp-grid-2{ grid-template-columns: 1fr; } }

.pp-scheme-summary{
  border:1px solid var(--gold-dim); background: rgba(217,182,76,0.09);
  border-radius: var(--radius-sm); padding:10px 12px; margin-bottom:12px; font-size:13px;
}

.pp-pending-pill{ font-size:10px; font-weight:800; padding:2px 6px; border-radius:5px; }
.pp-pending-yes{ background: rgba(92,179,127,0.18); color: var(--ok); }
.pp-pending-no{ background: rgba(226,86,75,0.18); color:#ff9a90; }

.pp-login-wrap{ display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding: 24px 14px; }
.pp-login-card{ max-width:400px; width:100%; }

.pp-badge-role{ font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:var(--gold-dim); }
`;

/* ------------------------------ Player pool ------------------------------ */
/* [Team, Coach, QB, [RBs], [WRs], [TEs]] - mirrors uploaded spec section 15 */
const TEAM_ROWS = [
  ["Arizona Cardinals","Mike LaFleur","Jacoby Brisset",["Jeremiyah Love","Tyler Allgeier"],["Marvin Harrison Jr","Michael Wilson"],["Trey McBride"]],
  ["Atlanta Falcons","Kevin Stafanski","Tua Tagovailoa",["Bijan Robinson","Brian Robinson Jr"],["Drake London"],["Kyle Pitts"]],
  ["Baltimore Ravens","Jesse Minter","Lamar Jackson",["Derek Henry"],["Zay Flowers","Rashod Bateman"],["Mark Andrews"]],
  ["Buffalo Bills","Joe Brady","Josh Allen",["James Cook"],["DJ Moore","Kalil Shakir"],["Dalton Kincaid"]],
  ["Carolina Panthers","Dave Canales","Bryce Young",["Chubba Hubbard","Jonathon Brooks"],["Tet McMillan","Jalen Coker"],["Tommy Tremble","Ja'Tavion Sanders"]],
  ["Chicago Bears","Ben Johnson","Caleb Williams",["D'Andre Swift","Kyle Monangai"],["Rome Odunze","Luther Burden"],["Colston Loveland"]],
  ["Cincinnati Bengals","Zac Taylor","Joe Burrow",["Chase Brown"],["Ja'Marr Chase","Tee Higgins"],["Mike Gesicki"]],
  ["Cleveland Browns","Todd Monken","Deshaun Watson",["Quinshon Judkins","Dylan Sampson"],["Jerry Jeudy","KC Concepcion"],["Harold Fannin"]],
  ["Dallas Cowboys","Brian Schottenheimer","Dak Prescott",["Javonte Williams"],["CeeDee Lamb","George Pickens"],["Jake Ferguson"]],
  ["Denver Broncos","Sean Payton","Bo Nix",["J.K. Dobbins","RJ Harvey"],["Courtland Sutton","Jaylen Waddle"],["Evan Engram"]],
  ["Detroit Lions","Dan Campbell","Jared Goff",["Jahmyr Gibbs","Isiah Pacheco"],["Amon-Ra St. Brown","Jameson Williams"],["Sam Laporta"]],
  ["Green Bay Packers","Matt LaFleur","Jordan Love",["Josh Jacobs"],["Christian Watson","Jayden Reed","Matthew Golden"],["Tucker Kraft"]],
  ["Houston Texans","DeMeco Ryans","C.J. Stroud",["David Montgomery","Woody Marks"],["Nico Collins","Jayden Higgins"],["Dalton Schultz"]],
  ["Indianapolis Colts","Shane Steichen","Daniel Jones",["Jonathan Taylor"],["Alec Pierce","Josh Downs"],["Tyler Warren"]],
  ["Jacksonville Jaguars","Liam Coen","Trevor Lawrence",["Bhayshul Tuten","Chris Rodriguez"],["Brian Thomas Jr","Jakobi Meyers","Parker Washington"],["Brenton Strange"]],
  ["Kansas City Chiefs","Andy Reid","Patrick Mahomes",["Kenneth Walker"],["Rashee Rice","Xavier Worthy"],["Travis Kelce"]],
  ["Los Angeles Chargers","Jim Harbaugh","Justin Herbert",["Omarion Hampton","Keaton Mitchell"],["Ladd McConkey","Quentin Johnston"],["Oronde Gadsden","David Njoku"]],
  ["Los Angeles Rams","Sean McVay","Matthew Stafford",["Kyren Williams","Blake Corum"],["Puka Nacua","Davante Adams"],["Colby Parkinson","Tyler Higbee","Terrance Ferguson"]],
  ["Las Vegas Raiders","Klint Kubiak","Kirk Cousins",["Ashton Jeanty"],["Tre Tucker","Jalen Nailor"],["Brock Bowers"]],
  ["Miami Dolphins","Jeff Hafley","Malik Willis",["De'Von Achane"],["Malik Washington","Jalen Tolbert"],["Greg Dulcich"]],
  ["Minnesota Vikings","Kevin O'Connell","Kyler Murray",["Aaron Jones","Jordan Mason"],["Justin Jefferson","Jordan Addison"],["T.J. Hockenson"]],
  ["New England Patriots","Mike Vrabel","Drake Maye",["Rhamondre Stevenson","TreVeyon Henderson"],["A.J. Brown","Romeo Doubs"],["Hunter Henry"]],
  ["New Orleans Saints","Kellen Moore","Tyler Shough",["Travis Etienne","Alvin Kamara"],["Chris Olave","Jordyn Tyson"],["Juwan Johnson"]],
  ["New York Giants","John Harbaugh","Jaxson Dart",["Cam Skattebo","Tyrone Tracy"],["Malik Nabers","Darius Slayton"],["Isaiah Likely","Theo Johnson"]],
  ["New York Jets","Aaron Glenn","Geno Smith",["Breece Hall","Braelon Allen"],["Garrett Wilson","Adonai Mitchell","Omar Cooper"],["Kenyon Sadiq","Mason Taylor"]],
  ["Philadelphia Eagles","Nick Sirianni","Jalen Hurts",["Saquon Barkley","Tank Bigsby"],["DeVonta Smith","Makai Lemon"],["Dallas Goedert"]],
  ["Pittsburgh Steelers","Mike McCarthy","Aaron Rodgers",["Jaylen Warren","Rico Dowdle"],["DK Metcalf","Michael Pittman"],["Pat Freiermuth","Darnell Washington"]],
  ["Seattle Seahawks","Mike Macdonald","Sam Darnold",["Zach Charbonet","Jadarian Price"],["Jaxson Smith-Njigba","Rashid Shaheed"],["AJ Barner"]],
  ["San Francisco 49ers","Kyle Shanahan","Brock Purdy",["Christian McCaffrey"],["Mike Evans","Ricky Pearsall"],["George Kittle"]],
  ["Tampa Bay Buccaneers","Todd Bowles","Baker Mayfield",["Bucky Irving","Kenneth Gainwell"],["Chris Godwin","Emeka Egbuka"],["Cade Otton"]],
  ["Tennessee Titans","Robert Saleh","Cam Ward",["Tony Pollard","Tyjae Spears"],["Carnell Tate","Wan'Dale Robinson"],["Gunnar Helm"]],
  ["Washington Commanders","Dan Quinn","Jayden Daniels",["Jacory Croskey-Merritt","Rachaad White"],["Terry McLaurin","Luke McCaffrey"],["Chig Okonkwo"]],
];

function generatePlayerPool() {
  const pool = [];
  let counter = 1;
  const push = (name, position, team) => {
    pool.push({
      id: "p" + (counter++),
      name,
      position, // 'Coach' | 'QB' | 'RB' | 'WR' | 'TE'
      team,
      status: "Active", // Active | OUT | IR | BYE
    });
  };
  TEAM_ROWS.forEach(([team, coach, qb, rbs, wrs, tes]) => {
    push(coach, "Coach", team);
    push(qb, "QB", team);
    rbs.forEach((n) => push(n, "RB", team));
    wrs.forEach((n) => push(n, "WR", team));
    tes.forEach((n) => push(n, "TE", team));
  });
  return pool;
}

/* ------------------------------- Constants ------------------------------- */

const POSITIONS = ["Coach", "QB", "WR", "RB", "TE"];
const SCHEME_POSITIONS = ["QB", "WR", "RB", "TE"]; // Coach never selectable
const FA_TABS = ["QB", "WR", "RB", "TE", "Coach", "BYE", "IR", "OUT"];
/* Built via String.fromCodePoint (not raw literal bytes) so the source file stays plain ASCII
   end-to-end -- avoids any risk of a non-ASCII byte getting mangled in transit. */
function CP() { return String.fromCodePoint.apply(null, arguments); }
const SUIT_CH = { spade: CP(0x2660), heart: CP(0x2665), diamond: CP(0x2666), club: CP(0x2663), star: CP(0x2605), sparkle: CP(0x2724) };
const ICON = {
  trophy: CP(0x1F3C6), crown: CP(0x1F451), warn: CP(0x26A0, 0xFE0F),
  football: CP(0x1F3C8), redraw: CP(0x1F501), shield: CP(0x1F6E1, 0xFE0F),
  flag: CP(0x1F3C1), forward: CP(0x27A1, 0xFE0F),
};
const SUIT_GLYPH = { Coach: SUIT_CH.spade, QB: SUIT_CH.heart, WR: SUIT_CH.diamond, RB: SUIT_CH.club, TE: SUIT_CH.star, FLEX: SUIT_CH.sparkle };
const ARROW = CP(0x2192);

const DEFAULT_SCORING = {
  yardsPerPoint: 10, // 1 point per N yards
  pointsPerTD: 5,
  coachWin: 2,
  coachTie: 1,
  coachLoss: 0,
};

/* -------------------------------- Helpers -------------------------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function nowStamp() {
  return new Date().toISOString();
}

function formatClock(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function playerLabel(p) {
  if (!p) return "(empty)";
  return p.name + " - " + p.position + " - " + p.team;
}

function standingsPointsArray(teamCount) {
  const arr = [];
  for (let i = 0; i < teamCount; i++) arr.push(teamCount - i);
  return arr;
}

function defaultAdvancement(bracketSize) {
  const list = [];
  let n = bracketSize;
  while (n >= 1) {
    list.push(n);
    if (n === 1) break;
    n = Math.max(1, Math.floor(n / 2));
  }
  return list;
}

function emptyCumulative() {
  return {
    standingsPoints: 0,
    weekWins: 0,
    coachWins: 0,
    totalTDs: 0,
    totalYards: 0,
    bestPlayer: null, // {name, position, points, period, periodLabel}
  };
}

function periodLabel(period) {
  if (!period) return "";
  return (period.type === "playoff" ? "Playoff Round " : "Week ") + period.number;
}

function makeEmptyLineup() {
  return {
    starters: { Coach: null, QB: null, WR: null, RB: null, TE: null, FLEX: null },
    bench: [null, null, null, null, null, null], // unordered set of 6 player ids, each has its own real position
  };
}

function createDefaultState() {
  return {
    schemaVersion: 1,
    leagueName: "Pigskin Poker",
    commissionerCode: null,
    teams: [], // {id, name, joinCode, roster:{starters,bench}, cumulative, playoffCumulative}
    playerPool: generatePlayerPool(),
    scoringConfig: deepClone(DEFAULT_SCORING),
    standingsPointsOverride: null, // array or null (null = derive from team count)
    currentPeriod: { type: "week", number: 1, phase: "pre-deal" }, // phase: pre-deal | dealt | stats | finalized
    schemes: {}, // teamId -> {type:'block'|'steal'|'redraw'|'noaction', position, playerId, submittedAt}
    rosterLocked: false,
    lockedPlayerIds: {}, // playerId -> true (this period)
    statsEntry: {}, // teamId -> { Coach:{result}, QB:{yards,tds}, WR:{...}, RB:{...}, TE:{...}, FLEX:{...} }
    weeklyResults: [], // {id, period, periodLabel, teamId, rank, rawScore, standingsPoints, coachResult, tds, yards, bestPlayer}
    activityLog: [], // {id, period, periodLabel, ts, type, text}
    playoffConfig: {
      bracketSize: 4,
      advancement: [4, 2, 1],
      started: false,
      completed: false,
      currentRoundIndex: 0,
      activeTeamIds: [],
      champion: null,
    },
  };
}

/* ---- roster/team helpers ---- */

function allRosteredPlayerIds(state) {
  const set = new Set();
  state.teams.forEach((t) => {
    const r = t.roster;
    if (!r) return;
    POSITIONS.concat(["FLEX"]).forEach((slot) => {
      if (r.starters[slot]) set.add(r.starters[slot]);
    });
    r.bench.forEach((id) => id && set.add(id));
  });
  return set;
}

function getPlayer(state, id) {
  if (!id) return null;
  return state.playerPool.find((p) => p.id === id) || null;
}

function teamRosterPlayerIds(team) {
  if (!team.roster) return [];
  const ids = [];
  POSITIONS.concat(["FLEX"]).forEach((slot) => {
    if (team.roster.starters[slot]) ids.push(team.roster.starters[slot]);
  });
  team.roster.bench.forEach((id) => id && ids.push(id));
  return ids;
}

function findTeamHoldingPlayer(state, playerId) {
  return state.teams.find((t) => teamRosterPlayerIds(t).includes(playerId)) || null;
}

function slotForPlayer(team, playerId) {
  const r = team.roster;
  for (const slot of POSITIONS.concat(["FLEX"])) {
    if (r.starters[slot] === playerId) return { area: "starters", slot };
  }
  const benchIdx = r.bench.indexOf(playerId);
  if (benchIdx >= 0) return { area: "bench", index: benchIdx };
  return null;
}

/* ---------------------------- Roster dealing ----------------------------- */

function dealRosters(state, teamIds) {
  const pool = state.playerPool;
  const activeByPos = {
    Coach: pool.filter((p) => p.position === "Coach" && p.status === "Active"),
    QB: pool.filter((p) => p.position === "QB" && p.status === "Active"),
    WR: pool.filter((p) => p.position === "WR" && p.status === "Active"),
    RB: pool.filter((p) => p.position === "RB" && p.status === "Active"),
    TE: pool.filter((p) => p.position === "TE" && p.status === "Active"),
  };
  const available = {
    Coach: shuffle(activeByPos.Coach.map((p) => p.id)),
    QB: shuffle(activeByPos.QB.map((p) => p.id)),
    WR: shuffle(activeByPos.WR.map((p) => p.id)),
    RB: shuffle(activeByPos.RB.map((p) => p.id)),
    TE: shuffle(activeByPos.TE.map((p) => p.id)),
  };
  const need = {
    Coach: teamIds.length * 2,
    QB: teamIds.length * 2,
    TE: teamIds.length * 2,
  };
  // WR/RB need depends on random FLEX assignment (min 2 each guaranteed, up to 4 if both flexes go one way)
  const minWR = teamIds.length * 2;
  const minRB = teamIds.length * 2;
  if (available.Coach.length < need.Coach) {
    return { error: "Not enough Active Coaches (" + available.Coach.length + ") to deal " + teamIds.length + " team(s). Add more Coaches to the player pool or mark fewer as OUT/IR/BYE." };
  }
  if (available.QB.length < need.QB) {
    return { error: "Not enough Active QBs (" + available.QB.length + ") to deal " + teamIds.length + " team(s). Add more QBs to the player pool." };
  }
  if (available.TE.length < need.TE) {
    return { error: "Not enough Active TEs (" + available.TE.length + ") to deal " + teamIds.length + " team(s). Add more TEs to the player pool." };
  }
  if (available.WR.length < minWR) {
    return { error: "Not enough Active WRs (" + available.WR.length + ") to deal " + teamIds.length + " team(s)." };
  }
  if (available.RB.length < minRB) {
    return { error: "Not enough Active RBs (" + available.RB.length + ") to deal " + teamIds.length + " team(s)." };
  }

  const take = (pos) => {
    if (available[pos].length === 0) return null;
    return available[pos].pop();
  };

  const rosters = {};
  const order = shuffle(teamIds.slice());
  for (const teamId of order) {
    const starterCoach = take("Coach");
    const benchCoach = take("Coach");
    const starterQB = take("QB");
    const benchQB = take("QB");
    const starterWR = take("WR");
    const benchWR = take("WR");
    const starterRB = take("RB");
    const benchRB = take("RB");
    const starterTE = take("TE");
    const benchTE = take("TE");
    const starterFlexPos = Math.random() < 0.5 ? "WR" : "RB";
    const benchFlexPos = Math.random() < 0.5 ? "WR" : "RB";
    const starterFlex = take(starterFlexPos);
    const benchFlex = take(benchFlexPos);

    if (!starterCoach || !benchCoach || !starterQB || !benchQB || !starterWR || !benchWR ||
        !starterRB || !benchRB || !starterTE || !benchTE || !starterFlex || !benchFlex) {
      return { error: "Ran out of Active players while dealing rosters (pool exhausted partway through). Add more players at the affected position(s) or reduce the number of teams." };
    }

    rosters[teamId] = {
      starters: { Coach: starterCoach, QB: starterQB, WR: starterWR, RB: starterRB, TE: starterTE, FLEX: starterFlex },
      bench: [benchCoach, benchQB, benchWR, benchRB, benchTE, benchFlex],
    };
  }
  return { rosters };
}

/* ---------------------------- Scheme processing --------------------------- */

function processSchemes(state) {
  const next = deepClone(state);
  const activity = [];
  const teams = next.teams;
  const schemes = next.schemes || {};
  const label = periodLabel(next.currentPeriod);

  const protectedIds = new Set();
  // Pass 1: blocks apply first & immediately
  Object.entries(schemes).forEach(([teamId, sc]) => {
    if (sc && sc.type === "block" && sc.playerId) {
      protectedIds.add(sc.playerId);
      const team = teams.find((t) => t.id === teamId);
      const p = getPlayer(next, sc.playerId);
      activity.push({
        id: uid("act"), period: next.currentPeriod, periodLabel: label, ts: nowStamp(),
        type: "block",
        text: (team ? team.name : "A team") + " blocked " + (p ? p.name + " (" + p.position + ")" : "a player") + " from being stolen this " + (next.currentPeriod.type === "playoff" ? "round" : "week") + ".",
      });
    }
  });

  // Pass 2: steals + redraws, single shuffled pass so freed players can flow between actions
  const actionEntries = Object.entries(schemes).filter(([, sc]) => sc && (sc.type === "steal" || sc.type === "redraw"));
  const shuffled = shuffle(actionEntries);

  const freeAgentIdOfPosition = (pos) => {
    const rostered = allRosteredPlayerIds(next);
    const candidates = next.playerPool.filter((p) => p.position === pos && p.status === "Active" && !rostered.has(p.id));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  };

  shuffled.forEach(([teamId, sc]) => {
    const team = teams.find((t) => t.id === teamId);
    if (!team || !team.roster) return;
    const droppedPlayer = getPlayer(next, sc.playerId);
    const loc = slotForPlayer(team, sc.playerId);
    if (!droppedPlayer || !loc) return; // player no longer where expected; skip gracefully

    if (sc.type === "steal") {
      const rostered = allRosteredPlayerIds(next);
      const victims = [];
      teams.forEach((t) => {
        if (t.id === teamId || !t.roster) return;
        POSITIONS.concat(["FLEX"]).forEach((slot) => {
          const pid = t.roster.starters[slot];
          if (pid) {
            const pl = getPlayer(next, pid);
            if (pl && pl.position === sc.position && !protectedIds.has(pid)) {
              victims.push({ team: t, slot, playerId: pid });
            }
          }
        });
      });
      if (victims.length === 0) {
        activity.push({
          id: uid("act"), period: next.currentPeriod, periodLabel: label, ts: nowStamp(),
          type: "steal-failed",
          text: team.name + " tried to steal a " + sc.position + " but no eligible (unprotected) target was found - action skipped, roster unchanged.",
        });
        return;
      }
      const target = victims[Math.floor(Math.random() * victims.length)];
      const stolenPlayer = getPlayer(next, target.playerId);
      // remove dropped player from acting team, place stolen player in same slot
      if (loc.area === "starters") team.roster.starters[loc.slot] = target.playerId;
      else team.roster.bench[loc.index] = target.playerId;
      // victim loses stolen player, gets FA replacement of same position in same slot
      const replacementId = freeAgentIdOfPosition(sc.position);
      target.team.roster.starters[target.slot] = replacementId; // may be null if pool empty
      const replacementPlayer = getPlayer(next, replacementId);
      activity.push({
        id: uid("act"), period: next.currentPeriod, periodLabel: label, ts: nowStamp(),
        type: "steal",
        text: team.name + " stole " + sc.position + " " + stolenPlayer.name + " from " + target.team.name +
          " (dropped " + droppedPlayer.name + "). " + target.team.name + " received " +
          (replacementPlayer ? replacementPlayer.name + " (free agent)" : "no replacement - free-agent pool empty at " + sc.position) + " in return.",
      });
      if (!replacementId) {
        activity.push({
          id: uid("act"), period: next.currentPeriod, periodLabel: label, ts: nowStamp(),
          type: "warning",
          text: "No Active free agents at " + sc.position + " were available to replace " + target.team.name + "'s stolen player - that slot is now empty.",
        });
      }
    } else if (sc.type === "redraw") {
      const replacementId = freeAgentIdOfPosition(sc.position);
      if (loc.area === "starters") team.roster.starters[loc.slot] = replacementId;
      else team.roster.bench[loc.index] = replacementId;
      const replacementPlayer = getPlayer(next, replacementId);
      activity.push({
        id: uid("act"), period: next.currentPeriod, periodLabel: label, ts: nowStamp(),
        type: "redraw",
        text: team.name + " redrew " + droppedPlayer.name + " (" + sc.position + ") for " +
          (replacementPlayer ? replacementPlayer.name + " (free agent)" : "no replacement - free-agent pool empty at " + sc.position) + ".",
      });
    }
  });

  next.activityLog = (next.activityLog || []).concat(activity);
  next.schemes = {}; // clear after processing
  return next;
}

/* ------------------------------ Scoring math ------------------------------ */

function computeStarterPoints(state, statLine, position) {
  if (!statLine) return 0;
  const cfg = state.scoringConfig;
  if (position === "Coach") {
    if (statLine.result === "Win") return cfg.coachWin;
    if (statLine.result === "Tie") return cfg.coachTie;
    if (statLine.result === "Loss") return cfg.coachLoss;
    return 0;
  }
  const yards = Number(statLine.yards) || 0;
  const tds = Number(statLine.tds) || 0;
  const n = cfg.yardsPerPoint > 0 ? cfg.yardsPerPoint : 10;
  return Math.floor(yards / n) + tds * cfg.pointsPerTD;
}

function currentStandingsPointsArray(state, teamCount) {
  if (state.standingsPointsOverride && state.standingsPointsOverride.length >= teamCount) {
    return state.standingsPointsOverride;
  }
  return standingsPointsArray(teamCount);
}

// Generic ranking with tiebreakers. teamStatRows: [{teamId, rawScore, tb:[standingsPts,weekWins,coachWins,tds,yards,bestPlayerPts]}]
function rankTeamsWithTiebreak(rows) {
  const sorted = rows.slice().sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
    for (let i = 0; i < 5; i++) {
      const av = a.tb[i] || 0, bv = b.tb[i] || 0;
      if (bv !== av) return bv - av;
    }
    return 0;
  });
  // standard competition ranking (1224): ties (identical rawScore AND identical tb) share rank
  const ranked = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const same = prev.rawScore === cur.rawScore && prev.tb.every((v, idx) => v === cur.tb[idx]);
      if (!same) rank = i + 1;
    }
    ranked.push(Object.assign({}, sorted[i], { rank }));
  }
  return ranked;
}

function finalizeCurrentPeriod(state) {
  const next = deepClone(state);
  const period = next.currentPeriod;
  const isPlayoff = period.type === "playoff";
  const activeIds = isPlayoff ? next.playoffConfig.activeTeamIds : next.teams.map((t) => t.id);
  const teams = next.teams.filter((t) => activeIds.includes(t.id));
  if (teams.length === 0) {
    return { error: "No teams to finalize for this period." };
  }

  const rows = teams.map((team) => {
    const stats = (next.statsEntry && next.statsEntry[team.id]) || {};
    const cum = isPlayoff ? team.playoffCumulative || emptyCumulative() : team.cumulative || emptyCumulative();
    let rawScore = 0, tds = 0, yards = 0, coachResult = null, bestThisPeriod = null;
    ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
      const playerId = team.roster ? team.roster.starters[slot] : null;
      const player = getPlayer(next, playerId);
      const line = stats[slot];
      const pts = computeStarterPoints(next, line, player ? player.position : slot);
      rawScore += pts;
      if (player && player.position === "Coach") {
        coachResult = line ? line.result : null;
      } else if (line) {
        tds += Number(line.tds) || 0;
        yards += Number(line.yards) || 0;
      }
      if (player && (!bestThisPeriod || pts > bestThisPeriod.points)) {
        bestThisPeriod = { name: player.name, position: player.position, points: pts };
      }
    });
    return {
      teamId: team.id, rawScore, tds, yards, coachResult, bestThisPeriod,
      tb: [cum.standingsPoints, cum.weekWins, cum.coachWins, cum.totalTDs, cum.totalYards, cum.bestPlayer ? cum.bestPlayer.points : 0],
    };
  });

  const ranked = rankTeamsWithTiebreak(rows);
  const spArr = currentStandingsPointsArray(next, teams.length);
  const topRank = 1;
  const resultsThisPeriod = [];

  ranked.forEach((r) => {
    const team = next.teams.find((t) => t.id === r.teamId);
    const standingsPoints = spArr[r.rank - 1] != null ? spArr[r.rank - 1] : 1;
    const isWeekWin = r.rank === topRank;
    const cumKey = isPlayoff ? "playoffCumulative" : "cumulative";
    if (!team[cumKey]) team[cumKey] = emptyCumulative();
    const cum = team[cumKey];
    cum.standingsPoints += standingsPoints;
    if (isWeekWin) cum.weekWins += 1;
    if (r.coachResult === "Win") cum.coachWins += 1;
    cum.totalTDs += r.tds;
    cum.totalYards += r.yards;
    if (r.bestThisPeriod && (!cum.bestPlayer || r.bestThisPeriod.points > cum.bestPlayer.points)) {
      cum.bestPlayer = {
        name: r.bestThisPeriod.name, position: r.bestThisPeriod.position, points: r.bestThisPeriod.points,
        periodLabel: periodLabel(period),
      };
    }
    const resultEntry = {
      id: uid("res"), period: Object.assign({}, period), periodLabel: periodLabel(period),
      teamId: team.id, teamName: team.name, rank: r.rank, rawScore: r.rawScore,
      standingsPoints, coachResult: r.coachResult, tds: r.tds, yards: r.yards,
      bestPlayer: r.bestThisPeriod,
    };
    resultsThisPeriod.push(resultEntry);
    next.weeklyResults.push(resultEntry);
  });

  const winner = resultsThisPeriod.find((r) => r.rank === 1);
  next.activityLog.push({
    id: uid("act"), period: Object.assign({}, period), periodLabel: periodLabel(period), ts: nowStamp(),
    type: "result",
    text: periodLabel(period) + " final - " + resultsThisPeriod
      .slice().sort((a, b) => a.rank - b.rank)
      .map((r) => "#" + r.rank + " " + r.teamName + " (" + r.rawScore + " pts)")
      .join(", ") + (winner ? ". Winner: " + winner.teamName + "!" : ""),
  });

  // Advance / reset for next period
  next.statsEntry = {};
  next.schemes = {};
  next.lockedPlayerIds = {};
  next.rosterLocked = false;
  next.teams.forEach((t) => { t.roster = null; }); // wipe rosters until the next deal so stale lineups can't be edited

  if (isPlayoff) {
    const cfg = next.playoffConfig;
    const nextRoundSize = cfg.advancement[cfg.currentRoundIndex + 1];
    if (nextRoundSize == null || nextRoundSize <= 1) {
      // Down to a single team -> that team is champion. They never play a round alone.
      const champ = ranked.find((r) => r.rank === 1);
      cfg.completed = true;
      cfg.champion = champ ? champ.teamId : null;
      const champTeam = champ ? next.teams.find((t) => t.id === champ.teamId) : null;
      next.activityLog.push({
        id: uid("act"), period: Object.assign({}, period), periodLabel: periodLabel(period), ts: nowStamp(),
        type: "champion",
        text: champTeam ? ICON.trophy + " " + champTeam.name + " wins the Pigskin Poker championship!" : "Playoffs complete.",
      });
    } else {
      // take top nextRoundSize teams by rank (ties broken already by rankTeamsWithTiebreak ordering)
      const orderedIds = ranked.slice().sort((a, b) => a.rank - b.rank).map((r) => r.teamId);
      const advancingIds = orderedIds.slice(0, nextRoundSize);
      cfg.activeTeamIds = advancingIds;
      cfg.currentRoundIndex += 1;
      next.currentPeriod = { type: "playoff", number: period.number + 1, phase: "pre-deal" };
      const advTeamNames = advancingIds.map((id) => (next.teams.find((t) => t.id === id) || {}).name).join(", ");
      next.activityLog.push({
        id: uid("act"), period: next.currentPeriod, periodLabel: periodLabel(next.currentPeriod), ts: nowStamp(),
        type: "advance",
        text: "Advancing to " + periodLabel(next.currentPeriod) + ": " + advTeamNames + ".",
      });
    }
  } else {
    next.currentPeriod = { type: "week", number: period.number + 1, phase: "pre-deal" };
  }

  return { state: next };
}

function seasonStandingsRows(state) {
  return state.teams.map((t) => {
    const cum = t.cumulative || emptyCumulative();
    return { teamId: t.id, teamName: t.name, rawScore: cum.standingsPoints, tb: [cum.standingsPoints, cum.weekWins, cum.coachWins, cum.totalTDs, cum.totalYards, cum.bestPlayer ? cum.bestPlayer.points : 0], cum };
  });
}

function startPlayoffs(state, bracketSize, advancement) {
  const next = deepClone(state);
  const ranked = rankTeamsWithTiebreak(seasonStandingsRows(next).map((r) => ({ teamId: r.teamId, rawScore: r.rawScore, tb: r.tb })));
  const orderedIds = ranked.slice().sort((a, b) => a.rank - b.rank).map((r) => r.teamId);
  const bracketTeams = orderedIds.slice(0, bracketSize);
  next.teams.forEach((t) => { t.playoffCumulative = emptyCumulative(); });
  next.playoffConfig = {
    bracketSize, advancement, started: true, completed: false,
    currentRoundIndex: 0, activeTeamIds: bracketTeams, champion: null,
  };
  next.currentPeriod = { type: "playoff", number: 1, phase: "pre-deal" };
  next.schemes = {}; next.statsEntry = {}; next.lockedPlayerIds = {}; next.rosterLocked = false;
  const names = bracketTeams.map((id) => (next.teams.find((t) => t.id === id) || {}).name).join(", ");
  next.activityLog.push({
    id: uid("act"), period: next.currentPeriod, periodLabel: periodLabel(next.currentPeriod), ts: nowStamp(),
    type: "playoffs-start",
    text: "Playoffs started! Regular-season standings are now frozen. Bracket (" + bracketTeams.length + "): " + names + ".",
  });
  return next;
}

/* ================================ UI atoms ================================ */

function SuitBadge({ position }) {
  return <span className={"pp-suit-badge pp-suit-" + position} title={position}>{SUIT_GLYPH[position] || "?"}</span>;
}

function Tag({ children }) {
  return <span className="pp-tag">{children}</span>;
}

function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  const isObj = typeof message === "object";
  const headline = isObj ? message.headline : message;
  const detail = isObj ? message.detail : null;
  return (
    <div className="pp-error-banner">
      <div>
        <div>{headline}</div>
        {detail ? <code>{detail}</code> : null}
      </div>
      {onDismiss ? <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onDismiss}>Dismiss</button> : null}
    </div>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, className, danger, big }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);
  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 8 }}>
        <button
          className={"pp-btn " + (danger ? "pp-btn-danger" : "pp-btn-gold") + (big ? "" : " pp-btn-sm")}
          onClick={() => { setConfirming(false); onConfirm(); }}
        >
          {confirmLabel || "Are you sure? Yes"}
        </button>
        <button className="pp-btn pp-btn-ghost pp-btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button className={className || ("pp-btn " + (danger ? "pp-btn-danger" : "") + (big ? "" : " pp-btn-sm"))} onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}

function TypedConfirm({ phrase, onConfirm, label }) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(false);
  if (!active) {
    return <button className="pp-btn pp-btn-danger" onClick={() => setActive(true)}>{label}</button>;
  }
  return (
    <div className="pp-card-tight" style={{ border: "1px solid #7a2e29", borderRadius: 8, background: "rgba(226,86,75,0.08)" }}>
      <p className="pp-sub" style={{ marginTop: 0 }}>
        Type <strong style={{ color: "#ffb4a8" }}>{phrase}</strong> below to confirm. This cannot be undone.
      </p>
      <input className="pp-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={phrase} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="pp-btn pp-btn-danger"
          disabled={value !== phrase}
          onClick={() => { onConfirm(); setActive(false); setValue(""); }}
        >
          Confirm & Wipe League
        </button>
        <button className="pp-btn pp-btn-ghost" onClick={() => { setActive(false); setValue(""); }}>Cancel</button>
      </div>
    </div>
  );
}

function SaveStatusBar({ status, lastSavedAt, onSaveNow, error }) {
  const color = status === "saving" ? "#d9b64c" : status === "error" ? "#e2564b" : "#5cb37f";
  const text = status === "saving" ? "Saving..." : status === "error" ? "Save failed" : (lastSavedAt ? "Saved at " + formatClock(lastSavedAt) : "Saved");
  return (
    <div className="pp-savebar">
      <span><span className="pp-savedot" style={{ background: color }} />{text}</span>
      <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onSaveNow}>Save Now</button>
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options, placeholder, disabled }) {
  return (
    <div className="pp-field">
      {label ? <label className="pp-label">{label}</label> : null}
      <select className="pp-select" value={value == null ? "" : value} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="pp-empty">{children}</div>;
}

function phaseText(state) {
  const phase = state.currentPeriod.phase;
  if (phase === "pre-deal") return "Not dealt yet";
  if (phase === "dealt") return state.rosterLocked ? "Rosters locked" : "Schemes open";
  if (phase === "schemes-processed") return "Stats in progress";
  return phase;
}

function PeriodBanner({ state, extra }) {
  return (
    <div className="pp-period-banner">
      <span className="pp-period-banner-label">{periodLabel(state.currentPeriod)}</span>
      <span className="pp-period-banner-phase">{phaseText(state)}</span>
      {extra ? <span className="pp-period-banner-extra">{extra}</span> : null}
    </div>
  );
}

function statLineText(state, player, line) {
  if (!player) return "";
  if (player.position === "Coach") {
    return line && line.result ? line.result : "no result entered";
  }
  const yards = line && line.yards != null ? line.yards : 0;
  const tds = line && line.tds != null ? line.tds : 0;
  return yards + " yds, " + tds + " TD";
}

function RosterSlotRow({ slot, player, state, statLine, locked, showStats }) {
  const pts = showStats ? computeStarterPoints(state, statLine, player ? player.position : slot) : null;
  return (
    <div className="pp-roster-slot">
      <span className="pp-roster-slot-label">{slot}</span>
      {player ? <SuitBadge position={player.position} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pp-roster-slot-name">{player ? player.name : "empty slot"}</div>
        <div className="pp-roster-slot-meta">
          {player ? player.position + " - " + player.team : ""}
          {player && player.status !== "Active" ? " | " + player.status : ""}
          {showStats && player ? " | " + statLineText(state, player, statLine) : ""}
        </div>
      </div>
      {locked ? <span className="pp-locked-pill">LOCKED</span> : null}
      {showStats ? <span className="pp-roster-slot-pts">{pts} pt{pts === 1 ? "" : "s"}</span> : null}
    </div>
  );
}

function TeamRosterBlock({ team, state, showStats, showBench }) {
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  const locks = state.lockedPlayerIds || {};
  if (!team.roster) return <EmptyState>No roster dealt yet this period.</EmptyState>;
  return (
    <div>
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        return (
          <RosterSlotRow
            key={slot} slot={slot} player={player} state={state}
            statLine={stats[slot]} locked={pid && locks[pid]} showStats={showStats}
          />
        );
      })}
      {showBench ? (
        <>
          <div className="pp-eyebrow" style={{ margin: "10px 0 6px" }}>Bench</div>
          {team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            return (
              <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={pid && locks[pid]} showStats={false} />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/* ================================ Login ================================ */

function LoginScreen({ state, onCommissionerLogin, onManagerLogin, loginError, setLoginError }) {
  const [mode, setMode] = useState(null); // 'commish' | 'manager'
  const [code, setCode] = useState("");
  const [teamId, setTeamId] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const hasCode = !!state.commissionerCode;

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

function StandingsTable({ rows, teams }) {
  if (rows.length === 0) return <EmptyState>No standings yet - finalize a week to populate this table.</EmptyState>;
  const ordered = rows.slice().sort((a, b) => a.rank - b.rank);
  return (
    <div className="pp-table-scroll">
      <table className="pp-table pp-table-wide">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Team</th>
            <th style={{ textAlign: "right" }}>Std Pts</th>
            <th style={{ textAlign: "right" }}>Week Wins</th>
            <th style={{ textAlign: "right" }}>Coach Wins</th>
            <th style={{ textAlign: "right" }}>TDs</th>
            <th style={{ textAlign: "right" }}>Yards</th>
            <th>Best Player</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const best = r.cum.bestPlayer;
            return (
              <tr key={r.teamId} className={r.rank === 1 ? "pp-standings-first" : ""}>
                <td>{r.rank === 1 ? <span className="pp-crown">{ICON.crown}</span> : null}{r.rank}</td>
                <td style={{ fontWeight: 700 }}>{r.teamName}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold-bright)" }}>{r.cum.standingsPoints}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.weekWins}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.coachWins}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.totalTDs}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.cum.totalYards}</td>
                <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{best ? best.name + " - " + best.points + " pts (" + best.periodLabel + ")" : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayoffsPanel({ state }) {
  const cfg = state.playoffConfig;
  if (!cfg.started) {
    return <EmptyState>Playoffs are TBD. The commissioner hasn't started them yet.</EmptyState>;
  }
  const roundResults = {};
  state.weeklyResults.forEach((r) => {
    if (r.period.type !== "playoff") return;
    const key = r.period.number;
    roundResults[key] = roundResults[key] || [];
    roundResults[key].push(r);
  });
  const rounds = Object.keys(roundResults).map(Number).sort((a, b) => a - b);
  return (
    <div>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Bracket size {cfg.bracketSize} | Advancement: {cfg.advancement.join(" -> ")}
        {cfg.completed && cfg.champion ? <> {"|"} <strong style={{ color: "var(--gold-bright)" }}>Champion: {(state.teams.find(t => t.id === cfg.champion) || {}).name}</strong></> : null}
      </p>
      {rounds.length === 0 ? (
        <EmptyState>Round 1 is set but no rounds have been finalized yet.</EmptyState>
      ) : (
        rounds.map((rn) => (
          <div key={rn} className="pp-card pp-card-tight">
            <h3 className="pp-h3">Playoff Round {rn}</h3>
            <table className="pp-table">
              <thead><tr><th style={{ width: 34 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
              <tbody>
                {roundResults[rn].slice().sort((a, b) => a.rank - b.rank).map((r) => (
                  <tr key={r.id}><td>{r.rank}</td><td>{r.teamName}</td><td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.rawScore}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {!cfg.completed ? (
        <p className="pp-sub">Currently active in the bracket: {cfg.activeTeamIds.map((id) => (state.teams.find(t => t.id === id) || {}).name).join(", ")}</p>
      ) : null}
    </div>
  );
}

function ActivityPanel({ state }) {
  const log = (state.activityLog || []).slice().reverse();
  if (log.length === 0) return <EmptyState>No activity yet. Steals, redraws, blocks, and week results will show up here.</EmptyState>;
  const grouped = [];
  let lastLabel = null;
  log.forEach((entry) => {
    if (entry.periodLabel !== lastLabel) {
      grouped.push({ header: entry.periodLabel });
      lastLabel = entry.periodLabel;
    }
    grouped.push(entry);
  });
  const iconFor = (type) => ({
    steal: ICON.football, "steal-failed": ICON.warn, redraw: ICON.redraw, block: ICON.shield,
    result: ICON.flag, warning: ICON.warn, "playoffs-start": ICON.trophy, advance: ICON.forward, champion: ICON.trophy,
  }[type] || "*");
  return (
    <div>
      {grouped.map((item, i) =>
        item.header ? (
          <div key={"h" + i} className="pp-eyebrow" style={{ margin: "14px 0 6px" }}>{item.header}</div>
        ) : (
          <div key={item.id} className="pp-card pp-card-tight" style={{ marginBottom: 8, display: "flex", gap: 10 }}>
            <span>{iconFor(item.type)}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{item.text}</span>
          </div>
        )
      )}
    </div>
  );
}

function LeagueHomeTab({ state }) {
  const [sub, setSub] = useState("regular");
  const standings = seasonStandingsRows(state);
  const ranked = rankTeamsWithTiebreak(standings.map((r) => ({ teamId: r.teamId, rawScore: r.rawScore, tb: r.tb })))
    .map((r) => Object.assign({}, r, { teamName: (state.teams.find(t => t.id === r.teamId) || {}).name, cum: (state.teams.find(t => t.id === r.teamId) || {}).cumulative || emptyCumulative() }));

  return (
    <div>
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "regular" ? " active" : "")} onClick={() => setSub("regular")}>Regular Season</button>
        <button className={"pp-subnav-btn" + (sub === "playoffs" ? " active" : "")} onClick={() => setSub("playoffs")}>Playoffs</button>
        <button className={"pp-subnav-btn" + (sub === "activity" ? " active" : "")} onClick={() => setSub("activity")}>Activity</button>
      </div>
      <div className="pp-card">
        <div className="pp-eyebrow" style={{ marginBottom: 8 }}>{periodLabel(state.currentPeriod)} - {state.currentPeriod.phase.replace("-", " ")}</div>
        {sub === "regular" && (state.playoffConfig.started
          ? <><p className="pp-sub" style={{ marginBottom: 10 }}>Regular-season standings are frozen - playoffs are underway.</p><StandingsTable rows={ranked} teams={state.teams} /></>
          : <StandingsTable rows={ranked} teams={state.teams} />)}
        {sub === "playoffs" && <PlayoffsPanel state={state} />}
        {sub === "activity" && <ActivityPanel state={state} />}
      </div>
    </div>
  );
}

/* ================================ My Team ================================ */

function eligibleBenchForSlot(state, team, slot) {
  return team.roster.bench
    .map((pid, idx) => ({ pid, idx, player: getPlayer(state, pid) }))
    .filter((b) => b.player && (slot === "FLEX" ? (b.player.position === "WR" || b.player.position === "RB") : b.player.position === slot));
}

function SchemeForm({ state, team, onSubmit, disabled, disabledReason }) {
  const existing = state.schemes[team.id];
  const [type, setType] = useState(existing ? existing.type : "noaction");
  const [position, setPosition] = useState(existing ? existing.position : "");
  const [playerId, setPlayerId] = useState(existing ? existing.playerId : "");

  useEffect(() => {
    setType(existing ? existing.type : "noaction");
    setPosition(existing ? existing.position : "");
    setPlayerId(existing ? existing.playerId : "");
    // eslint-disable-next-line
  }, [existing && existing.type, existing && existing.playerId, team.id, state.currentPeriod.number, state.currentPeriod.type]);

  if (!team.roster) return <EmptyState>No roster dealt yet this period - nothing to schedule.</EmptyState>;

  const rosterIds = teamRosterPlayerIds(team);
  const candidatePlayers = (type === "block" ? POSITIONS.concat(["FLEX"]).map((s) => team.roster.starters[s]).filter(Boolean) : rosterIds)
    .map((pid) => getPlayer(state, pid))
    .filter((p) => p && position && p.position === position);

  const canSubmit = type === "noaction" || (position && playerId);

  return (
    <div>
      {disabled ? <p className="pp-sub" style={{ color: "#ff9a90" }}>{disabledReason}</p> : null}
      <div className="pp-field">
        <label className="pp-label">Play Scheme</label>
        <select className="pp-select" value={type} disabled={disabled} onChange={(e) => { setType(e.target.value); setPosition(""); setPlayerId(""); }}>
          <option value="noaction">No Action</option>
          <option value="block">Block - protect a starter</option>
          <option value="steal">Steal - take from another team</option>
          <option value="redraw">Redraw - drop for a random replacement</option>
        </select>
      </div>
      {type !== "noaction" && (
        <>
          <div className="pp-field">
            <label className="pp-label">Position</label>
            <select className="pp-select" value={position} disabled={disabled} onChange={(e) => { setPosition(e.target.value); setPlayerId(""); }}>
              <option value="">Choose a position...</option>
              {SCHEME_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {position && (
            <div className="pp-field">
              <label className="pp-label">{type === "block" ? "Starter to protect" : "Player to drop"}</label>
              <select className="pp-select" value={playerId || ""} disabled={disabled} onChange={(e) => setPlayerId(e.target.value)}>
                <option value="">Choose a player...</option>
                {candidatePlayers.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
              </select>
              {candidatePlayers.length === 0 ? <p className="pp-sub">No eligible {position}s on your roster{type === "block" ? " starting lineup" : ""}.</p> : null}
            </div>
          )}
        </>
      )}
      <button
        className="pp-btn pp-btn-gold"
        disabled={disabled || !canSubmit}
        onClick={() => onSubmit({ type, position: type === "noaction" ? null : position, playerId: type === "noaction" ? null : playerId, submittedAt: nowStamp() })}
      >
        {existing ? "Update Scheme" : "Submit Scheme"}
      </button>
    </div>
  );
}

function SchemeSummary({ state, team }) {
  const sc = state.schemes[team.id];
  if (!sc) return null;
  const player = getPlayer(state, sc.playerId);
  const label = periodLabel(state.currentPeriod);
  let text;
  if (sc.type === "block") text = "Your submitted scheme for " + label + ": Block - protecting " + (player ? player.name : "?") + ".";
  else if (sc.type === "steal") text = "Your submitted scheme for " + label + ": Steal " + sc.position + " - dropping " + (player ? player.name : "?") + ".";
  else if (sc.type === "redraw") text = "Your submitted scheme for " + label + ": Redraw " + sc.position + " - dropping " + (player ? player.name : "?") + ".";
  else text = "Your submitted scheme for " + label + ": No Action.";
  return <div className="pp-scheme-summary">{text}</div>;
}

function LineupEditor({ state, team, onSwap }) {
  const locks = state.lockedPlayerIds || {};
  if (!team.roster) {
    return (
      <div>
        {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => (
          <div key={slot} style={{ marginBottom: 8 }}>
            <RosterSlotRow slot={slot} player={null} state={state} statLine={null} locked={false} showStats={false} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => {
        const pid = team.roster.starters[slot];
        const player = getPlayer(state, pid);
        const starterLocked = pid && locks[pid];
        const options = eligibleBenchForSlot(state, team, slot);
        return (
          <div key={slot} style={{ marginBottom: 8 }}>
            <RosterSlotRow slot={slot} player={player} state={state} statLine={null} locked={starterLocked} showStats={false} />
            {options.length > 0 ? (
              <SwapRow
                disabled={starterLocked}
                options={options}
                onSwap={(benchIdx) => {
                  const benchPlayer = getPlayer(state, team.roster.bench[benchIdx]);
                  if (benchPlayer && locks[benchPlayer.id]) return;
                  onSwap(slot, benchIdx);
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SwapRow({ options, onSwap, disabled }) {
  return (
    <div style={{ display: "flex", gap: 6, marginLeft: 8, marginTop: 4 }}>
      <select
        className="pp-select"
        style={{ flex: 1 }}
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === "") return;
          onSwap(Number(e.target.value));
        }}
      >
        <option value="">Swap in from bench...</option>
        {options.map((o) => <option key={o.idx} value={o.idx}>{playerLabel(o.player)}</option>)}
      </select>
    </div>
  );
}

function MyTeamTab({ state, team, onSwap, onSubmitScheme, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const schemeDisabled = !team.roster || state.rosterLocked;
  const disabledReason = !team.roster
    ? "No roster dealt yet."
    : state.rosterLocked
    ? "Rosters are locked for this " + (state.currentPeriod.type === "playoff" ? "round" : "week") + " - scheme submission is closed."
    : null;

  return (
    <div>
      <PeriodBanner state={state} extra={state.rosterLocked ? "Rosters locked for the weekend" : null} />
      <div className="pp-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          {renaming ? (
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="pp-btn pp-btn-sm pp-btn-gold" onClick={() => { onRename(name); setRenaming(false); }}>Save</button>
              <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => { setRenaming(false); setName(team.name); }}>Cancel</button>
            </div>
          ) : (
            <>
              <h2 className="pp-h2" style={{ marginBottom: 0 }}>{team.name}</h2>
              <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={() => setRenaming(true)}>Rename</button>
            </>
          )}
        </div>
        <SchemeSummary state={state} team={team} />
        <h3 className="pp-h3">Starting Lineup</h3>
        <p className="pp-sub" style={{ marginBottom: 10 }}>Swap a starter with an eligible bench player. Direct starter-for-starter swaps aren't allowed - route every change through the bench.</p>
        <LineupEditor state={state} team={team} onSwap={onSwap} />
        <h3 className="pp-h3" style={{ marginTop: 16 }}>Bench</h3>
        <p className="pp-sub" style={{ marginBottom: 10 }}>Not tied to any slot - swap any of these into a matching starting spot above.</p>
        {team.roster ? (
          team.roster.bench.map((pid, i) => {
            const player = getPlayer(state, pid);
            const locked = pid && (state.lockedPlayerIds || {})[pid];
            return <RosterSlotRow key={i} slot="BN" player={player} state={state} statLine={null} locked={locked} showStats={false} />;
          })
        ) : (
          [0, 1, 2, 3, 4, 5].map((i) => <RosterSlotRow key={i} slot="BN" player={null} state={state} statLine={null} locked={false} showStats={false} />)
        )}
      </div>

      <div className="pp-card">
        <h3 className="pp-h3">Play Scheme</h3>
        <SchemeForm state={state} team={team} onSubmit={(sc) => onSubmitScheme(team.id, sc)} disabled={schemeDisabled} disabledReason={disabledReason} />
      </div>
    </div>
  );
}

/* ============================== All Rosters =============================== */

function AllRostersTab({ state }) {
  if (state.teams.length === 0) return <EmptyState>No teams yet.</EmptyState>;
  return (
    <div>
      {state.teams.map((team) => (
        <div key={team.id} className="pp-card">
          <h3 className="pp-h3">{team.name}</h3>
          <TeamRosterBlock team={team} state={state} showStats={state.currentPeriod.phase !== "pre-deal"} showBench={true} />
        </div>
      ))}
    </div>
  );
}

/* ============================== Free Agents ================================ */

function FreeAgentsTab({ state }) {
  const [tab, setTab] = useState("QB");
  const rostered = allRosteredPlayerIds(state);
  let list;
  if (tab === "BYE" || tab === "IR" || tab === "OUT") {
    list = state.playerPool.filter((p) => p.status === tab);
  } else {
    list = state.playerPool.filter((p) => p.position === tab && p.status === "Active" && !rostered.has(p.id));
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
          <EmptyState>No {tab === "BYE" || tab === "IR" || tab === "OUT" ? "players marked " + tab : tab + " free agents"} right now.</EmptyState>
        ) : (
          list.map((p) => (
            <div key={p.id} className="pp-roster-slot">
              <SuitBadge position={p.position} />
              <div style={{ flex: 1 }}>
                <div className="pp-roster-slot-name">{p.name}</div>
                <div className="pp-roster-slot-meta">{p.position} - {p.team}</div>
              </div>
              {p.status !== "Active" ? <Tag>{p.status}</Tag> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* =============================== Live Stats ================================= */

function StatEntryRow({ state, team, slot, isCommissioner, onChange }) {
  const pid = team.roster.starters[slot];
  const player = getPlayer(state, pid);
  const stats = (state.statsEntry[team.id] || {})[slot] || {};
  const locks = state.lockedPlayerIds || {};
  const locked = pid && locks[pid];
  if (!player) return <RosterSlotRow slot={slot} player={null} state={state} showStats={false} />;

  if (!isCommissioner) {
    return <RosterSlotRow slot={slot} player={player} state={state} statLine={stats} locked={locked} showStats={true} />;
  }

  return (
    <div className="pp-roster-slot" style={{ flexWrap: "wrap" }}>
      <span className="pp-roster-slot-label">{slot}</span>
      <SuitBadge position={player.position} />
      <div style={{ flex: 1, minWidth: 120 }}>
        <div className="pp-roster-slot-name">{player.name}</div>
        <div className="pp-roster-slot-meta">{player.position} - {player.team}</div>
      </div>
      {player.position === "Coach" ? (
        <select className="pp-select" style={{ width: 120 }} value={stats.result || ""} onChange={(e) => onChange(team.id, slot, { result: e.target.value || null })}>
          <option value="">Result...</option>
          <option value="Win">Win</option>
          <option value="Tie">Tie</option>
          <option value="Loss">Loss</option>
        </select>
      ) : (
        <>
          <input className="pp-input" style={{ width: 78 }} type="number" placeholder="Yards" value={stats.yards != null ? stats.yards : ""} onChange={(e) => onChange(team.id, slot, Object.assign({}, stats, { yards: e.target.value }))} />
          <input className="pp-input" style={{ width: 62 }} type="number" placeholder="TDs" value={stats.tds != null ? stats.tds : ""} onChange={(e) => onChange(team.id, slot, Object.assign({}, stats, { tds: e.target.value }))} />
        </>
      )}
      <span className="pp-roster-slot-pts">{computeStarterPoints(state, stats, player.position)} pts</span>
      <button className={"pp-btn pp-btn-sm " + (locked ? "pp-btn-danger" : "pp-btn-ghost")} onClick={() => onChange(team.id, "__togglelock__", pid)}>
        {locked ? "Unlock" : "Lock"}
      </button>
    </div>
  );
}

function teamRunningScore(state, team) {
  if (!team.roster) return 0;
  const stats = (state.statsEntry && state.statsEntry[team.id]) || {};
  let total = 0;
  ["Coach", "QB", "WR", "RB", "TE", "FLEX"].forEach((slot) => {
    const pid = team.roster.starters[slot];
    const player = getPlayer(state, pid);
    total += computeStarterPoints(state, stats[slot], player ? player.position : slot);
  });
  return total;
}

function LiveScoresBar({ state, teams }) {
  const rows = teams.filter((t) => t.roster).map((t) => ({ team: t, score: teamRunningScore(state, t) }))
    .sort((a, b) => b.score - a.score);
  if (rows.length === 0) return null;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">This {state.currentPeriod.type === "playoff" ? "Round's" : "Week's"} Scores</h3>
      <table className="pp-table">
        <thead><tr><th style={{ width: 30 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team.id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 700 }}>{r.team.name}</td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--gold-bright)" }}>{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-sub" style={{ marginTop: 8, marginBottom: 0 }}>Updates live as stats are entered - only counts starters that already have a stat line.</p>
    </div>
  );
}

function LiveStatsTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError }) {
  const teamsForPeriod = state.currentPeriod.type === "playoff"
    ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id))
    : state.teams;

  if (teamsForPeriod.length === 0) return <EmptyState>No teams to show stats for.</EmptyState>;
  if (teamsForPeriod.every((t) => !t.roster)) return <EmptyState>No roster dealt yet this period.</EmptyState>;

  return (
    <div>
      {isCommissioner && (
        <div className="pp-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 className="pp-h3" style={{ marginBottom: 2 }}>Commissioner Controls</h3>
              <p className="pp-sub">Enter stats for each starter, then finalize the {state.currentPeriod.type === "playoff" ? "round" : "week"} once everyone's in.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={"pp-btn " + (state.rosterLocked ? "pp-btn-danger" : "")} onClick={onToggleRosterLock}>
                {state.rosterLocked ? "Unlock Rosters" : "Lock Rosters for the Weekend"}
              </button>
              <ConfirmButton label={"Finalize " + (state.currentPeriod.type === "playoff" ? "Round" : "Week")} confirmLabel="Yes, finalize" onConfirm={onFinalize} />
            </div>
          </div>
          {finalizeError ? <ErrorBanner message={finalizeError} /> : null}
        </div>
      )}
      <LiveScoresBar state={state} teams={teamsForPeriod} />
      {teamsForPeriod.map((team) => (
        <div key={team.id} className="pp-card">
          <h3 className="pp-h3">{team.name}</h3>
          {!team.roster ? <EmptyState>No roster dealt.</EmptyState> : (
            ["Coach", "QB", "WR", "RB", "TE", "FLEX"].map((slot) => (
              <StatEntryRow key={slot} state={state} team={team} slot={slot} isCommissioner={isCommissioner} onChange={onStatChange} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

/* ========================= Combined Rosters / FA / Stats hub ========================= */

function RosterHubTab({ state, isCommissioner, onStatChange, onToggleRosterLock, onFinalize, finalizeError }) {
  const [sub, setSub] = useState("rosters");
  return (
    <div>
      <PeriodBanner state={state} />
      <div className="pp-subnav">
        <button className={"pp-subnav-btn" + (sub === "rosters" ? " active" : "")} onClick={() => setSub("rosters")}>All Rosters</button>
        <button className={"pp-subnav-btn" + (sub === "fa" ? " active" : "")} onClick={() => setSub("fa")}>Free Agents</button>
        <button className={"pp-subnav-btn" + (sub === "stats" ? " active" : "")} onClick={() => setSub("stats")}>Live Stats</button>
      </div>
      {sub === "rosters" && <AllRostersTab state={state} />}
      {sub === "fa" && <FreeAgentsTab state={state} />}
      {sub === "stats" && (
        <LiveStatsTab
          state={state} isCommissioner={isCommissioner}
          onStatChange={onStatChange} onToggleRosterLock={onToggleRosterLock}
          onFinalize={onFinalize} finalizeError={finalizeError}
        />
      )}
    </div>
  );
}

/* ============================= Weekly Results =============================== */

function WeeklyResultsTab({ state }) {
  const byPeriod = {};
  state.weeklyResults.forEach((r) => {
    const key = r.periodLabel;
    byPeriod[key] = byPeriod[key] || [];
    byPeriod[key].push(r);
  });
  const keys = Object.keys(byPeriod);
  // sort by underlying period number descending, weeks before playoffs is fine since labels differ
  const order = state.weeklyResults.reduce((acc, r) => { acc[r.periodLabel] = r; return acc; }, {});
  keys.sort((a, b) => {
    const pa = order[a].period, pb = order[b].period;
    if (pa.type !== pb.type) return pa.type === "playoff" ? -1 : 1; // playoffs happen after the regular season, so they're most recent
    return pb.number - pa.number;
  });
  if (keys.length === 0) return <EmptyState>No weeks finalized yet. History will appear here after the commissioner finalizes a week.</EmptyState>;
  return (
    <div>
      {keys.map((label) => (
        <div key={label} className="pp-card">
          <h3 className="pp-h3">{label}</h3>
          <table className="pp-table">
            <thead><tr><th style={{ width: 30 }}>#</th><th>Team</th><th style={{ textAlign: "right" }}>Score</th><th style={{ textAlign: "right" }}>Std Pts</th></tr></thead>
            <tbody>
              {byPeriod[label].slice().sort((a, b) => a.rank - b.rank).map((r) => (
                <tr key={r.id}>
                  <td>{r.rank}</td><td>{r.teamName}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.rawScore}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--gold-bright)" }}>{r.standingsPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ================================== Rules ==================================== */

function QuickRefTile({ label, value }) {
  return (
    <div className="pp-qr-tile">
      <div className="pp-qr-value">{value}</div>
      <div className="pp-qr-label">{label}</div>
    </div>
  );
}

function RuleCard({ title, children }) {
  return (
    <div className="pp-card pp-card-tight" style={{ marginBottom: 10 }}>
      <h3 className="pp-h3">{title}</h3>
      <ul className="pp-rule-list">{children}</ul>
    </div>
  );
}

function RulesTab({ state }) {
  const cfg = state.scoringConfig;
  const teamCount = state.teams.length || 0;
  const spArr = currentStandingsPointsArray(state, teamCount || 1);
  return (
    <div>
      <div className="pp-card">
        <h2 className="pp-h2" style={{ marginBottom: 10 }}>Quick Reference</h2>
        <div className="pp-qr-grid">
          <QuickRefTile label={"pt per " + cfg.yardsPerPoint + " yds"} value={"1 : " + cfg.yardsPerPoint} />
          <QuickRefTile label="pts per TD" value={cfg.pointsPerTD} />
          <QuickRefTile label="Coach W / T / L" value={cfg.coachWin + " / " + cfg.coachTie + " / " + cfg.coachLoss} />
          <QuickRefTile label="Max TEs per team" value="2" />
          <QuickRefTile label={"Std pts (1st " + ARROW + " last)"} value={spArr.join(", ")} />
          <QuickRefTile label="Roster size" value="6 starters + 6 bench" />
        </div>
      </div>

      <RuleCard title={SUIT_CH.spade + " The Weekly Deal"}>
        <li>Every week (or playoff round), each team gets a fresh, random 12-player roster - nothing carries over.</li>
        <li>6 starters: Coach, QB, WR, RB, TE, FLEX.</li>
        <li>6 bench: one more of each (Coach, QB, WR, RB, TE), plus one more FLEX-eligible player.</li>
        <li>FLEX can only be a WR or RB - never a TE.</li>
        <li>Because of that, every team is capped at 2 TEs total, same as QB and Coach.</li>
        <li>The bench isn't tied to a slot - it's just 6 players, each shown under their real position.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.heart + " Play Schemes"}>
        <li>Each week, every manager picks one action: <strong>Block</strong>, <strong>Steal</strong>, <strong>Redraw</strong>, or <strong>No Action</strong>.</li>
        <li><strong>Block</strong> - protect one of your own starters from being stolen this week.</li>
        <li><strong>Steal</strong> - drop a player of a chosen position, take a random unprotected player of that same position from another team's starters.</li>
        <li><strong>Redraw</strong> - drop a player of a chosen position, get a random free-agent replacement at that exact position.</li>
        <li>Coach can never be selected for a scheme.</li>
        <li>Replacements are always the exact same position as what was dropped - never flexible.</li>
        <li>Dropped players go straight back into the free-agent pool, even mid-processing.</li>
        <li>Steals resolve in random order - no submission-order advantage.</li>
        <li>Schemes are never shown to other managers - only the resulting roster.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.diamond + " Scoring"}>
        <li>1 point per {cfg.yardsPerPoint} yards.</li>
        <li>{cfg.pointsPerTD} points per TD.</li>
        <li>Coach: {cfg.coachWin} pts for a Win, {cfg.coachTie} for a Tie, {cfg.coachLoss} for a Loss.</li>
        <li>Only starters score - bench players never score, regardless of stats.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.club + " Standings & Tiebreakers"}>
        <li>Teams are ranked by that week's score and earn standings points by finish: {spArr.join(", ")} (1st {ARROW} last).</li>
        <li>Ties share the higher value.</li>
        <li>Season standings = sum of weekly standings points, not raw weekly scores.</li>
        <li>Tiebreaker order, in this order: {["Standings Points", "Week Wins", "Coach Wins", "Total TDs", "Total Yards", "Best single-player score in a week"].join(" " + ARROW + " ")}.</li>
        <li>Best single-player score tracks the player's name, points, and week - and updates whenever a later week beats it.</li>
      </RuleCard>

      <RuleCard title={SUIT_CH.star + " Playoffs"}>
        <li>Commissioner sets a bracket size (top N teams by season standings) and an advancement list per round.</li>
        <li>Once playoffs start, regular-season standings freeze.</li>
        <li>Playoff rounds use the same cycle: {["deal", "schemes", "stats", "finalize"].join(" " + ARROW + " ")}.</li>
        <li>Same tiebreaker order applies, but scoped to that round only.</li>
        <li>Playoff periods are called "Round N" - regular season stays "Week N."</li>
        {state.playoffConfig.started ? (
          <li>Current bracket: {state.playoffConfig.bracketSize} teams, advancement {state.playoffConfig.advancement.join(" " + ARROW + " ")}.</li>
        ) : null}
      </RuleCard>

      <RuleCard title="Coaches">
        <li>Coaches can never be stolen, redrawn, or blocked.</li>
        <li>They only move between your own starting lineup and bench.</li>
      </RuleCard>

      <RuleCard title="Lineup Lock & Injury Swaps">
        <li>After schemes are processed, the commissioner can lock rosters for the weekend, which closes further scheme submission.</li>
        <li>Even while locked, the commissioner can mark individual players as locked once their real-life game starts.</li>
        <li>Managers can still freely swap any non-locked player in or out of their lineup, right up until that player's game begins.</li>
        <li>Lineup swaps always route a starter through the bench - you can never directly swap two starters.</li>
      </RuleCard>
    </div>
  );
}

/* =============================== Commissioner ================================ */

function CommTeamsPanel({ state, onAddTeam, onRenameTeam, onSetJoinCode, onRemoveTeam }) {
  const [newName, setNewName] = useState("");
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Add a Team</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="pp-input" placeholder="Team name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="pp-btn pp-btn-gold" disabled={!newName.trim()} onClick={() => { onAddTeam(newName.trim()); setNewName(""); }}>Add</button>
        </div>
      </div>
      {state.teams.map((t) => <CommTeamRow key={t.id} team={t} onRenameTeam={onRenameTeam} onSetJoinCode={onSetJoinCode} onRemoveTeam={onRemoveTeam} />)}
      {state.teams.length === 0 ? <EmptyState>No teams yet - add your first team above.</EmptyState> : null}
    </div>
  );
}

function CommTeamRow({ team, onRenameTeam, onSetJoinCode, onRemoveTeam }) {
  const [name, setName] = useState(team.name);
  const [code, setCode] = useState(team.joinCode || "");
  return (
    <div className="pp-card pp-card-tight">
      <div className="pp-grid-2">
        <div className="pp-field" style={{ marginBottom: 6 }}>
          <label className="pp-label">Team Name</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="pp-btn pp-btn-sm" onClick={() => onRenameTeam(team.id, name)}>Save</button>
          </div>
        </div>
        <div className="pp-field" style={{ marginBottom: 6 }}>
          <label className="pp-label">Join Code</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="pp-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="any text works" />
            <button className="pp-btn pp-btn-sm" onClick={() => onSetJoinCode(team.id, code)}>Save</button>
          </div>
        </div>
      </div>
      <ConfirmButton label={"Remove " + team.name} confirmLabel="Yes, remove team" danger onConfirm={() => onRemoveTeam(team.id)} />
    </div>
  );
}

function CommWeeksPanel({ state, onDeal, onProcessSchemes, dealError }) {
  const teams = state.currentPeriod.type === "playoff" ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id)) : state.teams;
  const submitted = teams.filter((t) => state.schemes[t.id]);
  const pending = teams.filter((t) => !state.schemes[t.id]);
  const phase = state.currentPeriod.phase;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">{periodLabel(state.currentPeriod)} - {phase.replace("-", " ")}</h3>
      {dealError ? <ErrorBanner message={dealError} /> : null}
      {phase === "pre-deal" && (
        <>
          <p className="pp-sub">Deal a fresh roster to {teams.length} team{teams.length === 1 ? "" : "s"} for {periodLabel(state.currentPeriod)}.</p>
          <button className="pp-btn pp-btn-gold" disabled={teams.length === 0} onClick={onDeal}>Deal Rosters</button>
        </>
      )}
      {phase === "dealt" && (
        <>
          <p className="pp-sub">{submitted.length} of {teams.length} teams have submitted a scheme.</p>
          {pending.length > 0 && <p className="pp-sub">Still pending: {pending.map((t) => t.name).join(", ")}</p>}
          <button className="pp-btn pp-btn-gold" onClick={onProcessSchemes}>Process Schemes</button>
        </>
      )}
      {phase === "schemes-processed" && (
        <p className="pp-sub">Schemes have been processed. Head to Live Stats to enter results and finalize.</p>
      )}
    </div>
  );
}

function CommManageRostersPanel({ state, onSwap, onSubmitScheme }) {
  const teams = state.currentPeriod.type === "playoff" ? state.teams.filter((t) => state.playoffConfig.activeTeamIds.includes(t.id)) : state.teams;
  const [teamId, setTeamId] = useState(teams[0] ? teams[0].id : "");
  const team = state.teams.find((t) => t.id === teamId);
  return (
    <div>
      <div className="pp-card">
        <label className="pp-label">Team</label>
        <select className="pp-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Choose a team...</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {team && <MyTeamTab state={state} team={team} onSwap={(slot, benchIdx) => onSwap(team.id, slot, benchIdx)} onSubmitScheme={onSubmitScheme} onRename={() => {}} />}
    </div>
  );
}

function CommPlayerPoolPanel({ state, onAddPlayer, onSetStatus, onDeletePlayer }) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("QB");
  const [team, setTeam] = useState("");
  const grouped = POSITIONS.reduce((acc, pos) => { acc[pos] = state.playerPool.filter((p) => p.position === pos).sort((a, b) => a.name.localeCompare(b.name)); return acc; }, {});
  return (
    <div>
      <div className="pp-card">
        <h3 className="pp-h3">Add Custom Player</h3>
        <div className="pp-grid-2">
          <div className="pp-field"><label className="pp-label">Name</label><input className="pp-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="pp-field">
            <label className="pp-label">Position</label>
            <select className="pp-select" value={position} onChange={(e) => setPosition(e.target.value)}>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="pp-field"><label className="pp-label">NFL Team</label><input className="pp-input" value={team} onChange={(e) => setTeam(e.target.value)} /></div>
        <button className="pp-btn pp-btn-gold" disabled={!name.trim() || !team.trim()} onClick={() => { onAddPlayer(name.trim(), position, team.trim()); setName(""); setTeam(""); }}>Add Player</button>
      </div>
      {POSITIONS.map((pos) => (
        <div key={pos} className="pp-card">
          <h3 className="pp-h3">{pos} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({grouped[pos].length})</span></h3>
          {grouped[pos].map((p) => (
            <div key={p.id} className="pp-roster-slot" style={{ flexWrap: "wrap" }}>
              <SuitBadge position={p.position} />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div className="pp-roster-slot-name">{p.name}</div>
                <div className="pp-roster-slot-meta">{p.team}</div>
              </div>
              <select className="pp-select" style={{ width: 100 }} value={p.status} onChange={(e) => onSetStatus(p.id, e.target.value)}>
                <option value="Active">Active</option>
                <option value="OUT">OUT</option>
                <option value="IR">IR</option>
                <option value="BYE">BYE</option>
              </select>
              <ConfirmButton label="Delete" confirmLabel="Yes, delete" danger onConfirm={() => onDeletePlayer(p.id)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CommScoringPanel({ state, onSave }) {
  const [cfg, setCfg] = useState(deepClone(state.scoringConfig));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Scoring Settings</h3>
      <div className="pp-field"><label className="pp-label">Points per N yards (N)</label><input className="pp-input" type="number" value={cfg.yardsPerPoint} onChange={(e) => setCfg(Object.assign({}, cfg, { yardsPerPoint: e.target.value }))} /></div>
      <div className="pp-field"><label className="pp-label">Points per TD</label><input className="pp-input" type="number" value={cfg.pointsPerTD} onChange={(e) => setCfg(Object.assign({}, cfg, { pointsPerTD: e.target.value }))} /></div>
      <div className="pp-grid-2">
        <div className="pp-field"><label className="pp-label">Coach Win</label><input className="pp-input" type="number" value={cfg.coachWin} onChange={(e) => setCfg(Object.assign({}, cfg, { coachWin: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Tie</label><input className="pp-input" type="number" value={cfg.coachTie} onChange={(e) => setCfg(Object.assign({}, cfg, { coachTie: e.target.value }))} /></div>
        <div className="pp-field"><label className="pp-label">Coach Loss</label><input className="pp-input" type="number" value={cfg.coachLoss} onChange={(e) => setCfg(Object.assign({}, cfg, { coachLoss: e.target.value }))} /></div>
      </div>
      <button className="pp-btn pp-btn-gold" onClick={() => onSave({
        yardsPerPoint: Number(cfg.yardsPerPoint) || 10, pointsPerTD: Number(cfg.pointsPerTD) || 0,
        coachWin: Number(cfg.coachWin) || 0, coachTie: Number(cfg.coachTie) || 0, coachLoss: Number(cfg.coachLoss) || 0,
      })}>Save Scoring</button>
    </div>
  );
}

function CommStandingsCfgPanel({ state, onSave }) {
  const teamCount = state.teams.length || 1;
  const current = state.standingsPointsOverride || standingsPointsArray(teamCount);
  const [text, setText] = useState(current.join(", "));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Standings Point Values by Rank</h3>
      <p className="pp-sub">Comma-separated, 1st place first. Default is team count down to 1.</p>
      <input className="pp-input" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="pp-btn pp-btn-gold" onClick={() => {
          const arr = text.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
          if (arr.length > 0) onSave(arr);
        }}>Save</button>
        <button className="pp-btn pp-btn-ghost" onClick={() => { onSave(null); setText(standingsPointsArray(teamCount).join(", ")); }}>Reset to Default</button>
      </div>
    </div>
  );
}

function CommPlayoffsPanel({ state, onStart }) {
  const [bracketSize, setBracketSize] = useState(state.playoffConfig.bracketSize || 4);
  const [advText, setAdvText] = useState((state.playoffConfig.advancement || defaultAdvancement(bracketSize)).join(", "));
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Playoff Configuration</h3>
      {state.playoffConfig.started ? (
        <p className="pp-sub">Playoffs already started ({state.playoffConfig.bracketSize} teams, {state.playoffConfig.advancement.join(" -> ")}). Use Reset to start over if needed.</p>
      ) : (
        <>
          <div className="pp-field">
            <label className="pp-label">Bracket Size (top N teams by season standings)</label>
            <input className="pp-input" type="number" value={bracketSize} onChange={(e) => { setBracketSize(e.target.value); setAdvText(defaultAdvancement(Number(e.target.value) || 1).join(", ")); }} />
          </div>
          <div className="pp-field">
            <label className="pp-label">Advancement per round (e.g. 4, 2, 1)</label>
            <input className="pp-input" value={advText} onChange={(e) => setAdvText(e.target.value)} />
          </div>
          <button
            className="pp-btn pp-btn-gold"
            disabled={state.teams.length < 2}
            onClick={() => {
              const bs = Number(bracketSize) || 2;
              const adv = advText.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
              onStart(Math.min(bs, state.teams.length), adv.length ? adv : defaultAdvancement(bs));
            }}
          >
            Start Playoffs
          </button>
          {state.teams.length < 2 ? <p className="pp-sub">Add at least 2 teams first.</p> : null}
        </>
      )}
    </div>
  );
}

function CommResetPanel({ onReset }) {
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Reset League</h3>
      <p className="pp-sub">Wipes teams, rosters, stats, standings, and the activity log. The player pool and scoring settings stay intact. This cannot be undone.</p>
      <TypedConfirm phrase="RESET LEAGUE" label="Reset League" onConfirm={onReset} />
    </div>
  );
}

function CommBackupPanel({ state, onDownload, onRestore, restoreError }) {
  const fileRef = useRef(null);
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Backup & Restore</h3>
      <p className="pp-sub">
        Given this app's history of unreliable automatic cloud saves, treat manual backups as your <strong>primary</strong>{" "}
        safety net, not a nice-to-have. Download a backup after anything important - a week dealt, a week finalized,
        teams added.
      </p>
      <button className="pp-btn pp-btn-gold" style={{ marginBottom: 12 }} onClick={onDownload}>Download Backup (JSON)</button>
      <div className="pp-divider" />
      <h3 className="pp-h3">Restore from Backup</h3>
      {restoreError ? <ErrorBanner message={restoreError} /> : null}
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) onRestore(f); e.target.value = ""; }} />
      <ConfirmButton label="Choose File & Restore" confirmLabel="This replaces current league data - continue?" danger onConfirm={() => fileRef.current && fileRef.current.click()} />
    </div>
  );
}

function CommInvitePanel({ state }) {
  const publicMsg = "Join our Pigskin Poker league! Ask the commissioner for your team's private join code to log in.";
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Public Invite Message</h3>
      <p className="pp-sub">Safe to post publicly - contains no codes.</p>
      <div className="pp-input" style={{ marginBottom: 10 }}>{publicMsg}</div>
      <h3 className="pp-h3">Private Join Codes</h3>
      <p className="pp-sub">Send each of these individually - not publicly.</p>
      {state.teams.map((t) => (
        <div key={t.id} className="pp-roster-slot"><div style={{ flex: 1 }}>{t.name}</div><Tag>{t.joinCode || "(no code set)"}</Tag></div>
      ))}
    </div>
  );
}

function CommissionerTab(props) {
  const [sub, setSub] = useState("teams");
  const subs = ["teams", "weeks", "roster-mgmt", "pool", "scoring", "standings-cfg", "playoffs", "invite", "backup", "reset"];
  const labels = { teams: "Teams", weeks: "Weeks", "roster-mgmt": "Manage Rosters", pool: "Player Pool", scoring: "Scoring", "standings-cfg": "Standings Cfg", playoffs: "Playoffs", invite: "Invite", backup: "Backup", reset: "Reset" };
  return (
    <div>
      <div className="pp-subnav">
        {subs.map((s) => <button key={s} className={"pp-subnav-btn" + (sub === s ? " active" : "")} onClick={() => setSub(s)}>{labels[s]}</button>)}
      </div>
      {sub === "teams" && <CommTeamsPanel state={props.state} onAddTeam={props.onAddTeam} onRenameTeam={props.onRenameTeam} onSetJoinCode={props.onSetJoinCode} onRemoveTeam={props.onRemoveTeam} />}
      {sub === "weeks" && <CommWeeksPanel state={props.state} onDeal={props.onDeal} onProcessSchemes={props.onProcessSchemes} dealError={props.dealError} />}
      {sub === "roster-mgmt" && <CommManageRostersPanel state={props.state} onSwap={props.onSwap} onSubmitScheme={props.onSubmitScheme} />}
      {sub === "pool" && <CommPlayerPoolPanel state={props.state} onAddPlayer={props.onAddPlayer} onSetStatus={props.onSetStatus} onDeletePlayer={props.onDeletePlayer} />}
      {sub === "scoring" && <CommScoringPanel state={props.state} onSave={props.onSaveScoring} />}
      {sub === "standings-cfg" && <CommStandingsCfgPanel state={props.state} onSave={props.onSaveStandingsCfg} />}
      {sub === "playoffs" && <CommPlayoffsPanel state={props.state} onStart={props.onStartPlayoffs} />}
      {sub === "invite" && <CommInvitePanel state={props.state} />}
      {sub === "backup" && <CommBackupPanel state={props.state} onDownload={props.onDownloadBackup} onRestore={props.onRestoreBackup} restoreError={props.restoreError} />}
      {sub === "reset" && <CommResetPanel onReset={props.onResetLeague} />}
    </div>
  );
}

/* ================================== App ==================================== */

const LEAGUE_KEY = "pigskin_league_state_v1";
const IDENTITY_KEY = "pigskin_my_identity_v1";

function errText(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  try { return JSON.stringify(e); } catch (x) { return String(e); }
}

export default function App() {
  const [state, setState] = useState(null);
  const [identity, setIdentity] = useState({ role: null, teamId: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadErrorDetail, setLoadErrorDetail] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveErrorDetail, setSaveErrorDetail] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [dealError, setDealError] = useState(null);
  const [finalizeError, setFinalizeError] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  const [tab, setTab] = useState("home");

  const hasLoaded = useRef(false);
  const retryTimer = useRef(null);
  const loadAttempt = useRef(0);
  const loadRetryTimer = useRef(null);

  /* ---- initial load (auto-retries a few times before showing a blocking error) ---- */
  const loadLeague = useCallback(async () => {
    setLoadFailed(false);
    let loadedState = null;
    let hardFail = false;
    try {
      const res = await window.storage.get(LEAGUE_KEY, true);
      if (res && res.value) loadedState = JSON.parse(res.value);
    } catch (e) {
      // key not found -> genuinely a brand-new league, safe to start fresh.
      // any other error -> do NOT fall back to a blank league, since auto-save could then
      // overwrite real data with an empty one. Block and let the person retry instead.
      const msg = errText(e);
      if (/not found|no such key|404/i.test(msg)) {
        loadedState = createDefaultState();
      } else {
        setLoadErrorDetail(msg);
        hardFail = true;
      }
    }
    if (hardFail) {
      loadAttempt.current += 1;
      if (loadAttempt.current <= 3) {
        // transient blip? retry automatically a few times before bothering the person
        if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current);
        loadRetryTimer.current = setTimeout(() => { loadLeague(); }, loadAttempt.current * 2000);
        return;
      }
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    loadAttempt.current = 0;
    if (loadRetryTimer.current) { clearTimeout(loadRetryTimer.current); loadRetryTimer.current = null; }
    if (!loadedState) loadedState = createDefaultState();
    setState(loadedState);

    let loadedIdentity = { role: null, teamId: null };
    try {
      const res2 = await window.storage.get(IDENTITY_KEY, false);
      if (res2 && res2.value) loadedIdentity = JSON.parse(res2.value);
    } catch (e) {
      // no stored identity yet - fine, stay logged out
    }
    setIdentity(loadedIdentity);
    hasLoaded.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLeague();
    return () => { if (loadRetryTimer.current) clearTimeout(loadRetryTimer.current); };
  }, [loadLeague]);

  /* ---- save on every change (no debounce) ---- */
  const doSave = useCallback(async (s) => {
    setSaveStatus("saving");
    try {
      const result = await window.storage.set(LEAGUE_KEY, JSON.stringify(s), true);
      if (!result) throw new Error("Storage write returned no confirmation.");
      setSaveStatus("saved");
      setLastSavedAt(nowStamp());
      setSaveErrorDetail(null);
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    } catch (e) {
      setSaveStatus("error");
      setSaveErrorDetail(errText(e));
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { doSave(s); }, 3000);
    }
  }, []);

  useEffect(() => {
    if (!hasLoaded.current || !state) return;
    doSave(state);
    // eslint-disable-next-line
  }, [state]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    window.storage.set(IDENTITY_KEY, JSON.stringify(identity), false).catch(() => {});
  }, [identity]);

  const saveNow = () => { if (state) doSave(state); };

  const update = useCallback((fn) => {
    setState((prev) => {
      const next = deepClone(prev);
      fn(next);
      return next;
    });
  }, []);

  /* ---- login handlers ---- */
  const onCommissionerLogin = (code) => {
    const trimmed = (code || "").trim();
    if (!state.commissionerCode) {
      if (!trimmed) { setLoginError("Enter a code to create the commissioner login."); return; }
      update((s) => { s.commissionerCode = trimmed; });
      setIdentity({ role: "commissioner", teamId: null });
      setLoginError(null);
    } else {
      if (trimmed === state.commissionerCode) {
        setIdentity({ role: "commissioner", teamId: null });
        setLoginError(null);
      } else {
        setLoginError("Incorrect commissioner code.");
      }
    }
  };

  const onManagerLogin = (teamId, joinCode) => {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) { setLoginError("Select a team first."); return; }
    if (!team.joinCode) { setLoginError("This team doesn't have a join code set yet - ask your commissioner to set one."); return; }
    if (team.joinCode !== joinCode) { setLoginError("Incorrect join code."); return; }
    setIdentity({ role: "manager", teamId });
    setLoginError(null);
  };

  const onLogout = () => { setIdentity({ role: null, teamId: null }); setTab("home"); };

  /* ---- roster swap / scheme submit ---- */
  const onSwap = (teamId, slot, benchIdx) => {
    update((s) => {
      const team = s.teams.find((t) => t.id === teamId);
      if (!team || !team.roster) return;
      const locks = s.lockedPlayerIds || {};
      const starterId = team.roster.starters[slot];
      const benchId = team.roster.bench[benchIdx];
      if ((starterId && locks[starterId]) || (benchId && locks[benchId])) return;
      team.roster.starters[slot] = benchId;
      team.roster.bench[benchIdx] = starterId;
    });
  };

  const onSubmitScheme = (teamId, scheme) => {
    update((s) => {
      if (s.rosterLocked) return;
      s.schemes[teamId] = scheme;
    });
  };

  const onRenameMyTeam = (teamId, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    update((s) => { const t = s.teams.find((x) => x.id === teamId); if (t) t.name = trimmed; });
  };

  /* ---- commissioner: weeks ---- */
  const onDeal = () => {
    setDealError(null);
    const teamIds = state.currentPeriod.type === "playoff" ? state.playoffConfig.activeTeamIds : state.teams.map((t) => t.id);
    if (teamIds.length === 0) { setDealError("Add at least one team before dealing rosters."); return; }
    const result = dealRosters(state, teamIds);
    if (result.error) { setDealError(result.error); return; }
    update((s) => {
      Object.entries(result.rosters).forEach(([teamId, roster]) => {
        const team = s.teams.find((t) => t.id === teamId);
        if (team) team.roster = roster;
      });
      s.currentPeriod.phase = "dealt";
      s.schemes = {};
      s.statsEntry = {};
      s.lockedPlayerIds = {};
      s.rosterLocked = false;
      s.activityLog.push({
        id: uid("act"), period: Object.assign({}, s.currentPeriod), periodLabel: periodLabel(s.currentPeriod), ts: nowStamp(),
        type: "deal", text: "Rosters dealt for " + periodLabel(s.currentPeriod) + " (" + teamIds.length + " team" + (teamIds.length === 1 ? "" : "s") + ").",
      });
    });
  };

  const onProcessSchemes = () => {
    const next = processSchemes(state);
    next.currentPeriod.phase = "schemes-processed";
    next.rosterLocked = true;
    setState(next);
  };

  /* ---- live stats ---- */
  const onStatChange = (teamId, slot, value) => {
    update((s) => {
      if (slot === "__togglelock__") {
        const pid = value;
        s.lockedPlayerIds[pid] = !s.lockedPlayerIds[pid];
        if (!s.lockedPlayerIds[pid]) delete s.lockedPlayerIds[pid];
        return;
      }
      if (!s.statsEntry[teamId]) s.statsEntry[teamId] = {};
      s.statsEntry[teamId][slot] = value;
    });
  };

  const onToggleRosterLock = () => update((s) => { s.rosterLocked = !s.rosterLocked; });

  const onFinalize = () => {
    setFinalizeError(null);
    const result = finalizeCurrentPeriod(state);
    if (result.error) { setFinalizeError(result.error); return; }
    setState(result.state);
    setDealError(null);
  };

  /* ---- commissioner: teams ---- */
  const onAddTeam = (name) => update((s) => {
    s.teams.push({ id: uid("team"), name, joinCode: "", roster: null, cumulative: emptyCumulative(), playoffCumulative: emptyCumulative() });
  });
  const onRenameTeam = (id, name) => { const trimmed = (name || "").trim(); if (!trimmed) return; update((s) => { const t = s.teams.find((x) => x.id === id); if (t) t.name = trimmed; }); };
  const onSetJoinCode = (id, code) => update((s) => { const t = s.teams.find((x) => x.id === id); if (t) t.joinCode = code; });
  const onRemoveTeam = (id) => update((s) => {
    s.teams = s.teams.filter((t) => t.id !== id);
    delete s.schemes[id];
    delete s.statsEntry[id];
    s.playoffConfig.activeTeamIds = s.playoffConfig.activeTeamIds.filter((tid) => tid !== id);
  });

  /* ---- commissioner: player pool ---- */
  const onAddPlayer = (name, position, team) => update((s) => {
    s.playerPool.push({ id: uid("pl"), name, position, team, status: "Active" });
  });
  const onSetStatus = (playerId, status) => update((s) => {
    const p = s.playerPool.find((x) => x.id === playerId);
    if (p) p.status = status;
  });
  const onDeletePlayer = (playerId) => update((s) => {
    s.playerPool = s.playerPool.filter((p) => p.id !== playerId);
    s.teams.forEach((t) => {
      if (!t.roster) return;
      POSITIONS.concat(["FLEX"]).forEach((slot) => { if (t.roster.starters[slot] === playerId) t.roster.starters[slot] = null; });
      t.roster.bench = t.roster.bench.map((id) => (id === playerId ? null : id));
    });
    Object.keys(s.schemes).forEach((teamId) => { if (s.schemes[teamId] && s.schemes[teamId].playerId === playerId) delete s.schemes[teamId]; });
  });

  /* ---- commissioner: scoring / standings cfg / playoffs / reset ---- */
  const onSaveScoring = (cfg) => update((s) => { s.scoringConfig = cfg; });
  const onSaveStandingsCfg = (arr) => update((s) => { s.standingsPointsOverride = arr; });
  const onStartPlayoffs = (bracketSize, advancement) => setState(startPlayoffs(state, bracketSize, advancement));
  const onResetLeague = () => update((s) => {
    s.teams = [];
    s.schemes = {};
    s.statsEntry = {};
    s.weeklyResults = [];
    s.activityLog = [];
    s.lockedPlayerIds = {};
    s.rosterLocked = false;
    s.currentPeriod = { type: "week", number: 1, phase: "pre-deal" };
    s.playoffConfig = { bracketSize: 4, advancement: [4, 2, 1], started: false, completed: false, currentRoundIndex: 0, activeTeamIds: [], champion: null };
    s.standingsPointsOverride = null;
  });

  /* ---- backup / restore ---- */
  const onDownloadBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pigskin-poker-backup-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setRestoreError({ headline: "Couldn't create the backup file.", detail: errText(e) });
    }
  };
  const onRestoreBackup = (file) => {
    setRestoreError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.playerPool)) {
          throw new Error("File doesn't look like a Pigskin Poker backup (missing teams/playerPool).");
        }
        setState(parsed);
      } catch (e) {
        setRestoreError({ headline: "Restore failed - the file couldn't be read as a valid backup.", detail: errText(e) });
      }
    };
    reader.onerror = () => setRestoreError({ headline: "Restore failed - couldn't read the file.", detail: errText(reader.error) });
    reader.readAsText(file);
  };

  /* ------------------------------- render ------------------------------- */

  if (loadFailed) {
    return (
      <div className="pp-root">
        <style>{GLOBAL_CSS}</style>
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>Couldn't load your league</h1>
            </div>
            <div className="pp-card">
              <p className="pp-sub" style={{ marginBottom: 10 }}>
                Storage couldn't be reached, so nothing has been shown or changed - your saved league data is safe.
                This screen stays up on purpose rather than showing an empty league, since that could get saved
                over your real data by accident.
              </p>
              <ErrorBanner message={{ headline: "Storage read failed", detail: loadErrorDetail }} />
              <button className="pp-btn pp-btn-gold pp-btn-block" onClick={() => { loadAttempt.current = 0; loadLeague(); }}>Try Again</button>
              <p className="pp-sub" style={{ marginTop: 10 }}>
                If this keeps happening: check your connection, make sure you opened this app's actual published
                link (not just the chat that built it), and try refreshing the page.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="pp-root">
        <style>{GLOBAL_CSS}</style>
        <div className="pp-login-wrap"><p className="pp-sub">Loading Pigskin Poker...</p></div>
      </div>
    );
  }

  if (!identity.role) {
    return (
      <div className="pp-root">
        <style>{GLOBAL_CSS}</style>
        <LoginScreen state={state} onCommissionerLogin={onCommissionerLogin} onManagerLogin={onManagerLogin} loginError={loginError} setLoginError={setLoginError} />
      </div>
    );
  }

  const isCommissioner = identity.role === "commissioner";
  const myTeam = identity.role === "manager" ? state.teams.find((t) => t.id === identity.teamId) : null;

  const NAV = [
    { key: "home", label: "League Home" },
    ...(identity.role === "manager" ? [{ key: "myteam", label: "My Team" }] : []),
    { key: "hub", label: "Rosters" },
    { key: "results", label: "Weekly Results" },
    { key: "rules", label: "Rules" },
    ...(isCommissioner ? [{ key: "comm", label: "Commissioner" }] : []),
  ];

  return (
    <div className="pp-root">
      <style>{GLOBAL_CSS}</style>
      <div className="pp-container">
        <div className="pp-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 className="pp-h1">{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
              <span className="pp-badge-role">{isCommissioner ? "Commissioner" : myTeam ? myTeam.name : "Manager"}</span>
            </div>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onLogout}>Log Out</button>
          </div>
          <SaveStatusBar status={saveStatus} lastSavedAt={lastSavedAt} onSaveNow={saveNow} />
          {saveStatus === "error" && saveErrorDetail ? <ErrorBanner message={{ headline: "Save failed - retrying automatically. You can also tap Save Now.", detail: saveErrorDetail }} /> : null}
          <nav className="pp-nav">
            {NAV.map((n) => (
              <button key={n.key} className={"pp-nav-btn" + (tab === n.key ? " active" : "")} onClick={() => setTab(n.key)}>{n.label}</button>
            ))}
          </nav>
        </div>

        <div style={{ paddingTop: 14 }}>
          {tab === "home" && <LeagueHomeTab state={state} />}
          {tab === "myteam" && myTeam && (
            <MyTeamTab state={state} team={myTeam} onSwap={(slot, benchIdx) => onSwap(myTeam.id, slot, benchIdx)} onSubmitScheme={onSubmitScheme} onRename={(name) => onRenameMyTeam(myTeam.id, name)} />
          )}
          {tab === "myteam" && !myTeam && <EmptyState>Your team couldn't be found - ask your commissioner to check the team list.</EmptyState>}
          {tab === "hub" && (
            <RosterHubTab
              state={state} isCommissioner={isCommissioner}
              onStatChange={onStatChange} onToggleRosterLock={onToggleRosterLock}
              onFinalize={onFinalize} finalizeError={finalizeError}
            />
          )}
          {tab === "results" && <WeeklyResultsTab state={state} />}
          {tab === "rules" && <RulesTab state={state} />}
          {tab === "comm" && isCommissioner && (
            <CommissionerTab
              state={state}
              onAddTeam={onAddTeam} onRenameTeam={onRenameTeam} onSetJoinCode={onSetJoinCode} onRemoveTeam={onRemoveTeam}
              onDeal={onDeal} onProcessSchemes={onProcessSchemes} dealError={dealError}
              onSwap={onSwap} onSubmitScheme={onSubmitScheme}
              onAddPlayer={onAddPlayer} onSetStatus={onSetStatus} onDeletePlayer={onDeletePlayer}
              onSaveScoring={onSaveScoring} onSaveStandingsCfg={onSaveStandingsCfg}
              onStartPlayoffs={onStartPlayoffs}
              onDownloadBackup={onDownloadBackup} onRestoreBackup={onRestoreBackup} restoreError={restoreError}
              onResetLeague={onResetLeague}
            />
          )}
        </div>
      </div>
    </div>
  );
}



