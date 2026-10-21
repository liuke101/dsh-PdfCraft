# dsh-PdfCraft

Bringing PdfCraft to DeepSeek Harness: an agent that can work on PDFs in a workspace, and a person who can edit those same PDFs in the right sidebar.

## Language

### Components

**Web Component**:
The activation entry of this bundle that serves the Panel: the Embedded App assets and readiness report, the Workspace Document routes, the binding registry, the Push Channel, the `/pdfcraft` command, and the `pdfcraft_open` tool. Activated by the `pdfcraft-web` Loader row from the bare package `dsh-pdfcraft`; not a separate package and not the upstream Web Build.
_Avoid_: panel plugin, web package, frontend

**CLI Component**:
The activation entry of this bundle that runs one Engine per live agent. Activated by the `pdfcraft-cli` Loader row from the `dsh-pdfcraft/cli` subpath; not a separate package and not the upstream `pdfcraft-cli` binary.
_Avoid_: backend, engine package, pdfcraft-cli plugin

### Surfaces

**Panel**:
The right-sidebar page that hosts PdfCraft inside DSH.
_Avoid_: tab, view, webview, editor surface

**Embedded App**:
The unmodified PdfCraft web application running inside the Panel.
_Avoid_: front end, UI, editor

**Web Build**:
The static output of the upstream `pdfcraft-web` release that the Panel serves as the Embedded App.
_Avoid_: frontend bundle, dist, assets

**Standalone Mode**:
The Panel state in which no Workspace Document is bound, so the Embedded App is used on its own and nothing it saves reaches the workspace.
_Avoid_: empty state, scratch mode, detached

**Native Registration**:
Publishing the Panel directly as a page type of DSH's own right sidebar.
_Avoid_: host registration, core registration

**BetterSidebar Registration**:
Publishing the Panel through the sidebar service that the DSH-better-sidebar plugin provides.
_Avoid_: plugin registration, external registration

**Push Channel**:
The path by which the harness side asks the browser to open the Panel for a particular conversation.
_Avoid_: notification, event bus, socket

**Open Request**:
One ask, from the `/pdfcraft` command or the `pdfcraft_open` tool, for a conversation's Panel to open at a Workspace Document or in Standalone Mode.
_Avoid_: push, notification, event

### Documents

**Workspace Document**:
A PDF inside the conversation's workspace that the Panel is currently bound to.
_Avoid_: open file, current file, document

**Host Bridge**:
The same-origin channel between the Embedded App and the plugin, through which the host pushes a document into the Panel and a save made there reaches the harness side.
_Avoid_: MCP bridge, postMessage API, RPC

**Write-back**:
Committing bytes produced in the Panel into the bound Workspace Document.
_Avoid_: export, save as, download

**Revision Guard**:
The rule that a Write-back is refused when the Workspace Document has changed since the Panel loaded it.
_Avoid_: conflict check, dirty check, lock

**Agent MCP Root**:
The directory the agent's PdfCraft tools may read and write; by default the conversation's workspace, or the configured static root when one is set.
_Avoid_: sandbox root, fence, cwd, project dir

### Agent

**Engine**:
The upstream `pdfcraft-cli mcp` process that serves one agent's PdfCraft tools, confined to that agent's Agent MCP Root.
_Avoid_: backend, service, daemon

**Compact Surface**:
The default agent tool list: a small core set plus `tool_search` and `tool_call`, which reach the rest of the catalogue.
_Avoid_: minimal mode, reduced mode, lite mode
