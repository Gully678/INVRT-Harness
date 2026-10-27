import { describe, expect, it } from "vite-plus/test";
import { makeProviderSettingsSchema, ProviderDriverKind, TrimmedString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { providerClients } from "./providerDriverMeta";
import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
} from "./ProviderSettingsForm";

describe("ProviderSettingsForm helpers", () => {
  it("keeps every masked field as a stored secret", () => {
    const settingsSchema = makeProviderSettingsSchema({
      token: TrimmedString.pipe(
        Schema.annotateKey({ providerSettingsForm: { control: "password" } }),
      ),
    });

    expect(deriveProviderSettingsFields({ settingsSchema })).toMatchObject([
      { key: "token", secret: true },
    ]);
  });

  it("preserves unknown config keys while omitting empty configurable fields", () => {
    const opencode = providerClients.get(ProviderDriverKind.make("opencode"));
    expect(opencode).toBeDefined();

    const serverUrl = deriveProviderSettingsFields(opencode!).find(
      (field) => field.key === "serverUrl",
    );
    expect(serverUrl).toBeDefined();

    const next = nextProviderConfigWithFieldValue(
      { forkOwned: 1, serverUrl: "http://127.0.0.1:4096" },
      serverUrl!,
      "",
    );

    expect(next).toEqual({ forkOwned: 1 });
  });

  it("keeps the zcode client registered with the same required fields as the pi client", () => {
    const zcode = providerClients.get(ProviderDriverKind.make("zcode"));
    const pi = providerClients.get(ProviderDriverKind.make("pi"));
    expect(zcode).toBeDefined();
    expect(pi).toBeDefined();
    expect(zcode!.label).toBe("ZCode");
    // The settings panel and the add-instance dialog iterate definitions; each concrete
    // client must carry the same registration fields (driver kind, label, schema, icon).
    for (const definition of [pi!, zcode!]) {
      expect(definition.driverKind).toBeTruthy();
      expect(definition.label.length).toBeGreaterThan(0);
      expect(Object.keys(definition.settingsSchema.fields).length).toBeGreaterThan(0);
      expect(definition.icon?.paths.length).toBeGreaterThan(0);
    }
  });

  it("stores false boolean fields when true is the default", () => {
    const next = nextProviderConfigWithFieldValue(
      undefined,
      {
        key: "experimental",
        control: "switch",
        label: "Experimental",
        clearWhenEmpty: "omit",
        defaultBooleanValue: true,
      },
      false,
    );

    expect(next).toEqual({ experimental: false });
  });
});
