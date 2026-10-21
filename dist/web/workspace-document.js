/**
 * Workspace Document access: the decisions behind reading a PDF into the Panel
 * and writing the Panel's bytes back into the conversation's workspace.
 *
 * Three rules live here, all of them independent of HTTP:
 *
 * - **Containment.** A requested path is resolved to its real path and must
 *   fall inside the conversation's workspace root (`SessionHeader.cwd`), the
 *   same boundary the agent's Agent MCP Root uses. Symlinks are resolved, so a
 *   link planted inside the workspace cannot reach outside it.
 * - **Size limit.** One configured per-document limit refuses both a read and
 *   a Write-back, and the refusal names the limit.
 * - **Revision Guard.** Reading records the served content's SHA-256. A later
 *   Write-back is accepted only while the file on disk still hashes to that
 *   value; otherwise it is refused with the explicit `reload` and `overwrite`
 *   choices. Nothing is written before every check has passed, and the write
 *   itself replaces the file atomically.
 *
 * The binding registry is the seam the Push Channel drives: one Workspace
 * Document per conversation, replaced in place by a later bind.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { DOCUMENT_ERROR, } from '../shared/protocol.js';
/** The per-document limit when the row does not configure one. */
export const DEFAULT_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
/** The choices a Revision Guard refusal offers the person. */
export const REVISION_CHOICES = Object.freeze(['reload', 'overwrite']);
/** SHA-256 of one document's bytes, in lowercase hex. */
export function revisionOf(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
/** Clamp a configured limit to a usable non-negative integer. */
export function normalizeMaxBytes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return DEFAULT_MAX_DOCUMENT_BYTES;
    }
    return Math.floor(value);
}
function failure(status, code, message, details, choices) {
    return {
        ok: false,
        status,
        code,
        message,
        ...(details === undefined ? {} : { details }),
        ...(choices === undefined ? {} : { choices }),
    };
}
/** Whether one real path is the root itself or lies below it. */
function isInside(root, target) {
    if (target === root)
        return true;
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    return target.startsWith(prefix);
}
/** A document path is a non-empty string naming a file, never a NUL-bearing one. */
function isDocumentPath(value) {
    return typeof value === 'string' && value !== '' && !value.includes('\0');
}
/** The name the Panel and the person see, taken from the requested path. */
function nameOf(documentPath) {
    const name = basename(documentPath);
    return name === '' || name === '.' || name === sep ? 'document.pdf' : name;
}
/**
 * The per-conversation binding registry.
 *
 * The Push Channel binds a document before it tells the browser to open the
 * Panel; the read and write routes resolve the bound document when the request
 * does not name one. A later bind for the same conversation replaces the
 * previous document in place, so one conversation never has two.
 */
export function createBindingRegistry() {
    const bySession = new Map();
    return {
        bind(sessionId, documentPath) {
            if (typeof sessionId !== 'string' || sessionId === '') {
                throw new TypeError('a binding needs a conversation id');
            }
            if (!isDocumentPath(documentPath)) {
                throw new TypeError('a binding needs a document path');
            }
            const document = Object.freeze({ path: documentPath, name: nameOf(documentPath) });
            bySession.set(sessionId, document);
            return document;
        },
        get(sessionId) {
            return bySession.get(sessionId);
        },
        clear(sessionId) {
            return bySession.delete(sessionId);
        },
        entries() {
            return [...bySession.entries()].map(([sessionId, document]) => ({ sessionId, ...document }));
        },
    };
}
/** The revisions the read route issued, keyed by conversation and real file. */
export function createRevisionRegistry() {
    const records = new Map();
    const keyOf = (sessionId, absolutePath) => `${sessionId}\0${absolutePath}`;
    return {
        record(sessionId, absolutePath, revision) {
            records.set(keyOf(sessionId, absolutePath), revision);
        },
        get(sessionId, absolutePath) {
            return records.get(keyOf(sessionId, absolutePath));
        },
    };
}
/** Resolve the conversation's workspace root, or the refusal that explains why not. */
function workspaceRootOf(sessions, sessionId) {
    let session;
    try {
        session = sessions?.get?.(sessionId);
    }
    catch {
        return failure(404, DOCUMENT_ERROR.unknownSession, `Unknown conversation: ${sessionId}.`);
    }
    if (session === undefined || session === null) {
        return failure(404, DOCUMENT_ERROR.unknownSession, `Unknown conversation: ${sessionId}.`);
    }
    const cwd = session.header?.cwd;
    if (typeof cwd !== 'string' || cwd === '') {
        return failure(409, DOCUMENT_ERROR.noWorkspace, 'This conversation has no workspace, so it has no document the Panel can open.');
    }
    return { ok: true, root: cwd };
}
/** Resolve a requested document inside the workspace, following symlinks. */
async function resolveInsideWorkspace(sessions, sessionId, documentPath) {
    if (typeof sessionId !== 'string' || sessionId === '') {
        return failure(400, DOCUMENT_ERROR.badRequest, 'A request needs the conversation id (session).');
    }
    if (!isDocumentPath(documentPath)) {
        return failure(400, DOCUMENT_ERROR.badRequest, 'A request needs a document path (path).');
    }
    const workspace = workspaceRootOf(sessions, sessionId);
    if (!workspace.ok)
        return workspace;
    let realRoot;
    try {
        realRoot = await realpath(workspace.root);
    }
    catch {
        return failure(409, DOCUMENT_ERROR.noWorkspace, 'This conversation\'s workspace no longer exists.');
    }
    const candidate = resolve(realRoot, documentPath);
    let realTarget;
    try {
        realTarget = await realpath(candidate);
    }
    catch {
        return failure(404, DOCUMENT_ERROR.notFound, `No such document: ${documentPath}.`);
    }
    if (!isInside(realRoot, realTarget)) {
        return failure(403, DOCUMENT_ERROR.outsideWorkspace, `${documentPath} is outside this conversation's workspace.`, { path: documentPath });
    }
    let info;
    try {
        info = await stat(realTarget);
    }
    catch {
        return failure(404, DOCUMENT_ERROR.notFound, `No such document: ${documentPath}.`);
    }
    if (!info.isFile()) {
        return failure(404, DOCUMENT_ERROR.notFound, `Not a regular file: ${documentPath}.`);
    }
    return { ok: true, realTarget, info, name: nameOf(documentPath) };
}
/** The refusal for a document above the configured per-document limit. */
export function documentTooLarge(maxBytes, bytes) {
    const measured = typeof bytes === 'number'
        ? `This document is ${bytes} bytes; `
        : 'This document is over the limit; ';
    return failure(413, DOCUMENT_ERROR.tooLarge, `${measured}the configured limit is ${maxBytes} bytes (maxDocumentBytes).`, { limit: maxBytes, ...(typeof bytes === 'number' ? { bytes } : {}), config: 'maxDocumentBytes' });
}
/**
 * Read one Workspace Document and record the revision the Panel will hold.
 */
export async function readWorkspaceDocument({ sessions, revisions, sessionId, documentPath, maxBytes, }) {
    const limit = normalizeMaxBytes(maxBytes);
    const resolved = await resolveInsideWorkspace(sessions, sessionId, documentPath);
    if (!resolved.ok)
        return resolved;
    if (resolved.info.size > limit)
        return documentTooLarge(limit, resolved.info.size);
    let bytes;
    try {
        bytes = await readFile(resolved.realTarget);
    }
    catch {
        return failure(404, DOCUMENT_ERROR.notFound, `No such document: ${documentPath}.`);
    }
    if (bytes.byteLength > limit)
        return documentTooLarge(limit, bytes.byteLength);
    const revision = revisionOf(bytes);
    revisions.record(sessionId, resolved.realTarget, revision);
    return {
        ok: true,
        bytes,
        revision,
        name: resolved.name,
        path: documentPath,
    };
}
/** Replace the file through a same-directory temp inode carrying its mode. */
async function replaceAtomically(absolutePath, bytes, mode) {
    const temp = `${absolutePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        await writeFile(temp, bytes, { flag: 'wx', mode: mode & 0o777 });
        await rename(temp, absolutePath);
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}
/**
 * Write the Panel's bytes back into a Workspace Document, under the Revision Guard.
 *
 * Every refusal returns before the replacement starts, so a refused Write-back
 * leaves the file exactly as it was. `force` is the person's explicit
 * overwrite-anyway choice after a Revision Guard refusal; it still requires a
 * document the read route served.
 */
export async function writeWorkspaceDocument({ sessions, revisions, sessionId, documentPath, revision, force = false, bytes, maxBytes, }) {
    const limit = normalizeMaxBytes(maxBytes);
    if (typeof revision !== 'string' || revision === '') {
        return failure(400, DOCUMENT_ERROR.badRequest, 'A Write-back needs the revision the Panel loaded.');
    }
    if (!(bytes instanceof Uint8Array)) {
        return failure(400, DOCUMENT_ERROR.badRequest, 'A Write-back needs the document bytes.');
    }
    const resolved = await resolveInsideWorkspace(sessions, sessionId, documentPath);
    if (!resolved.ok)
        return resolved;
    if (bytes.byteLength > limit)
        return documentTooLarge(limit, bytes.byteLength);
    const recorded = revisions.get(sessionId, resolved.realTarget);
    if (recorded === undefined) {
        return failure(409, DOCUMENT_ERROR.notLoaded, 'Open this document in the Panel before saving it.');
    }
    let current;
    try {
        current = await readFile(resolved.realTarget);
    }
    catch {
        return failure(404, DOCUMENT_ERROR.notFound, `No such document: ${documentPath}.`);
    }
    const currentRevision = revisionOf(current);
    if (!force && (revision !== recorded || currentRevision !== recorded)) {
        return failure(409, DOCUMENT_ERROR.revisionConflict, 'This document changed on disk after the Panel loaded it. Reload it, or overwrite it with the Panel\'s copy.', { revision, currentRevision, recordedRevision: recorded }, [...REVISION_CHOICES]);
    }
    try {
        await replaceAtomically(resolved.realTarget, bytes, resolved.info.mode);
    }
    catch {
        return failure(500, DOCUMENT_ERROR.writeFailed, `Could not write ${documentPath}.`);
    }
    const nextRevision = revisionOf(bytes);
    revisions.record(sessionId, resolved.realTarget, nextRevision);
    return {
        ok: true,
        path: documentPath,
        name: resolved.name,
        revision: nextRevision,
        bytes: bytes.byteLength,
    };
}
