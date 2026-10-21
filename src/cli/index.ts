/**
 * Host half of dsh-pdfcraft's CLI Component: one PdfCraft engine per live
 * Agent.
 *
 * The component owns the engine lifecycle and the three fields that shape it.
 * The engines themselves live in `agent-tools.ts`; this entry validates the
 * row's own configuration and hands it over. Nothing here serves the Panel or
 * touches the Web server, so the component activates on a Host with no Web
 * surface and keeps the agent's tools working when the Web Component is
 * disabled.
 *
 * The Panel and the engines share no runtime state. Each component has its own
 * Loader row and its own configuration; a profile patch that targets one does
 * not reach the other.
 */
import Schema from '@deepseek-ai/schemastery'

import { PLUGIN_NAME } from '../shared/paths.ts'
import { DEFAULT_CLI, registerAgentTools } from './agent-tools.ts'
import type { HostContext } from './host.ts'

/** Plugin name used in fiber diagnostics; the Panel publishes the bare package name. */
export const name = `${PLUGIN_NAME}-cli`

/**
 * The live-agent registry is required: a fresh activation adopts every
 * conversation that is already open, not only the ones created afterwards.
 */
export const inject = ['agents']

/**
 * Validate the row's configuration before activation.
 *
 * These are the engine fields only. The Web Component owns `webBuildDir`,
 * `openTool` and `maxDocumentBytes`, so a profile patch replaces this row's
 * configuration without restating the Panel's.
 */
export const Config = Schema.object({
  cliPath: Schema.string()
    .default(DEFAULT_CLI)
    .description(
      'The pdfcraft-cli executable the agent\'s PDF engine runs, as an absolute path or a command on PATH. '
      + 'Point this at the release you downloaded, or at a build of your own.',
    ),
  staticRoot: Schema.string()
    .default('')
    .description(
      'Pin every conversation to this absolute directory instead of its own workspace. Leave empty to keep each '
      + 'conversation confined to its own workspace; setting it trades that isolation for one shared root.',
    ),
  compactSurface: Schema.boolean()
    .default(true)
    .description(
      'Offer the compact PdfCraft tool surface (a few core tools plus search-and-call). '
      + 'Turn this off to expose the full tool catalogue, which costs much more context.',
    ),
})

/** The row's configuration after validation. */
export type CliConfig = ReturnType<typeof Config>

/**
 * Mount the per-conversation engines.
 * @param ctx - Host context carrying the agent lifecycle events.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: HostContext, config: Partial<CliConfig> = {}): void {
  registerAgentTools(ctx, {
    cliPath: config.cliPath,
    staticRoot: config.staticRoot,
    compactSurface: config.compactSurface,
  })
}
