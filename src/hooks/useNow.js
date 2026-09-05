/* A clock that re-renders.
 *
 * The lineup lock happens at a moment rather than on a button press: at one o'clock the
 * early games kick off and half a roster stops being changeable. Nothing arrives from
 * the server when that happens - the times were sent hours ago and the verdict is
 * computed from them - so without a tick the swap boxes would stay live until the
 * manager reloaded, and his change would be refused by the server instead.
 *
 * Half a minute is deliberately coarse. It is a lineup deadline, not a stopwatch, and
 * the server is the one that decides: a swap in the last thirty seconds either lands or
 * comes back refused, and either way the screen is right immediately afterwards.
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
