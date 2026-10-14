import { useState } from "react";
import { bridge } from "./bridge";
import { Select } from "./Select";
import type { ArtifactPage } from "./types";

export function hexPage(page: ArtifactPage): string {
  const bytes = Uint8Array.from(atob(page.bytesBase64), (c) => c.charCodeAt(0));
  const offset = BigInt(page.offset);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16);
    const hex = Array.from(row, (n) => n.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47);
    const ascii = Array.from(row, (n) =>
      n >= 32 && n <= 126 ? String.fromCharCode(n) : ".",
    ).join("");
    lines.push(
      `${(offset + BigInt(i)).toString(16).padStart(16, "0")}  ${hex}  |${ascii}|`,
    );
  }
  return lines.join("\n");
}
export function ArtifactPreview({
  id,
  index,
  disabled,
}: {
  id: string;
  index: number;
  disabled: boolean;
}) {
  const [offset, setOffset] = useState("0");
  const [page, setPage] = useState<ArtifactPage | null>(null);
  const [size, setSize] = useState("256");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function load(value = offset) {
    setLoading(true);
    setError(null);
    try {
      const result = await bridge.extractionBytes(
        id,
        index,
        value,
        Number(size),
      );
      setPage(result);
      setOffset(result.offset);
    } catch (e) {
      setError(String(e));
      setPage(null);
    } finally {
      setLoading(false);
    }
  }
  const blocked = disabled || loading;
  return (
    <details className="measurement-source artifact-preview">
      <summary>Read original stdout bytes · hex / ASCII</summary>
      <p className="source-label">
        Reads only the recorded destination file after its identity is checked.
        Offsets on the left are hexadecimal; input offsets are decimal.
      </p>
      <div className="artifact-controls">
        <label className="form-field">
          Byte offset · decimal
          <input
            value={offset}
            inputMode="numeric"
            onChange={(e) => setOffset(e.target.value)}
            disabled={blocked}
          />
        </label>
        <div className="form-field">
          <span>Page size · bytes</span>
          <Select
            label="Artifact page size"
            value={size}
            options={["256", "4096"].map((value) => ({ value, label: value }))}
            onChange={setSize}
            disabled={blocked}
          />
        </div>
        <button
          className="button"
          disabled={blocked}
          onClick={() => void load()}
        >
          Read bytes
        </button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {page && (
        <>
          <p className="source-label">
            Offset {page.offset} · {atob(page.bytesBase64).length} returned
            bytes · total {page.totalBytes} bytes
          </p>
          <pre className="image-tool-output byte-output" tabIndex={0}>
            {hexPage(page) || "End of output · no bytes in this page."}
          </pre>
          <div className="panel-actions">
            <button
              className="button subtle"
              disabled={blocked || BigInt(page.offset) === 0n}
              onClick={() =>
                void load(
                  (BigInt(page.offset) > BigInt(size)
                    ? BigInt(page.offset) - BigInt(size)
                    : 0n
                  ).toString(),
                )
              }
            >
              Previous page
            </button>
            <button
              className="button subtle"
              disabled={
                blocked ||
                BigInt(page.offset) + BigInt(atob(page.bytesBase64).length) >=
                  BigInt(page.totalBytes)
              }
              onClick={() =>
                void load(
                  (
                    BigInt(page.offset) + BigInt(atob(page.bytesBase64).length)
                  ).toString(),
                )
              }
            >
              Next page
            </button>
            <button
              className="button subtle"
              onClick={() =>
                void navigator.clipboard
                  .writeText(page.bytesBase64)
                  .catch((e) => setError(String(e)))
              }
            >
              Copy this page · base64
            </button>
          </div>
        </>
      )}
    </details>
  );
}
