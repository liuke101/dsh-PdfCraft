# Verifying the Panel end to end

The unit tests drive decisions, not the browser. The glue that turns a save into
a write-back — frame message → fetch → conflict dialog — has no seam, and one
defect there (`readFailure is not defined`, see #10) shipped past a green suite
and was caught only by walking the interface by hand. Run this whenever a change
touches the browser half (`src/web/client/`), the Workspace Document routes
(`src/web/document-routes.ts`), or the open tool (`src/web/panel-opens.ts`), and
before closing a map whose Testing Decisions call for manual verification.

## Before you start

A conversation in this workspace, the plugin installed in the profile, and the
upstream `pdfcraft-cli` plus web build in place (the Panel shows a
missing-build card naming what is absent otherwise). One workspace PDF is
enough; generate one with `pdfcraft-cli` or copy a fixture in.

## The signals

- **Sidebar**: exactly one `PdfCraft` page; the right column's `+` menu lists it
  once. The page title is always `PdfCraft` — the document name appears in the
  Embedded App's own tab, not in the sidebar.
- **Bound vs Standalone**: the iframe is `/pdfcraft/?host=parent` when a document
  is bound, `/pdfcraft/` when not. Standalone also shows the plugin notice
  `独立模式 — 保存的文件会下载，不会写回工作区。`
- **The Embedded App is canvas-only.** The iframe's DOM is empty, so read state
  from a screenshot, from file hashes, and from the app's own tabs. Do not
  expect selectors inside the frame.
- **Save**: `Ctrl+S` or Menu → File → Save. An edit marks the document tab with
  a dot; a successful write-back clears it.

## The checklist

1. **Command open** — `/pdfcraft e2e/sample.pdf` → the right column gains the
   `PdfCraft` page, the app shows `sample.pdf`, the Standalone notice is gone.
2. **Standalone** — `/pdfcraft` with no path → iframe without `?host=parent` and
   the notice above.
3. **Agent open** — ask the conversation's agent to open a second file with
   `pdfcraft_open`. The same page switches document; no second tab appears.
4. **Person edits, agent sees it** — add a stamp (Tools → Add a stamp), save,
   then `sha256sum` the file before and after. Open it with the agent's
   `doc_open` / `doc_info`: the annotation appears, author `Guest`.
5. **Agent edits, person sees it** — rotate a page with `page_rotate`, `doc_save`,
   then reopen the Panel (the change is not pushed into a running frame). The
   app renders the rotated page.
6. **Revision Guard** — with the Panel open, have the agent change and save the
   file, then save from the Panel. Expect the dialog `此文档已在磁盘上更改` with
   `重新载入` and `仍然覆盖`.
   - *Reload*: the file's hash is unchanged and the Panel shows the current file.
   - *Overwrite*: the file becomes exactly the Panel's pending bytes. Hash them
     in the page and compare — never stringify them.
7. **Containment** — `doc_open /etc/hostname` is refused as outside the
   workspace.
8. **Compact surface** — the default tool set is small; `tool_search` reaches
   `page_rotate`.

## The path you cannot see live

The Panel registers through better-sidebar when it is present and through DSH's
own right sidebar otherwise. This profile usually has better-sidebar installed,
so the live run exercises only that path; switching means disabling a bundle for
the whole profile and restarting the web server. `test/client-bundle.test.ts`
asserts one path or the other, which is the intended substitute. Say so when you
record the result instead of leaving it silently unchecked.

## Recording

Comment pass/fail per row on the map or ticket, with the hash or copy that
decides it. Close only when every row passes, or when the exception and its
reason are written down.
