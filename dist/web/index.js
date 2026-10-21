/**
 * Host half of dsh-pdfcraft's Web Component: the Panel's HTTP surface.
 *
 * It serves the readiness report, the real PdfCraft web assembly from the
 * profile's own origin, and the Workspace Document routes that bind a
 * conversation's file and write it back. It also publishes the binding
 * registry as `pdfcraftBindings` and the Push Channel as `pdfcraftOpens`: the
 * command and the model-facing tool create open requests there, the Panel's
 * browser half holds the conversation's view open, and the controller opens
 * the page when one arrives.
 *
 * The per-agent engines are the CLI Component's job. This component serves
 * the Panel only, so disabling that row leaves the Panel working and disabling
 * this row leaves the engines working.
 *
 * The Push Channel is how the harness half asks the browser to open the Panel.
 * A request binds one Workspace Document per conversation, is delivered once
 * to the conversation's view when that conversation is on screen, and waits
 * otherwise. Turning the open entries off drains what is still waiting.
 */
import Schema from '@deepseek-ai/schemastery';
import { ASSET_PREFIX, BINDING_PATH, DOCUMENT_PATH, PLUGIN_NAME, PUSHES_PATH, STATUS_PATH, } from '../shared/paths.js';
import { createBindingHandler, createDocumentHandler } from './document-routes.js';
import { createPushHandler } from './open-routes.js';
import { createPanelOpens, registerOpenCommand, registerOpenTool } from './panel-opens.js';
import { createAssetHandler, createStatusHandler } from './web-build.js';
import { createBindingRegistry, createRevisionRegistry, DEFAULT_MAX_DOCUMENT_BYTES, normalizeMaxBytes, } from './workspace-document.js';
/** Plugin name used in fiber diagnostics; the browser half publishes the same id. */
export const name = PLUGIN_NAME;
/**
 * The page is a Web surface; a Host without the Web server has nothing to serve.
 * The Session store resolves each conversation's workspace root.
 */
export const inject = ['webServer', 'sessions'];
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
        .description('Directory holding the extracted pdfcraft-web build (the folder that contains index.html). '
        + 'Download it from the PdfCraft release named by the Panel when this is empty or wrong.'),
    openTool: Schema.boolean()
        .default(true)
        .description('Offer the person\'s /pdfcraft command and the agent\'s pdfcraft_open tool, which put a Workspace Document '
        + 'in front of the person in the Panel. Turning this off withdraws both entries and drops any open request '
        + 'that has not reached the browser yet.'),
    maxDocumentBytes: Schema.natural()
        .default(DEFAULT_MAX_DOCUMENT_BYTES)
        .description('Largest Workspace Document the Panel will open or save, in bytes. '
        + 'A larger read or Write-back is refused, and the refusal names this limit.'),
});
/**
 * Register the Panel's HTTP surface and publish the two services its command,
 * tool and browser half share.
 * @param ctx - Host context carrying the Web server.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
    const webBuildDir = typeof config.webBuildDir === 'string' ? config.webBuildDir : '';
    const maxDocumentBytes = normalizeMaxBytes(config.maxDocumentBytes);
    // One binding per conversation, shared by the Push Channel and these routes.
    // It is this activation's own registry; publishing it as a service lets the
    // Push Channel reach the same instance from outside this function.
    const bindings = createBindingRegistry();
    ctx.provide?.('pdfcraftBindings', bindings);
    const revisions = createRevisionRegistry();
    // One Push Channel per activation. It binds a document before it tells the
    // browser, and the same instance is published for the harness-half seam and
    // diagnostics. Turning the open entries off drops whatever was waiting.
    const openTool = config.openTool !== false;
    const opens = createPanelOpens({
        bindings,
        enabled: openTool,
        warn: (message) => ctx.logger?.warn?.(message),
    });
    ctx.provide?.('pdfcraftOpens', opens);
    if (!openTool) {
        opens.setEnabled(false);
    }
    else {
        ctx.effect(() => registerOpenCommand(ctx, opens) ?? (() => { }), 'dsh-pdfcraft: /pdfcraft command');
        ctx.effect(() => registerOpenTool(ctx, opens) ?? (() => { }), 'dsh-pdfcraft: pdfcraft_open tool');
    }
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: createStatusHandler(webBuildDir),
    }), 'dsh-pdfcraft: web build status route');
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: ASSET_PREFIX,
        handler: createAssetHandler(webBuildDir),
    }), 'dsh-pdfcraft: embedded app asset route');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: BINDING_PATH,
        handler: createBindingHandler(bindings),
    }), 'dsh-pdfcraft: Workspace Document binding route');
    const pushSurface = createPushHandler(opens);
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: PUSHES_PATH,
        handler: pushSurface.handler,
    }), 'dsh-pdfcraft: Push Channel route');
    ctx.effect(() => () => {
        pushSurface.close();
        opens.dispose();
    }, 'dsh-pdfcraft: Push Channel streams');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: DOCUMENT_PATH,
        handler: createDocumentHandler({
            sessions: ctx.sessions,
            bindings,
            revisions,
            maxBytes: maxDocumentBytes,
        }),
    }), 'dsh-pdfcraft: Workspace Document read and Write-back route');
}
