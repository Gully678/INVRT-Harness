// One-shot generator: builds scripts/source-sync/registry.json from the immutable
// review inventory + the per-source facts stated in the review documents.
// Grounding rule: owner/repo/sha/forkOf come verbatim from ALL-SYNCED-SOURCES-CURRENT-INVENTORY.json;
// pins/status/notes come only from the named documents. No invented hashes.
const NodeFS = require("node:fs");
const NodePath = require("node:path");

const INVENTORY =
  "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-27/ONE-DAY-RELEASE/ALL-SYNCED-SOURCES-CURRENT-INVENTORY.json";
const OUT =
  "/Users/mac/Repos/.worktrees/invrt-claude-source-sync-registry-20261027/scripts/source-sync/registry.json";
const REVIEWED = "2026-10-27";

const inv = JSON.parse(NodeFS.readFileSync(INVENTORY, "utf8"));
const byRepo = new Map(inv.map((r) => [r.repo, r]));
function shaOf(repoKey, must) {
  const row = inv.find((r) => r.repo === repoKey);
  if (!row) throw new Error(`inventory missing ${repoKey}`);
  const sha = row.sha;
  if (must && !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`bad sha for ${repoKey}: ${sha}`);
  return sha;
}
function forkOf(repoKey) {
  const row = inv.find((r) => r.repo === repoKey);
  return row && row.parent ? row.parent : undefined;
}

// ---- document-stated pins (full 40-hex only) ----
const PIN_HARNESS = "70eccd48e47398cc66d422d47de9c2af8e1c30e5"; // ADOPTION-QUEUE-2026-10-27.md
const PIN_REA = "98422997c035bf314084b7d786628616e70bc95f"; // ADOPTION-QUEUE-2026-10-27.md
const PIN_KAMMANDOR = "79549e60816050b276206742377f8dcfbdc81795"; // packet, unchanged recorded pin
const PIN_PGUARDRAILS = "93dc0db741a42604ade4261e7299e36f2681452d"; // packet, unchanged recorded pin
const PIN_GRILL = shaOf("Gully678/grill-with-ui", true); // packet names exact fc0de407; inventory gives the full sha
const PIN_FUSION = shaOf("Gully678/fusion-harness", true); // checklist: current matches recorded head
// semantic-review current pins (SEMANTIC-COVERAGE.json rows, cross-confirmed against inventory prefixes)
const COVERAGE = JSON.parse(
  NodeFS.readFileSync(
    "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-27/ONE-DAY-RELEASE/ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json",
    "utf8",
  ),
);
const pinFromCoverage = (source) => {
  const row = COVERAGE.rows.find((r) => r.source === source);
  if (!row) throw new Error(`coverage missing ${source}`);
  const invSha = shaOf(source, true);
  if (!invSha.startsWith(row.current_pin.slice(0, 12))) throw new Error(`pin mismatch ${source}`);
  return row.current_pin;
};
const PIN_CLAUDE_SEO = pinFromCoverage("Gully678/claude-seo");
const PIN_COLDOUT = pinFromCoverage("Gully678/coldoutboundskills");
const PIN_GEO_SEO = pinFromCoverage("Gully678/geo-seo-claude");
const PIN_KNOWLEDGE = pinFromCoverage("Gully678/knowledge-work-plugins");
const PIN_LAST30 = pinFromCoverage("Gully678/last30days-skill");
const PIN_MARKETING = pinFromCoverage("Gully678/marketingskills");
const PIN_SCROLL = pinFromCoverage("Gully678/scroll-craft");
const PIN_TASTE = pinFromCoverage("Gully678/taste-skill");

// cross-check git facts verified in this checkout on 2026-10-27 (git reads only)
const MERGE = "5b0f7fb84ee3cfc11d6449c4c8690988a4d389e6";
const UPSTREAM = "790ba13d0c839d3cd1b4c45f6d3c252b9286dc99";
const FIX = "84b49e6151bae11d10adf97fac18b647b1c94ad6";
const CROSS_HARNESS = {
  reachable: [PIN_HARNESS],
  ancestors: [{ ancestor: PIN_HARNESS, of: UPSTREAM }],
  commitSubjectsBind: [{ sha: MERGE, contains: "790ba13d0c" }],
  evidenceFiles: [
    { path: "oneday-evidence/ADOPTION-REVIEW.json", contains: [MERGE, "790ba13d0c", FIX] },
  ],
};
const CROSS_REA = { reachable: [PIN_REA] };

const pinSha = (sha, source, version) =>
  version ? { kind: "sha", sha, source, version } : { kind: "sha", sha, source };

const entries = [];
function add(e) {
  entries.push({
    id: e.repo,
    owner: e.repo.split("/")[0],
    repo: e.repo.split("/")[1],
    ...(forkOf(e.repo) ? { forkOf: forkOf(e.repo) } : {}),
    ...(e.firstParty ? { firstParty: true } : {}),
    role: e.role,
    pin: e.pin === undefined ? null : e.pin,
    adoptionStatus: e.adoptionStatus,
    ...(e.packsRecords !== undefined ? { packsRecords: e.packsRecords } : {}),
    ...(e.changedBodies !== undefined ? { changedBodies: e.changedBodies } : {}),
    ...(e.missingPaths !== undefined ? { missingPaths: e.missingPaths } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    lastReviewed: REVIEWED,
    reviewRef: e.reviewRef,
    ...(e.gitCrossCheck ? { gitCrossCheck: e.gitCrossCheck } : {}),
  });
}
const PKT = "ALL-SYNCED-SOURCES-REVIEW-AND-ZCODE-PACKET.md";
const QUEUE = "ADOPTION-QUEUE-2026-10-27.md";
const CHECKLIST = "REPOSITORY-SYNC-CHECKLIST-2026-10-27.md";
const COVDOC = "ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json";
const MISSING = "ALL-SYNCED-SOURCES-MISSING-PATH-PRESERVATION.md";
const INV = "ALL-SYNCED-SOURCES-CURRENT-INVENTORY.json";

// Owner-updated forks (adoption wave 2, frozen reviewed pins)
add({
  repo: "Gully678/INVRT-Harness",
  role: "INVRT Code harness product source (fork of t3code); adoption wave 2 consumes the reviewed pin exactly",
  pin: pinSha(PIN_HARNESS, QUEUE),
  adoptionStatus: "pending",
  reviewRef: `${QUEUE}; ${CHECKLIST}; ${INV}`,
  gitCrossCheck: CROSS_HARNESS,
  notes:
    "Upstream advanced one further commit after review; adopt the reviewed pin exactly, do not chase moving main.",
});
add({
  repo: "Gully678/rea",
  role: "REA evidence runtime (B26/B27 foundation); isolated OWNED stdio integration; no auto HTTP endpoint selection",
  pin: pinSha(PIN_REA, QUEUE, "6.8.0"),
  adoptionStatus: "pending",
  reviewRef: `${QUEUE}; ${INV}`,
  gitCrossCheck: CROSS_REA,
  notes:
    "Pin is git-reachable in this checkout but is NOT an ancestor of the integration head: REA is a separate repository. Node floors 22.23.4/24.22.1/26.12.1 per REA-U07; sync must never invoke REA setup/update (REA-U05).",
});

// First-party
add({
  repo: "INVRT-AI/monti-forge",
  firstParty: true,
  role: "MONTI forge: INVRT first-party skills/agents/laws source, consumed as local vendored copies",
  pin: {
    kind: "local",
    note: "Consumed as the local vendored/working copy; the review records six historical revisions and no single consumed sha. The monti-forge primary is dirty/foreign and is never pulled, reset or switched.",
  },
  adoptionStatus: "adopted",
  packsRecords: 102,
  missingPaths: 11,
  reviewRef: `${CHECKLIST}; ${PKT}; ${MISSING}; ${INV}`,
  notes:
    "11 recorded INVRT-owned media/quality paths absent at current source head (incl. invrt-concise-code, invrt-technical-prose, invrt-ui-quality): preserve bodies until a reviewed relocation qualifies.",
});
add({
  repo: "INVRT-AI/invrt-media-factory",
  firstParty: true,
  role: "Craft/Media capability integration; INVRT first-party product source",
  pin: null,
  adoptionStatus: "pending",
  reviewRef: `${CHECKLIST}; ${PKT}`,
  notes:
    "138 raw skill bodies are another product's private source context, not automatic FORGE imports (packet action 7).",
});

// Adopted skill libraries (verified unchanged at recorded pins)
add({
  repo: "Gully678/kammandor-skills",
  role: "First-party skill source library; FORGE consumes local vendored copies (marketplace 6.0.0)",
  pin: pinSha(PIN_KAMMANDOR, PKT),
  adoptionStatus: "adopted",
  packsRecords: 304,
  reviewRef: `${PKT}; ${INV}`,
  notes:
    "304 direct-admitted PACKS records, 856 files intact (285 exact + 19 verified name-line projections); 9 absent PFO private names NOT auto-imported; 14 Superpowers bodies need harness qualification.",
});
add({
  repo: "Gully678/INVRT_Production_Guardrails",
  role: "First-party production guardrail skill library (1 plugin, 3 core skills)",
  pin: pinSha(PIN_PGUARDRAILS, PKT),
  adoptionStatus: "adopted",
  packsRecords: 3,
  reviewRef: `${PKT}; ${INV}`,
  notes:
    "All 10 source files match remote/local FORGE/installed/pilot copies; no drift in checked copies.",
});

// Reviewed re-adaptation / unchanged-head pins
add({
  repo: "Gully678/grill-with-ui",
  role: "Required owned Grill/Blueprint UI source adaptation (re-adapt at exact reviewed pin)",
  pin: pinSha(PIN_GRILL, PKT),
  adoptionStatus: "pending",
  reviewRef: `${PKT}; ${INV}`,
  notes:
    "Port Host/origin/body/CSP/token protections; keep INVRT ownership/symlink/writer/export/recovery contracts; no default LAN exposure or token-log sharing (packet action 4).",
});
add({
  repo: "Gully678/fusion-harness",
  role: "Required independent-model contribution/synthesis patterns (selected adaptation, not a competing controller)",
  pin: pinSha(PIN_FUSION, `${CHECKLIST}; ${INV}`),
  adoptionStatus: "pending",
  reviewRef: `${CHECKLIST}; ${INV}`,
  notes: "Recorded head matches current source head; unchanged in this review wave.",
});

// Changed-pack sources reviewed at exact current pins (78 changed bodies)
add({
  repo: "Gully678/claude-seo",
  role: "FORGE skill library source",
  pin: pinSha(PIN_CLAUDE_SEO, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 25,
  changedBodies: 25,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "seo-agentic hub route and conditional seo-matomo/auth helper need exact closure qualification with honest unavailable states.",
});
add({
  repo: "Gully678/coldoutboundskills",
  role: "FORGE skill library source",
  pin: pinSha(PIN_COLDOUT, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 50,
  changedBodies: 13,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "Moved helper/cross-skill routes; one canonical decision contract for reply floors, placement verdicts and bounce-share; never infer cancellation, domain-purchase or seed-send authority from loaded bodies.",
});
add({
  repo: "Gully678/geo-seo-claude",
  role: "FORGE skill library source",
  pin: pinSha(PIN_GEO_SEO, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 15,
  changedBodies: 1,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "Crawler/citability policy conflict with other SEO sources must be reconciled against primary documentation with attribution.",
});
add({
  repo: "Gully678/knowledge-work-plugins",
  role: "FORGE skill library source",
  pin: pinSha(PIN_KNOWLEDGE, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 104,
  changedBodies: 9,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "Connector actions/scheduling/untrusted-context constraints go into the real INVRT/tool grant boundaries, not prompt-only.",
});
add({
  repo: "Gully678/last30days-skill",
  role: "FORGE skill library source",
  pin: pinSha(PIN_LAST30, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 1,
  changedBodies: 1,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "Adopt the whole moved runtime/discovery/setup/synthesis closure; distinct-key routing tests prevent cross-provider credential borrowing; retired monolith received structural deletion review.",
});
add({
  repo: "Gully678/marketingskills",
  role: "FORGE skill library source",
  pin: pinSha(PIN_MARKETING, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 31,
  changedBodies: 27,
  reviewRef: `${PKT}; ${COVDOC}`,
});
add({
  repo: "Gully678/scroll-craft",
  role: "FORGE skill library source",
  pin: pinSha(PIN_SCROLL, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 1,
  changedBodies: 1,
  reviewRef: `${PKT}; ${COVDOC}`,
  notes:
    "LAN screenshot mode exposes served-root files: keep loopback default; authorised LAN tests need an owned minimal fixture root with bind/path proof and captured-process cleanup.",
});
add({
  repo: "Gully678/taste-skill",
  role: "FORGE skill library source",
  pin: pinSha(PIN_TASTE, `${COVDOC}; ${INV}`),
  adoptionStatus: "pending",
  packsRecords: 13,
  changedBodies: 1,
  missingPaths: 12,
  reviewRef: `${PKT}; ${COVDOC}; ${MISSING}`,
  notes:
    "12 recorded specialist components absent at current source head: preserve until exact replacement/adaptation qualifies domain coverage; adopt the actual Node/browser/scripts/assets/data closure.",
});

// Pin-pending: Craft/Media family
const craft = [
  "Gully678/pdfcraft",
  "Gully678/artcraft-services",
  "Gully678/photocraft",
  "Gully678/wordcraft",
  "Gully678/filmcraft",
  "Gully678/effectcraft",
  "Gully678/cadcraft",
  "Gully678/vectorcraft",
  "Gully678/gridcraft",
  "Gully678/artcraft",
];
for (const repo of craft) {
  const notes = [];
  if (repo.endsWith("wordcraft") || repo.endsWith("gridcraft"))
    notes.push("Keeps the D3 inclusion/unavailable decisions (checklist).");
  if (repo.endsWith("artcraft-services"))
    notes.push(
      "Authenticated HTTP/async-worker/MySQL/object-store service with declared fair-source/WIP licence: keep the unresolved rights inventory and approved service boundary (packet action 7).",
    );
  if (repo !== "Gully678/artcraft-services")
    notes.push(
      "Desktop manifests declare Rust 1.95 plus external Git dependencies (e.g. storytold/craft-libs): include transitive consumed revisions in the source graph.",
    );
  add({
    repo,
    role: "Craft/Media capability integration",
    pin: null,
    adoptionStatus: "pending",
    reviewRef: `${CHECKLIST}; ${PKT}; ${INV}`,
    notes: notes.join(" "),
  });
}

// Pin-pending: selected workflow/quality methods
const methods = [
  "Gully678/agent-style",
  "Gully678/anti-slop",
  "Gully678/anti-slop2",
  "Gully678/mpskills",
  "Gully678/pstack",
  "Gully678/osmani-agent-skills",
  "Gully678/gstack",
];
const methodNotes = {
  "Gully678/agent-style":
    "6 copies but 2 canonical skill surfaces (packet); prose discipline adaptation is already applied in INVRT law 7.",
  "Gully678/anti-slop2": "Now includes a contrast MCP launcher as well as 6 skills (packet).",
  "Gully678/mpskills": "38 SKILL files but 27 explicit plugin exports (packet).",
  "Gully678/pstack": "61 raw vs 58 main skills plus 3 separate automation bodies (packet).",
  "Gully678/gstack":
    "Full delta inventory is 1383 changed paths (856 modified + 527 added); semantic review covers selected methods, not all 1383 files or 174 commits.",
};
for (const repo of methods) {
  add({
    repo,
    role: "Selected skill/quality/workflow methods, preserving INVRT orchestration",
    pin: null,
    adoptionStatus: "pending",
    reviewRef: `${CHECKLIST}; ${PKT}; ${INV}`,
    notes: methodNotes[repo],
  });
}

// Pin-pending: remaining FORGE skill libraries and tool provenance
add({
  repo: "Gully678/gsd-core",
  role: "FORGE skill library source (method adaptations, not a competing controller)",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 4,
  reviewRef: `${CHECKLIST}; ${INV}`,
  notes: "Do not import GSD hooks wholesale merely to obtain one skill (packet action 3).",
});
add({
  repo: "Gully678/ralph",
  role: "FORGE skill library source",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 2,
  reviewRef: `${CHECKLIST}; ${INV}`,
});
add({
  repo: "Gully678/claude-email",
  role: "FORGE skill library source",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 6,
  reviewRef: `${CHECKLIST}; ${INV}`,
});
add({
  repo: "Gully678/aaron-marketing-skills",
  role: "FORGE skill library source",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 120,
  reviewRef: `${CHECKLIST}; ${INV}`,
});
add({
  repo: "Gully678/ai-sales-team-claude",
  role: "FORGE skill library source",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 13,
  reviewRef: `${CHECKLIST}; ${INV}`,
});
add({
  repo: "Gully678/dataforseo-brain",
  role: "FORGE skill library source",
  pin: null,
  adoptionStatus: "pending",
  packsRecords: 1,
  reviewRef: `${CHECKLIST}; ${INV}`,
});
add({
  repo: "Gully678/graphify",
  role: "FORGE tool provenance: knowledge graph CLI/MCP (source/provenance record, not install authority)",
  pin: null,
  adoptionStatus: "pending",
  reviewRef: `${CHECKLIST}; ${PKT}; ${INV}`,
  notes:
    "CLI and MCP surfaces are distinct connections; semantic/provider extraction can transmit content and query logging has state; never enable as an implicit sync effect (packet action 6).",
});
add({
  repo: "Gully678/SkillSpector",
  role: "FORGE tool provenance: skill scanner (source/provenance record, not install authority)",
  pin: null,
  adoptionStatus: "pending",
  reviewRef: `${CHECKLIST}; ${PKT}; ${INV}`,
  notes:
    "Default LLM analysis sends eligible files to its provider and OSV checks query externally; a scanner PASS is not a sandbox or enterprise certificate (packet action 6).",
});

if (entries.length !== 41) throw new Error(`expected 41 entries, got ${entries.length}`);

const registry = {
  schemaVersion: 1,
  lastReviewed: REVIEWED,
  reviewRefs: {
    adoptionQueue: QUEUE,
    sourcesPacket: PKT,
    semanticCoverage: COVDOC,
    missingPathPreservation: MISSING,
    currentInventory: INV,
    syncChecklist: CHECKLIST,
    documentsRoot:
      "research/2026-10-27/ONE-DAY-RELEASE/ in the INVRT-CODE knowledge home (2026-10-27 review wave)",
  },
  summary: {
    sourcesTotal: 41,
    admittedRecords: 795,
    unchangedBodies: 694,
    changedBodies: 78,
    missingPaths: 23,
    localPilotDifferences: 176,
    changedBodiesBySource: {
      "claude-seo": 25,
      coldoutboundskills: 13,
      "geo-seo-claude": 1,
      "knowledge-work-plugins": 9,
      "last30days-skill": 1,
      marketingskills: 27,
      "scroll-craft": 1,
      "taste-skill": 1,
    },
    semanticCoverage: {
      currentBodiesReviewed: COVERAGE.current_bodies_reviewed,
      currentLines: COVERAGE.current_lines,
      fullLiteralUnifiedDiffs: COVERAGE.full_literal_unified_diffs,
      structuralOldDeletionDiff: COVERAGE.structural_old_deletion_diff,
    },
  },
  sources: entries,
};

NodeFS.mkdirSync(NodePath.dirname(OUT), { recursive: true });
NodeFS.writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n");
const packsTotal = entries.reduce((a, e) => a + (e.packsRecords || 0), 0);
const changedTotal = entries.reduce((a, e) => a + (e.changedBodies || 0), 0);
const missingTotal = entries.reduce((a, e) => a + (e.missingPaths || 0), 0);
console.log(
  `entries=${entries.length} packsSum=${packsTotal} changedSum=${changedTotal} missingSum=${missingTotal} pinned=${entries.filter((e) => e.pin && e.pin.kind === "sha").length} localPin=${entries.filter((e) => e.pin && e.pin.kind === "local").length} pinPending=${entries.filter((e) => e.pin === null).length}`,
);
