import { z } from "zod";
import { firstUseTrust as trust } from "./ForgeFirstUseTrust.ts";
import type { PythonObservation } from "./ForgePythonRuntime.ts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const codeIdentity = z.strictObject({
  filename: z.string(),
  name: z.string(),
  caller: z.string(),
  marshal_bytes: z.number().int().min(1).max(16777216),
  sha256: sha,
  callerCodeSha256: sha,
});
// A metadata object never grants authority. The empty code-owned qualification
// slot must first bind its complete bytes to a separate exact reviewer verdict.
export const guardedMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observationSha256: z.literal("a2f54e508c58a14c991e0deccb4f5b24bdfa4960f3fe1837e46dc0acdd506336"),
  launcherSha256: sha,
  bootstrap: z
    .array(z.strictObject({ name: z.string(), origin: z.string(), loader: z.string() }))
    .max(81),
  executions: z.array(codeIdentity).min(1).max(128),
  generatedCompilations: z
    .array(z.strictObject({ execSha256: sha, sourceSha256: sha, callerCodeSha256: sha }))
    .length(5),
  router: z.strictObject({
    codeSha256: sha,
    callerCodeSha256: sha,
    marshalBytes: z.number().int().min(1).max(1048576),
  }),
});
export type GuardedMetadata = z.infer<typeof guardedMetadataSchema>;
export interface GuardFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
const hex = (value: string) => Buffer.from(value, "utf8").toString("hex");
const identity = (code: PythonObservation["actual_exec_code"][number]) =>
  JSON.stringify([code.filename, code.name, code.caller, code.marshal_bytes, code.sha256]);

export const logicalRouterArgs = (cwd: string) => [
  `--prompt=${trust.taskPrompt}`,
  `--cwd=${cwd}`,
  "--task-type=planning",
  "--review",
  "--llm",
  "--done",
];

/** Encode data, never Python expressions. Every runtime caller comes from pinned metadata. */
export function buildGuardPolicy(
  expected: PythonObservation,
  baseline: PythonObservation,
  metadata: GuardedMetadata,
  files: readonly GuardFile[],
  routerSourceSha256: string,
): string {
  const prior = baseline.actual_exec_code.find((code) => code.filename.endsWith("/argparse.py"));
  const current = expected.actual_exec_code.find((code) => code.filename.endsWith("/argparse.py"));
  if (
    prior?.sha256 !== "eecfc6a6e407174b033817a9ed34b0818d70c554c94b59d2332492331250e6b6" ||
    current?.sha256 !== "539fcfe1f57392b0bf902aa8ff1f58e5fb90fa852e3dc135d18e6f2cec2a5ebf" ||
    prior.marshal_bytes !== 114010 ||
    current.marshal_bytes !== 114010 ||
    prior.filename !== current.filename ||
    prior.name !== current.name ||
    prior.caller !== current.caller
  )
    throw new Error("guarded metadata unqualified");
  const known = new Map(
    [...expected.actual_exec_code, prior].map((code) => [identity(code), code]),
  );
  const qualified = new Map(metadata.executions.map((code) => [identity(code), code]));
  if (
    qualified.size !== metadata.executions.length ||
    qualified.size > known.size ||
    [...qualified.keys()].some((key) => !known.has(key))
  )
    throw new Error("guarded metadata unqualified");
  const generated = new Set(
    expected.actual_exec_code
      .filter((code) => code.filename === "<string>")
      .map((code) => code.sha256),
  );
  if (
    generated.size !== 5 ||
    new Set(metadata.generatedCompilations.map((code) => code.execSha256)).size !== 5 ||
    metadata.generatedCompilations.some(
      (code) =>
        !generated.has(code.execSha256) ||
        !metadata.executions.some(
          (exec) =>
            exec.filename === "<string>" &&
            exec.sha256 === code.execSha256 &&
            exec.callerCodeSha256 === code.callerCodeSha256,
        ),
    )
  )
    throw new Error("guarded metadata unqualified");
  const modules = new Map(expected.modules.map((module) => [module.name, module]));
  if (new Set(metadata.bootstrap.map((module) => module.name)).size !== metadata.bootstrap.length)
    throw new Error("guarded metadata unqualified");
  for (const entry of metadata.bootstrap) {
    if (entry.name === "__main__") {
      if (entry.origin !== "None" || entry.loader !== "builtins.NoneType")
        throw new Error("guarded metadata unqualified");
    } else {
      const module = modules.get(entry.name);
      if (!module || entry.origin !== String(module.origin) || entry.loader !== module.loader)
        throw new Error("guarded metadata unqualified");
    }
  }
  for (const name of ["sys", "marshal", "posix", "_imp", "_hashlib", "__main__"])
    if (!metadata.bootstrap.some((module) => module.name === name))
      throw new Error("guarded metadata unqualified");
  const rows = [
    ["version", "1"],
    ["cwd", hex(expected.cwd)],
    [
      "router",
      hex(`${trust.routerRoot}/tools/route_skills.py`),
      routerSourceSha256,
      metadata.router.codeSha256,
    ],
  ];
  for (const argument of logicalRouterArgs(expected.cwd)) rows.push(["argv", hex(argument)]);
  for (const path of expected.sys_path) rows.push(["sys_path", hex(path)]);
  for (const entry of metadata.bootstrap)
    rows.push(["bootstrap", hex(entry.name), hex(entry.origin), hex(entry.loader)]);
  for (const module of expected.modules)
    rows.push([
      "module",
      hex(module.name),
      hex(module.origin ?? ""),
      hex(module.file ?? ""),
      hex(module.cached ?? ""),
      hex(module.frozen_registry_code_sha256 ?? ""),
    ]);
  const uniqueFiles = new Map<string, GuardFile>();
  for (const file of files) {
    const existing = uniqueFiles.get(file.path);
    if (existing && (existing.sha256 !== file.sha256 || existing.bytes !== file.bytes))
      throw new Error("guarded metadata unqualified");
    uniqueFiles.set(file.path, file);
  }
  for (const file of [...uniqueFiles.values()].sort((a, b) => a.path.localeCompare(b.path)))
    rows.push(["file", hex(file.path), String(file.bytes), file.sha256]);
  for (const code of metadata.executions)
    rows.push([
      "exec",
      hex(code.filename),
      hex(code.name),
      hex(code.caller),
      String(code.marshal_bytes),
      code.sha256,
      code.callerCodeSha256,
    ]);
  rows.push([
    "exec",
    hex(`${trust.routerRoot}/tools/route_skills.py`),
    hex("<module>"),
    hex("<string>"),
    String(metadata.router.marshalBytes),
    metadata.router.codeSha256,
    metadata.router.callerCodeSha256,
  ]);
  for (const code of metadata.generatedCompilations)
    rows.push(["generated_compile", code.sourceSha256, code.callerCodeSha256]);
  return rows.map((row) => row.join("\t")).join("\n") + "\n";
}
