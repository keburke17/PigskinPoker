/* Is this URL the local Supabase stack?
 *
 * Lives here rather than in scripts/ because two very different things need the same
 * answer, and they must not drift: the development scripts refuse to seed known-password
 * accounts into anything but a local database, and server/feed/index.js refuses to serve
 * the recorded fixture to anything but a local database. Both are guarding the same
 * mistake - a .env.local still pointing at the hosted project - and both key off the
 * host rather than off anyone remembering which terminal they are in.
 */
export function isLocalUrl(url) {
  try {
    const h = new URL(String(url)).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "0.0.0.0";
  } catch {
    return false;
  }
}
