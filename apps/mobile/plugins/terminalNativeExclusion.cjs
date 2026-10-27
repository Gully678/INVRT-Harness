// GhosttyKit ships an arm64-only iOS simulator slice, so only the x86_64 (Intel) simulator
// destination cannot link the native terminal. Excluding the module on every iOS build also
// removed it from arm64 simulators and physical devices; the exclusion must stay scoped to
// the destination that cannot link it. Pure logic, required by both the config plugin and
// its tests so the predicate is asserted directly.
const EXCLUDE_ENV_VAR = "T3CODE_IOS_EXCLUDE_TERMINAL_NATIVE";
const TERMINAL_NATIVE_PACKAGE = "@t3tools/mobile-terminal-native";

function resolveIosTerminalNativeExclusion(env) {
  return env[EXCLUDE_ENV_VAR] === "1" ? [TERMINAL_NATIVE_PACKAGE] : [];
}

// Replaces the bare `use_expo_modules!` in the generated Podfile. The env var is read at
// pod-install time, so one prebuild serves both destinations: set the variable only for the
// Intel simulator workflow (pod install and xcodebuild run without the slice).
const PODFILE_MARKER =
  "# t3code: terminal-native excluded only for the Intel simulator destination";

// The widgets target's `use_expo_modules_widgets!` does not match this exact line.
const BARE_INVOCATION = "\n  use_expo_modules!\n";

function terminalNativePodfilePatch() {
  return [
    PODFILE_MARKER,
    `terminal_native_excludes = ENV[${JSON.stringify(EXCLUDE_ENV_VAR)}] == '1' ? [${JSON.stringify(TERMINAL_NATIVE_PACKAGE)}] : []`,
    "use_expo_modules!(exclude: terminal_native_excludes)",
  ]
    .map((line) => `  ${line}`)
    .join("\n");
}

/** Returns the Podfile with the scoped exclusion, or null when already patched. Throws when
 * the generated bare invocation is missing so silent no-ops cannot ship. */
function applyTerminalNativeExclusionPatch(podfile) {
  if (podfile.includes(PODFILE_MARKER)) {
    return null;
  }
  if (!podfile.includes(BARE_INVOCATION)) {
    throw new Error("Unable to scope terminal-native exclusion: use_expo_modules! is missing.");
  }
  return podfile.replace(BARE_INVOCATION, `\n${terminalNativePodfilePatch()}\n`);
}

module.exports = {
  EXCLUDE_ENV_VAR,
  TERMINAL_NATIVE_PACKAGE,
  PODFILE_MARKER,
  resolveIosTerminalNativeExclusion,
  terminalNativePodfilePatch,
  applyTerminalNativeExclusionPatch,
};
