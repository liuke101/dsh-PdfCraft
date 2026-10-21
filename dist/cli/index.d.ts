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
import Schema from '@deepseek-ai/schemastery';
import type { HostContext } from './host.js';
/** Plugin name used in fiber diagnostics; the Panel publishes the bare package name. */
export declare const name = "dsh-pdfcraft-cli";
/**
 * The live-agent registry is required: a fresh activation adopts every
 * conversation that is already open, not only the ones created afterwards.
 */
export declare const inject: string[];
/**
 * Validate the row's configuration before activation.
 *
 * These are the engine fields only. The Web Component owns `webBuildDir`,
 * `openTool` and `maxDocumentBytes`, so a profile patch replaces this row's
 * configuration without restating the Panel's.
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    cliPath: Schema<string, string, "defined">;
    staticRoot: Schema<string, string, "defined">;
    compactSurface: Schema<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    cliPath: Schema<string, string, "defined">;
    staticRoot: Schema<string, string, "defined">;
    compactSurface: Schema<boolean, boolean, "defined">;
}>>, "plain">;
/** The row's configuration after validation. */
export type CliConfig = ReturnType<typeof Config>;
/**
 * Mount the per-conversation engines.
 * @param ctx - Host context carrying the agent lifecycle events.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: HostContext, config?: Partial<CliConfig>): void;
