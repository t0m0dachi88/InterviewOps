# Phase 5 Slice 1 — Windows runtime verification runbook

Status: **Not accepted / execution pending**. This runbook adds database-backed acceptance tests. It does not claim that they passed.

## Environment

- Windows 10/11, **Node.js 22.22.0 or newer within Node 22**, and the npm shipped with that Node distribution. Check `node -v` and `npm -v`.
- Network access to `https://registry.npmjs.org/` for the first install. The prior isolated runtime failed with `EAI_AGAIN` and an incomplete offline npm cache. **Do not remove or regenerate `package-lock.json`, modify dependencies, or force an installation**.
- Existing monorepo root `package.json`, `package-lock.json` (lockfile v3), `apps/*` and `packages/*` npm workspaces.
- Test-only MongoDB: `apps/api/src/test/db.js` starts a **new MongoMemoryServer instance** and connects Mongoose to its generated URI. It never uses the production Atlas URI. `clearTestDb()` deletes documents in every connected test collection before each test. Never point these tests at a production database.
- `mongodb-memory-server` requires a compatible MongoDB server binary. Either allow it to fetch a matching Windows x64 binary, or install a suitable local MongoDB Community Server for Windows and configure `MONGOMS_SYSTEM_BINARY` as below. Version compatibility depends on the installed mongodb-memory-server release. A Windows binary must be selected for the Windows host.

## Commands (PowerShell, run from extracted repository root)

```powershell
$ErrorActionPreference = 'Stop'
node --version
npm --version
npm config get registry
Test-Path .\package-lock.json
# Must return True; do not replace the lockfile.
Test-NetConnection registry.npmjs.org -Port 443
npm ping --registry=https://registry.npmjs.org/

# Option A: automatically downloaded *test* mongod binary (requires network)
Remove-Item Env:\MONGOMS_SYSTEM_BINARY -ErrorAction SilentlyContinue

# OR option B: use a separately installed compatible Windows mongod executable:
# $env:MONGOMS_SYSTEM_BINARY = 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe'
# & $env:MONGOMS_SYSTEM_BINARY --version

# Install EXACT versions from existing package-lock.json (root npm workspaces)
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; stop and inspect the error before testing' }

# Slice 1 original plus newly added acceptance suite
npm run test --workspace=@platform/api -- src/__tests__/rubrics.test.js src/__tests__/rubrics.verification.test.js
if ($LASTEXITCODE -ne 0) { Write-Warning 'Slice 1 integration tests failed; record output and fix the actual issue.' }

# Full Phase 0-4 and Slice 1 API regression
npm run test --workspace=@platform/api
# Worker regression
npm run test --workspace=@platform/worker
# Frontend unit tests
npm run test --workspace=@platform/web
# Shared package regression (optional additional scope)
npm run test --workspace=@platform/shared
# Frontend production build
npm run build --workspace=@platform/web
```

PowerShell defaults to continuing after native command nonzero exits in some versions, so inspect every displayed exit code and command result. For a fail-fast sequence, execute each command separately and stop when one fails. Save full output/transcripts:

```powershell
Start-Transcript -Path .\slice1-verification-transcript.txt
# Run the commands above here
Stop-Transcript
```

For npm download failures, check proxies, registry configuration, certificate trust, DNS and firewall policy (`npm config get proxy`, `npm config get https-proxy`, `Resolve-DnsName registry.npmjs.org`). Avoid `--force`, `--legacy-peer-deps`, changing the registry lockfile URLs or disabling TLS as workarounds. When a binary download is blocked, supply a locally installed `mongod.exe` via `MONGOMS_SYSTEM_BINARY`. The test binary must be compatible with the version requested by `mongodb-memory-server`.

### Acceptance and evidence

Record Node/npm versions; test MongoDB version (`mongod --version` when configured); each command and its exit code; Vitest per-suite test counts and names; any skipped tests; frontend TypeScript/Vite exit status; discovered bugs; and fixes. All tests must execute against the test MongoDB instance. A successful static syntax check or file inspection does not count as integration verification.

## Historical rubric version integrity and scaling

Slice 1 uses **one `EvaluationRubric` document per rubric**, with `versions[]` storing fully copied, numbered historical versions, `currentVersion`, status and audit fields. The service's `createRubricVersion` uses a single MongoDB atomic `findOneAndUpdate` filtered on `_id`, `organizationId`, `status: active` and `currentVersion: expectedVersion`, with `$push` to append and `$inc` to increment. Two competing writes with the same expectedVersion cannot both match once the first succeeds. `archiveRubric` updates status and archive metadata without deleting `versions[]`. These are design claims until the database-backed tests actually run.

MongoDB has a **16 MiB maximum BSON document size**. With at most 30 criteria and bounded lengths per criterion, each stored rubric version can add kilobytes or, in a deliberately text-heavy upper-bound case, tens of kilobytes; actual size depends on criteria count and text. A rubric with 8 short criteria likely remains small across tens of revisions, but large histories can eventually hit the BSON limit. Because the entire version array is embedded in a single document, appending increases document size and write amplification; reading the document with all historical versions also grows cost as revisions accumulate. At larger scale, split versions into a separate immutable `EvaluationRubricVersion` collection with a compound unique index on `(rubricId, version)`, and keep the current version pointer on the parent. **No such migration is justified for expected MVP use yet**, absent observed document-size or write-throughput pressure.

**Trust boundary:** historical immutability is enforced by the authorized **rubric service operation**, not by MongoDB-level rules or a cryptographic tamper-proof mechanism. A database user with direct update privileges, an arbitrary Mongoose write path, or an operator with Atlas admin access can mutate embedded versions; the schema alone does not stop this. Only authenticated application routes with `RUBRIC_MANAGE` should invoke version-appending operations. Runtime credentials must be secret; restrict DB network access and grant the app only its required collection privileges, with no `dropDatabase`, `dropCollection`, user/role administration, or production schema-admin rights. Admin/DBA identities remain privileged and should be separately controlled, logged and subject to access review. Backups / point-in-time restoration and DB audit policies are required for stronger forensic recovery. Future service paths must NEVER use unrestricted `$set: { versions: ... }` or directly save mutated history; regression tests should guard this contract.

**Snapshot selection:** the approved Phase 5 design freezes the rubric version upon **first scorecard creation** (Slice 3); this is not yet an implemented runtime capability in Slice 1. Interview rescheduling must not silently alter an existing scorecard snapshot. Archived rubrics remain retrievable historically but cannot be versioned.

## Scope

This runbook and `rubrics.verification.test.js` cover Slice 1 only. No Slice 2 frontend has been built. Production MongoDB Atlas, Upstash, LiveKit, Judge0 and email delivery are not verified by the rubric integration tests.
