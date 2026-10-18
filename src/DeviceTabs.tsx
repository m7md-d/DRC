import { Icon, type IconName } from "./Icon";
import type { Tab } from "./types";

const sections: {
  key: Tab;
  label: string;
  easy: string;
  icon: IconName;
  hint: string;
}[] = [
  {
    key: "device",
    label: "Device",
    easy: "Overview",
    icon: "drive",
    hint: "Device identity, source access and available actions.",
  },
  {
    key: "partitions",
    label: "Partitions",
    easy: "Disk layout",
    icon: "partitions",
    hint: "Reported partition sizes, filesystems and mount points.",
  },
  {
    key: "smart",
    label: "SMART / NVMe",
    easy: "Disk status",
    icon: "chart",
    hint: "Explicit device information queries, reported status and temperature. No self-test starts here.",
  },
  {
    key: "connection",
    label: "Connection",
    easy: "Connection",
    icon: "link",
    hint: "Reported connection path, hubs, interface states and original host readings.",
  },
  {
    key: "activity",
    label: "Activity",
    easy: "Command history",
    icon: "chart",
    hint: "Session command durations and outcomes. These do not measure disk throughput.",
  },
  {
    key: "tools",
    label: "Tools",
    easy: "Tools",
    icon: "tools",
    hint: "Installed tools, available functions and missing dependencies.",
  },
];

export function DeviceTabs({
  tab,
  select,
  partitions,
  simple,
}: {
  tab: Tab;
  select: (tab: Tab) => void;
  partitions: number;
  simple: boolean;
}) {
  return (
    <nav
      className={`workspace-tabs ${simple ? "simple-device-tabs" : ""}`}
      aria-label="Device details"
    >
      {sections.map((item) => (
        <button
          key={item.key}
          className={tab === item.key ? "active" : ""}
          data-section={item.key}
          aria-pressed={tab === item.key}
          onClick={() => select(item.key)}
          data-hint={item.hint}
        >
          <Icon name={item.icon} />
          {simple ? item.easy : item.label}
          {item.key === "partitions" && (
            <span className="tab-count">{partitions}</span>
          )}
        </button>
      ))}
      {!simple && (
        <div className="tab-end">
          <Icon name="lock" size={12} />
          <span>Write commands unavailable</span>
        </div>
      )}
    </nav>
  );
}
