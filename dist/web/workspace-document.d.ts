import { type BoundDocument, type DocumentFailure } from '../shared/protocol.js';
import type { SessionStore } from './host.js';
/** The per-document limit when the row does not configure one. */
export declare const DEFAULT_MAX_DOCUMENT_BYTES: number;
/** The choices a Revision Guard refusal offers the person. */
export declare const REVISION_CHOICES: readonly ["reload", "overwrite"];
/** A refused read or Write-back, before it becomes an HTTP response. */
export interface DocumentRefusal extends DocumentFailure {
    readonly ok: false;
    readonly status: number;
}
/** SHA-256 of one document's bytes, in lowercase hex. */
export declare function revisionOf(bytes: Uint8Array): string;
/** Clamp a configured limit to a usable non-negative integer. */
export declare function normalizeMaxBytes(value: unknown): number;
/** The per-conversation binding registry. */
export interface BindingRegistry {
    /**
     * Bind (or replace) the one Workspace Document of a conversation.
     * @param sessionId - the conversation the binding belongs to.
     * @param documentPath - a path relative to the workspace, or absolute.
     */
    bind(sessionId: string, documentPath: string): BoundDocument;
    /** The conversation's bound document, or undefined in Standalone Mode. */
    get(sessionId: string): BoundDocument | undefined;
    /** Drop the binding, leaving the conversation in Standalone Mode. */
    clear(sessionId: string): boolean;
    /** Every current binding, in bind order (diagnostics and tests). */
    entries(): Array<BoundDocument & {
        readonly sessionId: string;
    }>;
}
/**
 * The per-conversation binding registry.
 *
 * The Push Channel binds a document before it tells the browser to open the
 * Panel; the read and write routes resolve the bound document when the request
 * does not name one. A later bind for the same conversation replaces the
 * previous document in place, so one conversation never has two.
 */
export declare function createBindingRegistry(): BindingRegistry;
/**
 * The revisions the read route issued, keyed by conversation and real file.
 * One document is one revision: a read replaces the record, a Write-back
 * replaces it again with the hash of the bytes it wrote.
 */
export interface RevisionRegistry {
    record(sessionId: string, absolutePath: string, revision: string): void;
    get(sessionId: string, absolutePath: string): string | undefined;
}
/** The revisions the read route issued, keyed by conversation and real file. */
export declare function createRevisionRegistry(): RevisionRegistry;
/** The refusal for a document above the configured per-document limit. */
export declare function documentTooLarge(maxBytes: number, bytes?: number): DocumentRefusal;
/** A read that succeeded. */
export interface WorkspaceDocumentRead {
    readonly ok: true;
    readonly bytes: Buffer;
    readonly revision: string;
    readonly name: string;
    readonly path: string;
}
/** The options a read needs. */
export interface ReadWorkspaceDocumentOptions {
    readonly sessions: SessionStore | undefined;
    readonly revisions: RevisionRegistry;
    readonly sessionId: string;
    readonly documentPath: string;
    readonly maxBytes: number;
}
/**
 * Read one Workspace Document and record the revision the Panel will hold.
 */
export declare function readWorkspaceDocument({ sessions, revisions, sessionId, documentPath, maxBytes, }: ReadWorkspaceDocumentOptions): Promise<WorkspaceDocumentRead | DocumentRefusal>;
/** A Write-back that succeeded. */
export interface WorkspaceDocumentWrite {
    readonly ok: true;
    readonly path: string;
    readonly name: string;
    readonly revision: string;
    readonly bytes: number;
}
/** The options a Write-back needs. */
export interface WriteWorkspaceDocumentOptions {
    readonly sessions: SessionStore | undefined;
    readonly revisions: RevisionRegistry;
    readonly sessionId: string;
    readonly documentPath: string;
    /** The revision the Panel loaded. */
    readonly revision: string;
    /** The explicit overwrite-anyway choice after a Revision Guard refusal. */
    readonly force?: boolean;
    /** The complete new document. */
    readonly bytes: Uint8Array | undefined;
    readonly maxBytes: number;
}
/**
 * Write the Panel's bytes back into a Workspace Document, under the Revision Guard.
 *
 * Every refusal returns before the replacement starts, so a refused Write-back
 * leaves the file exactly as it was. `force` is the person's explicit
 * overwrite-anyway choice after a Revision Guard refusal; it still requires a
 * document the read route served.
 */
export declare function writeWorkspaceDocument({ sessions, revisions, sessionId, documentPath, revision, force, bytes, maxBytes, }: WriteWorkspaceDocumentOptions): Promise<WorkspaceDocumentWrite | DocumentRefusal>;
