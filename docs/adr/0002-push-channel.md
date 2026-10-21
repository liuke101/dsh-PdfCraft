# 2. Open the Panel through a hand-built Push Channel

> **Update 2026-10-21 (#14):** the plugin is now TypeScript. The files named below moved to `src/web/panel-opens.ts`, `src/web/open-routes.ts`, and `src/web/client/index.ts`; the route and page-kind strings are now imported from `src/shared/paths.ts` and inlined into the browser bundle rather than mirrored. The decision is unchanged.

- **Status:** Accepted
- **Date:** 2026-10-20
- **Issues:** #1, #6

## Context

Two actors need to make the Panel appear: the person, through a slash command, and the model, through a tool. Both need the same result: the right sidebar opens at a particular Workspace Document, or in Standalone Mode, for the conversation they are in.

DSH has no host-side API for this. The right sidebar exposes an `openTab` call in the browser, and it is valid only for the conversation currently mounted. The host cannot call it, and a request aimed at a conversation that is not on screen cannot be opened immediately. There is also no general event bus from the harness half to the browser half.

The requirements are narrow and specific:

- A request binds the conversation's Workspace Document **before** the Panel opens, so a Panel that mounts because of the request already reads the new binding rather than loading the old one first.
- One conversation has one Panel and one bound Workspace Document; a later open replaces the pending one rather than queuing two.
- Delivery is exactly once: a reconnect must not reopen a Panel the person already closed, and a request that reached a stream is consumed.
- A request for a conversation that is not on screen waits until that conversation's surface is mounted.
- Turning the model-facing tool off must also turn off the command and drop anything still waiting.
- The model must not be able to rearrange the right column when the person has disabled that.

## Decision

- **A per-conversation channel with consume-on-send semantics.** `src/web/panel-opens.ts` owns the policy. `open(sessionId, path)` binds or clears the conversation's Workspace Document first, then creates an immutable `OpenRequest` (`id`, `sessionId`, `document`). It deletes any previous pending request for that conversation, delivers to one attached stream if there is one, and otherwise stores the request as pending. `attach(sessionId, send)` registers a browser stream and flushes one waiting request. `setEnabled(false)` drops everything pending; `dispose()` closes the queues and detaches every stream.
- **The stream is Server-Sent Events.** `GET /pdfcraft/pushes?session=<id>` is a one-way SSE stream. It writes a `: connected` comment, then `data: {"type":"open",...}` frames. The policy object has no HTTP knowledge; `src/web/open-routes.ts` is only the adapter, and it closes every stream when the plugin unloads. SSE was chosen because the direction is one-way, `EventSource` reconnects on its own, and no extra server or WebSocket layer is needed.
- **The browser holds a stream for the conversation on screen.** `src/web/client/index.ts` watches the sidebar controller's mounted-session snapshot and opens one `EventSource` for that conversation. When a frame for that conversation arrives, it publishes a revision to the Panel's open feed and calls the controller's `openTab` for the single PdfCraft page. If the page kind is still being registered during activation, one short retry covers the race. A request that arrives while another conversation is mounted stays on the host until that conversation's stream attaches.
- **Two entries, one policy.** The person's `/pdfcraft [path]` command and the model's `pdfcraft_open` tool both call the same `open` function and return whether the request was delivered immediately. The command never submits a model message. Omitting the path clears the binding and opens Standalone Mode instead of failing.
- **One switch controls both.** `openTool` defaults to `true`. When it is `false`, neither entry is registered and the channel drains what is still waiting. An already-open Panel is left alone; the switch governs opening, not the Panel's existence.
- **One page identity.** Both registration paths use the same `pdfcraft` page kind, and the better-sidebar path declares a single-instance page. This is also what keeps a later open from adding a second entry.
- **Exactly once means exactly once per stream send.** A request handed to a stream is removed from the pending map and is not replayed when the browser reconnects. If no stream accepts it, it stays pending for that conversation only.

## Consequences

- The command and the tool behave the same way. One switch withdraws both entries, so the model cannot open the Panel for a person who has turned the feature off.
- A request can be delivered before the browser's Panel body has ever mounted; the binding route is what the body reads on mount, so it opens on the right Workspace Document.
- A request for a conversation that is not on screen waits in host memory. It is not persisted, so a DSH restart loses it; that is acceptable for an open request, which is only meaningful in a live interface.
- Delivery is at-most-once from the browser's point of view. A dropped stream can lose a request that was already consumed; the alternative, replaying on reconnect, would reopen Panels the person closed, which is worse.
- Opening always expands the right column, because the controller's open call does. DSH offers no quiet open; this is a known limitation rather than something the channel can work around.
- The design is specific to open requests. It is not a general notification bus, and it deliberately carries no arbitrary payloads or commands into the browser.
- Both halves need the same route and page-kind strings. They are imported from `src/shared/paths.ts`, which the browser build inlines, so the two halves cannot drift.

## Alternatives considered

- **Call the sidebar controller from the host.** Not possible: the controller is a browser-side service and `openTab` is only valid for the mounted conversation.
- **Let the model tool return a link or a transcript notice.** Rejected: the user story is that the Workspace Document is put in front of the person without another action, and a command that needed a model round trip would be slower and less predictable.
- **Poll a queue endpoint from the browser.** Rejected: latency and duplicate-delivery bookkeeping for a channel that only needs a push.
- **A WebSocket.** Rejected: the traffic is one-way and small; SSE and `EventSource` already provide reconnect behavior and need no protocol upgrade or extra server.
- **Queue per Workspace Document instead of per conversation.** Rejected: one conversation has one Panel and one bound Workspace Document, so two requests for the same conversation must collapse, not queue.
- **Replay pending requests on reconnect.** Rejected: a reconnect is not a fresh person intent, and replay would reopen a Panel that was deliberately closed.
