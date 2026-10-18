import { invoke } from "@tauri-apps/api/core";
import { native } from "./bridge";

// Opt-in documentation driver. It uses the same visible controls and backend
// checks as a user, reads only a generated image, and never starts disk operations.
export async function captureReadme() {
  if (!native) return;
  let enabled = false;
  let preferences: [string, string | null][] = [];
  const restorePreferences = () => {
    for (const [key, value] of preferences) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  };
  try {
    const context = await invoke<{ image: string } | null>(
      "readme_capture_context",
    );
    if (!context) return;
    enabled = true;
    preferences = [
      "drc.experience",
      "drc.referenceOS",
      "drc.referenceFamily",
    ].map((key) => [key, localStorage.getItem(key)]);
    const wait = async <T>(
      find: () => T | undefined | null | false,
      label: string,
    ): Promise<T> => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const value = find();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const buttons = () => [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ];
    const button = (label: string) =>
      buttons().find(
        (b) =>
          !b.disabled &&
          b.getClientRects().length > 0 &&
          !b.closest("[hidden]") &&
          (b.getAttribute("aria-label") === label ||
            b.textContent?.trim() === label),
      );
    const press = async (label: string) =>
      (await wait(() => button(label), label)).click();
    const mode = async (name: "Easy" | "Professional") => {
      await press(name);
      await wait(
        () => document.querySelector(`.experience-${name.toLowerCase()}`),
        `${name} layout`,
      );
    };
    const fill = async (
      field: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) => {
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const settle = async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    const snapshot = async (name: string) => {
      await settle();
      const header = document
        .querySelector(".app-header")!
        .getBoundingClientRect();
      const bar = document
        .querySelector(".workspace-bar")!
        .getBoundingClientRect();
      const breadcrumb = document
        .querySelector(".breadcrumb")!
        .getBoundingClientRect();
      if (
        Math.abs(header.bottom - 48) > 1 ||
        Math.abs(bar.top - header.bottom) > 1 ||
        breadcrumb.top < bar.top - 1 ||
        breadcrumb.bottom > bar.bottom + 1
      )
        throw new Error(
          `Workspace navigation is clipped in ${name}: ${JSON.stringify({ header: header.toJSON(), bar: bar.toJSON(), breadcrumb: breadcrumb.toJSON() })}`,
        );
      await invoke("readme_capture_frame", { name });
    };
    const presentation = await invoke<{ controlsSide: string }>(
      "window_presentation",
    );
    await wait(
      () =>
        document.querySelector(
          `.app-header.controls-${presentation.controlsSide}`,
        ),
      `native toolbar side (${JSON.stringify(presentation)})`,
    );
    await mode("Easy");
    await wait(
      () =>
        button("Refresh devices") &&
        document.querySelector(".overview-readings"),
      "device overview",
    );
    // All mode changes below use visible controls. No physical reads, resets,
    // acquisition preparation or SMART queries are part of these checks.
    await press("Storage workspace");
    await wait(
      () => document.querySelector(".storage-overview"),
      "storage workspace",
    );
    if (document.activeElement?.classList.contains("panel-back"))
      throw new Error("Pointer navigation focused the back action.");
    const workspacePane = document.querySelector(".storage-overview");
    await mode("Professional");
    if (document.querySelector(".storage-overview") !== workspacePane)
      throw new Error("Mode change replaced the current workspace.");
    await mode("Easy");
    const diskLink = document.querySelector<HTMLButtonElement>(
      'section[aria-labelledby="storage-disks-heading"] .storage-device-row',
    );
    if (diskLink) {
      diskLink.click();
      await wait(
        () => document.querySelector(".easy-workspace"),
        "easy disk layout",
      );
      await mode("Professional");
      await wait(
        () => document.querySelector(".workspace-content"),
        "professional disk readings",
      );
      if (document.querySelector(".easy-workspace"))
        throw new Error("Professional mode retained the Easy disk layout.");
      await mode("Easy");
      await wait(
        () => document.querySelector(".easy-workspace"),
        "disk mode toggle restores Easy",
      );
      await press("All readings");
      await wait(
        () => document.querySelector(".overview-original-fields:not([hidden])"),
        "original fields inside the Easy overview",
      );
      await press("All readings");
      for (const section of [
        "partitions",
        "smart",
        "connection",
        "activity",
        "tools",
      ]) {
        document
          .querySelector<HTMLButtonElement>(
            `.workspace-tabs [data-section="${section}"]`,
          )!
          .click();
        await wait(
          () =>
            document.querySelector(
              `.workspace-tabs [data-section="${section}"][aria-pressed="true"]`,
            ),
          section,
        );
        const page = document.querySelector(".workspace-content");
        await mode("Professional");
        await mode("Easy");
        if (
          document.querySelector(".workspace-content") !== page ||
          !document.querySelector(
            `.workspace-tabs [data-section="${section}"][aria-pressed="true"]`,
          )
        )
          throw new Error(
            `Changing mode replaced or left the ${section} page.`,
          );
      }
      document
        .querySelector<HTMLButtonElement>(
          '.workspace-tabs [data-section="device"]',
        )!
        .click();
      await wait(
        () => document.querySelector(".easy-workspace"),
        "Easy disk overview",
      );
      const path = buttons().find((b) =>
        /^\/dev\//.test(b.textContent?.trim() ?? ""),
      );
      if (!path) throw new Error("Selected disk navigation is missing.");
      path.click();
      await wait(
        () => document.querySelector(".easy-workspace"),
        "disk breadcrumb in Easy",
      );
      if (button("Easy")?.getAttribute("aria-pressed") !== "true")
        throw new Error("Disk breadcrumb changed the selected mode.");
    } else await press("Close Storage workspace");
    await press("Create disk image");
    await wait(
      () => document.querySelector(".simple-acquisition"),
      "guided copy form",
    );
    buttons()
      .find(
        (b) =>
          b.closest(".source-choice") &&
          b.textContent?.trim().startsWith("Image file"),
      )!
      .click();
    const input = await wait(
      () =>
        document.querySelector<HTMLInputElement>(
          '.acquisition-form input[placeholder="Absolute path to a regular image file"]',
        ),
      "copy source",
    );
    await fill(input, context.image);
    await press("Continue to save location");
    const destination = document.querySelector<HTMLInputElement>(
      '.acquisition-form input[placeholder="A new DRC acquisition folder will be created here"]',
    )!;
    await fill(destination, "/private/tmp/DRC-review-only");
    const acquisition = document.querySelector(".acquisition-form");
    await mode("Professional");
    const retries = document.querySelector<HTMLInputElement>(
      '.acquisition-form input[type="number"][max="5"]',
    )!;
    await fill(retries, "2");
    await mode("Easy");
    if (
      !document
        .querySelector(".copy-settings-summary")
        ?.textContent?.includes("2 retry passes")
    )
      throw new Error(
        "Easy copy summary reports defaults instead of the entered settings.",
      );
    if (
      document.querySelector(".acquisition-form") !== acquisition ||
      input.value !== context.image ||
      destination.value !== "/private/tmp/DRC-review-only" ||
      !button("Change source")
    )
      throw new Error("Mode change lost copy fields or guided-step position.");
    await press("Close Create a disk image");
    await press("Saved sessions");
    await press("Import pasted session JSON");
    const pasted = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Session JSON to import"]',
    )!;
    await fill(pasted, '{"mode-preservation-check":true}');
    const sessions = document.querySelector(".saved-list");
    await mode("Professional");
    await mode("Easy");
    if (
      pasted.value !== '{"mode-preservation-check":true}' ||
      document.querySelector(".saved-list") !== sessions
    )
      throw new Error(
        "Mode change lost the session import or saved-list state.",
      );
    await press("Close Saved sessions");
    const dock = document.querySelector<HTMLElement>(".terminal-dock")!;
    if (!dock.classList.contains("is-compact"))
      await press("Collapse command output");
    await settle();
    const terminal = dock.querySelector(".xterm");
    const collapsedHeight = dock.getBoundingClientRect().height;
    const heights: number[] = [];
    dock.querySelector<HTMLButtonElement>('[data-stream="commands"]')!.click();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        heights.push(dock.getBoundingClientRect().height);
        if (performance.now() - start < 300) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    const expandedHeight = dock.getBoundingClientRect().height;
    if (expandedHeight <= collapsedHeight + 40)
      throw new Error("Command-output label did not expand the dock.");
    if (
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !heights.some(
        (height) => height > collapsedHeight + 1 && height < expandedHeight - 1,
      )
    )
      throw new Error(
        "Output dock opened without intermediate animation frames.",
      );
    dock.querySelector<HTMLButtonElement>('[data-stream="events"]')!.click();
    await wait(
      () => dock.querySelector('[data-stream="events"][aria-expanded="true"]'),
      "connection events",
    );
    await press("Collapse command output");
    await settle();
    dock.querySelector<HTMLButtonElement>('[data-stream="events"]')!.click();
    await wait(
      () => !dock.classList.contains("is-compact"),
      "connection-events label expansion",
    );
    await settle();
    if (dock.querySelector(".xterm") !== terminal)
      throw new Error("Opening the output dock recreated the terminal.");
    await press("Collapse command output");
    await wait(
      () => dock.classList.contains("is-compact"),
      "closed output dock",
    );
    dock.querySelector<HTMLButtonElement>('[data-stream="commands"]')!.click();
    await wait(
      () =>
        dock.querySelector('[data-stream="commands"][aria-expanded="true"]'),
      "command stream restored",
    );
    await press("Collapse command output");
    await snapshot("overview");
    // Stop metadata watching through its normal control before reading the
    // generated image, so a refresh cannot disable controls mid-capture.
    document
      .querySelector<HTMLButtonElement>('[role="switch"][aria-checked="true"]')
      ?.click();
    await wait(() => button("Refresh devices"), "metadata refresh to finish");
    await press("Browse disk image");
    const field = await wait(
      () => document.querySelector<HTMLInputElement>("#image-source-path"),
      "source-image field",
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, context.image);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await press("Open image");
    await press("Browse files");
    await wait(
      () =>
        document
          .querySelector(".image-results")
          ?.textContent?.includes("HELLO.TXT") ||
        [...document.querySelectorAll("td")].some(
          (td) => td.textContent === "HELLO.TXT",
        ),
      "generated image file list",
    );
    await wait(() => button("Browse files"), "image query to finish");
    const browser = document.querySelector(".file-browser");
    const chosen = [
      ...document.querySelectorAll<HTMLInputElement>(".entry-checkbox"),
    ].find((input) => input.closest("tr")?.textContent?.includes("HELLO.TXT"))!;
    chosen.click();
    const filter = document.querySelector<HTMLInputElement>(
      'input[aria-label="Find a listed file"]',
    )!;
    await fill(filter, "HELLO");
    await mode("Professional");
    await mode("Easy");
    if (
      document.querySelector(".file-browser") !== browser ||
      !chosen.checked ||
      filter.value !== "HELLO" ||
      field.value !== context.image
    )
      throw new Error(
        "Mode change lost the opened image, selected entries or file filter.",
      );
    chosen.click();
    await fill(filter, "");
    await snapshot("image-files");
    await press("Close Browse disk image");
    await press("Command reference");
    await press("Linux");
    await wait(
      () => document.querySelector(".reference-code"),
      "reference commands",
    );
    const referenceSearch = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search command reference"]',
    )!;
    await fill(referenceSearch, "ddrescue");
    const reference = document.querySelector(".reference-layout");
    await mode("Professional");
    await mode("Easy");
    if (
      document.querySelector(".reference-layout") !== reference ||
      referenceSearch.value !== "ddrescue"
    )
      throw new Error("Mode change lost the reference page or search.");
    await fill(referenceSearch, "");
    await snapshot("command-reference");
    restorePreferences();
    await invoke("readme_capture_finish", { error: null });
  } catch (error) {
    restorePreferences();
    if (enabled)
      await invoke("readme_capture_finish", { error: String(error) });
  }
}
