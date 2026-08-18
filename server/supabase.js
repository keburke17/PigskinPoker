/* Secret-key Supabase client. Server-side only.
 *
 * The secret key BYPASSES RLS, which is precisely why it never leaves the server: it
 * lives in Netlify's environment variables and a git-ignored .env.local, and is read
 * from the environment here and nowhere else.
 *
 * RLS remains the backstop. This client is trusted to enforce the commissioner/manager
 * rules in code (server/operations.js); RLS is what stops a browser holding the
 * publishable key from routing around those checks entirely.
 */

import { createClient } from "@supabase/supabase-js";

export function createSecretClient(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  if (key.startsWith("sb_publishable_")) {
    // Cheap guard against a very expensive mistake.
    throw new Error("SUPABASE_SECRET_KEY holds a PUBLISHABLE key - privileged writes would fail");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
