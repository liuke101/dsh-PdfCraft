import type { BoundDocument, OpenRequest } from '../shared/protocol.js';
import { type Disposer, type HostContext } from './host.js';
import type { BindingRegistry } from './workspace-document.js';
/** The human entry point; the command name without its leading slash. */
export declare const OPEN_COMMAND_NAME = "pdfcraft";
/** The model-facing entry point. */
export declare const OPEN_TOOL_NAME = "pdfcraft_open";
/** One delivered or queued open. */
export interface OpenOutcome {
    readonly id: string;
    readonly delivered: boolean;
    readonly document: BoundDocument | null;
}
/** The Push Channel's decision surface. */
export interface PanelOpens {
    /**
     * Bind a conversation and queue (or deliver) its open request.
     * @param sessionId - the conversation whose Panel should open.
     * @param documentPath - the Workspace Document, or nothing for Standalone Mode.
     */
    open(sessionId: string, documentPath?: string | null): OpenOutcome;
    /**
     * Attach one browser stream for a conversation and flush what was waiting.
     * A sender that throws is detached by its owner; the request it was handed
     * is not replayed, which keeps delivery exactly once.
     * @param sessionId - the conversation the stream shows.
     * @param send - writes one request to the stream.
     * @returns detaches the stream.
     */
    attach(sessionId: string, send: (request: OpenRequest) => void): Disposer;
    /**
     * Turn the entries on or off. Turning them off drops every request that has
     * not reached a stream yet; an already-opened Panel is untouched.
     */
    setEnabled(next: boolean): void;
    /** Drop the queues and every attached stream; the plugin is going away. */
    dispose(): void;
    /** Pending requests in bind order, for diagnostics and tests. */
    pendingRequests(): OpenRequest[];
}
/** What `createPanelOpens` needs from its owner. */
export interface PanelOpensOptions {
    readonly bindings: BindingRegistry;
    /** Whether the two entries may create requests. */
    readonly enabled?: boolean;
    /** Receives non-fatal failures. */
    readonly warn?: (message: string) => void;
}
/**
 * Create the Push Channel over one conversation binding registry.
 */
export declare function createPanelOpens({ bindings, enabled, warn, }: PanelOpensOptions): PanelOpens;
/**
 * Register the person's `/pdfcraft` command.
 *
 * With a path the command binds that Workspace Document and asks the browser
 * to open the Panel at it. With no path it clears the binding, so the Panel
 * opens in Standalone Mode instead of failing. The handler never submits a
 * model message; this is the whole point of the command.
 */
export declare function registerOpenCommand(ctx: HostContext, opens: PanelOpens): Disposer | undefined;
/**
 * Register the model-facing `pdfcraft_open` tool.
 *
 * The tool binds one Workspace Document for the calling conversation and asks
 * that conversation's Panel to open it. It never opens a second Panel and
 * never names another conversation: the agent speaks for the conversation it
 * is running in, exactly like the person's command. A path that is not in the
 * workspace is refused later, when the Panel reads it, by the same route that
 * guards the person's own opens.
 */
export declare function registerOpenTool(ctx: HostContext, opens: PanelOpens): Disposer | undefined;
