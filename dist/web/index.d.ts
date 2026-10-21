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
 * The per-agent engine is still mounted here for one step, so the package
 * stays one entry and one Loader row while the split proceeds. The CLI
 * Component takes it over next; the Panel does not depend on it.
 *
 * The Push Channel is how the harness half asks the browser to open the Panel.
 * A request binds one Workspace Document per conversation, is delivered once
 * to the conversation's view when that conversation is on screen, and waits
 * otherwise. Turning the open entries off drains what is still waiting.
 */
import Schema from '@deepseek-ai/schemastery';
import type { HostContext } from './host.js';
/** Plugin name used in fiber diagnostics. */
export declare const name = "dsh-pdfcraft";
/**
 * The page is a Web surface; a Host without the Web server has nothing to serve.
 * The Session store resolves each conversation's workspace root.
 */
export declare const inject: string[];
/**
 * Validate the row's configuration before activation.
 *
 * `webBuildDir` is the directory the person extracted the release into; the
 * bundle patch defaults it below the Harness home. An empty value keeps the
 * plugin mounted and lets the Panel explain what to fetch.
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    webBuildDir: Schema<string, string, "defined">;
    cliPath: Schema<string, string, "defined">;
    staticRoot: Schema<string, string, "defined">;
    compactSurface: Schema<boolean, boolean, "defined">;
    openTool: Schema<boolean, boolean, "defined">;
    maxDocumentBytes: Schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    webBuildDir: Schema<string, string, "defined">;
    cliPath: Schema<string, string, "defined">;
    staticRoot: Schema<string, string, "defined">;
    compactSurface: Schema<boolean, boolean, "defined">;
    openTool: Schema<boolean, boolean, "defined">;
    maxDocumentBytes: Schema<number, number, "defined">;
}>>, "plain">;
/** The row's configuration after validation. */
export type WebConfig = ReturnType<typeof Config>;
/**
 * Register the Panel's HTTP surface and, for now, the per-conversation agent engines.
 * @param ctx - Host context carrying the Web server.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: HostContext, config?: Partial<WebConfig>): void;
