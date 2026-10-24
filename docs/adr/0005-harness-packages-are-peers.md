# 5. Declare the harness's own packages as peers, not dependencies

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

The plugin imports three packages that belong to the harness: `@deepseek-ai/dsh-tools` (the tool registry and `defineTool`), `@deepseek-ai/dsh-mcp-client` (the MCP bridge the CLI Component mounts per Agent), and `@deepseek-ai/schemastery` (the `Config` schema library). It began by pinning the first two as exact `dependencies` at `0.2.1-rc.1`, the version that was current when the TypeScript rewrite landed.

`dsh` moved to `0.2.1-rc.2`. Two separate things then went wrong, and only the first is visible in a lockfile:

1. **A pinned copy shadows the runtime's copy.** `dsh` supplies its own `dsh-tools` and `dsh-mcp-client` and routes a plugin's bare import of one to the copy the running runtime was built with. That routing (`routeLinked` in `@deepseek-ai/dsh-app-boot`) only fires for a package the plugin lists as a **peer** — it reads the plugin's `peerDependencies` to decide whether the package belongs to the runtime. Declared as a `dependency`, the plugin's own `node_modules` wins the resolution, so the plugin loads `0.2.1-rc.1` classes while the harness runs `0.2.1-rc.2` ones. In one process that means two distinct `dsh-tools` module instances: `ToolOutputError`, `HarnessError` and every other class identity differ across the boundary, so an `instanceof` check on either side silently answers `false`.
2. **The compatibility gate cannot see the plugin at all.** `evaluatePluginCompatibility` reads `engines.dsh` or the `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` entries of `peerDependencies`. It ignores plain `dependencies`. With the harness packages declared as dependencies, the gate found no requirement and reported the plugin compatible with every `dsh` version — including ones it would break on.

Neither failure shows up in the suite: both copies of `dsh-tools` happen to export the same names, and `defineTool` returns a plain object, so the tool this plugin registers keeps working by luck. The exposure is the next harness release that changes a class, a signature, or the registry contract.

## Decision

- **Harness-owned packages are `peerDependencies`**, ranged `^0.2.1-rc.1`. A caret on a prerelease admits the whole `0.2.1` line, so one range covers both the version this repo develops against and whatever `0.2.1-rc.N` the runtime ships.
- **They stay in `devDependencies`** at the exact version the repo builds and tests against, so `tsc` and `node --test` resolve the types and the runtime without a harness installed.
- **`schemastery` stays a plain `dependency`.** It is a general schema library rather than a harness service, it carries no `@deepseek-ai/dsh-` prefix, the compatibility gate never inspects it, and it keys its identity off `Symbol.for("schemastery")` rather than a class reference, so two copies interoperate.
- **A test holds the split.** `test/bundle-manifest.test.ts` fails if either harness package returns to `dependencies`, loses its peer range, or drops out of `devDependencies`.

## Consequences

- The plugin resolves the harness's own `dsh-tools` and `dsh-mcp-client`, so there is one class identity per process and `instanceof` works across the plugin boundary.
- `evaluatePluginCompatibility` now sees the requirement: `0.2.1-rc.1`, `0.2.1-rc.2` and `0.2.1` pass, `0.3.0` and `0.1.9` are flagged before the plugin loads. An incompatible harness is reported instead of failing at runtime.
- `npm install` reports the peers as unmet when the repo is installed on its own, which is accurate: the harness supplies them. A `devDependency` copy keeps the suite self-contained.
- The two `devDependency` pins are `0.2.1-rc.1` rather than `0.2.1-rc.2` because `dsh-mcp-client@0.2.1-rc.2` peer-depends on `@deepseek-ai/dsh-llm@0.2.1-rc.2`, which would pull a second harness tree into this repo's `node_modules` for no gain: the two `dsh-tools` builds are byte-identical and the suites are the same. The range, not the pin, is what the runtime reads.

## Alternatives considered

- **Pin the harness packages as exact dependencies at each harness release.** Rejected: it re-creates the shadowing on every bump, needs a release of this plugin per harness release, and leaves the compatibility gate blind in between.
- **Bundle the harness packages into the plugin.** Rejected: they are cordis services whose identity must match the runtime's, so bundling guarantees the split this record exists to prevent.
- **Declare `engines.dsh` instead of peer ranges.** Workable — it decides alone and the peers are then ignored — but it states one runtime version rather than the packages actually imported, and a peer range already carries the information the gate needs.
