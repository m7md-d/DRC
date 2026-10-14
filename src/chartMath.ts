export interface PlotPoint {
  x: string;
  values: (string | null)[];
  label: string;
  breakBefore?: boolean;
}

// Floating point is confined to SVG geometry. Readouts/export use source strings.
export function plotNumber(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function observedGrowth(
  previous: { elapsedMs: string; rescuedBytes: string } | undefined,
  current: { elapsedMs: string; rescuedBytes: string },
) {
  if (
    !previous ||
    ![
      previous.elapsedMs,
      previous.rescuedBytes,
      current.elapsedMs,
      current.rescuedBytes,
    ].every((n) => /^\d+$/.test(n))
  )
    return null;
  const interval = BigInt(current.elapsedMs) - BigInt(previous.elapsedMs);
  const delta = BigInt(current.rescuedBytes) - BigInt(previous.rescuedBytes);
  // Do not bridge missing observations or turn counter reversal into a speed.
  if (interval <= 0n || interval > 2500n || delta < 0n) return null;
  return {
    rate: String((delta * 1000n) / interval),
    delta: String(delta),
    interval: String(interval),
  };
}

/** Preserve extrema and discontinuities when drawing long series. Never mutate samples. */
export function plotIndices(points: PlotPoint[], buckets = 240): number[] {
  if (points.length <= buckets * 2) return points.map((_, i) => i);
  const chosen = new Set<number>([0, points.length - 1]);
  const stride = Math.ceil(points.length / buckets);
  for (let start = 0; start < points.length; start += stride) {
    const end = Math.min(start + stride, points.length);
    chosen.add(start);
    chosen.add(end - 1);
    for (let series = 0; series < points[0].values.length; series++) {
      let min = start,
        max = start;
      for (let i = start; i < end; i++) {
        const value = plotNumber(points[i].values[series]);
        if (value === null || points[i].breakBefore) {
          chosen.add(i);
          if (i > 0) chosen.add(i - 1);
          if (i + 1 < points.length) chosen.add(i + 1);
        }
        if (
          value !== null &&
          (plotNumber(points[min].values[series]) === null ||
            value < plotNumber(points[min].values[series])!)
        )
          min = i;
        if (
          value !== null &&
          (plotNumber(points[max].values[series]) === null ||
            value > plotNumber(points[max].values[series])!)
        )
          max = i;
      }
      chosen.add(min);
      chosen.add(max);
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

export function plotSegments(
  points: PlotPoint[],
  indices: number[],
  series: number,
): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (const index of indices) {
    const value = plotNumber(points[index].values[series]);
    if (points[index].breakBefore || value === null) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (value !== null) current.push(index);
  }
  if (current.length) segments.push(current);
  return segments;
}
