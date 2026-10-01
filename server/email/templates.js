/* What each email actually says.
 *
 * Issue #57. PURE FUNCTIONS: facts in, { subject, text, html } out. No database, no
 * clock, no environment - the same discipline src/engine/ holds to, for the same
 * payoff. Every sentence in here is asserted in tests/notify.test.js without a stack
 * running, and Scott can be shown a rendered email without anything being sent.
 *
 * ---------------------------------------------------------------------------
 * THE WORDING IS NOT FINISHED, AND THAT IS THE PLAN.
 *
 * Kyle asked for the structure; Scott writes the words. Anything below that sounds like
 * the app talking to the league - the subject lines, the running order, the jokes it
 * does not yet have - is a first draft waiting for him, and changing it is a text edit
 * in this file rather than a change to how any of this works.
 *
 * TWO THINGS ARE NOT HIS TO SOFTEN, though:
 *
 *   1. NEVER PROMISE A CLOCK THE LEAGUE HAS NOT SWITCHED ON. The deadline sentence is
 *      handed in as a fact read from the league's own settings (src/engine/weeklyClock.js).
 *      A league whose commissioner processes schemes by hand must not be told that
 *      Thursday 3am is a deadline, because for them it is not one.
 *   2. EVERY MESSAGE CARRIES ITS OWN OFF SWITCH. See server/email/unsubscribe.js.
 * ---------------------------------------------------------------------------
 *
 * ASCII-ONLY SOURCE, per CLAUDE.md, and the card suits are HTML entities exactly as
 * supabase/templates/magic_link.html has them - which in email is also the safe choice:
 * a raw multi-byte glyph in a mis-declared charset arrives as mojibake.
 *
 * TABLE LAYOUT AND INLINE STYLES, also copied from the sign-in email: Gmail strips
 * <style> blocks, and this has to survive clients written a decade apart. Dark text on
 * light, because a dark background is where email clients disagree most.
 *
 * AND THERE IS ALWAYS A PLAIN TEXT PART. Every message is built twice, and not for
 * purity: a text/plain alternative is one of the things spam filters weigh, and it is
 * what a watch or a screen reader reads out.
 */

const BRAND = "&#9824; Pigskin Poker &#9830;";

/** HTML-escape. Team names and player names are typed by people and land in markup. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* --------------------------------------------------------------- the shell -- */

/**
 * The card every message sits in: brand, subtitle, body, button, footer.
 *
 * ONE LAYOUT FOR ALL THREE, so a league recognises the sender at a glance and so a
 * change to the footer cannot reach two of the three emails and miss the other.
 */
function layout({ subtitle, blocks, action, footer }) {
  const body = blocks.join("\n");
  const button = action
    ? '<tr><td align="center" style="padding:4px 0 20px;">' +
      '<a href="' + esc(action.href) + '" style="display:inline-block;background-color:#d9b64c;color:#1d3024;' +
      'font-weight:bold;font-size:15px;text-decoration:none;padding:12px 28px;border-radius:8px;">' +
      esc(action.label) + "</a></td></tr>"
    : "";

  return (
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f2ec;padding:24px 0;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">\n" +
    '  <tr><td align="center">\n' +
    '    <table width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;' +
    'border:1px solid #ddd8c8;border-radius:10px;padding:28px;">\n' +
    '      <tr><td align="center" style="padding-bottom:6px;font-family:Georgia,\'Times New Roman\',serif;' +
    'font-size:22px;font-weight:bold;color:#1d3024;">' + BRAND + "</td></tr>\n" +
    '      <tr><td align="center" style="padding-bottom:20px;font-size:13px;color:#6b7a6f;">' +
    esc(subtitle) + "</td></tr>\n" +
    body + "\n" + button + "\n" +
    '      <tr><td style="font-size:11px;color:#95a099;line-height:1.5;border-top:1px solid #eae6da;padding-top:14px;">' +
    footer + "</td></tr>\n" +
    "    </table>\n  </td></tr>\n</table>"
  );
}

/** A paragraph. */
const p = (html) =>
  '      <tr><td style="font-size:14px;color:#33403a;line-height:1.5;padding-bottom:16px;">' + html + "</td></tr>";

/** A quieter paragraph, for a deadline or an aside. */
const note = (html) =>
  '      <tr><td style="font-size:12px;color:#6b7a6f;line-height:1.5;padding-bottom:16px;">' + html + "</td></tr>";

/** A list of lines - a roster, or what the schemes did. */
const list = (lines) =>
  '      <tr><td style="font-size:14px;color:#33403a;line-height:1.7;padding-bottom:16px;">' +
  lines.map((l) => "&bull; " + l).join("<br />") +
  "</td></tr>";

/**
 * The footer, which is the same on all three and is not optional.
 *
 * It says which league this is about - somebody in two leagues needs to know which one
 * is emailing them - and it carries both off switches: this kind, or everything.
 */
function footerHtml({ leagueName, unsubscribeUrl, unsubscribeAllUrl }) {
  return (
    "You are getting this because you manage a team in " + esc(leagueName) + ".<br />" +
    '<a href="' + esc(unsubscribeUrl) + '" style="color:#6b7a6f;">Stop these emails</a>' +
    (unsubscribeAllUrl
      ? ' &middot; <a href="' + esc(unsubscribeAllUrl) + '" style="color:#6b7a6f;">stop all league email</a>'
      : "")
  );
}

function footerText({ leagueName, unsubscribeUrl }) {
  return (
    "\n---\nYou are getting this because you manage a team in " + leagueName + ".\n" +
    "Stop these emails: " + unsubscribeUrl + "\n"
  );
}

/* ------------------------------------------------------- A. the week dealt -- */

/**
 * "Week 6 is final, and your Week 7 roster is waiting."
 *
 * THE RECAP AND THE DEAL ARE ONE EMAIL, not two, and that is a judgement about inboxes
 * rather than about the game. On a clock they happen within a second of each other at
 * 6am Tuesday; sending two messages a second apart is how a sender gets filtered. When
 * a commissioner finalizes on Monday night and deals on Tuesday, the recap still rides
 * with the deal, which is the moment there is something to do.
 *
 * `recap` is null in week 1, and in any league whose previous week nobody finalized.
 * Saying nothing is correct there - an empty "you finished nowhere" line is worse.
 *
 * @param {object} facts
 * @param {string} facts.periodLabel   the NEW week: "Week 7"
 * @param {object|null} facts.recap    { periodLabel, rank, teamCount, standingsPoints, rawScore, best }
 * @param {string[]} facts.roster      one line per starter, already worded
 * @param {string} facts.deadline      the whole deadline sentence, from the league's settings
 */
export function renderWeekDealt(facts) {
  const { teamName, leagueName, periodLabel, recap, roster = [], deadline, site } = facts;
  const subject = periodLabel + ": your new roster is dealt";

  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const recapText = recap
    ? recap.periodLabel + " is final. " + teamName + " finished " + ordinal(recap.rank) + " of " +
      recap.teamCount + " with " + recap.rawScore + " points, and took " + recap.standingsPoints +
      " standings point" + (recap.standingsPoints === 1 ? "" : "s") + "." +
      (recap.best ? " Best on the roster: " + recap.best.name + ", " + recap.best.points + "." : "")
    : null;

  const blocks = [];
  if (recapText) blocks.push(p(esc(recapText)));
  blocks.push(p("<b>" + esc(periodLabel) + "</b> has been dealt. Here is what " + esc(teamName) + " is holding:"));
  if (roster.length) blocks.push(list(roster.map(esc)));
  blocks.push(note(esc(deadline)));

  const text =
    (recapText ? recapText + "\n\n" : "") +
    periodLabel + " has been dealt. Here is what " + teamName + " is holding:\n" +
    roster.map((r) => "  - " + r).join("\n") + "\n\n" +
    deadline + "\n\n" +
    "Pick your scheme: " + site + "\n" +
    footerText(facts);

  return {
    subject,
    text,
    html: layout({
      subtitle: leagueName,
      blocks,
      action: { href: site, label: "Pick Your Scheme" },
      footer: footerHtml(facts),
    }),
  };
}

/* ---------------------------------------------------- B. the last reminder -- */

/**
 * "Schemes close in 12 hours and you have nothing on file."
 *
 * ONLY TO SOMEBODY WITH NOTHING ON FILE, and only where the deadline is a real time.
 * A reminder to a manager who has already picked is noise, and noise is how a sender
 * ends up in a spam folder - taking the sign-in email's reputation with it. The choosing
 * is done in server/notify.js; this only has to sound like a nudge rather than a telling
 * off, because No Action is a legitimate thing to have decided on purpose.
 */
export function renderSchemeReminder(facts) {
  const { teamName, leagueName, periodLabel, deadline, hoursLeft, site } = facts;
  const subject = "Schemes close in " + hoursLeft + " hours - " + teamName + " has nothing in";

  const opening =
    "Nothing has been submitted for " + teamName + " in " + periodLabel + " yet, and " + deadline;
  const consequence =
    "If the deadline passes with nothing in, your week runs as it was dealt - no block, no steal, no redraw.";
  const permission = "If that is what you wanted, ignore this. Otherwise there is still time.";

  return {
    subject,
    text: opening + "\n\n" + consequence + "\n\n" + permission + "\n\nPick your scheme: " + site + "\n" +
      footerText(facts),
    html: layout({
      subtitle: leagueName + " - " + periodLabel,
      blocks: [p(esc(opening)), p(esc(consequence)), note(esc(permission))],
      action: { href: site, label: "Pick Your Scheme" },
      footer: footerHtml(facts),
    }),
  };
}

/* ------------------------------------------------- C. the schemes have run -- */

/**
 * "The schemes ran. Set your lineup."
 *
 * WHAT HAPPENED TO YOUR ROSTER IS THE POINT, not that a job ran. The lines are handed in
 * already worded - "your block on X held", "Y was stolen by Team B" - and they are only
 * legal to send because a resolved scheme is public in this league (RLS gates on
 * `resolved_at`, and the Activity log shows the same thing).
 *
 * The lock sentence matters as much as the schemes did: in a `gametime` league a player
 * is frozen at his own kickoff, so "set your lineup" has a different deadline for every
 * name on the list. That wording comes from the league's own lock mode.
 */
export function renderSchemesProcessed(facts) {
  const { teamName, leagueName, periodLabel, events = [], lock, site } = facts;
  const subject = periodLabel + ": schemes are in, set your lineup";

  const opening =
    events.length
      ? "The " + periodLabel + " schemes have run. Here is what happened to " + teamName + ":"
      : "The " + periodLabel + " schemes have run. Nothing moved on or off " + teamName + ".";

  const blocks = [p(esc(opening))];
  if (events.length) blocks.push(list(events.map(esc)));
  blocks.push(p("Your lineup is yours to set."));
  blocks.push(note(esc(lock)));

  return {
    subject,
    text:
      opening + "\n" +
      (events.length ? events.map((e) => "  - " + e).join("\n") + "\n" : "") +
      "\nYour lineup is yours to set.\n\n" + lock + "\n\nSet your lineup: " + site + "\n" +
      footerText(facts),
    html: layout({
      subtitle: leagueName,
      blocks,
      action: { href: site, label: "Set Your Lineup" },
      footer: footerHtml(facts),
    }),
  };
}

/** kind -> renderer. The one place the three are named together. */
export const RENDERERS = {
  week_dealt: renderWeekDealt,
  scheme_reminder: renderSchemeReminder,
  schemes_processed: renderSchemesProcessed,
};

/** Render whichever kind this is. Unknown kinds throw - there are only ever three. */
export function render(kind, facts) {
  const renderer = RENDERERS[kind];
  if (!renderer) throw new Error("unknown notification kind: " + kind);
  return renderer(facts);
}
