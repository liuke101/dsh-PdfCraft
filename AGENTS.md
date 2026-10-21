# dsh-PdfCraft

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles keep their default strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### End-to-end verification

The bundle activates as two Loader rows: `pdfcraft-web` (the Panel, its routes, command and open tool) and `pdfcraft-cli` (the per-agent engines); both are active by default. A change to the browser half or the Web Component's host surface (`src/web/`, including `src/web/client/`) is verified in the live interface, not just by the suite. Changes to the CLI Component (`src/cli/`) are covered by its suite and by the checklist's two-row checks. Follow `docs/agents/e2e-verification.md`.

### Commit Conventions

This project follows Conventional Commits (<https://www.conventionalcommits.org/en/v1.0.0/>):
`<type>(<scope>): <description> (#<ticket number>)`
- Example: `feat(deploy): parameterized Hub install script + systemd service + closed registration (#4)`
