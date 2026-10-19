/**
 * Host half of dsh-pdfcraft.
 *
 * It owns four registrations: the JSON readiness report the Panel asks for, the
 * prefix route that serves the real PdfCraft web assembly from the profile's
 * own origin, and the two routes of the Workspace Document surface — the
 * conversation's current binding and the document itself (read and Write-back).
 * All are released with the plugin's fiber, so uninstalling the bundle withdraws
 * the HTTP surface with nothing left behind.
 *
 * The binding registry is also published as the `pdfcraftBindings` service.
 * That is the seam the Push Channel (#5) drives: it binds one Workspace Document
 * per conversation, and the Panel's routes resolve that binding.
 */
import Schema from '@deepseek-ai/schemastery'

import { createBindingHandler, createDocumentHandler } from './lib/document-routes.js'
import { ASSET_PREFIX, BINDING_PATH, DOCUMENT_PATH, PLUGIN_NAME, STATUS_PATH } from './lib/paths.js'
import { createAssetHandler, createStatusHandler } from './lib/web-build.js'
import {
  createBindingRegistry,
  createRevisionRegistry,
  DEFAULT_MAX_DOCUMENT_BYTES,
  normalizeMaxBytes,
} from './lib/workspace-document.js'

/** Plugin name used in fiber diagnostics. */
export const name = PLUGIN_NAME

/**
 * The page is a Web surface; a Host without the Web server has nothing to serve.
 * The Session store resolves each conversation's workspace root.
 */
export const inject = ['webServer', 'sessions']

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
  maxDocumentBytes: Schema.natural()
    .default(DEFAULT_MAX_DOCUMENT_BYTES)
    .description(
      'Largest Workspace Document the Panel will open or save, in bytes. '
      + 'A larger read or Write-back is refused, and the refusal names this limit.',
    ),
})

/**
 * Register the Plugin HTTP surface.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying the Web server.
 * @param {{ webBuildDir?: string }} [config] - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
  const webBuildDir = typeof config.webBuildDir === 'string' ? config.webBuildDir : ''
  const maxDocumentBytes = normalizeMaxBytes(config.maxDocumentBytes)

  // One binding per conversation, shared by the Push Channel and these routes.
  // It is this activation's own registry; publishing it as a service lets the
  // Push Channel reach the same instance from outside this function.
  const bindings = createBindingRegistry()
  if (typeof ctx.provide === 'function') {
    ctx.provide('pdfcraftBindings', bindings)
  }
  const revisions = createRevisionRegistry()

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

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: BINDING_PATH,
      handler: createBindingHandler(bindings),
    }),
    'dsh-pdfcraft: Workspace Document binding route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: DOCUMENT_PATH,
      handler: createDocumentHandler({
        sessions: ctx.sessions,
        bindings,
        revisions,
        maxBytes: maxDocumentBytes,
      }),
    }),
    'dsh-pdfcraft: Workspace Document read and Write-back route',
  )
}
