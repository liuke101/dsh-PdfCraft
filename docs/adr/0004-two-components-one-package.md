# 4. Activate the Panel and the engines as two components in one installable package

- **Status:** Accepted
- **Date:** 2026-10-21
- **Issues:** #12, #14, #15, #16

## Context

The plugin began as one JavaScript bundle in which two unrelated jobs shared one activation: serving the Panel (the Embedded App assets, the Workspace Document read and Write-back routes, the Host Bridge, the Push Channel, and the open entries) and running one PdfCraft engine per live agent. A change to either job sat beside the wiring for the other, and one configuration schema mixed the fields of both. #12 asked for the project to be rewritten in TypeScript with the two jobs as separate components, without changing what the person, the agent, or a profile owner sees.

The harness and the install path constrain the split:

- A Loader row names one module. That module's exported `apply`, `Config`, and `inject` are the activation.
- The shell's `@deepseek-ai/dsh-client-modules` reads a package's `dsh.client` declaration only from a Loader row whose name is the bare package name. A row named with a subpath (`dsh-pdfcraft/web`) contributes no browser bundle in `0.2.1-rc.1`: the host half loads, but the Panel page silently never registers.
- The engines are mounted per Agent and listen to agent lifecycle events. The Panel serves HTTP routes and publishes services. Neither needs the other at runtime.
- A person installs and upgrades the bundle with one command (`dsh plugin --profile web add`). Splitting it into two installable packages would add work to that path and let the two halves drift in version.

## Decision

- **One package, two component entries.** The package stays `dsh-pdfcraft` and installs once. `exports["."]` and `exports["./web"]` name the Web Component entry (`dist/web/index.js`); `exports["./cli"]` names the CLI Component entry (`dist/cli/index.js`). The bundle patch inserts both Loader rows.
- **Two rows, two ids.** `pdfcraft-web` activates the Web Component and `pdfcraft-cli` activates the CLI Component. Both are active by default. The Web row keeps the bare package name and the CLI row uses the `./cli` subpath. The web row must stay bare for client discovery; the CLI row has no browser half, so a subpath is safe there.
- **The Web Component owns the Panel and its host surface.** It registers the asset and readiness routes, the Workspace Document read and Write-back routes, the binding registry published as `pdfcraftBindings`, the Push Channel published as `pdfcraftOpens`, the `/pdfcraft` command, and the `pdfcraft_open` tool. It configures `webBuildDir`, `openTool`, and `maxDocumentBytes`.
- **The CLI Component owns the engines.** It mounts the shipped MCP client on each Agent's scoped context, runs `pdfcraft-cli mcp --root <root>`, follows the idle and disposal lifecycle, and configures `cliPath`, `staticRoot`, and `compactSurface`.
- **Each row validates only its own fields.** A profile patch replaces that row's whole `Config`, so tuning the engines does not restate the Panel's fields and vice versa. The two entries share host *types* through `src/shared/host.ts`; they share no runtime state and neither imports the other.
- **The browser half stays package-level.** It keeps the same `__ModuleLoader__` envelope and id (`dsh-pdfcraft`) and activates with the Web row. Disabling `pdfcraft-web` therefore withdraws the Panel page as well as its routes; disabling `pdfcraft-cli` withdraws only the engine tools.
- **One package-level locale.** The package keeps one `locale/*.json` at its root for both components. The `./cli/locale/*.json` export alias lets the `pdfcraft-cli` subpath row resolve the same dictionaries as the bare `pdfcraft-web` row, so the bundle and both rows are titled `dsh-pdfcraft` in English and Chinese, with a description naming the Panel and the agent tools. The Panel's own page title stays `PdfCraft`, from the browser half's dictionary.
- **The old row disappears, and its patch is skipped loudly.** A profile patch that still targets `- id: pdfcraft` matches no row. The harness Loader warns `patch: entry "pdfcraft" not found` and skips it. The README carries a field-by-field migration table, because the old values do not carry over.

## Consequences

- Installing and upgrading is unchanged: one package, one profile dependency, one bundle selection. The plugin list shows two rows, and each can be disabled to isolate a failure.
- The Panel and the engines can be changed, tested, and reasoned about separately. The suite drives the two entries independently and together.
- Disabling the CLI row leaves the Panel fully functional, including open requests and Write-back. Disabling the Web row leaves the agent's MCP tools working, but also withdraws the Panel page; that is the price of the browser bundle being package-level.
- Both rows share the package's one locale: the plugin list shows the bundle and both rows titled `dsh-pdfcraft`, not two localized components. The Panel page keeps `PdfCraft`.
- The package version moves to 0.2.0 and the row ids become `pdfcraft-web` and `pdfcraft-cli`, so existing profile overrides must be moved. A patch that still targets `pdfcraft` is warned about and skipped, and the migration table maps every field; the migration itself is manual.
- The Web row cannot use a `dsh-pdfcraft/web` specifier while `dsh-client-modules` reads `dsh.client` only from bare package rows. If the harness gains subpath client rows, the row can be renamed; until then the bare specifier is load-bearing, not cosmetic.
- Two active rows mean two plugin fibers instead of one. The extra fiber is small and has no shared state; the engines' own process cost is unchanged.
- A fresh CLI activation adopts the Agents that are already live, through the `agents` registry, so toggling a row or reloading the component does not leave an open conversation without tools.

## Alternatives considered

- **Two npm packages, each installed separately.** Rejected: two installs, two versions that can skew, and a shared route/release module and locale that would have to be published twice or copied. The person would also have to keep two bundle selections straight.
- **One package with one row that activates both halves.** This is the starting point the split exists to remove. It keeps the two jobs' wiring and configuration adjacent.
- **A `dsh-pdfcraft/web` row for the Web Component.** Rejected for `0.2.1-rc.1`: the client-modules scan returns early on a subpath, so the Panel's browser half never registers. Revisit when the harness supports subpath client rows.
- **A separate bare carrier row for the browser half.** Rejected: a third activation for one page, with its own load order and failure mode, to gain cosmetic symmetry in the row name.
- **A workspace or monorepo package per component.** Rejected: the distribution is one installed folder; a workspace adds tooling without changing the install.
