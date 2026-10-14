import { expect, it } from "vitest";
import {
  plotNumber,
  plotIndices,
  plotSegments,
  observedGrowth,
  type PlotPoint,
} from "./chartMath";

it("keeps absent readings distinct from measured zero", () => {
  expect(plotNumber(null)).toBeNull();
  expect(plotNumber("not reported")).toBeNull();
  expect(plotNumber("0")).toBe(0);
  const points: PlotPoint[] = [
    { x: "0", values: ["0"], label: "zero" },
    { x: "1", values: [null], label: "absent" },
    { x: "2", values: ["2"], label: "two" },
    { x: "5", values: ["3"], label: "gap", breakBefore: true },
  ];
  expect(plotSegments(points, plotIndices(points), 0)).toEqual([[0], [2], [3]]);
});

it("derives map growth with exact arithmetic within one observed interval", () => {
  expect(
    observedGrowth(undefined, { elapsedMs: "1000", rescuedBytes: "1" }),
  ).toBeNull();
  expect(
    observedGrowth(
      { elapsedMs: "1000", rescuedBytes: "18446744073709550000" },
      { elapsedMs: "2500", rescuedBytes: "18446744073709551615" },
    ),
  ).toEqual({ rate: "1076", delta: "1615", interval: "1500" });
  expect(
    observedGrowth(
      { elapsedMs: "0", rescuedBytes: "4" },
      { elapsedMs: "1000", rescuedBytes: "4" },
    )?.rate,
  ).toBe("0");
  expect(
    observedGrowth(
      { elapsedMs: "0", rescuedBytes: "4" },
      { elapsedMs: "5000", rescuedBytes: "9" },
    ),
  ).toBeNull();
  expect(
    observedGrowth(
      { elapsedMs: "0", rescuedBytes: "4" },
      { elapsedMs: "1000", rescuedBytes: "3" },
    ),
  ).toBeNull();
});
it("draws extrema and breaks without discarding original samples or rounding readouts", () => {
  const points: PlotPoint[] = Array.from({ length: 3000 }, (_, i) => ({
    x: String(i),
    values: [
      i === 613 ? "18446744073709551615" : "5",
      i === 415 ? "1000000" : "2",
    ],
    label: String(i),
  }));
  points[820].values[0] = null;
  points[1700].breakBefore = true;
  const original = JSON.stringify(points),
    indices = plotIndices(points, 50);
  expect(indices.length).toBeLessThan(500);
  for (const i of [0, 2999, 613, 415, 819, 820, 821, 1699, 1700, 1701])
    expect(indices).toContain(i);
  expect(plotSegments(points, indices, 0).length).toBe(3);
  expect(JSON.stringify(points)).toBe(original);
  expect(points[613].values[0]).toBe("18446744073709551615");
});
