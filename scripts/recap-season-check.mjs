/* Does the free weekly recap repeat itself over a season?
 *
 *   node scripts/recap-season-check.mjs [seasons]
 *
 * Plays whole simulated 12-team, 18-week seasons through the preview's recap writer
 * (src/preview/freeRecap.js) and reports two things: any line that appeared twice in a
 * season, and any list in src/preview/recapLines.js that a season asked for more lines
 * than it has. Run it after adding or removing lines. No database, no network.
 */

import { createServer } from "vite";

const seasons = Number(process.argv[2]) || 6;
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { createPreviewLeague } = await server.ssrLoadModule("/src/preview/previewLeague.js");
  const { freeRecapsByWeek, makeDeck } = await server.ssrLoadModule("/src/preview/freeRecap.js");
  const L = await server.ssrLoadModule("/src/preview/recapLines.js");
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const need = {};
  let recaps = 0;
  let repeats = 0;

  for (let seed = 1; seed <= seasons; seed++) {
    const asked = {};
    const deck = makeDeck("season" + seed);
    const counting = { fresh: (name, list) => ((asked[name] = (asked[name] || 0) + 1), deck.fresh(name, list)) };
    const byWeek = freeRecapsByWeek(createPreviewLeague({ played: 18, recapWeeks: weeks, seed }), weeks, counting);
    const seen = new Set();
    weeks.forEach((w) => byWeek[w].forEach((r) => {
      recaps++;
      [r.headline, r.story, r.mvp.note, r.dud.note, ...r.notes.map((n) => n.text)].forEach((t) => {
        if (seen.has(t)) {
          repeats++;
          console.log("repeated in season " + seed + ": " + t);
        }
        seen.add(t);
      });
    }));
    Object.entries(asked).forEach(([k, v]) => (need[k] = Math.max(need[k] || 0, v)));
  }

  const short = Object.entries(need).filter(([k, v]) => v > (L[k] || []).length);
  short.forEach(([k, v]) => console.log(k + ": a season wanted " + v + ", the list has " + (L[k] || []).length));
  console.log(recaps + " recaps over " + seasons + " seasons, " + repeats + " repeated lines, " + short.length + " lists running short");
} finally {
  await server.close();
}
