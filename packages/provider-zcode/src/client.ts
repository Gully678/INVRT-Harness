import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { ZCodeSettings } from "./settings.ts";

export const zcodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("zcode"),
  label: "ZCode",
  settingsSchema: ZCodeSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#111111", dark: "#F5F5F5" },
    paths: [
      {
        d: "M4 4h7v3H7v3H4V4zm9 0h7v6h-3V7h-4V4zM4 14h3v3h4v3H4v-6zm13 0h3v6h-7v-3h4v-3z",
      },
    ],
  },
});
