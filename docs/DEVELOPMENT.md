# Development

© 2026 Talal Al Ghafri. All Rights Reserved.

## Requirements

- Node.js 22.5 or newer (`node:sqlite` is unavailable below this)
- npm 10 or newer

No other toolchain is needed. There is no native build step.

## Setup

```bash
npm install
npm run build
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Regenerate embedded migrations, then compile every package. |
| `npm run typecheck` | Type-check packages and the test suites. |
| `npm run lint` | ESLint with type-aware rules. |
| `npm test` | Every test project. |
| `npm run test:unit` | Unit tests, co-located with the code they cover. |
| `npm run test:integration` | Cross-component tests in `tests/integration/`. |
| `npm run test:security` | Security invariants in `tests/security/`. |
| `npm run test:performance` | Traversal and hashing benchmarks. |
| `npm run check:migrations` | Fail if embedded migrations are stale. |
| `npm run verify` | The full gate: migrations, lint, typecheck, build, tests. |

`npm run verify` is what CI runs and what must pass before a gate is declared
complete.

## Layout

```
apps/cli              CLI entry point and commands
packages/shared       Pure contracts: types, rule catalog, report schema
packages/core         Config, logging, redaction, errors, fs, SQLite, rules
database/migrations   Forward-only SQL, the source of truth for the schema
scripts/              Build tooling
tests/fixtures        Synthetic FiveM servers
tests/integration     Cross-component tests
tests/security        Security invariants
tests/performance     Benchmarks
```

Unit tests live beside the code as `*.test.ts` and are excluded from build
output. They are type-checked through `tsconfig.test.json`, because Vitest does
not type-check on its own and an untyped test can pass while importing something
that does not exist.

## Adding a package

1. Create `packages/<name>/` with a `package.json` and a `tsconfig.json`
   extending `tsconfig.base.json` and referencing its dependencies.
2. Add it to `workspaces` in the root `package.json` and to `references` in the
   root `tsconfig.json`.
3. Add an alias in `vitest.config.ts` so tests resolve source, not build output.

Directories for packages a later gate delivers contain a README stating their
status. They are not registered as workspaces until they contain real code — an
empty compiled package is a claim that something exists.

## Adding a rule

1. Add the entry to `packages/shared/src/rules/catalog.ts`: id, category,
   default severity, description, rationale, **known false positives**, and
   evidence requirements. Rule ids are a published contract — choose carefully,
   because changing a meaning later requires a new id.
2. Implement `RuleDefinition` in the owning package. Rules are pure: no I/O.
3. Build findings with `createFinding`. It enforces the invariants centrally.
4. Write tests against a fixture — including a **negative** test proving the
   rule does not fire on the healthy fixture.
5. Set `status: 'IMPLEMENTED'` in the catalog only once the rule actually runs.

A false positive is a product defect. If a rule can fire on a benign pattern,
that pattern belongs in `falsePositives` and, where possible, in the confidence
calculation.

## Adding a migration

1. Create `database/migrations/NNNN_snake_case.sql`. Versions are contiguous
   from 1.
2. Run `npm run generate:migrations`, and commit the generated file with it.
3. Never edit an applied migration. The runner records each migration's checksum
   and refuses to continue if one changes.

## Dependency policy

The product has **no third-party runtime dependencies**, and that is a design
goal rather than an accident: a tool that reads other people's servers should
not carry a transitive supply chain, and an installation that needs a native
build step fails often on Windows hosts.

Before adding any dependency — development ones included — check and record:

1. **Maintenance:** actively maintained, recent releases, responsive to security
   reports.
2. **Security:** no unresolved advisories.
3. **Licence:** permissive (MIT, Apache-2.0, BSD, ISC). No GPL, LGPL or AGPL in
   anything that ships.
4. **Commercial compatibility:** distributable inside a proprietary product.
5. **Necessity:** would writing it directly be comparable in size to the
   integration?

Then add it to `THIRD_PARTY_LICENSES.md` in the same commit.

## Code conventions

- Strict TypeScript. `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are all on.
- ESM with explicit `.js` extensions on relative imports.
- Comments explain *why*. What the code does should be readable from the code.
- Errors are `SentinelError` subclasses so every failure has a category, an exit
  code and an error id.
- Diagnostic wording: *detected*, *observed*, *evidence indicates*, *likely
  related*, *requires review*. Never *guaranteed*, *definitely malicious*,
  *definitely caused*, *100% fixed*.
- Never invent data. If something was not measured, it is `Unavailable` or
  `Not collected`.

## Testing conventions

- A test names the property it protects, not the function it calls.
- Security invariants belong in `tests/security/` so they can be run and
  reported on their own.
- Fixtures are synthetic and fictional. Credential-shaped values use an
  `EXAMPLE_`/`FIXTURE` marker, which a hygiene test enforces.
- Benchmarks assert generous ceilings that catch a change in complexity, not a
  slow machine, and print their timings.

## Gate discipline

A gate is complete only when: implementation exists, tests exist and pass,
typecheck passes, lint passes, the build passes, security implications are
reviewed, documentation is updated, limitations are documented, no placeholder
functionality remains, and `docs/GATE_STATUS.md` is updated.

Do not begin a later gate's work early. Partial features across several gates
are harder to verify than one finished gate.
