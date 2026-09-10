# Third-party licenses

Sentinel Forge is proprietary software (see `LICENSE`). It uses the third-party
components listed here, each under its own licence.

Every dependency is evaluated before it is added, against the policy in
`docs/DEVELOPMENT.md § Dependency policy`: maintenance status, security history,
licence, and compatibility with distribution inside a proprietary commercial
product.

## Runtime dependencies

**None.**

Sentinel Forge has no third-party runtime dependencies. The product runs on the
Node.js standard library alone, including its bundled SQLite implementation
(`node:sqlite`). This is a deliberate design decision:

- installation cannot fail on a native build step, which is the most common
  installation failure on Windows FiveM hosts;
- there is no third-party code in the process that reads an operator's server;
- there is no transitive supply chain to audit for a security-sensitive tool.

## Development dependencies

These are used to build and test the product. They are not distributed with a
release.

| Component | Version | Licence | Purpose |
| --- | --- | --- | --- |
| [typescript](https://www.typescriptlang.org/) | ^5.9.3 | Apache-2.0 | Compiler and type checker. |
| [vitest](https://vitest.dev/) | ^5.0.0 | MIT | Test runner. |
| [eslint](https://eslint.org/) | ^10.10.0 | MIT | Linter. |
| [@eslint/js](https://eslint.org/) | ^10.0.1 | MIT | ESLint's own recommended rule set. |
| [typescript-eslint](https://typescript-eslint.io/) | ^8.70.0 | MIT | Type-aware linting for TypeScript. |
| [globals](https://github.com/sindresorhus/globals) | ^17.12.0 | MIT | Global identifier definitions for ESLint. |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | ^22.19.0 | MIT | Type definitions for the Node.js standard library. |

Apache-2.0 and MIT are permissive licences compatible with distributing a
proprietary product. No GPL, LGPL, AGPL or source-availability-obligation
licence appears in this list, directly or transitively.

## Platform

| Component | Licence | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | MIT | Runtime. Version 22.5 or newer is required for `node:sqlite`. |
| [SQLite](https://sqlite.org/) | Public domain | Bundled with Node.js and used through `node:sqlite`. |

## Trademarks

FiveM, Cfx.re, Grand Theft Auto, GTA V, Rockstar Games and txAdmin are
trademarks of their respective owners. Sentinel Forge is an independent product
and is not affiliated with, endorsed by, or sponsored by any of them. These
names are used only to identify the environments Sentinel Forge analyses.

## Verifying this list

```bash
npm ls --all --omit=dev   # must report no third-party runtime dependencies
npx license-checker --production   # optional external audit
```
