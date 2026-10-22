# dsh-PdfCraft

A DeepSeek Harness bundle that puts [PdfCraft](https://github.com/storytold/pdfcraft) in DSH's right sidebar and gives the conversation's agent the upstream PdfCraft MCP tools, confined by default to that conversation's workspace.

The workspace file is where the person and the agent meet. The Panel edits the real PDF on disk; the agent edits the same file through `pdfcraft-cli`; a save made in the Panel is written back under a revision guard, so a change the agent made in the meantime is never overwritten silently.

The bundle installs once and activates as two components: the **Web Component** serves the Panel, and the **CLI Component** runs one PdfCraft engine per live agent. They share no runtime state and have separate configuration.

The Embedded App is the unmodified upstream PdfCraft web build. It is served from the profile's own origin, not from a separate server and not from a copy checked into this repository.

## What you get

- **A real PdfCraft Panel.** The right-sidebar page is an iframe of the upstream web application, with PdfCraft's own menus, toolbars and preferences. This plugin adds no native toolbar of its own.
- **PdfCraft tools for the agent.** Each live agent gets the upstream `pdfcraft-cli mcp` server mounted on its own scoped context, rooted at its conversation's workspace. The default surface is compact; the full catalogue is one switch away.
- **One Workspace Document.** The Panel reads a Workspace Document from the conversation's workspace and writes saves back to it. By default, the agent's tools read and write the same directory.
- **Containment.** The Panel's Workspace Document routes resolve every requested path to its real path and refuse anything outside the conversation's workspace. By default, the agent's engine runs with the same directory as its `--root`.
- **No extra service.** There is no plugin-owned port, the plugin makes no outbound network requests, and there is no MCP row to configure by hand. The Panel's assets, Workspace Document routes and open channel all live on the DSH profile's own origin.

### Components and rows

The bundle patch inserts two Loader rows, and both are active at once:

| Row | Module | Owns |
|---|---|---|
| `pdfcraft-web` | `dsh-pdfcraft` (the bare package name) | The Embedded App assets and readiness report, the Workspace Document read and Write-back routes, the binding registry and Push Channel services, the `/pdfcraft` command, and the `pdfcraft_open` tool. |
| `pdfcraft-cli` | `dsh-pdfcraft/cli` | The per-agent PdfCraft engines and their lifecycle. |

The package exposes both entries: `exports["."]`, with `exports["./web"]` as its alias, resolves to the Web Component (`dist/web/index.js`); `exports["./cli"]` resolves to the CLI Component (`dist/cli/index.js`). Display text is resolved per specifier: `locale/*.json` titles the bundle and the `pdfcraft-web` row `dsh-pdfcraft`, and `locale/cli/*.json`, exported as `./cli/locale/*.json`, titles the `pdfcraft-cli` row `dsh-pdfcraft-cli`, each with its own description. The Panel page keeps its own title, `PdfCraft`.

The Web row keeps the bare package name because the shell's `dsh-client-modules` reads a package's `dsh.client` declaration only from a bare Loader row. The Panel's browser half is part of that package, so it activates with the Web row: disabling `pdfcraft-web` withdraws the Panel page and its routes as well as the command and the open tool. Disabling `pdfcraft-cli` withdraws only the agent's engines; the Panel keeps opening, reading and writing back. Disabling `pdfcraft-web` leaves the MCP tools working, because they live in the CLI Component.

```text
Person ── right-sidebar Panel ── iframe ──▶ PdfCraft web build (/pdfcraft/)
                  │                                │
                  │ Host Bridge (postMessage)      │ Save / Open
                  ▼                                ▼
             DSH host  ── /pdfcraft/document ──▶ Workspace Document
                  ▲                                ▲
Agent ── MCP client ── stdio ──▶ pdfcraft-cli mcp ──┘
                                --root <workspace>
```

## Verified environment

This repository is developed and verified on **Linux x86_64** with **DSH `0.2.1-rc.1`** and **PdfCraft `0.9.0`**. Other platforms are not verified as part of this work.

You need:

- A DSH web profile (`dsh web`).
- `pnpm` on `PATH`, because `dsh plugin` uses it. The install steps below also use `git`, `curl`, `tar`, and either `python3` or `unzip`.
- Node.js as required by your DSH installation. No build step and no Rust toolchain are needed for this plugin.
- About 150 MB of disk for the two upstream artifacts.
- A browser with WebGPU or WebGL2, which the PdfCraft web application itself requires.

## 1. Download the two pinned upstream artifacts

The plugin ships no PdfCraft code or binaries. Both artifacts come from the **PdfCraft v0.9.0** release, not from this repository:

<https://github.com/storytold/pdfcraft/releases/tag/v0.9.0>

| Artifact | Release asset | SHA-256 |
|---|---|---|
| Command-line engine, Linux x86_64 | `pdfcraft-cli-0.9.0-linux-x86_64.tar.gz` | `cdba2bec4d502d016dd78101a402d07845b708c49d77bc85e0ab640aca65372b` |
| Command-line engine, Linux aarch64 | `pdfcraft-cli-0.9.0-linux-aarch64.tar.gz` | `6a5316da69300fc30cd7355cba1c5a9c307ceb741bcce91ba0c5c835350ca0a2` |
| Command-line engine, macOS universal | `pdfcraft-cli-0.9.0-macos-universal.zip` | `c20b8ced630417d47042ee37282fdb8362a29ebbc0b0bec3f4f635d0e28545f0` |
| Web build, all platforms | `pdfcraft-web-0.9.0.zip` | `eb465508b0623be27b07ef5145c0670c71ddd7791b4541721358b59c7e0a722e` |

Only the Linux x86_64 command-line engine is verified here; the other rows name the same release's assets for reference. The web build is platform-independent.

Download the two assets for your platform plus the release's checksum file into one directory:

```sh
mkdir -p "$HOME/pdfcraft-download"
cd "$HOME/pdfcraft-download"

BASE=https://github.com/storytold/pdfcraft/releases/download/v0.9.0
curl -fLO "$BASE/pdfcraft-cli-0.9.0-linux-x86_64.tar.gz"
curl -fLO "$BASE/pdfcraft-web-0.9.0.zip"
curl -fLO "$BASE/SHA256SUMS.txt"
```

### Verify what you downloaded

`SHA256SUMS.txt` is the release's own checksum file, downloaded from the same `BASE` URL above; it is not a file in this repository. Verify exactly the two artifacts you downloaded, so a missing one fails instead of being skipped:

```sh
cd "$HOME/pdfcraft-download"
CLI=pdfcraft-cli-0.9.0-linux-x86_64.tar.gz
WEB=pdfcraft-web-0.9.0.zip

grep -E "  (${CLI}|${WEB})\$" SHA256SUMS.txt | sha256sum --check
```

If you downloaded a different command-line asset, set `CLI` to that filename from the table above. On macOS, use the system tool for the check half:

```sh
grep -E "  (${CLI}|${WEB})\$" SHA256SUMS.txt | shasum -a 256 -c
```

You should see both downloaded artifacts named with `OK`:

```text
pdfcraft-cli-0.9.0-linux-x86_64.tar.gz: OK
pdfcraft-web-0.9.0.zip: OK
```

A missing file says `FAILED open or read`; a corrupt file says `FAILED`. Either one stops the command with a non-zero exit status. Delete the bad file and download it again; do not install it.

The SHA-256 values in the table above are the same values in `SHA256SUMS.txt` from v0.9.0, repeated here so the pin is visible without a network request.

## 2. Install the command-line engine and the web build

If you already have a `pdfcraft-cli` you trust, skip the CLI extraction below and point `cliPath` at it; the web build has no substitute. Otherwise, put `pdfcraft-cli` on `PATH`:

```sh
cd "$HOME/pdfcraft-download"
tar xzf pdfcraft-cli-0.9.0-linux-x86_64.tar.gz
mkdir -p "$HOME/.local/bin"
install -m 755 pdfcraft-cli-0.9.0-linux-x86_64/pdfcraft-cli "$HOME/.local/bin/pdfcraft-cli"
"$HOME/.local/bin/pdfcraft-cli" --version
```

The last command starts with `pdfcraft-cli 0.9.0`. If `$HOME/.local/bin` is not on your `PATH`, note the absolute path; you will set `cliPath` to it below.

Put the web build where the bundle expects it by default:

```sh
cd "$HOME/pdfcraft-download"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$DSH_HOME/pdfcraft"
python3 -m zipfile -e pdfcraft-web-0.9.0.zip "$DSH_HOME/pdfcraft/"
mv "$DSH_HOME/pdfcraft/pdfcraft-web-0.9.0" "$DSH_HOME/pdfcraft/web"
test -f "$DSH_HOME/pdfcraft/web/index.html" && echo "web build in place"
```

`python3 -m zipfile` is used so the command does not depend on `unzip`; `unzip pdfcraft-web-0.9.0.zip -d "$DSH_HOME/pdfcraft/"` works too if you have it. The bundle patch defaults `webBuildDir` to `$DSH_HOME/pdfcraft/web` (that is `~/.dsh/pdfcraft/web` when `DSH_HOME` is unset), so this location needs no configuration.

If you would rather keep the extracted folder under its release name, skip the `mv` and set `webBuildDir` to `$DSH_HOME/pdfcraft/pdfcraft-web-0.9.0` in the configuration step.

## 3. Install the bundle

Install this package into the `web` profile:

```sh
git clone https://github.com/liuke101/dsh-PdfCraft.git
cd dsh-PdfCraft
dsh plugin --profile web add "$PWD"
```

Run this while DSH is not running, or restart `dsh web` afterwards. `dsh plugin` initializes the profile if it does not exist yet, adds the package, and selects the bundle.

The command installs the package as a profile dependency. The repository is the distribution; this package is not published to npm.

Start DSH and check the result:

```sh
dsh web
```

- The plugin list shows the bundle and the `pdfcraft-web` row as `dsh-pdfcraft`, and the `pdfcraft-cli` row as `dsh-pdfcraft-cli`. Both rows must be active for the Panel and the agent's tools together; each works without the other.
- The right sidebar has exactly one **PdfCraft** entry: through DSH-better-sidebar when that plugin is active, otherwise through DSH's own right sidebar. The plugin never registers both.
- Typing `/pdfcraft` in a conversation opens the Panel in Standalone Mode.
- The agent's tool list contains tools named `mcp__pdfcraft-<hash>__<tool>`; the hash is derived from the workspace and stays stable for it.
- If the web build is missing, the Panel says so with the file to fetch and the directory currently configured. This is covered in [When something is missing](#when-something-is-missing).

## 4. Configure it

The defaults work when the web build is at `$DSH_HOME/pdfcraft/web` and `pdfcraft-cli` is on `PATH`. To change anything, add an override for the row you are changing in the profile patch:

`$DSH_HOME/profiles/web/cordis.patch.yml`

```yaml
- id: pdfcraft-web
  name: dsh-pdfcraft
  config:
    webBuildDir: !!js dshHomePath('pdfcraft', 'web')
    openTool: true
    maxDocumentBytes: 33554432
- id: pdfcraft-cli
  name: dsh-pdfcraft/cli
  config:
    cliPath: /home/me/.local/bin/pdfcraft-cli
    staticRoot: ''
    compactSurface: true
```

A profile patch **replaces the row's whole `config` object**, so include every field you want to keep on that row. The example shows every field of both rows. All values except `cliPath` are the shipped defaults; `cliPath` points at the path installed above. Change only the values you need, but keep `webBuildDir` (or set it explicitly) on the Web row rather than dropping it by accident. Configuration changes apply when the profile reloads; restart DSH if your profile does not use HMR.

### Migrating from the old single row

Before 0.2.0 the bundle inserted one row, `pdfcraft`, with all six fields. The split moves each field to the component that owns it:

| Old field on `pdfcraft` | New row | New field |
|---|---|---|
| `webBuildDir` | `pdfcraft-web` | `webBuildDir` |
| `openTool` | `pdfcraft-web` | `openTool` |
| `maxDocumentBytes` | `pdfcraft-web` | `maxDocumentBytes` |
| `cliPath` | `pdfcraft-cli` | `cliPath` |
| `staticRoot` | `pdfcraft-cli` | `staticRoot` |
| `compactSurface` | `pdfcraft-cli` | `compactSurface` |

A profile patch that still targets `- id: pdfcraft` matches no row after the upgrade. The Loader warns `patch: entry "pdfcraft" not found` and skips that patch, so the bundle runs with its defaults until you move the overrides to the two rows above. The old row's values do not carry over automatically.

### Every configuration field

Each row validates only its own fields; a field placed on the other row is not read by it.

**Web Component (`pdfcraft-web`)**

| Field | Type | Default | What it does |
|---|---|---|---|
| `webBuildDir` | string | `$DSH_HOME/pdfcraft/web` via the bundle patch; the schema default is an empty string | Directory containing the extracted web build's `index.html`. An empty or wrong value leaves the component mounted and makes the Panel show the missing-build card naming what to fetch. The web build is never downloaded by the plugin. |
| `openTool` | boolean | `true` | Register the person's `/pdfcraft` command and the agent's `pdfcraft_open` tool. Set to `false` to withdraw both and drop any open request that has not reached the browser yet; an already-open Panel is untouched. |
| `maxDocumentBytes` | integer | `33554432` (32 MiB) | Largest Workspace Document the Panel will open or save, in bytes. A larger read or Write-back is refused with a message naming this limit. **This does not limit the agent's tools**, which use the upstream engine directly. |

**CLI Component (`pdfcraft-cli`)**

| Field | Type | Default | What it does |
|---|---|---|---|
| `cliPath` | string | `pdfcraft-cli`, resolved through `PATH` | The `pdfcraft-cli` executable the agent's engine runs. Use an absolute path to pin a specific release. An empty value falls back to `pdfcraft-cli`. |
| `staticRoot` | string | `""`, meaning each conversation's own workspace | Pin every agent's engine to this absolute directory instead of its conversation's workspace. It must exist; otherwise no engine starts and the warning names the root. This gives up per-conversation isolation; the Panel stays confined to the conversation workspace either way. |
| `compactSurface` | boolean | `true` | Offer the compact agent surface: a small core set of tools plus `tool_search` and `tool_call`, which reach every remaining tool. Set to `false` to expose the full catalogue, at a much higher context cost. |

The three fields on each row are that row's whole configuration surface. The bundle patch points the Web row's `webBuildDir` at the Harness home; if you install the package by some other route, set it explicitly.

## 5. Use it

### The person

Open the Panel from a conversation:

```text
/pdfcraft                          open in Standalone Mode
/pdfcraft reports/quarterly.pdf    open a Workspace Document
```

The command runs without the model, so it costs no model round trip. A path may be relative to the conversation's workspace or absolute inside it. Paths are resolved with symlinks followed and refused when the real file is outside the workspace.

The Panel is one page titled **PdfCraft**, not one page per Workspace Document. A later open for the same conversation replaces the Workspace Document that conversation is bound to; it does not add a second page. Opening the Panel brings the right column forward, because DSH offers no quiet open.

A bound Panel uses the Host Bridge, so **PdfCraft's own Save writes back to the Workspace Document**. The host replaces the file atomically. This includes Save As: while a Workspace Document is bound, a save in the Panel is a Write-back to that bound file, not a new workspace file. Before writing, the Revision Guard compares the revision the Panel loaded with the revision the read route recorded and with the file's current SHA-256. If the file changed underneath the Panel, the save is refused and the Panel offers two explicit choices:

- **Reload** shows the current file and discards the Panel's pending save.
- **Overwrite anyway** writes the Panel's bytes over the current file.

There is no silent last-writer-wins. The agent is not locked out, though: its tools write the file directly, so the guard protects a Panel save and does not stop the agent from changing the file after the Panel loaded it. The Panel reads a Workspace Document when it loads it; a change made by the agent afterwards is not pushed into the open frame. It becomes visible when the Panel loads the Workspace Document again, for example after reopening it, or when a save reports the conflict.

**Standalone Mode** is the Panel with no Workspace Document bound. The Host Bridge is off, so the plugin receives nothing from the Embedded App. Saves from that state go through the browser's normal download path and never reach the workspace. See the limitations below.

### The agent

The agent opens the Panel with the `pdfcraft_open` tool:

```json
{ "path": "reports/quarterly.pdf" }
```

The path is optional; omitting it opens Standalone Mode. A later open for the same conversation replaces the bound Workspace Document. If the conversation is not on screen, the open waits and is delivered when it is; the result reads `Opened …` when the browser received it immediately and `Queued …` when it waits for the conversation to come on screen.

The agent's PDF tools are the upstream PdfCraft MCP tools under the namespace for the workspace. They belong to the CLI Component: disabling `pdfcraft-cli` withdraws them, and the Panel keeps working.

```text
mcp__pdfcraft-<hash>__doc_open
mcp__pdfcraft-<hash>__doc_inspect
mcp__pdfcraft-<hash>__text_extract
mcp__pdfcraft-<hash>__tool_search
```

The hash is derived from the Agent MCP Root and stays stable for a given workspace; if it were `1a2b3c4d5e`, the first tool would be `mcp__pdfcraft-1a2b3c4d5e__doc_open`. A good prompt is simply:

> Open `reports/quarterly.pdf` in the PdfCraft Panel, then summarize page 3 and add a bookmark called "Summary".

Engine lifecycle: an engine starts when an Agent appears or starts running, or when the CLI Component activates with the conversation already open, is released after five minutes with no activity, and starts again on the next activity. Disposing the Agent or unloading the CLI Component withdraws it. A conversation with no workspace gets no engine and a warning.

## When something is missing

The two artifacts fail independently, and the plugin keeps working around each one.

### The web build is missing or in the wrong place

The Panel replaces the frame with a card titled **PdfCraft web build not found**. It names the file to fetch and the release, links to the release, shows the configured directory when there is one, and offers **Check again**. The agent's tools are unaffected.

The same information is available without the Panel:

```sh
# replace 3080 with your DSH web origin's port
curl -s http://127.0.0.1:3080/pdfcraft/status
```

The route always answers `200` with JSON:

```json
{
  "ready": false,
  "reason": "missing-build",
  "directory": "/home/me/.dsh/pdfcraft/web",
  "file": "pdfcraft-web-0.9.0.zip",
  "release": "0.9.0",
  "releaseUrl": "https://github.com/storytold/pdfcraft/releases/tag/v0.9.0",
  "appPath": "/pdfcraft/"
}
```

`reason` is one of `not-configured` (empty `webBuildDir`), `missing-build` (the directory does not exist), `not-a-directory` (the path exists but is not a directory), `missing-index` (no `index.html` inside), or `ready`. A direct visit to `/pdfcraft/` while the build is missing answers `503` with the same instruction in plain text.

Fix it by pointing `webBuildDir` at the folder that contains `index.html`, not at the release zip and not at its parent if the extraction nested the files. Restart DSH or reload the profile, then press **Check again**.

If `index.html` exists but the application does not start, check that the hashed `.js` and `_bg.wasm` files are beside it. The Panel shows the Embedded App's own startup error when the Host Bridge is on.

### `pdfcraft-cli` is missing

The Panel still works; only the agent loses its PDF tools. The harness log names the engine that could not start for that workspace, and the conversation continues normally because the MCP bridge is configured not to fail agent creation.

Check it directly:

```sh
command -v pdfcraft-cli
pdfcraft-cli --version
```

If it is not on `PATH`, set `cliPath` on the `pdfcraft-cli` row in the profile patch and restart. If the binary is present but the tools are absent, check that `pdfcraft-cli` is active in the plugin list; disabling that row withdraws the tools without touching the Panel. The Panel's Workspace Document routes never need the command-line tool; the agent's MCP tools do.

### The open was queued rather than delivered

The browser holds the Push Channel stream only for the conversation on screen. A request for another conversation waits on the host; it is delivered when that conversation is next on screen. The command's text and the tool's `delivered` field say which happened. A queued request is in memory only and is lost when DSH restarts.

### A path is refused

- **Outside the workspace**: the Panel says the path is outside this conversation's workspace. Symlinks are followed before this check, so a link planted inside the workspace cannot reach outside it.
- **Too large**: the message names `maxDocumentBytes`. Raise the limit or use a smaller PDF.
- **No workspace**: the conversation has no `cwd`, so there is nothing to read or save into.

## Known limitations

These are properties of this design, not bugs to report:

- **The Embedded App inherits neither DSH's theme nor its language.** PdfCraft is an application with its own appearance and its own preferences. Only the plugin's own copy (the waiting, missing, Standalone and conflict states) follows the DSH locale, which ships in English and Chinese.
- **The person and the agent do not share a live document.** Work in the Panel and work by the agent meet only when the file is read or written. There is no shared in-memory document, no simultaneous editing, and no automatic refresh of the open frame.
- **Standalone Mode discards unsaved work silently.** With the Host Bridge off, the plugin receives nothing from the Embedded App and cannot detect unsaved work. Opening a Workspace Document afterwards replaces the standalone frame without warning. Saves in this mode download through the browser and never reach the workspace.
- **The web build is a large manual download.** The zip is about 14 MB compressed and expands to about 38 MB, and it is fetched by hand from the upstream release. The Panel is unavailable until it is in place; the plugin does not download or update it.
- **Opening the Panel always expands the right column.** DSH's sidebar has no quiet open, so both the command and `pdfcraft_open` bring the column forward.
- **The stdio probe makes per-workspace mounting heavy.** Each engine's stdio transport starts a temporary probe process before the serving process. With one engine per live agent, that is noticeably heavier than a single static server. `staticRoot` can reduce it to one shared root at the cost of per-conversation isolation.

## Upgrading

- **Web build**: replace the contents of `webBuildDir` with a newer extracted release and point `webBuildDir` at it. This plugin is tested against `0.9.0`; a newer build must still speak the upstream Host Bridge protocol (`pdfcraft:ready`, `pdfcraft:open`, `pdfcraft:save`, `pdfcraft:dirty`, `pdfcraft:failed`). If upstream changes it, upgrade the plugin too.
- **Command-line engine**: point `cliPath` on the `pdfcraft-cli` row at a newer `pdfcraft-cli`. The agent surface is whatever that release's `mcp` mode provides; `compactSurface` still controls whether `--compact` is passed.
- **The plugin**: `dsh plugin --profile web remove dsh-pdfcraft`, then `dsh plugin --profile web add "$PWD"` from the updated checkout, and restart DSH.
- **From 0.1.x to 0.2.0**: the single `pdfcraft` row becomes `pdfcraft-web` and `pdfcraft-cli`. Move each override with the [migration table](#migrating-from-the-old-single-row); the old row's patch is warned about and skipped, so nothing breaks, but its values are not applied.

The upstream release pin lives in `src/shared/paths.ts`, which is compiled into both the Host build and the browser bundle; updating it is a plugin change, not a configuration change.

## Uninstall

```sh
dsh plugin --profile web remove dsh-pdfcraft
rm -rf "${DSH_HOME:-$HOME/.dsh}/pdfcraft"
```

Remove any `pdfcraft-web` or `pdfcraft-cli` override from `$DSH_HOME/profiles/web/cordis.patch.yml` (and any old `pdfcraft` override left from before 0.2.0). The downloaded upstream artifacts live only in the directories above and in your `PATH`; the plugin keeps no other state. PDFs you edited stay in your workspaces.

## Development

The two Host entries and the browser half are TypeScript. `npm run build` clears `dist/`, compiles the Host with `tsc`, and bundles the browser half with `tsdown` into the shell's module-loader envelope, so a clone installs with no toolchain and removed sources cannot leave stale output behind. Edit `src/`, never `dist/`, and commit both.

The Web row keeps the bare package specifier (`dsh-pdfcraft`). The shell's `dsh-client-modules` reads a package's `dsh.client` declaration only from a bare Loader row, so `exports["."]` points at the Web Component entry and `exports["./web"]` names the same module for direct import. A row named `dsh-pdfcraft/web` would load the Host half but silently contribute no browser bundle. The CLI row uses the `dsh-pdfcraft/cli` subpath because it has no browser half.

```sh
npm run build                     # clean dist/, tsc the Host, then tsdown the browser bundle
npm test                          # the whole suite, node:test
npm run typecheck                 # tsc --noEmit for the Host and for the browser half
node --test test/document-routes.test.ts   # one suite
```

The tests use only Node's built-in test runner and assertion library. Node 24 strips types from the test files and the TypeScript sources, so the suite runs against `src/` directly with no transpile step. The browser bundle gets one shape test through a fake `__ModuleLoader__`; the Host Bridge, Push Channel, and refusal decisions are pure functions in `src/web/client/protocol.ts` and are driven directly. The TypeScript compiler, `tsdown`, and `@types/node` are pinned exactly with the other development dependencies. `.github/workflows/check.yml` builds, fails when the committed `dist/` is stale, type-checks both configurations, and runs the suite on every push and pull request.

The glue that turns a save into a write-back is verified by hand. Follow [docs/agents/e2e-verification.md](docs/agents/e2e-verification.md).

```text
src/
  web/index.ts        Web Component entry: configuration, HTTP routes, route wiring
  web/client/         browser half: page registration, Host Bridge, Push Channel stream
  web/client/protocol.ts  pure bridge, push, and refusal decisions
  web/web-build.ts    static asset and readiness routes
  web/workspace-document.ts  containment, size limit, Revision Guard, binding registry
  web/document-routes.ts  Workspace Document HTTP surface
  web/panel-opens.ts  Push Channel decisions, /pdfcraft command, pdfcraft_open tool
  web/open-routes.ts  Push Channel SSE adapter
  web/http.ts         shared query parsing and response writers
  cli/index.ts        CLI Component entry: configuration and engine lifecycle wiring
  cli/agent-tools.ts  per-agent MCP engine lifecycle
  cli/host.ts         the CLI Component's slice of the host context
  shared/host.ts      the host context types both component entries share
  shared/paths.ts     public routes, headers, and release pin (compiled into both halves)
  shared/protocol.ts  binding, open-request, and refusal-code types
dist/
  web/index.js        committed Web Component build; what the bare Loader row imports
  web/client.js       committed browser bundle; what the shell loads
  cli/index.js        committed CLI Component build; what the subpath Loader row imports
locale/               plugin-listing text: locale/*.json titles the Web row and the bundle, locale/cli/*.json the CLI row; Panel copy is in src/web/client/copy.ts
cordis.patch.yml      the bundle patch: the two component rows
test/                 node:test suites, one per seam
docs/adr/             the architecture decisions
GLOSSARY.md           the domain vocabulary
```

The four ADRs explain why the Panel serves an unmodified app, why opening is a Push Channel, why the engine is mounted per workspace, and why the two components share one installable package:

- [ADR-0001: Serve the unmodified web build and treat the workspace file as the source of truth](docs/adr/0001-unmodified-web-build.md)
- [ADR-0002: Open the Panel through a hand-built Push Channel](docs/adr/0002-push-channel.md)
- [ADR-0003: Mount the engine per workspace under workspace-root containment](docs/adr/0003-per-workspace-engine.md)
- [ADR-0004: Activate the Panel and the engines as two components in one installable package](docs/adr/0004-two-components-one-package.md)

The domain vocabulary these documents use is in [GLOSSARY.md](GLOSSARY.md).

## License

The plugin is [MIT licensed](LICENSE). PdfCraft is a separate project with its own MIT/Apache-2.0 licensing; this repository contains none of its code or binaries.
