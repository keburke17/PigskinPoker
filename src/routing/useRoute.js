/* The React binding for src/routing/index.js - deliberately the only React in there.
 * Keeping the parsing pure means it is testable without a DOM or a renderer, which is
 * where all the actual logic lives. */

import { useEffect, useState } from "react";
import { currentRoute, navigate, onRouteChange } from "./index.js";

export function useRoute() {
  const [route, setRoute] = useState(() => currentRoute());
  useEffect(() => onRouteChange(setRoute), []);
  return [route, navigate];
}
