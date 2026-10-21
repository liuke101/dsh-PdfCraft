/**
 * The Panel's protocol vocabulary, shared by the host half in Node and the
 * browser half in the shell.
 *
 * Everything here is a plain value or type: no Node built-ins, no DOM, so the
 * same module can be imported by the compiled host and inlined into the
 * browser bundle. The Workspace Document refusal codes are the contract the
 * Panel branches on, so the two halves name them from here instead of keeping
 * mirrored lists.
 */
/** One Workspace Document as the binding registry and the Panel describe it. */
export interface BoundDocument {
    /** The path the read and Write-back routes resolve, as it was bound. */
    readonly path: string;
    /** The name the Embedded App shows in its own tab. */
    readonly name: string;
}
/**
 * One ask for a conversation's Panel to open, as the Push Channel carries it.
 * A null document is Standalone Mode.
 */
export interface OpenRequest {
    /** Opaque id, for logs and tests. */
    readonly id: string;
    /** The conversation whose Panel should open. */
    readonly sessionId: string;
    /** The bound Workspace Document, or null for Standalone Mode. */
    readonly document: BoundDocument | null;
}
/** Stable Workspace Document failure codes; callers branch on these, never on message text. */
export declare const DOCUMENT_ERROR: {
    readonly badRequest: 'workspace-document/bad-request';
    readonly unknownSession: 'workspace-document/unknown-session';
    readonly noWorkspace: 'workspace-document/no-workspace';
    readonly notFound: 'workspace-document/not-found';
    readonly outsideWorkspace: 'workspace-document/outside-workspace';
    readonly tooLarge: 'workspace-document/too-large';
    readonly notBound: 'workspace-document/not-bound';
    readonly notLoaded: 'workspace-document/not-loaded';
    readonly revisionConflict: 'workspace-document/revision-conflict';
    readonly writeFailed: 'workspace-document/write-failed';
    readonly internal: 'workspace-document/internal';
};
/** One of the stable refusal codes above. */
export type DocumentErrorCode = (typeof DOCUMENT_ERROR)[keyof typeof DOCUMENT_ERROR];
/** The JSON body of a refused read or Write-back. */
export interface DocumentFailure {
    /** One of {@link DOCUMENT_ERROR}. */
    readonly code: DocumentErrorCode;
    /** Human-readable English fallback; the Panel prefers its own copy. */
    readonly message: string;
    /** Machine-readable context, such as the configured size limit. */
    readonly details?: Record<string, unknown>;
    /** The explicit choices a Revision Guard refusal offers. */
    readonly choices?: readonly string[];
}
