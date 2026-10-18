import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
const hints: Record<string, string> = {
  Easy: "Inspect disks, create images and browse recovered files.",
  Professional:
    "Shows complete device fields, partitions, tool reports and raw command output.",
  Reference:
    "An offline command guide for macOS and Linux. Examples can be copied; they are never executed here.",
  "Recovery checks":
    "Check device detection, source access and a small sample read.",
  "Run checks":
    "Run the configured checks. Does not format, repair a filesystem or write to the source.",
  Inspect:
    "Read SMART/NVMe information for the selected disk without running a self-test.",
  "Create image…":
    "Choose the source and a separate destination, then review the raw-copy command.",
  "Open image…":
    "Open a raw disk image read-only to inspect partitions and recover files.",
  "Command reference":
    "Search tools, commands and flags for independent terminal use.",
  "Refresh port map":
    "Collect current host USB/Thunderbolt metadata, including the USB registry on macOS. Does not read disk sectors.",
  "Port map":
    "Collects the host's USB and Thunderbolt hierarchy, including hubs and enclosure properties. Does not read disk sectors.",
  "Ports & enclosures":
    "See the reported bus → hub → device hierarchy and each node's original properties.",
  Refresh:
    "Refreshes connected-device metadata. Does not start SMART, a surface scan or imaging.",
  "Read-only policy":
    "Explains source-read-only handles and the limits of operating-system write protection.",
  Sessions:
    "Open or export a saved local case with original readings and command output.",
  "Create disk image":
    "Choose a source and destination, review the command, then copy raw sectors into an image with a persistent mapfile.",
  "Create or resume an image":
    "Create a new raw image or review a saved image/map pair before resuming.",
  "Open an image":
    "Browse an existing image and extract selected files into a new folder without mounting the source.",
  "Browse an image":
    "Inspect partitions and files inside an existing image. The image is opened read-only.",
  "Inspect disk":
    "Request the SMART and NVMe fields supported by this disk and connection. Does not run a self-test.",
  "Read SMART / NVMe":
    "Requests tool-reported SMART/NVMe fields. No automatic diagnosis or self-test.",
  "All readings":
    "Switches to Professional to inspect every original reported field.",
  "All readings and raw fields":
    "Switches to Professional without changing your session or source policy.",
  "Watch connections":
    "Listen for connection events and refresh device metadata. SMART and data reads remain explicit.",
  "Collect report":
    "Read current USB/Thunderbolt host metadata. Enclosure enumeration alone does not prove its SSD is accessible.",
  Connection:
    "Host-reported connection properties, USB power budgets and visual port hierarchy.",
  "Reported capacity":
    "The exact size the device reported, displayed in decimal units. This is not a verification of manufacturer capacity.",
  "Reported capacity distribution":
    "Proportions of reported partition sizes. The remainder does not indicate filesystem free space.",
  "SMART · tool reported":
    "The original tool's status and temperature. DRC does not assign a health score.",
  "Source access":
    "DRC source handles are read-only. System and metadata-only media are excluded from physical imaging.",
  "Advanced copy settings":
    "Set range, sector size, retries, successful-read timeout, rate cap and direction explicitly.",
  "Logical sector size · bytes":
    "Bytes per logical sector, from the source when reported. Changing this affects read alignment.",
  "Retry passes · 0–5":
    "How many ddrescue retry passes to request. More attempts can stress an unstable device.",
  "Time since last successful read · seconds":
    "ddrescue's timeout since a successful read. It cannot interrupt an outstanding blocked kernel request.",
  "Copying phase only":
    "Skips trimming, sweeping and scraping so the initial pass concentrates on previously untried ranges.",
  "Read backwards":
    "Copies the requested range in reverse. This is a user-selected direction, not an automatic rescue strategy.",
  "Input offset · bytes":
    "The first source byte included in this acquisition. Image positions retain the source's offsets.",
  "Length · bytes":
    "Number of source bytes in the requested domain. Leave empty for the remaining reviewed source size.",
  "Maximum read rate · bytes/s":
    "Caps the requested copy rate. Blank means no configured cap.",
  "Prepare and review":
    "Validates source identity, destination backing and capacity, then shows the exact command. Does not start copying.",
  "Command output":
    "Original commands, stdout and stderr. Terminal escape sequences are displayed inertly; original bytes stay saved.",
  "Host evidence":
    "Read Linux PCIe/NVMe-controller observations and kernel messages, even without a block device.",
};
function description(target: HTMLElement): string | null {
  if (target.dataset.hint) return target.dataset.hint;
  const raw = target.getAttribute("aria-label") ?? target.textContent ?? "";
  const label = raw.trim().replace(/\s+/g, " ");
  const known = Object.entries(hints).find(
    ([k]) => k.toLowerCase() === label.toLowerCase(),
  );
  if (known) return known[1];
  if (label.startsWith("Close"))
    return "Close this panel.";
  if (label.startsWith("Copy"))
    return "Copy the displayed text to the clipboard.";
  if (target.matches(".field-table td:first-child"))
    return "Original field path reported by the tool. Unknown properties are retained without interpretation.";

  return null;
}
export function Hints() {
  const [active, setActive] = useState<{
    text: string;
    x: number;
    y: number;
    element: HTMLElement;
  } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let keyboardFocus = false;
    const pointer = () => {
      keyboardFocus = false;
      hide();
    };
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setActive(null);
    };
    const show = (event: Event) => {
      if (event.type === "focusin" && !keyboardFocus) return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              "[data-hint],button,h1,h2,h3,h4,.eyebrow,th,.field-table td:first-child",
            )
          : null;
      if (target === current) return;
      hide();
      if (!target) return;
      const text = description(target);
      if (!text) return;
      current = target;
      const reveal = () => {
        const r = target.getBoundingClientRect();
        setActive({
          text,
          x: Math.min(
            Math.max(12, r.left),
            Math.max(12, window.innerWidth - 332),
          ),
          y: r.bottom + 9,
          element: target,
        });
      };
      if (event.type === "focusin") reveal();
      else timer = setTimeout(reveal, 350);
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", pointer);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) keyboardFocus = true;
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", key);
    return () => {
      hide();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", pointer);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const e = active.element;
    const old = e.getAttribute("aria-describedby");
    e.setAttribute(
      "aria-describedby",
      [old, "drc-hint"].filter(Boolean).join(" "),
    );
    return () => {
      if (old) e.setAttribute("aria-describedby", old);
      else e.removeAttribute("aria-describedby");
    };
  }, [active]);
  return active
    ? createPortal(
        <div
          id="drc-hint"
          role="tooltip"
          className="hint-bubble"
          style={{
            left: active.x,
            top: Math.min(active.y, window.innerHeight - 112),
          }}
        >
          {active.text}
        </div>,
        document.body,
      )
    : null;
}
