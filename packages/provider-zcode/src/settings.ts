import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * binaryPath empty decodes to the "zcode" command on PATH. When that is absent, the
 * status probe falls back to the macOS app bundle script (see status.ts) because the
 * ZCode CLI ships inside ZCode.app and is not always on PATH.
 */
export const ZCodeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("zcode").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description:
          "Path to the ZCode CLI script. Leave empty to use zcode from PATH, or the ZCode.app bundle script on macOS.",
        providerSettingsForm: { placeholder: "zcode", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type ZCodeSettings = typeof ZCodeSettings.Type;
