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
/** Stable Workspace Document failure codes; callers branch on these, never on message text. */
export const DOCUMENT_ERROR = {
    badRequest: 'workspace-document/bad-request',
    unknownSession: 'workspace-document/unknown-session',
    noWorkspace: 'workspace-document/no-workspace',
    notFound: 'workspace-document/not-found',
    outsideWorkspace: 'workspace-document/outside-workspace',
    tooLarge: 'workspace-document/too-large',
    notBound: 'workspace-document/not-bound',
    notLoaded: 'workspace-document/not-loaded',
    revisionConflict: 'workspace-document/revision-conflict',
    writeFailed: 'workspace-document/write-failed',
    internal: 'workspace-document/internal',
};
