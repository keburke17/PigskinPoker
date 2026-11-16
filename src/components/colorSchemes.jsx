/* Pigskin Poker UI - "Your Colors", the Full Season colour picker (Scott, 2026-11-16).
 *
 * Ten schemes, chosen by Scott from four rounds of mockups. Each one is a block of CSS
 * variables in global.css (.sn-c-<id>); this file is the list, the names, and the three
 * swatches the picker draws. Pylon Orange is the default, so it has no class of its own.
 *
 * GENERIC ON PURPOSE. No scheme is named after an NFL team or matched exactly to one's
 * colours: Scott asked for that so the list could never read as team merchandise, in case
 * colour schemes are ever something people pay for. Keep new names to colours and moods.
 *
 * The picker is the whole of it: nothing in the game reads the choice, and the position
 * cards, Block / Steal / Redraw and the injury tags look the same in all ten.
 */

export const DEFAULT_COLOR_SCHEME = "pylon";

/* [background, card, highlight] - drawn as the three squares beside each name. */
export const COLOR_SCHEMES = [
  { id: "classic-dark", name: "Classic Dark", light: false, swatch: ["#121316", "#1b1e22", "#e8eaed"] },
  { id: "midnight", name: "Midnight", light: false, swatch: ["#0c1a30", "#10223b", "#5cc8ff"] },
  { id: "pylon", name: "Pylon Orange", light: false, swatch: ["#14171a", "#1b1f23", "#ff7a30"] },
  { id: "blackout", name: "Blackout", light: false, swatch: ["#0a0b0d", "#111316", "#e63a32"] },
  { id: "black-green", name: "Black & Green", light: false, swatch: ["#0a0b0d", "#111316", "#2fbf71"] },
  { id: "blue-silver", name: "Blue & Silver", light: false, swatch: ["#0a2c42", "#0e3954", "#c3cad0"] },
  { id: "classic-light", name: "Classic Light", light: true, swatch: ["#f8f9f9", "#ffffff", "#24303e"] },
  { id: "turf-chalk", name: "Turf & Chalk", light: true, swatch: ["#eff5f1", "#ffffff", "#1d8a4e"] },
  { id: "snow-day", name: "Snow Day", light: true, swatch: ["#e9eff6", "#fbfcfd", "#1d3f72"] },
  { id: "game-day", name: "Game Day", light: true, swatch: ["#13254a", "#ffffff", "#c8202f"] },
];

export function findColorScheme(id) {
  return COLOR_SCHEMES.find((s) => s.id === id) || COLOR_SCHEMES.find((s) => s.id === DEFAULT_COLOR_SCHEME);
}

/* The classes App.jsx adds to .pp-root beside sn-theme. Pylon Orange needs none. */
export function colorSchemeClasses(id) {
  const scheme = findColorScheme(id);
  if (scheme.id === DEFAULT_COLOR_SCHEME) return "";
  return " sn-c-" + scheme.id + (scheme.light ? " sn-light" : "");
}

export function ColorPicker({ value, onPick }) {
  const current = findColorScheme(value).id;
  return (
    <div className="pp-card">
      <h3 className="pp-h3">Your Colors</h3>
      <p className="pp-sub" style={{ marginBottom: 10 }}>
        Pick the colors you want for this game. Only you see them, and only on this device.
      </p>
      <div className="pp-colors" role="radiogroup" aria-label="Your colors">
        {COLOR_SCHEMES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === current}
            className={"pp-color-opt" + (s.id === current ? " picked" : "")}
            onClick={() => onPick(s.id)}
          >
            <span className="pp-color-swatch" aria-hidden="true">
              {s.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
            </span>
            <span className="pp-color-name">{s.name}</span>
            <span className="pp-color-kind">{s.light ? "Light" : "Dark"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
