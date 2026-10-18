import { useEffect, useRef, useState } from "react";
import { interpolatedCount } from "./acquisitionTiming";

export function useAnimatedCount(
  value: string,
  duration: number,
  enabled: boolean,
  epoch: string,
  resetOnDecrease = true,
) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  const previousEpoch = useRef(epoch);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const start = performance.now(),
      from = current.current;
    const snap = () => {
      cancelAnimationFrame(frame);
      current.current = value;
      setShown(value);
    };
    if (
      !enabled ||
      duration <= 0 ||
      reduced.matches ||
      document.hidden ||
      previousEpoch.current !== epoch ||
      (resetOnDecrease && BigInt(value) < BigInt(from))
    ) {
      previousEpoch.current = epoch;
      snap();
      return;
    }
    const tick = (at: number) => {
      const fraction = Math.min(1, (at - start) / duration);
      current.current = interpolatedCount(from, value, fraction);
      setShown(current.current);
      if (fraction < 1) frame = requestAnimationFrame(tick);
    };
    const motion = () => {
      if (reduced.matches) snap();
    };
    const visibility = () => {
      if (document.hidden) snap();
    };
    reduced.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [value, duration, enabled, epoch, resetOnDecrease]);
  return shown;
}
