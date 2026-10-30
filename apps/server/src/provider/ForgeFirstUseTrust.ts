import * as NodeURL from "node:url";

// Packet and runtime TCB pins remain local data; executable assets belong to this module's candidate.
export const firstUseTrust = Object.freeze({
  profileId: "first-use-planning-real-v5" as const,
  trustRevision: 1 as const,
  taskPrompt:
    "Planning. Our private notes tool should let its owner save a note and find it later. Ask one consequential question about who may read a note. Do not write files or start work.",
  packageRoot:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/first-use-audit/version5-inputs",
  evidenceRoot:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/first-use-audit",
  routerRoot:
    "/Users/mac/.agents/forge-runtime/561aaa0d2e1a5af53d0888b4a1dd2f12bb75f332e8ecf2ccfd9911d9a51ef722",
  executable: "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11",
  executableSha256: "4e28e811a89aeac6eed668ae641c7f85f5831e42e8dc6cd9a85a3bcc032ec46a",
  receiptSha256: "3c60e9e91582c5bed1964e2575ef06811956e1b48605a2a1b5f5b51cd5475188",
  archiveSha256: "feb85bd7bc060c26aea2703c5832ce837f6c98d4c7a22d9cf56577ca12ae23d9",
  contentVerdict: Object.freeze({
    path: "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/first-use-content-audit/V5-REVIEW.md",
    sha256: "be8e98dfbba9ba6a817a4eda3e56c9116b7f95b339603bf44868aafb7f226266",
  }),
  packetVerdict: Object.freeze({
    path: "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/first-use-packet-audit/V5-AUDIT.md",
    sha256: "f89341ec2fd7235e5ce4a543c40888516e581f2127b0d0298fefd011628aea6b",
  }),
  metadata: Object.freeze({
    "MANIFEST.json": "baf90ec84e458e703b5ca84d3beb330988bd0a4b83f9f6a5ea3a09d4aaf4c782",
    "TASK.json": "f750b1a33f27869ead78387309b31f8d11f4fe0b90684c1796810ff256419ee8",
    "NATIVE-POLICY-CANDIDATE.json":
      "b11f942d543d2501b5e06a2b8f5d45a175ff8521ad12d31389c3725acff1880d",
    "NATIVE-DEPENDENCY-CANDIDATE.json":
      "f1dfc6940665dfd7f7692afc0c82b847d755f518d38a6ea75b74963c9a4a9eba",
    "PYTHON-RUNTIME-CANDIDATE.json":
      "f228431433865239bbb7700f353d2ce232baa9686a06ead551cb9bbc4cc33a23",
    "LICENCE-CUSTODY.json": "d1163dc7db3180844d00940ed5acba4a548b2c4a51c09820e22352256f3bbfcb",
    "DEPENDENCY-DISPOSITIONS.json":
      "23b621275e2e08aec990ec3227f6e10caa99b39e7f21f82aced59c278b9d2ebf",
    "STORY-SKILLS.md": "12c07367452a163782aadfae66982d87be8a188bc966256294dbf667859e6ba9",
    "ROUTER-CATALOGUE-CUSTODY.json":
      "1d546bd3d9962f8489d7f63e01c1c25f90616e880511d24c6785fcfcd4ede8f4",
    "ANCHOR-CANDIDATE.json": "e9bb8b75b05421f3c7fc70858b47684af385558dc18fcd76873af45245ad13b5",
  }),
  routerRequired: Object.freeze([
    "ai-native-agent",
    "coterai-council",
    "prd",
    "production-audit",
    "verification-before-completion",
    "writing-plans",
  ]),
  required: Object.freeze([
    "ai-native-agent",
    "coterai-council",
    "invrt-concise-code",
    "prd",
    "production-audit",
    "production-guardrails",
    "verification-before-completion",
    "writing-plans",
  ]),
});

export interface ReviewedPythonQualification {
  readonly metadataPath: string;
  readonly metadataSha256: string;
  readonly verdictSha256: string;
  readonly verdictPath: string;
  readonly baselinePath: string;
  readonly baselineSha256: string;
  readonly cwd: string;
  readonly probePath: string;
  readonly probeSha256: string;
}
// UNACCEPTED source proposal. Exact-source approval and parent coordination precede execution.
// This binds a separate bounded metadata verdict, never a package-supplied approval flag.
const reviewedRuntime: ReviewedPythonQualification = Object.freeze({
  metadataPath:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/forge-f1/PROBE03-stdout.txt",
  metadataSha256: "a2f54e508c58a14c991e0deccb4f5b24bdfa4960f3fe1837e46dc0acdd506336",
  baselinePath:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/forge-f1/ORIGIN-PROBE-stdout.txt",
  baselineSha256: "c87271a31d88927f5deccdfbb23cb2eafd865d5f3f553178f07ebf38765fae0c",
  verdictPath:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/first-use-runtime-qualification-audit/PROBE03-RESULT-REVIEW.md",
  verdictSha256: "69f968cdef932a16ab41e9dcd50dc7cf24f7a418d30b392c83a9cfd580bc92e6",
  cwd: "/Users/mac/Repos/.worktrees/invrt-code-20261030-donor",
  probePath:
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/forge-f1/PYTHON-ORIGIN-PROBE03-PROPOSED.py",
  probeSha256: "3f64d7fb0d20f0c58d1cb52e1b7b67f3ead61a9655f32a871db1d8456b06d9f1",
});
export function reviewedPythonQualification(): ReviewedPythonQualification | undefined {
  return reviewedRuntime;
}

export interface ReviewedGuardedExecutionQualification {
  readonly metadataPath: string;
  readonly metadataSha256: string;
  readonly verdictPath: string;
  readonly verdictSha256: string;
  readonly launcherSha256: string;
  readonly policySha256: string;
}
// The old separate-process observation cannot admit the new actual-process boundary.
// New bootstrap/router/caller fingerprints require a separate exact verdict and source review.
export function reviewedGuardedExecutionQualification():
  | ReviewedGuardedExecutionQualification
  | undefined {
  return undefined;
}
// A source checkout resolves its own assets, independently of the qualified fixture project cwd.
// A packaged build must preserve these sibling assets and receive separate artifact review.
export const guardedLauncherPath = NodeURL.fileURLToPath(
  new URL("./ForgeGuardedLauncher.py", import.meta.url),
);
export const guardedPolicyPath = NodeURL.fileURLToPath(
  new URL("./ForgeGuardedPolicy.tsv", import.meta.url),
);
