/* The site admins' screen. Issue #40.
 *
 * NOT A LEAGUE TAB, even though the app draws a pill for it. Everything else in this
 * app is scoped to one league; this edits `player_pool`, the single template every
 * league is copied from, and the 32 head-coach rows in it. See server/coaches.js for
 * why those rows are the one thing that may cross a league boundary.
 *
 * WHY IT IS A LIST OF TEAMS AND NOT A LIST OF PLAYERS. The commissioner's pool screen
 * shows 224 rows grouped by position, with a status dropdown and a Delete on each,
 * because a skill player can be dealt, blocked, stolen, redrawn, hurt and retired. A
 * coach can do none of those. There are always exactly 32, one per NFL team, nobody may
 * add or remove one, and the only thing about him that is ever wrong is his name - so
 * the screen is 32 rows keyed by TEAM with one editable field, and the team is the part
 * that cannot be edited.
 *
 * That shape is the point Scott was making on 2026-09-07: the card is the TEAM. It
 * scores its team's Win, Tie or Loss and the coach's name has never entered the
 * arithmetic. The name is on the card because it is more fun than "Baltimore Ravens"
 * twice - which is exactly why it being wrong is annoying and not dangerous.
 */

import { useEffect, useState } from "react";
import { SUIT_CH } from "../engine/index.js";
import { ErrorBanner } from "./atoms.jsx";

function CoachRow({ row, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name ?? "");

  // The list is re-read after every save, so a row that changed underneath us (the
  // "push everything" button, or another admin) must not keep showing the old value.
  useEffect(() => { if (!editing) setName(row.name ?? ""); }, [row.name, editing]);

  const save = async () => {
    const n = name.trim();
    if (!n || n === row.name) { setEditing(false); return; }
    const r = await onSave(row.team, n);
    if (r?.ok) setEditing(false);
  };

  const disagreements = row.disagreements ?? [];
  const missing = row.missingIn ?? [];

  return (
    <div className="pp-roster-slot" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 170 }}>
        <div className="pp-roster-slot-name">{row.team}</div>
        <div className="pp-roster-slot-meta">
          {row.name ? "Head coach" : "No coach in the shared pool"}
          {row.retiredCount ? " - " + row.retiredCount + " retired row(s) left alone" : ""}
        </div>
      </div>

      {editing ? (
        <div style={{ flex: 2, minWidth: 220, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input
            className="pp-input"
            style={{ flex: 2, minWidth: 140 }}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(row.name ?? ""); setEditing(false); } }}
          />
          <button className="pp-btn pp-btn-gold" disabled={busy} onClick={save}>Save</button>
          <button className="pp-btn" disabled={busy} onClick={() => { setName(row.name ?? ""); setEditing(false); }}>Cancel</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 2, minWidth: 160 }}>
            <div className="pp-roster-slot-name">{row.name ?? "-"}</div>
            {disagreements.length ? (
              <div className="pp-hint pp-hint-bad">
                {disagreements.length === 1 ? "1 league still says " : disagreements.length + " leagues still say "}
                {[...new Set(disagreements.flatMap((d) => d.names))].join(", ")}
              </div>
            ) : null}
            {missing.length ? (
              <div className="pp-hint">
                No coach row at all in {missing.map((m) => m.leagueName ?? m.leagueId).join(", ")}
              </div>
            ) : null}
          </div>
          <button className="pp-btn" disabled={busy || !row.name} onClick={() => setEditing(true)}>Edit</button>
        </>
      )}
    </div>
  );
}

/** What a write actually did, in the admin's terms. Never silently successful. */
function Report({ report }) {
  if (!report) return null;
  const skipped = report.skipped ?? [];
  return (
    <div className="pp-card pp-card-tight">
      <p className="pp-sub">
        {report.team ? (
          <>
            <strong>{report.team}: {report.name}.</strong>{" "}
            {report.templateChanged ? "Shared pool updated. " : "Shared pool already said that. "}
            {report.leaguesUpdated
              ? report.leaguesUpdated + " league" + (report.leaguesUpdated === 1 ? "" : "s") + " updated."
              : "No league needed changing."}
          </>
        ) : (
          <>
            <strong>Pushed the whole list.</strong>{" "}
            {report.rowsUpdated
              ? report.rowsUpdated + " coach row" + (report.rowsUpdated === 1 ? "" : "s") + " updated across "
                + (report.teamsChanged?.length ?? 0) + " team" + ((report.teamsChanged?.length ?? 0) === 1 ? "" : "s") + "."
              : "Every league already agreed with the list."}
          </>
        )}
      </p>
      {skipped.length ? (
        <>
          <p className="pp-sub" style={{ marginTop: 8 }}>
            <strong>Left alone,</strong> because guessing would be worse than telling you:
          </p>
          <ul className="pp-rule-list">
            {skipped.map((s, i) => (
              <li key={i}>
                {s.team ? s.team + " - " : ""}
                {s.leagueName ?? s.leagueId}
                {s.reason === "duplicate"
                  ? " has two live coach rows for this team (" + (s.names ?? []).join(" / ") + ")"
                  : " - " + (s.reason ?? "skipped")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function AdminScreen({ account, admin, checked, coaches, error, onSetCoach, onSyncAll, onSignInWithEmail, onLeave }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const save = async (team, name) => {
    setBusy(true);
    const r = await onSetCoach(team, name);
    setBusy(false);
    if (r?.ok) setReport(r.report);
    return r;
  };

  const syncAll = async () => {
    setBusy(true);
    const r = await onSyncAll();
    setBusy(false);
    if (r?.ok) setReport(r.report);
  };

  /* THREE STATES, and they are deliberately different words. Not signed in is a thing
   * you can fix from here; signed in and not an admin is not, and should not read like
   * an error you could argue with. */
  if (!checked) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap"><p className="pp-sub">Checking...</p></div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>Admin</h1>
            </div>
            <div className="pp-card">
              <p className="pp-sub" style={{ marginBottom: 10 }}>Sign in to continue.</p>
              {sent ? (
                <p className="pp-hint pp-hint-good">Check your email for the sign-in link.</p>
              ) : (
                <>
                  <input className="pp-input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button
                    className="pp-btn pp-btn-gold pp-btn-block"
                    style={{ marginTop: 8 }}
                    onClick={async () => { const r = await onSignInWithEmail(email); if (r?.ok) setSent(true); }}
                  >
                    Email Me A Link
                  </button>
                </>
              )}
              <button className="pp-btn pp-btn-ghost pp-btn-block" style={{ marginTop: 8 }} onClick={onLeave}>Back</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="pp-root">
        <div className="pp-login-wrap">
          <div className="pp-login-card">
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div className="pp-eyebrow">Pigskin Poker</div>
              <h1 className="pp-h1" style={{ fontSize: 26 }}>Nothing here for you</h1>
            </div>
            <div className="pp-card">
              <p className="pp-sub" style={{ marginBottom: 10 }}>
                This screen belongs to the people who built the game. Being a commissioner
                does not include it - your league's players are all on your own Commish tab.
              </p>
              <button className="pp-btn pp-btn-gold pp-btn-block" onClick={onLeave}>Back To My Leagues</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const rows = coaches?.coaches ?? [];
  const behind = rows.filter((r) => (r.disagreements ?? []).length).length;

  return (
    <div className="pp-root">
      <div className="pp-container">
        <div className="pp-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 className="pp-h1">{SUIT_CH.spade} Pigskin Poker {SUIT_CH.diamond}</h1>
              <span className="pp-badge-role">Admin</span>
            </div>
            <button className="pp-btn pp-btn-sm pp-btn-ghost" onClick={onLeave}>My Leagues</button>
          </div>
        </div>

        <div style={{ paddingTop: 14 }}>
          {error ? <ErrorBanner message={{ headline: error }} /> : null}

          <div className="pp-card">
            <h3 className="pp-h3">Head Coaches</h3>
            <p className="pp-sub">
              One list, for every league. These 32 names live in the shared pool that each
              new league is created from, and editing one here changes it in the template
              and in every league already playing.
            </p>
            <p className="pp-sub">
              <strong>The coach card is the team.</strong> It scores its NFL team's result -
              Win, Tie or Loss - and the coach's name has never been part of that. Nothing
              you type here can move a point, in this week or in one already played. The
              name is on the card because it is more fun than reading the team twice, which
              is also why no feed is allowed to write it: the free coach data had John
              Harbaugh at the Giants, and it is not worth being wrong to be automatic.
            </p>
            <p className="pp-sub">
              Nobody may add or delete a coach here. There are 32 NFL teams and there are 32
              coach cards, and a league missing one is a hole to look at rather than
              something this screen should quietly patch.
            </p>
          </div>

          <div className="pp-card">
            <h3 className="pp-h3">Push The List Everywhere</h3>
            <p className="pp-sub">
              Sets every league's coach rows to the names below. Use it after correcting a
              batch, or on a league that was created before the list was right.
              {coaches ? " " + coaches.leagueCount + " league(s) on this deployment." : ""}
              {behind ? " " + behind + " team(s) currently disagree somewhere." : " Everything agrees right now."}
            </p>
            <button className="pp-btn pp-btn-gold" disabled={busy || !rows.length} onClick={syncAll}>
              {busy ? "Working..." : "Push To Every League"}
            </button>
          </div>

          <Report report={report} />

          <div className="pp-card">
            {rows.length ? rows.map((r) => (
              <CoachRow key={r.team} row={r} onSave={save} busy={busy} />
            )) : <p className="pp-sub">Loading the list...</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
