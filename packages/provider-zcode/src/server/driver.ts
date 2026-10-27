/**
 * ZCode provider driver. Registers the ZCode adapter, snapshot probe and usage reader
 * under the "zcode" driver kind, following the same contract as the other native drivers.
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import { ZCodeSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { ZcodeAdapterV2Driver, type ZcodeAdapterV2DriverEnv } from "./adapter.ts";
import { makeZcodeTextGeneration } from "./textGeneration.ts";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { buildInitialZcodeProviderSnapshot, checkZcodeProviderStatus } from "./status.ts";
import { zcodeUsageReader } from "./usage.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";

const DEFAULT_ZCODE_SETTINGS: ZCodeSettings = Schema.decodeSync(ZCodeSettings)({});
const DRIVER_KIND = ProviderDriverKind.make("zcode");

// ZCode.app updates itself; no npm package or CLI self-update is managed here.
const resolveMaintenance = makeCachedProviderMaintenanceResolution(
  Effect.succeed(
    makeManualOnlyProviderMaintenanceCapabilities({
      provider: DRIVER_KIND,
      packageName: "zcode",
    }),
  ),
);

export type ZcodeDriverEnv =
  | ZcodeAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem;

export const ZcodeDriver: ProviderDriver<ZCodeSettings, ZcodeDriverEnv, never> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ZCode",
    supportsMultipleInstances: true,
  },
  configSchema: ZCodeSettings,
  defaultConfig: (): ZCodeSettings => DEFAULT_ZCODE_SETTINGS,
  usage: zcodeUsageReader,
  create: Effect.fn("ZcodeDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const host = yield* ProviderHost.ProviderHost;
    const processEnv = yield* mergeProviderInstanceEnvironment(environment);
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const effectiveConfig = { ...config, enabled } satisfies ZCodeSettings;
    const maintenanceResolution = yield* resolveMaintenance;

    const orchestrationAdapter = yield* ZcodeAdapterV2Driver.create({
      instanceId,
      displayName,
      accentColor,
      environment,
      enabled,
      config,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build ZCode orchestration adapter.",
            cause,
          }),
      ),
    );

    const checkProvider = checkZcodeProviderStatus(effectiveConfig, processEnv).pipe(
      Effect.map(stampIdentity),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ZCodeSettings>>({
      resolveMaintenance: maintenanceResolution,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: () =>
        buildInitialZcodeProviderSnapshot(effectiveConfig).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      checkProvider,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build ZCode snapshot.",
            cause,
          }),
      ),
    );

    // Commit-message and title generation require a configured ZCode model provider;
    // failing closed keeps the seam honest instead of pretending a capability exists.
    const textGeneration = makeZcodeTextGeneration();

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
