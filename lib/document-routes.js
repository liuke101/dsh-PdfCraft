/**
 * The Workspace Document HTTP surface as pure request-to-response decisions,
 * with thin node:http adapters at the bottom.
 *
 * Two exact routes sit beside the asset route:
 *
 * - `GET /pdfcraft/binding?session=<id>` answers which Workspace Document the
 *   conversation is bound to, or `document: null` for Standalone Mode.
 * - `GET /pdfcraft/document?session=<id>[&path=<path>]` serves the document's
 *   bytes and the revision the Panel must quote on the way back.
 * - `POST /pdfcraft/document?session=<id>[&path=<path>]&revision=<rev>[&force=1]`
 *   is the Write-back; the body is the complete new PDF.
 *
 * The policy lives in `workspace-document.js`; this module only parses requests,
 * reads a bounded body, and turns a decision into status, headers and JSON.
 */
import { queryOf, send, sendJson } from './http.js'
import { REVISION_HEADER } from '../dist/shared/paths.js'
import {
  DOCUMENT_ERROR,
  documentTooLarge,
  normalizeMaxBytes,
  readWorkspaceDocument,
  writeWorkspaceDocument,
} from './workspace-document.js'

function isReadableMethod(method) {
  return method === 'GET' || method === 'HEAD'
}

function sendDocument(response, request, result) {
  send(response, request, 200, {
    'content-type': 'application/pdf',
    'cache-control': 'no-store',
    'content-length': String(result.bytes.byteLength),
    'x-pdfcraft-revision': result.revision,
  }, result.bytes)
}

function sendFailure(response, request, result) {
  sendJson(response, request, result.status, {
    code: result.code,
    message: result.message,
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(result.choices === undefined ? {} : { choices: result.choices }),
  })
}

function methodNotAllowed(response, request, allow) {
  send(response, request, 405, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    allow,
  }, 'method not allowed')
}

/**
 * Read the complete request body, refusing past the configured document limit
 * without buffering the rest.
 * @returns {{tooLarge: boolean, bytes: Buffer | undefined, total: number}}
 */
async function readBody(request, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > limit) return { tooLarge: true, total }
    chunks.push(buffer)
  }
  return { tooLarge: false, bytes: Buffer.concat(chunks), total }
}

/** A request's session id, decoded once. */
function sessionOf(query) {
  return query.get('session') ?? ''
}

/** A request's document path: the explicit one, else the conversation's binding. */
function documentPathOf(query, bindings, sessionId) {
  const explicit = query.get('path')
  if (explicit !== null) return { path: explicit }
  const bound = bindings.get(sessionId)
  if (bound === undefined) {
    return {
      failure: {
        status: 409,
        code: DOCUMENT_ERROR.notBound,
        message: 'No Workspace Document is bound to this conversation; the Panel is in Standalone Mode.',
      },
    }
  }
  return { path: bound.path }
}

function forceOf(query, request) {
  const value = query.get('force')
  if (value === '1' || value === 'true') return true
  return (request.headers ?? {})['x-pdfcraft-force'] === '1'
}

/**
 * Resolve the request's conversation and target document, answering the
 * refusal itself when either is missing.
 * @returns {{sessionId: string, path: string} | undefined}
 */
function targetOf(query, bindings, request, response) {
  const sessionId = sessionOf(query)
  if (sessionId === '') {
    sendJson(response, request, 400, {
      code: DOCUMENT_ERROR.badRequest,
      message: 'A document request needs the conversation id (session).',
    })
    return undefined
  }
  const chosen = documentPathOf(query, bindings, sessionId)
  if (chosen.failure !== undefined) {
    sendJson(response, request, chosen.failure.status, {
      code: chosen.failure.code,
      message: chosen.failure.message,
    })
    return undefined
  }
  return { sessionId, path: chosen.path }
}

/** Keep one unexpected throw from taking down the server fiber. */
function guarded(handler) {
  return async (request, response) => {
    try {
      await handler(request, response)
    } catch {
      if (response.headersSent !== true && response.writableEnded !== true) {
        sendJson(response, request, 500, {
          code: DOCUMENT_ERROR.internal,
          message: 'The Panel hit an unexpected error while reaching the workspace.',
        })
      }
    }
  }
}

/**
 * Build the route handler that reports the conversation's current binding.
 * @param {object} bindings - the per-conversation binding registry.
 */
export function createBindingHandler(bindings) {
  return guarded(async (request, response) => {
    if (!isReadableMethod(request.method)) {
      methodNotAllowed(response, request, 'GET, HEAD')
      return
    }
    const query = queryOf(request)
    const sessionId = sessionOf(query)
    if (sessionId === '') {
      sendJson(response, request, 400, {
        code: DOCUMENT_ERROR.badRequest,
        message: 'The binding report needs the conversation id (session).',
      })
      return
    }
    sendJson(response, request, 200, {
      sessionId,
      document: bindings.get(sessionId) ?? null,
    })
  })
}

/**
 * Build the route handler that reads a Workspace Document and accepts its Write-back.
 *
 * @param {object} options
 * @param {{get(id: string): object | undefined}} options.sessions - the Session store.
 * @param {object} options.bindings - the per-conversation binding registry.
 * @param {object} options.revisions - the revisions the read route issued.
 * @param {number} options.maxBytes - the per-document limit.
 */
export function createDocumentHandler({ sessions, bindings, revisions, maxBytes }) {
  const limit = normalizeMaxBytes(maxBytes)

  return guarded(async (request, response) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const query = queryOf(request)
      const target = targetOf(query, bindings, request, response)
      if (target === undefined) return
      const result = await readWorkspaceDocument({
        sessions,
        revisions,
        sessionId: target.sessionId,
        documentPath: target.path,
        maxBytes: limit,
      })
      if (!result.ok) sendFailure(response, request, result)
      else sendDocument(response, request, result)
      return
    }

    if (request.method === 'POST') {
      const query = queryOf(request)
      const target = targetOf(query, bindings, request, response)
      if (target === undefined) return
      const body = await readBody(request, limit)
      if (body.tooLarge) {
        sendFailure(response, request, documentTooLarge(limit))
        return
      }
      const result = await writeWorkspaceDocument({
        sessions,
        revisions,
        sessionId: target.sessionId,
        documentPath: target.path,
        revision: query.get('revision') ?? (request.headers ?? {})[REVISION_HEADER] ?? '',
        force: forceOf(query, request),
        bytes: body.bytes,
        maxBytes: limit,
      })
      if (!result.ok) sendFailure(response, request, result)
      else sendJson(response, request, 200, result)
      return
    }

    methodNotAllowed(response, request, 'GET, HEAD, POST')
  })
}
