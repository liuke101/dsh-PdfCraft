/**
 * Host half of dsh-pdfcraft.
 *
 * It owns exactly two registrations: the JSON readiness report the Panel asks
 * for, and the prefix route that serves the real PdfCraft web assembly from
 * the profile's own origin. Both are released with the plugin's fiber, so
 * uninstalling the bundle withdraws the HTTP surface with nothing left behind.
 */
import Schema from '@deepseek-ai/schemastery'

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
})

/**
 * Register the Plugin HTTP surface.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying the Web server.
 * @param {{ webBuildDir?: string }} [config] - resolved plugin configuration.
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
}
