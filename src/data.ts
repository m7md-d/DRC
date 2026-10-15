import type { Json, CommandRecord, Device } from "./types";

export interface Field {
  path: string;
  value: Json;
  type: string;
}

export function flatten(value: Json, path = ""): Field[] {
  if (Array.isArray(value)) {
    if (!value.length) return [{ path: path || "$", value, type: "array" }];
    return value.flatMap((item, index) => flatten(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return [{ path: path || "$", value, type: "object" }];
    return entries.flatMap(([key, item]) => {
      const segment = /^[A-Za-z_$][\w$]*$/.test(key)
        ? path
          ? `.${key}`
          : key
        : `[${JSON.stringify(key)}]`;
      return flatten(item, path + segment);
    });
  }
  return [
    { path: path || "$", value, type: value === null ? "null" : typeof value },
  ];
}

export function displayValue(value: Json | undefined): string {
  if (value === undefined) return "Not reported";
  if (value === null) return "null";
  return typeof value === "string"
    ? value === ""
      ? '""'
      : value
    : JSON.stringify(value);
}

export function getField(
  value: Json | undefined,
  key: string,
): Json | undefined {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value[key]
    : undefined;
}

export function humanBytes(value: string | null | undefined): string {
  if (value == null || !/^\d+$/.test(value)) return "Not reported";
  const amount = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  let divisor = 1n;
  let index = 0;
  while (index < units.length - 1 && amount >= divisor * 1000n) {
    divisor *= 1000n;
    index++;
  }
  if (index === 0) return `${amount} B`;
  const hundredths = (amount * 100n) / divisor;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")} ${units[index]}`;
}

export function timestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function quoteArgument(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export function commandLine(
  record: Pick<CommandRecord, "program" | "arguments">,
): string {
  return [record.program, ...record.arguments].map(quoteArgument).join(" ");
}

export function transcript(record: CommandRecord): string {
  const details = [`$ ${commandLine(record)}`, "", record.stdout];
  if (record.stdin) details.push("\n[stdin supplied]\n", record.stdin);
  if (record.stdoutArtifact) {
    const a = record.stdoutArtifact;
    details.push(
      `[DRC storage record: original stdout is stored in ${a.path}]`,
      `[bytes=${a.bytes} SHA-256=${a.sha256}]`,
    );
  }
  if (record.stderr) details.push("\n[stderr]\n", record.stderr);
  if (record.launchError)
    details.push(`\n[launch error] ${record.launchError}`);
  details.push(
    `\n[process] exit=${record.exitCode ?? "none"} signal=${record.terminationSignal ?? "none"} duration=${record.durationMs}ms timeout=${record.timedOut}`,
  );
  return details.join("\n");
}

/** Only safe display control characters reach xterm; original bytes stay in the record. */
export function terminalText(value: string): string {
  return value
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
      (character) =>
        `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
    )
    .replaceAll("\n", "\r\n");
}

export function smartStatus(code: number | null): string[] {
  if (code === null) return ["No process exit status"];
  if (code === 0) return ["No smartctl exit bits set"];
  const labels = [
    "Bit 0 · command line did not parse",
    "Bit 1 · device open / identify / low-power condition",
    "Bit 2 · SMART command or checksum error",
    "Bit 3 · device reported a failing SMART status",
    "Bit 4 · prefailure attribute at/below threshold",
    "Bit 5 · attribute previously at/below threshold",
    "Bit 6 · device error log contains records",
    "Bit 7 · device self-test log contains errors",
  ];
  return labels.filter((_, bit) => (code & (1 << bit)) !== 0);
}

export function canAcquireDevice(device: Device | undefined): device is Device {
  if (!device || device.metadataOnly || device.infoError) return false;
  if (getField(device.info,"kname") !== undefined) return getField(getField(device.info,"drcObservation"),"systemBacking") === false;
  return device.internal === false;
}
