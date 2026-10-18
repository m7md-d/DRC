import { describe, expect, it } from "vitest";
import {
  normalizeLinuxFamily,
  packageFamilies,
  referenceCommands,
  searchReference,
} from "./commandReference";
describe("offline command reference", () => {
  it("keeps OS-specific enumeration, install and raw-source examples distinct", () => {
    const mac = referenceCommands("macos", "debian");
    const linux = referenceCommands("linux", "debian");
    expect(mac.find((c) => c.id === "list")!.command).toContain("diskutil");
    expect(linux.find((c) => c.id === "list")!.command).toContain(
      "lsblk --json --bytes",
    );
    expect(linux.find((c) => c.id === "install")!.command).toContain(
      "gddrescue",
    );
    expect(mac.find((c) => c.id === "install")!.command).toContain(
      "brew install",
    );
    expect(linux.find((c) => c.id === "copy")!.command).toContain(
      "ddrescue --no-trim",
    );
  });
  it("searches flags and retains write-effect classification", () => {
    const commands = referenceCommands("linux", "debian");
    expect(
      commands.filter((c) => searchReference(c, "--no-sweep")).map((c) => c.id),
    ).toContain("copy");
    expect(commands.find((c) => c.id === "format")!.effect).toBe(
      "source-write",
    );
    expect(commands.find((c) => c.id === "extract")!.effect).toBe(
      "destination-write",
    );
    expect(commands.find((c) => c.id === "extract")!.command).toContain(
      "set -C",
    );
    for (const command of commands) {
      expect(command.command).not.toMatch(
        /\/dev\/(?:disk\d|rdisk\d|sd[a-z](?:\d|\b)|nvme\d)/,
      );
    }
  });
  it("migrates equivalent Debian-family selections and preserves Fedora", () => {
    for (const saved of [null, "debian", "ubuntu", "mint", "unknown"])
      expect(normalizeLinuxFamily(saved)).toBe("debian");
    expect(normalizeLinuxFamily("fedora")).toBe("fedora");
    expect(Object.keys(packageFamilies)).toEqual(["debian", "fedora"]);
  });
  it("uses Fedora packages and RPM installation without changing recovery commands", () => {
    const fedora = referenceCommands("linux", "fedora");
    const debian = referenceCommands("linux", "debian");
    const install = fedora.find((c) => c.id === "install")!.command;
    expect(install).toContain("sudo dnf install ddrescue");
    expect(install).toContain("systemd-udev");
    expect(install).not.toMatch(/gddrescue|apt /);
    expect(fedora.find((c) => c.id === "install-drc")!.command).toContain(
      ".rpm",
    );
    expect(debian.find((c) => c.id === "install-drc")!.command).toContain(
      ".deb",
    );
    for (const command of fedora.filter(
      (c) => !["install", "install-drc"].includes(c.id),
    )) {
      expect(command).toEqual(debian.find((c) => c.id === command.id));
    }
  });
});
