const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

const { applyTerminalNativeExclusionPatch } = require("./terminalNativeExclusion.cjs");

module.exports = function withIosTerminalNativeExclusion(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");
      const patched = applyTerminalNativeExclusionPatch(podfile);
      if (patched !== null) {
        fs.writeFileSync(podfilePath, patched, "utf8");
      }
      return nextConfig;
    },
  ]);
};
