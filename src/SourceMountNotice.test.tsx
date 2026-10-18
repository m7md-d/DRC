import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceMountNotice } from "./SourceMountNotice";

describe("mounted source preparation", () => {
  it("names every mounted volume and distinguishes a filesystem flush from the read-only copy", () => {
    const html = renderToStaticMarkup(
      <SourceMountNotice
        source={{
          state: "mounted",
          deviceId: "disk8",
          deviceName: "External SSD",
          volumes: [
            {
              deviceId: "disk8s1",
              mountPoint: "/Volumes/Untitled",
              readOnly: true,
            },
            {
              deviceId: "disk8s2",
              mountPoint: "/Volumes/Files",
              readOnly: false,
            },
          ],
        }}
        working={false}
        proceed={() => {}}
        cancel={() => {}}
      />,
    );
    for (const value of [
      "disk8s1",
      "disk8s2",
      "/Volumes/Untitled",
      "/Volumes/Files",
      "Mounted read-only",
      "Mounted read/write",
      "pending filesystem writes",
      "Unmount source and continue",
      "show the copy review",
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain("Start acquisition");
  });
});
