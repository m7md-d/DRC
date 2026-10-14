import { humanBytes } from "./data";
import type { Json } from "./types";

export function ByteValue({ value, className = "" }: { value: Json | undefined; className?: string }) {
  const exact = typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (exact === null || !/^\d+$/.test(exact)) return <span className={className}>{value == null ? "Not reported" : String(value)}</span>;
  return <span className={`byte-value ${className}`} tabIndex={0} data-hint={`${exact} bytes exactly · decimal units (1 GB = 1,000,000,000 bytes)`} aria-label={`${humanBytes(exact)}, ${exact} bytes exactly`}>{humanBytes(exact)}</span>;
}

const byteFields = new Set(["size", "totalsize", "disksize", "volumesize", "sizebytes", "sourceSize".toLowerCase(), "freebytes", "writtenbytes", "maximumbytes", "rescuedbytes", "nontriedbytes", "nontrimmedbytes", "nonscrapedbytes", "badsectorbytes", "finishedbytes", "bytes", "deviceblocksize", "physicalblocksize", "log-sec", "phy-sec"]);
export function isByteField(path: string, value: Json): boolean {
  const leaf = path.match(/(?:^|\.)([^.[\]]+)$/)?.[1] ?? path.match(/\["([^"\\]+)"\]$/)?.[1];
  return !!leaf && byteFields.has(leaf.toLowerCase()) && typeof value === "string" && /^\d+$/.test(value);
}
