/* Pigskin Poker UI - Your Colors, and the team settings sheet it lives in.
 *
 * Scott, 2026-11-16. Eight schemes, chosen from four rounds of mockups, offered in both
 * poker games, which both open in the Classic Felt until a person picks. Each scheme is a block of CSS variables in global.css (.sn-c-<id>); this
 * file is the list, the names, and the three swatches the picker draws.
 *
 * HOW A SCHEME REACHES THE SCREEN. The Classic Felt is the stylesheet's own :root, so it
 * needs no class. Every other scheme is built on .sn-theme (the old Full Season look,
 * written as variables) plus its own .sn-c-<id> block, and the light ones add .sn-light.
 *
 * PYLON ORANGE IS GONE (Scott, 2026-11-17). It was the Full Season look, then a choice
 * here; now it is neither. Its colours survive only as .sn-theme's base values, which no
 * screen shows on their own any more - every offered scheme overrides all of them. A phone
 * that saved "pylon" falls back to the felt.
 *
 * GENERIC ON PURPOSE. No scheme is named after an NFL team or matched exactly to one's
 * colours: Scott asked for that so the list could never read as team merchandise, in case
 * colour schemes are ever something people pay for. Keep new names to colours and moods.
 *
 * Nothing in the game reads the choice, and the position cards, Block / Steal / Redraw
 * and the injury tags look the same in every scheme.
 */

import { useEffect, useState } from "react";

/* Each game's look until the person picks another. BOTH ARE THE CLASSIC FELT (Scott,
 * 2026-11-16): Full Season used to open in Pylon Orange so it could not be mistaken for
 * a Weekly table, and he chose one shared starting look instead - the SEASON / WEEKLY
 * badge beside the league name still tells them apart. Kept per game so either can move
 * on its own again with one word. */
export const DEFAULT_COLOR_SCHEME = { season: "felt", weekly: "felt" };

/* [background, card, highlight] - drawn as the three squares beside each name. */
export const COLOR_SCHEMES = [
  { id: "felt", name: "Classic Felt", light: false, swatch: ["#061a11", "#0c2318", "#e8c25a"] },
  { id: "classic-dark", name: "Classic Dark", light: false, swatch: ["#121316", "#1b1e22", "#e8eaed"] },
  { id: "midnight", name: "Midnight", light: false, swatch: ["#0c1a30", "#10223b", "#5cc8ff"] },
  { id: "blackout", name: "Blackout", light: false, swatch: ["#0a0b0d", "#111316", "#e63a32"] },
  { id: "classic-light", name: "Classic Light", light: true, swatch: ["#f8f9f9", "#ffffff", "#24303e"] },
  { id: "turf-chalk", name: "Turf & Chalk", light: true, swatch: ["#eff5f1", "#ffffff", "#1d8a4e"] },
  { id: "snow-day", name: "Snow Day", light: true, swatch: ["#e9eff6", "#fbfcfd", "#1d3f72"] },
  { id: "game-day", name: "Game Day", light: true, swatch: ["#13254a", "#ffffff", "#c8202f"] },
];

/* PARKED, NOT OFFERED (Scott, 2026-11-16). Finished schemes held back on purpose: he
 * may one day sell extra colour schemes, and wants a few ready to add when he does. Their
 * CSS blocks stay in global.css, so offering one is moving its line up into COLOR_SCHEMES.
 * Nothing draws from this list. */
export const PARKED_COLOR_SCHEMES = [
  { id: "black-green", name: "Black & Green", light: false, swatch: ["#0a0b0d", "#111316", "#2fbf71"] },
  { id: "blue-silver", name: "Blue & Silver", light: false, swatch: ["#0a2c42", "#0e3954", "#c3cad0"] },
  { id: "blue-silver-light", name: "Blue & Silver Light", light: true, swatch: ["#ebeced", "#fbfcfc", "#1f7fc0"] },
];

function defaultFor(game) {
  return DEFAULT_COLOR_SCHEME[game] || DEFAULT_COLOR_SCHEME.season;
}

/* The scheme to draw: the saved one if it still exists, otherwise the game's default. */
export function findColorScheme(id, game = "season") {
  return COLOR_SCHEMES.find((s) => s.id === id) || COLOR_SCHEMES.find((s) => s.id === defaultFor(game));
}

/* The classes App.jsx adds to .pp-root. */
export function colorSchemeClasses(id, game = "season") {
  const scheme = findColorScheme(id, game);
  if (scheme.id === "felt") return "";
  return " sn-theme sn-c-" + scheme.id + (scheme.light ? " sn-light" : "");
}

function ColorGrid({ value, game, onPick }) {
  const current = findColorScheme(value, game).id;
  const fallback = defaultFor(game);
  return (
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
          <span className="pp-color-name">
            {s.name}
            <span className="pp-color-kind">{s.id === fallback ? "Default" : s.light ? "Light" : "Dark"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* THE GEAR beside your team name in the header (Scott, 2026-11-16: "a subtle button easy
 * to click on a phone, kind of like how Yahoo fantasy has it"). Small to look at, 44px to
 * hit - the hit area is padding, so it does not push the header taller. */
export function TeamSettingsButton({ onClick }) {
  return (
    <button type="button" className="pp-team-gear" onClick={onClick} aria-label="Team settings: name and colors" title="Team settings">
      <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M8.6 1.5h2.8l.4 2.2c.5.2 1 .5 1.4.8l2.1-.8 1.4 2.4-1.7 1.5c.1.5.1 1.1 0 1.6l1.7 1.5-1.4 2.4-2.1-.8c-.4.3-.9.6-1.4.8l-.4 2.2H8.6l-.4-2.2c-.5-.2-1-.5-1.4-.8l-2.1.8-1.4-2.4L5 10.3c-.1-.5-.1-1.1 0-1.6L3.3 7.2l1.4-2.4 2.1.8c.4-.3.9-.6 1.4-.8l.4-2.3zM10 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
        />
      </svg>
    </button>
  );
}

/* The sheet the gear opens: your team's name, then your colours. It is drawn inside
 * .pp-root, so a tap on a scheme repaints the page behind it at once - the preview is the
 * screen itself. A commissioner with no team gets the colours alone. */
export function TeamSettingsSheet({ team, onRename, game, colorScheme, onPickColors, onClose }) {
  const [name, setName] = useState(team ? team.name : "");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const trimmed = name.trim();
  const changed = !!team && !!trimmed && trimmed !== team.name;
  const save = (e) => {
    e.preventDefault();
    if (!changed) return;
    onRename(trimmed);
    setSaved(true);
  };
  return (
    <div className="pp-overlay" onClick={onClose}>
      <div className="pp-overlay-card pp-settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Team settings">
        <button className="pp-overlay-x" onClick={onClose} aria-label="Close">x</button>
        <h2 className="pp-h2" style={{ marginBottom: 12 }}>Team Settings</h2>
        {team ? (
          <form className="pp-settings-section" onSubmit={save}>
            <label className="pp-label" htmlFor="pp-team-name">Team name</label>
            <div className="pp-settings-row">
              <input
                id="pp-team-name"
                className="pp-input"
                value={name}
                onChange={(e) => { setName(e.target.value); setSaved(false); }}
              />
              {/* Disabled on a blank or unchanged name rather than accepting the press: the
                * server refuses a blank one, and saving the same name would look like it
                * did something. */}
              <button type="submit" className="pp-btn pp-btn-gold" disabled={!changed}>Save</button>
            </div>
            {saved ? <div className="pp-settings-note">Saved.</div> : null}
          </form>
        ) : null}
        <div className="pp-settings-section">
          <div className="pp-label">Your colors</div>
          <p className="pp-sub" style={{ margin: "0 0 10px" }}>
            Only you see these, and only on this device. They apply to every {game === "weekly" ? "Weekly" : "Full Season"} league you play here.
          </p>
          <ColorGrid value={colorScheme} game={game} onPick={onPickColors} />
        </div>
      </div>
    </div>
  );
}
