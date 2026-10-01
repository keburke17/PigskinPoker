/* The one page in this app that works with no session at all.
 *
 * Issue #57. A league email has to be stoppable by somebody standing in their inbox with
 * no memory of ever signing in - otherwise the button they reach for says "report spam",
 * and that complaint lands on the sending domain, which is the domain magic links come
 * from. This is cheaper than that.
 *
 * A PEER OF api.mjs RATHER THAN A ROUTE INSIDE IT, for two reasons that both matter:
 *
 *   - api.mjs is POST-only, JSON-only, and every route there resolves a session. This
 *     one answers a GET from a browser with HTML and is authorized by a signed token
 *     instead (server/email/unsubscribe.js). Bolting it on would mean weakening the
 *     shape that keeps api.mjs easy to reason about;
 *   - mail clients POST here by themselves (RFC 8058 one-click), so the endpoint must
 *     accept a form post from a machine that has never heard of this app.
 *
 * WHAT THE TOKEN CAN DO IS THE WHOLE SECURITY ARGUMENT: silence one kind of email for
 * one person. It cannot sign anybody in, cannot read anything, and cannot turn email
 * back ON - that needs a real session, on the account screen. A leaked link is a
 * stranger doing somebody the favour of stopping their mail.
 *
 * GET NEVER CHANGES ANYTHING. Link scanners and mail previewers fetch every URL in a
 * message before a human sees it; an unsubscribe-on-GET would quietly opt out half a
 * league. The GET renders a page with a button, and the button POSTs.
 */

import { createSecretClient } from "../../server/supabase.js";
import { readToken, prefUpdateFor, kindWords } from "../../server/email/unsubscribe.js";
import { setPrefs } from "../../server/notify.js";

const html = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body,
});

/* Deliberately one small page with inline styles and no script: it is opened in a
 * webview inside a mail client as often as in a browser, and it must work there. */
function page({ heading, message, form = "" }) {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" />" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />" +
    "<title>Pigskin Poker email</title></head>" +
    "<body style=\"margin:0;background:#f4f2ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">" +
    "<div style=\"max-width:460px;margin:48px auto;padding:28px;background:#fff;border:1px solid #ddd8c8;border-radius:10px;\">" +
    "<div style=\"text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:#1d3024;\">" +
    "&#9824; Pigskin Poker &#9830;</div>" +
    "<h1 style=\"font-size:16px;color:#1d3024;margin:22px 0 10px;\">" + heading + "</h1>" +
    "<p style=\"font-size:14px;color:#33403a;line-height:1.5;\">" + message + "</p>" +
    form +
    "</div></body></html>"
  );
}

const confirmForm = (token) =>
  "<form method=\"POST\" action=\"/unsubscribe\">" +
  "<input type=\"hidden\" name=\"t\" value=\"" + token.replace(/"/g, "&quot;") + "\" />" +
  "<button type=\"submit\" style=\"display:inline-block;background:#d9b64c;color:#1d3024;font-weight:bold;" +
  "font-size:15px;border:0;padding:12px 28px;border-radius:8px;cursor:pointer;\">Stop These Emails</button>" +
  "</form>";

/** The token arrives in the query string on a GET, and in a form body on a POST. */
function tokenFrom(event) {
  const fromQuery = event.queryStringParameters?.t;
  if (fromQuery) return fromQuery;
  const body = event.body || "";
  if (!body) return "";
  try {
    /* One-click posts `List-Unsubscribe=One-Click` and nothing else, so the token has to
     * survive in the URL for that case; our own form posts it in the body. */
    const params = new URLSearchParams(
      event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body
    );
    return params.get("t") || "";
  } catch {
    return "";
  }
}

export async function handler(event) {
  const method = event.httpMethod;
  if (method !== "GET" && method !== "POST") {
    return html(405, page({ heading: "Not here", message: "Use the link in the email." }));
  }

  const token = tokenFrom(event);
  const read = readToken(token);
  if (!read.ok) {
    /* Says what went wrong, because the most likely cause is a link broken in half by a
     * mail client rather than anything sinister. */
    return html(
      400,
      page({
        heading: "That link did not work",
        message:
          "We could not read it (" + read.why + "). Try opening the whole link from the email, " +
          "or sign in and turn these emails off on your account.",
      })
    );
  }

  if (method === "GET") {
    return html(
      200,
      page({
        heading: "Stop " + kindWords(read.kind) + "?",
        message: "Nothing has changed yet. Press the button and these emails stop.",
        form: confirmForm(token),
      })
    );
  }

  let db;
  try {
    db = createSecretClient();
  } catch (e) {
    console.error("[unsubscribe] not configured:", e.message);
    return html(500, page({ heading: "Something went wrong", message: "Try again in a minute." }));
  }

  const saved = await setPrefs(db, read.userId, prefUpdateFor(read.kind));
  if (saved.error) {
    console.error("[unsubscribe] failed for", read.userId, "-", saved.error);
    return html(500, page({ heading: "Something went wrong", message: "Try again in a minute." }));
  }

  console.log("[unsubscribe] off:", read.kind, "for", read.userId);
  return html(
    200,
    page({
      heading: "Done",
      message:
        "You will not get " + kindWords(read.kind) + " any more. Your team is untouched - " +
        "the week still runs, and you can turn these back on from your account whenever you like.",
    })
  );
}
