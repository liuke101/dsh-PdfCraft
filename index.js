/**
 * Host half of dsh-pdfcraft.
 *
 * It serves the Panel's HTTP surface (the readiness report and the real
 * PdfCraft web assembly from the profile's own origin), and it gives each
 * conversation's agent the upstream PdfCraft MCP tools confined to that
 * conversation's workspace. Every registration is released with the plugin's
 * fiber, so uninstalling the bundle withdraws the HTTP surface and every
 * running engine with nothing left behind.
 */
import Schema from '@deepseek-ai/schemastery'

import { DEFAULT_CLI, registerAgentTools } from './lib/agent-tools.js'
import { ASSET_PREFIX, PLUGIN_NAME, STATUS_PATH } from './lib/paths.js'
import { createAssetHandler, createStatusHandler } from './lib/web-build.js'

/** Plugin name used in fiber diagnostics. */
export const name = PLUGIN_NAME

/** The page is a Web surface; a Host without the Web server has nothing to serve. */
export const inject = ['webServer']

/**
 * Validate the row's configuration before activation.
 *
 * `webBuildDir` is the directory the person extracted the release into; the
 * bundle patch defaults it below the Harness home. An empty value keeps the
 * plugin mounted and lets the Panel explain what to fetch.
 */
export const Config = Schema.object({
  webBuildDir: Schema.string()
    .default('')
    .description(
      'Directory holding the extracted pdfcraft-web build (the folder that contains index.html). '
      + 'Download it from the PdfCraft release named by the Panel when this is empty or wrong.',
    ),
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

/**
 * Register the Panel's HTTP surface and the per-conversation agent engines.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying the Web server.
 * @param {{ webBuildDir?: string, cliPath?: string, staticRoot?: string, compactSurface?: boolean }} [config] - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
  const webBuildDir = typeof config.webBuildDir === 'string' ? config.webBuildDir : ''

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: createStatusHandler(webBuildDir),
    }),
    'dsh-pdfcraft: web build status route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ASSET_PREFIX,
      handler: createAssetHandler(webBuildDir),
    }),
    'dsh-pdfcraft: embedded app asset route',
  )

  registerAgentTools(ctx, config)
}
