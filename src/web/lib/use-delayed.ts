import { useEffect, useReducer, useState } from "react";

/** True once `flag` has been true for `delayMs`; false at once when it turns false. */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [late, setLate] = useState(false);
  if (!flag && late) setLate(false);
  useEffect(() => {
    if (!flag) return;
    const timer = window.setTimeout(() => setLate(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && late;
}

/** Re-renders every `intervalMs`, for relative times ("seit 14:03 Uhr" across midnight). */
export function useTick(intervalMs: number): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}
