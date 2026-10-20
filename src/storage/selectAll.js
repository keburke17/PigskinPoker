/* Every row a query matches, however many there are.
 *
 * PostgREST hands back at most `max_rows` rows per request - 1000, both hosted and in
 * supabase/config.toml - and says nothing when it stops there: the rest are simply not in
 * the reply. A league outgrows that quietly. `player_week_lines` is ~224 players x every
 * week played, so by week 6 a league had ~1300 and the bench and free-agent numbers went
 * missing for whichever fifth of the pool the database happened to put last (Bijan
 * Robinson with no points and no average, CeeDee Lamb with points and no average -
 * reported by Scott, 2026-10-19). `roster_slots` crosses the same line mid-season in a
 * 10-team league, and a save diffs against what was read.
 *
 * So the league load reads every table through this, a page at a time.
 *
 * `build` makes a FRESH query each call - a supabase-js builder is spent once awaited.
 * It must be ORDERED on something unique, or a row can land on two pages, or none, when
 * the heap order shifts between requests. A short page is the last one, which is only
 * true while PAGE is no bigger than the server's max_rows: lower that cap and this must
 * come down with it.
 *
 * @param {() => object} build  returns an ordered supabase-js select
 * @returns {Promise<{ data: Array|null, error: object|null }>}
 */
export const PAGE = 1000;

export async function selectAll(build) {
  const data = [];
  for (let from = 0; ; from += PAGE) {
    const page = await build().range(from, from + PAGE - 1);
    if (page.error) return { data: null, error: page.error };
    const rows = page.data ?? [];
    data.push(...rows);
    if (rows.length < PAGE) return { data, error: null };
  }
}
