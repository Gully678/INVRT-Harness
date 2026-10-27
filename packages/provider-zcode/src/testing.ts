/** Test-only exports: fake app-server factory and captured protocol fixtures. */
export { startFakeZcodeAppServer } from "./server/fakeServer.ts";
export {
  contextWindowUsedPercent,
  sessionContextUsageWindow,
  sessionStateUsageToSnapshot,
  sessionUsageToTotals,
  usageLimitsFromAvailability,
  usageStatsToRecords,
} from "./server/mapping.ts";
export { mapSessionEventToTurnUpdates } from "./server/eventMapping.ts";
export { parseTranscriptPart } from "./server/protocolTypes.ts";
export {
  appServerCommand,
  startZcodeProtocolClient,
  ZcodeProtocolClosedError,
  ZcodeProtocolError,
} from "./server/protocol.ts";
