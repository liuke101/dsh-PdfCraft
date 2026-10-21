import type { HostContext } from './host.js';
/** The command that starts the upstream engine when configuration names no other. */
export declare const DEFAULT_CLI = "pdfcraft-cli";
/** The settings the engines run with, resolved from the row's configuration. */
export interface EngineSettings {
    readonly cliPath: string;
    readonly staticRoot: string;
    readonly compactSurface: boolean;
}
/** The three engine fields the row configures. */
export interface AgentToolsConfig {
    readonly cliPath?: string;
    readonly staticRoot?: string;
    readonly compactSurface?: boolean;
}
/**
 * Register the agent lifecycle listeners that mount and release engines.
 * @param ctx - Host context owning the listeners.
 * @param config - resolved plugin configuration.
 */
export declare function registerAgentTools(ctx: HostContext, config?: AgentToolsConfig): void;
