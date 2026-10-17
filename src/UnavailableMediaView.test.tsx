import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnavailableMediaView } from "./UnavailableMediaView";
import type { Json, UnavailableMedia } from "./types";

const item: UnavailableMedia = {
  id: "observed:102",
  name: "Fixture SSD",
  stage: "media-unassigned",
  sizeBytes: "256060514304",
  bsdName: null,
  transport: "USB",
  observedAt: 1,
  fields: {
    usb: { "USB Product Name": "Fixture SSD" },
    media: {
      Size: "256060514304",
      "Preferred Block Size": "512",
      vendorRawCounter: "18446744073709551615",
    },
  },
};
describe("unaddressable storage", () => {
  it("summarizes driver counters only when one driver can be identified", () => {
    const driver = {
      IOObjectClass: "IOBlockStorageDriver",
      Statistics: { "Errors (Read)": "2", "Bytes (Read)": "0" },
    };
    const render = (driverChain: Json[]) =>
      renderToStaticMarkup(
        <UnavailableMediaView
          item={{ ...item, fields: { driverChain } }}
          refresh={() => {}}
          ports={() => {}}
          disabled
        />,
      );
    expect(render([driver])).toContain("Host driver counters");
    expect(render([driver])).toContain("all applications");
    expect(render([driver, driver])).not.toContain("Host driver counters");
  });
  it("shows exact evidence without presenting an observation as an acquisition source", () => {
    const html = renderToStaticMarkup(
      <UnavailableMediaView
        item={item}
        refresh={() => {}}
        ports={() => {}}
        disabled
      />,
    );
    expect(html).toContain("No disk identifier".toLowerCase());
    expect(html).toContain("Not assigned");
    expect(html).toContain("256060514304");
    expect(html).toContain("18446744073709551615");
    expect(html).toContain("Imaging and SMART are unavailable");
    expect(html).not.toContain("/dev/observed:");
    expect(html).toContain('disabled=""');
  });
});
