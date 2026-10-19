# dsh-PdfCraft

Bringing PdfCraft to DeepSeek Harness: an agent that can work on PDFs in a workspace, and a person who can edit those same PDFs in the right sidebar.

## Language

### Surfaces

**Panel**:
The right-sidebar page that hosts PdfCraft inside DSH.
_Avoid_: tab, view, webview, editor surface

**Embedded App**:
The unmodified PdfCraft web application running inside the Panel.
_Avoid_: front end, UI, editor

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

### Documents

**Workspace Document**:
A PDF inside the conversation's workspace that the Panel is currently bound to.
_Avoid_: open file, current file, document

**Host Bridge**:
The live channel between the Embedded App and the plugin, through which a save made in the Panel reaches the harness side.
_Avoid_: MCP bridge, postMessage API, RPC

**Write-back**:
Committing bytes produced in the Panel into the bound Workspace Document.
_Avoid_: export, save as, download

**Revision Guard**:
The rule that a Write-back is refused when the Workspace Document has changed since the Panel loaded it.
_Avoid_: conflict check, dirty check, lock

**Agent MCP Root**:
The directory the agent's PdfCraft tools may read and write; it is the conversation's workspace.
_Avoid_: sandbox root, fence, cwd, project dir
