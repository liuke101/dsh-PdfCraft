/**
 * The Workspace Document HTTP surface as pure request-to-response decisions,
 * with thin adapters at the bottom.
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
 * The policy lives in `workspace-document.ts`; this module only parses requests,
 * reads a bounded body, and turns a decision into status, headers and JSON.
 */
import { FORCE_HEADER, REVISION_HEADER } from '../shared/paths.ts'
import {
  DOCUMENT_ERROR,
  type DocumentErrorCode,
  type DocumentFailure,
} from '../shared/protocol.ts'
import type { SessionStore } from './host.ts'
import {
  queryOf,
  send,
  sendJson,
  type RouteHandler,
  type RouteRequest,
  type RouteResponse,
} from './http.ts'
import {
  documentTooLarge,
  normalizeMaxBytes,
  readWorkspaceDocument,
  writeWorkspaceDocument,
  type BindingRegistry,
  type DocumentRefusal,
  type RevisionRegistry,
} from './workspace-document.ts'

function isReadableMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD'
}

function sendDocument(
  response: RouteResponse,
  request: RouteRequest,
  result: { readonly bytes: Uint8Array; readonly revision: string },
): void {
  send(response, request, 200, {
    'content-type': 'application/pdf',
    'cache-control': 'no-store',
    'content-length': String(result.bytes.byteLength),
    [REVISION_HEADER]: result.revision,
  }, result.bytes)
}

function sendFailure(response: RouteResponse, request: RouteRequest, result: DocumentRefusal): void {
  const body: DocumentFailure = {
    code: result.code,
    message: result.message,
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(result.choices === undefined ? {} : { choices: result.choices }),
  }
  sendJson(response, request, result.status, body)
}

function methodNotAllowed(response: RouteResponse, request: RouteRequest, allow: string): void {
  send(response, request, 405, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    allow,
  }, 'method not allowed')
}

/** A complete or over-limit request body. */
type RequestBody =
  | { readonly tooLarge: true }
  | { readonly tooLarge: false; readonly bytes: Buffer }

/**
 * Read the complete request body, refusing past the configured document limit
 * without buffering the rest.
 */
async function readBody(request: RouteRequest, limit: number): Promise<RequestBody> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > limit) return { tooLarge: true }
    chunks.push(buffer)
  }
  return { tooLarge: false, bytes: Buffer.concat(chunks) }
}

/** A request's session id, decoded once. */
function sessionOf(query: URLSearchParams): string {
  return query.get('session') ?? ''
}

/** A refusal a route answers itself, before it reaches the document policy. */
interface EarlyRefusal {
  readonly status: number
  readonly code: DocumentErrorCode
  readonly message: string
}

/** The target document a request resolves, or undefined once a refusal was answered. */
type RequestTarget = { readonly sessionId: string; readonly path: string } | undefined

/** A request's document path: the explicit one, else the conversation's binding. */
function documentPathOf(
  query: URLSearchParams,
  bindings: BindingRegistry,
  sessionId: string,
): { readonly path: string } | { readonly failure: EarlyRefusal } {
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

function forceOf(query: URLSearchParams, request: RouteRequest): boolean {
  const value = query.get('force')
  if (value === '1' || value === 'true') return true
  return (request.headers ?? {})[FORCE_HEADER] === '1'
}

/**
 * Resolve the request's conversation and target document, answering the
 * refusal itself when either is missing.
 */
function targetOf(
  query: URLSearchParams,
  bindings: BindingRegistry,
  request: RouteRequest,
  response: RouteResponse,
): RequestTarget {
  const sessionId = sessionOf(query)
  if (sessionId === '') {
    sendJson(response, request, 400, {
      code: DOCUMENT_ERROR.badRequest,
      message: 'A document request needs the conversation id (session).',
    })
    return undefined
  }
  const chosen = documentPathOf(query, bindings, sessionId)
  if ('failure' in chosen) {
    sendJson(response, request, chosen.failure.status, {
      code: chosen.failure.code,
      message: chosen.failure.message,
    })
    return undefined
  }
  return { sessionId, path: chosen.path }
}

/** Keep one unexpected throw from taking down the server fiber. */
function guarded(handler: RouteHandler): RouteHandler {
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
 */
export function createBindingHandler(bindings: BindingRegistry): RouteHandler {
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

/** The collaborators the Workspace Document route needs. */
export interface DocumentHandlerOptions {
  readonly sessions: SessionStore | undefined
  readonly bindings: BindingRegistry
  readonly revisions: RevisionRegistry
  readonly maxBytes: number
}

/**
 * Build the route handler that reads a Workspace Document and accepts its Write-back.
 */
export function createDocumentHandler({
  sessions,
  bindings,
  revisions,
  maxBytes,
}: DocumentHandlerOptions): RouteHandler {
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
      const header = (request.headers ?? {})[REVISION_HEADER]
      const result = await writeWorkspaceDocument({
        sessions,
        revisions,
        sessionId: target.sessionId,
        documentPath: target.path,
        revision: query.get('revision') ?? (typeof header === 'string' ? header : ''),
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
