// @effect-diagnostics-next-line nodeBuiltinImport:off -- Verify artwork source bytes with the native SHA-256 implementation.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- These tests verify the shipped asset files directly.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const digest = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const source = (path: string) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");
const paths = (value: string) =>
  [...value.matchAll(/\bd="([^"]+)"/g)].map((match) => digest(match[1]!));
const mark = "54c64d34a9535363732330e48f7c45b446ad22c99ed420fc9cb0bee22332cd9f";
const wordmark = "d19456b410373de75599c3c4ad8c6c4eeffc3f0dc4bfbf8de0dda4e180fc28d4";

describe("approved brand artwork", () => {
  it("keeps both web and native artwork identical to the approved SVG masters", () => {
    for (const path of [
      "./components/InvrtMark.tsx",
      "../../mobile/src/components/InvrtMark.tsx",
    ]) {
      expect(paths(source(path)), path).toEqual([mark, wordmark]);
    }
  });

  it("ships the canonical mark in the native widget template", () => {
    expect(paths(source("../../mobile/assets/widget/T3Mark.svg"))).toEqual([mark]);
  });
  it("keeps marketing and permission-helper company artwork on the same masters", () => {
    expect(paths(source("../../marketing/src/assets/brand/invrt-mark.svg"))).toEqual([mark]);
    expect(paths(source("../../marketing/src/assets/brand/invrt-wordmark.svg"))).toEqual([
      wordmark,
    ]);
    expect(paths(source("../../desktop/src/permissions/InvrtCodeLockup.ts")).slice(0, 2)).toEqual([
      mark,
      wordmark,
    ]);
  });

  it("ships the approved static Inter 600 native descriptor font", () => {
    const bytes = NodeFS.readFileSync(
      new URL("../../mobile/assets/fonts/Inter_18pt-SemiBold.ttf", import.meta.url),
    );
    expect(NodeCrypto.createHash("sha256").update(bytes).digest("hex")).toBe(
      "a8b276e25bb13dfa39cface35cc92aff9a7d5f1b96143f0df8c66351ccfed2a4",
    );
  });

  it("keeps the Icon Composer regeneration masters on approved mark-only artwork", () => {
    for (const path of [
      "../../../assets/prod/app-icon.icon/Assets/text.svg",
      "../../../assets/dev/app-icon.icon/Assets/text.svg",
      "../../../assets/nightly/app-icon.icon/Assets/text.svg",
      "../../../assets/prod/logo.svg",
    ]) {
      expect(paths(source(path)).at(-1), path).toBe(mark);
    }
  });
});
