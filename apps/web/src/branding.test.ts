import { describe, expect, it } from "vite-plus/test";

import { APP_BASE_NAME, APP_DISPLAY_NAME, DESKTOP_DOWNLOAD_URL } from "./branding";

// The product-name seam: outside the desktop shell the web fallback must report INVRT Code, and the
// desktop download URL stays on its current host until the owner decides the INVRT download URL.
describe("branding", () => {
  it("falls back to the INVRT Code base name", () => {
    expect(APP_BASE_NAME).toBe("INVRT Code");
  });

  it("formats the display name from the base name and stage label", () => {
    expect(APP_DISPLAY_NAME).toContain("INVRT Code");
  });

  it("keeps the desktop download URL unchanged", () => {
    expect(DESKTOP_DOWNLOAD_URL).toBe("https://t3.codes/download");
  });
});
