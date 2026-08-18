/* Serves the Netlify Function locally, so `npm run dev` exercises the REAL privileged
 * write path against local Supabase - same handler, same auth, same code that deploys.
 *
 * Without this you would need the Netlify CLI to test writes, and the temptation would
 * be to add a "dev only" bypass in the client. That bypass is exactly how a write path
 * ends up unenforced in production, so there isn't one.
 *
 * The secret key is read from the Vite process environment (.env.local), NOT from
 * import.meta.env, so it never reaches the browser bundle.
 */

import { loadEnv } from "vite";

export function apiPlugin() {
  return {
    name: "pigskin-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
      // Make the non-VITE_ variables visible to the handler, in this process only.
      for (const k of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
        if (env[k] && !process.env[k]) process.env[k] = env[k];
      }

      server.middlewares.use("/api", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end(JSON.stringify({ ok: false, error: "Use POST." }));
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try {
          const { handler } = await server.ssrLoadModule("/netlify/functions/api.mjs");
          const result = await handler({
            httpMethod: "POST",
            body: Buffer.concat(chunks).toString("utf8"),
            headers: req.headers,
          });
          res.statusCode = result.statusCode;
          for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
          res.end(result.body);
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: e?.message || "dev api error" }));
        }
      });
    },
  };
}
