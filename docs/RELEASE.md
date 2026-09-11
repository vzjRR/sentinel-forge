# Release process

© 2026 Talal Al Ghafri. All Rights Reserved.

## Versioning

Semantic Versioning. Three version numbers exist and move independently:

| Version | Meaning | Where |
| --- | --- | --- |
| Product version | The release itself. | `package.json`, `PRODUCT_VERSION` |
| Report schema version | The JSON report contract. | `REPORT_SCHEMA_VERSION` |
| Database schema version | The local storage schema. | Highest applied migration |

`0.x` releases are pre-MVP: the CLI surface can still change between minor
versions. From `1.0.0`, exit codes, rule ids and the report schema are stable
within a major version.

## Rule stability

A rule id is a public contract. It appears in reports, in CI failure conditions
and in user configuration.

- **Never** change what an existing id means. Retire it and publish a new id.
- Tightening a rule to reduce false positives is a patch or minor change.
- Broadening a rule so it reports new patterns is a minor change and must be
  noted in the changelog.
- Changing a rule's default severity is a minor change and must be noted.

Every rule's status in `packages/shared/src/rules/catalog.ts` must be accurate at
release time. A rule marked `IMPLEMENTED` that does not run is a defect.

## Report schema changes

- Adding an optional field: minor.
- Adding a required field, removing a field, or changing a field's type or
  meaning: major, with a bump to `REPORT_SCHEMA_VERSION` and a migration note in
  `docs/API.md`.
- Never change the shape silently.

## Release checklist

Everything here is verified before a release is tagged.

**Build and tests**

- [ ] `npm run check:migrations` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test:unit` passes
- [ ] `npm run test:integration` passes
- [ ] `npm run test:security` passes
- [ ] `npm run test:performance` passes
- [ ] `npm run build` passes
- [ ] The packaged CLI runs from a clean checkout

**Security** (see `SECURITY.md § Release checklist`)

- [ ] No secrets committed
- [ ] No raw credentials in reports
- [ ] Path traversal and symlink escape tests pass
- [ ] Report redaction tests pass
- [ ] No arbitrary shell execution, Lua execution or downloads
- [ ] Dashboard local-only by default
- [ ] Telemetry disabled by default
- [ ] Security claims accurately worded
- [ ] No production data in the repository

**Documentation**

- [ ] `docs/GATE_STATUS.md` reflects reality
- [ ] `docs/COMPATIBILITY.md` records what was actually tested
- [ ] `docs/CLI.md` matches the implemented command surface
- [ ] `docs/API.md` matches the emitted schema
- [ ] `CHANGELOG.md` updated
- [ ] `THIRD_PARTY_LICENSES.md` matches the dependency tree
- [ ] No capability is described as available when it is not

**Honesty review**

- [ ] No fake data, no fake telemetry, no invented metrics
- [ ] Every `NOT IMPLEMENTED` capability says so in the CLI and the docs
- [ ] No claim of guaranteed detection, guaranteed causation, or perfect coverage

## Release contents

A release contains the CLI, the dashboard, the `sentinel_doctor` resource,
documentation, `LICENSE`,
`THIRD_PARTY_LICENSES.md`, compatibility information and the changelog.

It never contains secrets, production data, developer credentials, test
credentials, or source maps for production builds.

## Runtime overhead

The in-server collector's footprint is checked before every release. Significant
overhead is a release blocker, not a known issue.

Two parts, measured differently:

1. **Disk and ingestion cost — automated.** `npm run test:performance` measures
   the worst-case and steady-state size of the telemetry the collector writes,
   and the cost of importing a full rotation. These run in CI like any other
   test.
2. **In-server CPU and tick cost — manual.** It requires a running FiveM server,
   which no automated test has. Run the profiler comparison documented in
   `resources/sentinel_doctor/README.md` (record with the collector stopped,
   then with it running) on a server carrying real load, and record the result
   in the release notes.

Step 2 is not skippable because step 1 passed. They measure different things,
and only step 2 measures the cost the operator actually pays.
