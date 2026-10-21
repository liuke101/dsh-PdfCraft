import type { SessionStore } from './host.js';
import { type RouteHandler } from './http.js';
import { type BindingRegistry, type RevisionRegistry } from './workspace-document.js';
/**
 * Build the route handler that reports the conversation's current binding.
 */
export declare function createBindingHandler(bindings: BindingRegistry): RouteHandler;
/** The collaborators the Workspace Document route needs. */
export interface DocumentHandlerOptions {
    readonly sessions: SessionStore | undefined;
    readonly bindings: BindingRegistry;
    readonly revisions: RevisionRegistry;
    readonly maxBytes: number;
}
/**
 * Build the route handler that reads a Workspace Document and accepts its Write-back.
 */
export declare function createDocumentHandler({ sessions, bindings, revisions, maxBytes, }: DocumentHandlerOptions): RouteHandler;
