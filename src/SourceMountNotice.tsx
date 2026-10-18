import { useEffect, useRef } from "react";
import type { MountedAcquisitionSource } from "./types";

export function SourceMountNotice({
  source,
  working,
  proceed,
  cancel,
}: {
  source: MountedAcquisitionSource;
  working: boolean;
  proceed: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section
      className="source-mount-notice"
      ref={ref}
      tabIndex={-1}
      aria-label="Unmount source volumes"
    >
      <h3>Unmount source volumes before copying</h3>
      <p>
        {source.deviceName} · <code>/dev/{source.deviceId}</code>
      </p>
      <ul>
        {source.volumes.map((volume) => (
          <li key={`${volume.deviceId}:${volume.mountPoint}`}>
            <code>{volume.mountPoint}</code>
            <span>
              {volume.deviceId} ·{" "}
              {volume.readOnly ? "Mounted read-only" : "Mounted read/write"}
            </span>
          </li>
        ))}
      </ul>
      <p>
        Close files on these volumes. They will disappear from Finder while the
        disk stays connected.
      </p>
      {source.volumes.some((volume) => !volume.readOnly) && (
        <p>
          macOS may save pending filesystem writes during unmount. This
          preparation step is separate from the read-only copy.
        </p>
      )}
      <p>
        DRC will unmount normally, recheck the source and show the copy review.
        If unmount fails, copying stays stopped.
      </p>
      <div className="panel-actions">
        <button className="button primary" disabled={working} onClick={proceed}>
          {working ? "Preparing source…" : "Unmount source and continue"}
        </button>
        <button className="button" disabled={working} onClick={cancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
