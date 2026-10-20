# 3. Mount the engine per workspace under workspace-root containment

- **Status:** Accepted
- **Date:** 2026-10-20
- **Issues:** #1, #6

## Context

The agent's PDF capability is the upstream `pdfcraft-cli` in MCP mode: `pdfcraft-cli mcp [--root DIR] [--compact]`. It speaks JSON lines over stdin/stdout and serves the PdfCraft automation tools. `--root` confines every file the tools read and write, links included; `--compact` returns a small core tool set plus `tool_search` and `tool_call`, and keeps every other tool reachable through those two.

DSH ships an MCP client bridge, `@deepseek-ai/dsh-mcp-client`, that mounts one server per child plugin and registers its tools on the caller's context. A server namespace (`serverName`) must be unique inside one registration scope; the model sees tools as `mcp__<serverName>__<tool>`.

The constraints are:

- Two live conversations may have different workspaces, and one conversation's tools must never read or write the other's files.
- An agent's tools must disappear with that agent. A subagent's lifecycle events stay on its own scoped context, so a listener on the host alone would let a subagent's engine outlive it.
- Idle conversations should not hold processes.
- The default tool surface should stay small. The full PdfCraft catalogue is large and would spend a lot of context on schemas the model rarely needs.
- The person's Panel and the agent's tools should have the same boundary, so "the Panel can touch what the agent can touch" is a statement a user can rely on.
- A machine without `pdfcraft-cli` should still be able to use the rest of DSH. A missing engine is a degraded feature, not a failed conversation.

## Decision

- **Mount one engine per live agent, rooted at that agent's workspace.** On `agent/created`, the plugin records an entry and provisions an engine. The root is the configured `staticRoot` when it is set, otherwise `resolve(agent.session.header.cwd)`. An agent with no workspace, or with a root that is not an existing directory, gets no engine and a warning.
- **Mount the shipped MCP client as a child of the agent's scoped context.** The bridge configuration is:

  ```js
  {
    serverName: `pdfcraft-${sha256(root).slice(0, 10)}`,
    transport: 'stdio',
    command: cliPath,
    args: ['mcp', '--root', root, '--compact'], // '--compact' omitted when compactSurface is false
    cwd: root,
    failOnStartupError: false,
  }
  ```

  Because the child is mounted on `agent.ctx`, the tools are scoped to that agent and are withdrawn when it is disposed.
- **The namespace is a pure function of the root.** The same workspace always gets the same `serverName` and therefore stable tool names across remounts; distinct roots get distinct names, so several live workspaces coexist. The hash suffix is opaque to the model, but it is stable for a given workspace.
- **The compact surface is the default.** `compactSurface` defaults to `true`, which passes `--compact`; setting it to `false` exposes the full catalogue and costs considerably more context.
- **The engine has an idle lifecycle.** A running agent cancels any pending release. When it goes idle, a five-minute timer releases the engine; the next activity starts a new one. Remounting waits for the previous release to finish so the namespace cannot race. Disposing the agent disposes its engine and subscriptions. Unloading the plugin releases every remaining engine.
- **Lifecycle listeners follow both contexts.** Host listeners see host agents; the agent's own scoped context sees events that stay inside that agent's context tree, including a subagent's. The plugin subscribes to both, and its status handler ignores events that name another agent, so a subagent's engine is released with the subagent without disturbing its parent's.
- **Startup failure is logged, not fatal.** `failOnStartupError: false` means a missing or broken `pdfcraft-cli` leaves the conversation running with no PdfCraft tools, and the harness log names the failure. The alternative, rejecting agent creation, would turn a missing optional tool into an unusable conversation.
- **The Panel uses the same workspace boundary.** The Workspace Document routes resolve `SessionHeader.cwd` with `realpath` and accept only paths whose real target is the root or below it; symlinks are resolved before the comparison. The agent's `--root` is the same directory. A configured `staticRoot` deliberately breaks that equality for the agent and is documented as such; the Panel remains confined to the conversation workspace.
- **A size limit and the Revision Guard sit at the Panel boundary, not around the agent.** `maxDocumentBytes` caps what the Panel reads and writes. The agent's engine has its own files; its writes are direct and are not revision-guarded. This is documented so nobody mistakes the guard for a file lock.

## Consequences

- Workspaces are isolated for both actors by default. One conversation's tools cannot read another's workspace, and a change in one cannot leak into the other.
- Several agents/workspaces can have engines at once. Their tool namespaces are derived from the root, so names stay stable for a workspace across remounts and restarts.
- Per-agent mounting is heavier than one static server. The stdio transport starts a probe process before the serving process on each mount, and an idle release means a later turn pays that cost again. `staticRoot` is the escape hatch when one shared root is acceptable; it trades isolation for one root and is never the default.
- A missing `pdfcraft-cli` produces a warning and no PDF tools, not a failed session. The Panel is unaffected because its routes do not use the command-line tool.
- The agent's writes are immediate and unguarded. A person with the Panel open can still be surprised by a changed file; the Revision Guard turns that surprise into an explicit choice at save time, but it does not prevent the change.
- A subagent's engine is released with the subagent because the listener is attached to the subagent's scoped context as well as the host.
- An agent whose workspace root disappears or cannot be opened simply has no engine until the root is usable again; the warning names the root.
- The namespace is stable but not human-readable. Users see `mcp__pdfcraft-<hash>__doc_open`, not a path; the hash is there to keep distinct roots distinct without exposing filesystem names in tool names.

## Alternatives considered

- **One global engine rooted at a configured directory.** Simpler and cheaper, but it removes per-conversation isolation. Retained as the explicit `staticRoot` option rather than the default.
- **One engine per workspace shared by every agent in it.** Rejected: DSH scopes tool registration to an agent context, and a shared process would need an ownership and lifetime model. Per-agent mounting is the simpler correct unit, and the root-derived namespace still makes tool names stable.
- **Use `--automation-read-root` and `--automation-write-root` instead of `--root`.** These can separate read and write authority, but this plugin needs one workspace for both, which is exactly `--root`. The two are not mutually exclusive upstream; the single root matches the Agent MCP Root concept.
- **Start the engine only when the model first calls a PdfCraft tool.** Not possible with this MCP client: tools have to be discovered and registered before the model can call one, so the server must start before the tool list is known.
- **Keep every engine for the life of the process.** Rejected: idle workspaces would hold processes and memory for no benefit.
- **Reject agent creation when the engine fails.** Rejected: a missing optional binary must not make the whole conversation unusable.
