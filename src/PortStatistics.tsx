import { displayValue, getField } from "./data";
import { driverStateDurations } from "./portTopology";
import type { Json } from "./types";
export function PortStatistics({ fields }: { fields: Json }) {
  const stats = getField(fields, "port-statistics");
  const counters = [
    ["Connections", "kPortStatConnectCount"],
    ["Address failures", "kPortStatAddressFailureCount"],
    ["Enumeration failures", "kPortStatEnumerationFailureCount"],
    ["Over-current events", "kPortStatOverCurrentCount"],
    ["Remote wakes", "kPortStatRemoteWakeCount"],
  ].filter(([, key]) => getField(stats, key) !== undefined);
  const states = driverStateDurations(fields);
  const total = states?.reduce((n, s) => n + BigInt(s.milliseconds), 0n) ?? 0n;
  if (!counters.length && !states) return null;
  return (
    <section className="port-statistics">
      <h4 data-hint="Original host-port counters. The driver's counting period is not specified here, and these counts are not assigned to the selected SSD.">
        Host-port statistics
      </h4>
      <div className="port-counter-grid">
        {counters.map(([label, key]) => (
          <article
            key={key}
            data-hint={`${key} · original host-port counter. This is not a diagnosis of the attached disk.`}
          >
            <span>{label}</span>
            <strong>{displayValue(getField(stats, key))}</strong>
          </article>
        ))}
      </div>
      {states && total > 0n && (
        <div className="port-state-chart">
          <h4>Reported time in driver states</h4>
          <div
            role="img"
            aria-label="Proportions of the reported durations in host-port driver states"
          >
            {states.map((state) => {
              const percent =
                Number((BigInt(state.milliseconds) * 10000n) / total) / 100;
              const hundredths = (BigInt(state.milliseconds) * 100n) / 3600000n;
              return (
                <div
                  className="port-state-row"
                  key={state.key}
                  tabIndex={0}
                  data-hint={`${state.key}: ${state.original} · exact duration ${state.milliseconds} ms. Bar length is derived from the sum of reported states.`}
                >
                  <span>{state.key.replace(/^kPowerState/, "")}</span>
                  <div>
                    <i style={{ width: `${percent}%` }} />
                  </div>
                  <code>
                    {hundredths / 100n}.
                    {String(hundredths % 100n).padStart(2, "0")} h
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="source-label">
        Driver-reported counters and durations. Their observation period is not
        specified here; they do not measure power delivered to an SSD.
      </p>
    </section>
  );
}
