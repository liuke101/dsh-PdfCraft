# 1. Serve the unmodified PdfCraft web build and treat the workspace file as the source of truth

- **Status:** Accepted
- **Date:** 2026-10-20
- **Issues:** #1, #6

## Context

PdfCraft ships a static web build: `index.html`, a wasm-bindgen ES module, and a WebAssembly module. It has no server-side component. The build already supports being embedded: adding `?host=parent` to the frame URL turns on a same-origin `postMessage` bridge, and the app then posts `pdfcraft:ready`, `pdfcraft:save`, `pdfcraft:dirty` and `pdfcraft:failed` to its parent and accepts `pdfcraft:open` with a PDF's bytes. That is an upstream feature, not something this project patches in.

The reference implementation of this capability is a ZCode plugin whose panel *is* the engine: the MCP server queues calls, the live panel polls them, and the person and the agent share one in-memory document. That design needs a patched, self-compiled Rust build and a host that can render MCP Apps surfaces. DSH has neither. It hosts React pages in its right sidebar, and the upstream tool this port needs is a headless command-line engine over files on disk.

Two constraints follow:

1. This repository must not build or patch PdfCraft. Building it needs a Rust toolchain and produces a very large artifact; the upstream release already publishes the web build.
2. A shared live document is not possible with a headless engine over files, and reproducing the ZCode wrapper is explicitly out of scope. The file is the only thing both actors can reliably share.

## Decision

- **Pin the upstream web build.** The Embedded App is `pdfcraft-web-0.9.0.zip` from [PdfCraft v0.9.0](https://github.com/storytold/pdfcraft/releases/tag/v0.9.0). The person downloads and extracts it; the plugin never downloads it, never caches it, and never ships a copy in this repository. The pin lives in `src/shared/paths.ts` and is mirrored in `client.js`.
- **Serve it unmodified from the profile's own origin.** The asset route serves the extracted directory byte-for-byte under `/pdfcraft/`. It sets `application/wasm` for `.wasm`, `text/javascript` for `.js`, immutable caching for JS/WASM/CSS/font files, and `no-cache` for `index.html`. It rewrites no file and injects no script.
- **The Panel is an iframe of that directory.** A bound conversation frames `/pdfcraft/?host=parent`; Standalone Mode frames `/pdfcraft/` with no bridge. The plugin's own chrome is limited to the states where it must speak: waiting for the build, a missing build, Standalone Mode, a refused read, and the revision conflict.
- **The workspace file is the single source of truth.** A Workspace Document is read through the host's `/pdfcraft/document` route, which resolves the requested path under the conversation's `SessionHeader.cwd` with `realpath`, so a symlink inside the workspace cannot escape it. The bytes are posted into the frame with `pdfcraft:open`. The frame is rebuilt when the bound Workspace Document changes (its React key includes the path and a reload epoch), so a new Workspace Document cannot leave the old one on screen.
- **Saves are written back by the host.** A `pdfcraft:save` message carries the complete new PDF and the name. The host writes those bytes to the bound path through a same-directory temporary file and `rename`, replacing the file atomically. The host answers with the new revision; the app is not given filesystem access.
- **The Revision Guard is revision-based, not trust-based.** Serving a Workspace Document records its SHA-256. A Write-back is accepted only when the revision quoted by the Panel matches the revision the read route recorded **and** the file's current bytes still hash to that value. A mismatch refuses the write before anything is replaced and returns the explicit choices `reload` and `overwrite`. `overwrite` is the person's deliberate choice to replace the file with the Panel's bytes; it still requires that the Workspace Document was served by the read route first.
- **Standalone Mode is the same app with the bridge off.** No Workspace Document is bound, the host bridge listener is not attached, and PdfCraft's own Save downloads through the browser. The panel says so in its own copy.
- **The agent does not go through the Panel.** It uses the upstream engine directly (ADR-0003). The person's saves and the agent's writes meet at the file; only the person's Write-back goes through the Revision Guard.

## Consequences

- The person gets the actual PdfCraft Embedded App, not a reduced imitation, and upgrades are a matter of replacing a directory.
- The Embedded App keeps its own appearance and language. It does not inherit DSH's theme or locale; only the plugin's own copy is localized.
- The person and the agent are not editing one live document. There is no shared buffer, no presence, no automatic refresh, and no conflict detection while both are merely editing. The Revision Guard runs at Write-back time, and the agent's tools do not participate in it: they write the file directly.
- The bridge is an upstream protocol. A breaking upstream change requires a plugin change, not a configuration change.
- Serving from the profile's origin is not optional: the bridge only accepts its parent on the same origin. A separate static host or CDN would need CORS and a different bridge design.
- The web build is a large manual download and the Panel is unavailable until it is in place. That is the cost of not shipping or downloading binaries.
- The host must return the correct media types and caching headers; a generic static server would still work, but the route exists so the plugin can guarantee them and report readiness.

## Alternatives considered

- **Build or patch PdfCraft in this repository.** Rejected: out of scope, needs a Rust toolchain, produces a large artifact, and makes every upstream change a merge problem.
- **Ship the extracted web build in the repository.** Rejected: 14 MB of third-party build output, licensing and update burden, and it would duplicate a release the person can verify.
- **Serve the app from a separate host or CDN.** Rejected: the Host Bridge is same-origin, and a cross-origin panel would add CORS, framing and containment work for no benefit.
- **Use DSH's built-in PDF preview.** Rejected: it can look at a PDF but cannot edit, annotate, secure, combine, split or extract from one.
- **Recreate the reference implementation's shared live document.** Rejected: it requires the panel to be the engine and a patched build; a headless engine over files cannot provide it.
- **Let the Embedded App write files directly.** Rejected: it would bypass the workspace boundary, the size limit and the Revision Guard, and give the browser more access than the agent.
