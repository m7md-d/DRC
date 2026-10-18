import { useMemo, useState } from "react";
import { humanBytes } from "./data";
import { useAnimatedCount } from "./useAnimatedCount";
import {
  plotIndices,
  plotNumber,
  plotSegments,
  type PlotPoint,
} from "./chartMath";

const width = 640,
  height = 218,
  left = 68,
  right = 20,
  top = 14,
  bottom = 36;
export function metricLabel(
  value: string,
  unit: "bytes" | "bytes/s" | "ms" | "count",
) {
  return unit.startsWith("bytes")
    ? `${humanBytes(value)}${unit === "bytes/s" ? "/s" : ""}`
    : `${value}${unit === "ms" ? " ms" : ""}`;
}
function AnimatedMetric({
  value,
  unit,
  duration,
  live,
  epoch,
}: {
  value: string;
  unit: Parameters<typeof metricLabel>[1];
  duration: number;
  live: boolean;
  epoch: string;
}) {
  const shown = useAnimatedCount(value, duration, live, epoch, false);
  return (
    <strong
      data-hint={`Latest recorded value: ${value} ${unit}. Display movement stays between received samples.`}
    >
      {metricLabel(shown, unit)}
    </strong>
  );
}
export function Plot({
  title,
  description,
  points,
  series,
  unit,
  xLabel,
  xFormat = (s) => `${s}s`,
  markersOnly = false,
  onSelect,
  live = false,
  intervalMs = 0,
}: {
  title: string;
  description: string;
  points: PlotPoint[];
  series: { label: string; color: string }[];
  unit: "bytes" | "bytes/s" | "ms" | "count";
  xLabel: string;
  xFormat?: (value: string) => string;
  markersOnly?: boolean;
  onSelect?: (index: number) => void;
  live?: boolean;
  intervalMs?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const index = Math.min(selected ?? points.length - 1, points.length - 1);
  const active = points[index];
  const following = live && selected === null;
  const transition =
    following && intervalMs > 0 ? `transform ${intervalMs}ms linear` : "none";
  const geometry = useMemo(() => {
    const xs = points.map((p) => plotNumber(p.x) ?? 0);
    const minX = xs.reduce((a, b) => Math.min(a, b), Infinity),
      maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
    let maxY = 0;
    for (const p of points)
      for (const v of p.values) maxY = Math.max(maxY, plotNumber(v) ?? 0);
    const x = (i: number) =>
      left +
      (maxX === minX ? 0.5 : (xs[i] - minX) / (maxX - minX)) *
        (width - left - right);
    const y = (v: number) =>
      top + (1 - v / (maxY || 1)) * (height - top - bottom);
    return { x, y, maxY, indices: plotIndices(points), minX, maxX };
  }, [points]);
  if (!points.length)
    return (
      <section className="plot-card">
        <h4>{title}</h4>
        <p className="plot-empty">No recorded samples for this measurement.</p>
      </section>
    );
  const choose = (next: number) =>
    setSelected(Math.max(0, Math.min(points.length - 1, next)));
  return (
    <section className="plot-card">
      <div className="plot-heading">
        <h4>{title}</h4>
        <span>{points.length} recorded samples</span>
      </div>
      <p className="source-label">{description}</p>
      <div className="plot-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="plot"
        role="slider"
        tabIndex={0}
        aria-label={`${title} · use arrow keys to inspect recorded samples`}
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={index + 1}
        aria-valuetext={`${active.label}; ${series.map((s, i) => `${s.label}: ${active.values[i] ?? "not reported"} ${unit}`).join("; ")}`}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            choose(
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? points.length - 1
                  : index + (e.key === "ArrowRight" ? 1 : -1),
            );
          }
        }}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * width;
          let nearest = 0;
          for (let i = 1; i < points.length; i++)
            if (
              Math.abs(geometry.x(i) - px) < Math.abs(geometry.x(nearest) - px)
            )
              nearest = i;
          choose(nearest);
        }}
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = geometry.y((geometry.maxY || 1) * ratio);
          return (
            <g key={ratio} className="plot-grid">
              <line x1={left} x2={width - right} y1={y} y2={y} />
              <text x={left - 9} y={y + 3} textAnchor="end">
                {metricLabel(
                  String(Math.round((geometry.maxY || 1) * ratio)),
                  unit,
                )}
              </text>
            </g>
          );
        })}
        {series.map((s, si) => (
          <g key={s.label} stroke={s.color} fill={s.color}>
            {!markersOnly &&
              plotSegments(points, geometry.indices, si).map((segment, i) => (
                <path
                  key={i}
                  d={segment
                    .map(
                      (n, j) =>
                        `${j ? "L" : "M"}${geometry.x(n)},${geometry.y(plotNumber(points[n].values[si])!)}`,
                    )
                    .join(" ")}
                  fill="none"
                  strokeWidth="1.7"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {geometry.indices
              .filter((n) => plotNumber(points[n].values[si]) !== null)
              .map((n) => (
                <circle
                  key={n}
                  cx={geometry.x(n)}
                  cy={geometry.y(plotNumber(points[n].values[si])!)}
                  r={markersOnly ? 3 : points.length < 50 ? 2 : 0.6}
                  stroke="none"
                />
              ))}
          </g>
        ))}
        <g
          className="plot-live-cursor"
          style={{
            transform: `translateX(${geometry.x(index)}px)`,
            transition,
          }}
        >
          <line
            className="plot-crosshair"
            x1={0}
            x2={0}
            y1={top}
            y2={height - bottom}
          />
        </g>
        {series.map(
          (s, si) =>
            active.values[si] !== null && (
              <circle
                key={s.label}
                className="plot-live-cursor"
                style={{
                  transform: `translate(${geometry.x(index)}px, ${geometry.y(plotNumber(active.values[si])!)}px)`,
                  transition,
                }}
                r={4}
                fill="var(--panel)"
                stroke={s.color}
                strokeWidth="2"
              />
            ),
        )}
        <g className="plot-axis">
          <text x={left} y={height - 14}>
            {xFormat(points[0].x)}
          </text>
          <text x={width - right} y={height - 14} textAnchor="end">
            {xFormat(points.at(-1)!.x)}
          </text>
          <text
            x={(left + width - right) / 2}
            y={height - 1}
            textAnchor="middle"
          >
            {xLabel}
          </text>
        </g>
      </svg>
      <div className="plot-readout">
        <span>{active.label}</span>
        <span>
          Sample {index + 1} / {points.length}
        </span>
      </div>
      <dl className="plot-values">
        {series.map((s, si) => (
          <div key={s.label}>
            <dt>
              <i style={{ background: s.color }} />
              {s.label}
            </dt>
            <dd>
              {active.values[si] === null ? (
                "Not reported"
              ) : (
                <>
                  <AnimatedMetric
                    value={active.values[si]}
                    unit={unit}
                    duration={intervalMs}
                    live={following}
                    epoch={title}
                  />
                  <code>
                    {active.values[si]} {unit}
                  </code>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="plot-controls">
        <button
          className="button subtle"
          disabled={index <= 0}
          onClick={() => choose(index - 1)}
        >
          ← Previous
        </button>
        <button className="button subtle" onClick={() => setSelected(null)}>
          Latest
        </button>
        <button
          className="button subtle"
          disabled={index >= points.length - 1}
          onClick={() => choose(index + 1)}
        >
          Next →
        </button>
        {onSelect && (
          <button className="button" onClick={() => onSelect(index)}>
            View original command
          </button>
        )}
      </div>
      {geometry.indices.length < points.length && (
        <p className="source-label">
          Drawing uses {geometry.indices.length} points retaining extrema and
          gaps. All {points.length} samples remain inspectable above and in the
          original log.
        </p>
      )}
    </section>
  );
}
