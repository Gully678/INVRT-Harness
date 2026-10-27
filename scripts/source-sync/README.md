# Approved source registry (source-sync slice 1)

The registry records the 41 approved upstream source identities for INVRT Code and lets any
agent verify, offline, that the recorded pins and review counts are internally consistent with
the checkout's own adoption evidence. Last reviewed: 2026-10-27.

## Contract

- `registry.json` is DATA. It is the single record of which sources are approved, which exact
  revision each document pinned, and what must be preserved when a source updates.
- This slice verifies only. The automatic fetch/candidate/conflict/test/audit/rollback machinery
  is a LATER slice. Nothing here fetches, clones or executes remote content (supply-chain law):
  the only external process invoked is `git` in local read mode against this checkout's objects.
- `pin-pending` is a valid state. Where no review document states a consumed sha, the entry
  records `pin: null`. No hash in this registry was invented; every recorded pin cites its
  document. Adoption statuses are `adopted` (consumed today), `pending` (reviewed/queued), and
  `superseded` (unused today: no reviewed document supersedes one of the 41 identities).
- A validator rule of record: an `adopted` entry must carry a pin. First-party working copies
  (monti-forge) may pin `kind: "local"` with a note instead of a sha.
- The verbatim `coverage-2026-10-27-SEMANTIC-COVERAGE.json` copy must stay outside any future
  whole-repo `vp fmt` scope: reformatting it would break the byte-identity provenance claim
  above.

## What the check verifies (offline only)

`node scripts/source-sync/check-source-registry.ts` exits 0 when all of these hold and 1 with
named findings otherwise:

1. Every entry passes the typed validator (`registry.ts`): unique ids, known statuses, sha
   format, ISO dates, first-party/local-pin consistency.
2. Summary consistency: `sourcesTotal` equals the entry count; `changedBodiesBySource` and the
   per-entry counts sum to `changedBodies` (78); per-entry `missingPaths` sums to 23; per-entry
   `packsRecords` sums to `admittedRecords` (795).
3. Coverage counts match `coverage-2026-10-27-SEMANTIC-COVERAGE.json`, a byte-identical copy of
   the review wave's `ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json` (sha256
   `4234dc930599bb7327137e9a727027cb34dc2d27914100332c71c354a12dc3e7`; 78 bodies, 21570 lines,
   77 full diffs, `last30days` structural deletion, 78 evidence rows).
4. Documented pins cross-check against git-reachable facts (local `git` reads only):
   - `Gully678/INVRT-Harness` pin `70eccd48...` is reachable and an ancestor of upstream
     `790ba13d0c...`; merge `5b0f7fb84...` subject binds `790ba13d0c`; the committed
     `oneday-evidence/ADOPTION-REVIEW.json` binds the merge, upstream and fix commits.
   - `Gully678/rea` pin `98422997...` (v6.8.0) is reachable in this checkout. It is deliberately
     NOT claimed as an ancestor: REA is a separate repository.

## Running

```sh
node scripts/source-sync/check-source-registry.ts
node scripts/source-sync/check-source-registry.ts --registry <path> --coverage <path>
```

No package.json registration was added: scripts in this repo run directly with `node`, and the
colocated tests run, from this directory, with `pnpm exec vp test run --config
../../vite.config.ts --dir .`.
The check script uses only node builtins plus local `git`; the tests additionally spawn
`process.execPath` for the corrupted-copy cases.

## Row provenance

Every row's `reviewRef` names its grounding documents. All documents live in the INVRT-CODE
knowledge home at `research/2026-10-27/ONE-DAY-RELEASE/`:

- `ALL-SYNCED-SOURCES-CURRENT-INVENTORY.json`: owner, repo, current sha, fork parent for all 41
  identities (immutable audit inputs of the review wave; never treated as adopted revisions).
- `ADOPTION-QUEUE-2026-10-27.md`: frozen reviewed pins for INVRT-Harness (`70eccd48...`) and REA
  (`98422997...`, v6.8.0), adoption order, sync contract rules.
- `ALL-SYNCED-SOURCES-REVIEW-AND-ZCODE-PACKET.md`: 41 identities, 795 admitted records, 694/78
  body split, 176 local pilot differences, grill re-adaptation pin `fc0de407...`, first-party
  confirmations (kammandor `79549e60...`, INVRT_Production_Guardrails `93dc0db7...`).
- `ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json`: per-source review pins for the eight changed-body
  sources and the 78-row evidence set (copied byte-identical into this directory).
- `ALL-SYNCED-SOURCES-MISSING-PATH-PRESERVATION.md`: the 23 missing paths (12 taste-skill, 11
  INVRT-owned components recorded against monti-forge).
- `REPOSITORY-SYNC-CHECKLIST-2026-10-27.md`: the register roles, intended roles per source, and
  the automatic source-synchronisation owner requirement this slice starts.

Pins recorded as `adopted` are consumed today by FORGE's local vendored copies; pins recorded as
`pending` are frozen review inputs for the queued adoption waves. The `fc0de407...` grill pin is
the full sha whose prefix the packet names; `fusion-harness` `01a34820...` is the recorded head
the checklist states matches current source. Neither has been adopted into the product.
