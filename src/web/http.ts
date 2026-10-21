/**
 * The small HTTP helpers every route module shares: query parsing and the
 * response writers. They know nothing about the Panel, so a route module keeps
 * only its own policy and framing.
 *
 * The request and response types are the narrow slice of `node:http` these
 * handlers actually touch, so the route decisions can be driven by a plain
 * recording object in the suite as well as by the real server.
 */
import type { IncomingHttpHeaders } from 'node:http'

/** One inbound request, as much of `IncomingMessage` as a route reads. */
export interface RouteRequest {
  readonly method?: string
  readonly url?: string
  readonly headers?: IncomingHttpHeaders
  [Symbol.asyncIterator](): AsyncIterator<Buffer | Uint8Array | string>
}

/** One outbound response, as much of `ServerResponse` as a route writes. */
export interface RouteResponse {
  readonly headersSent?: boolean
  readonly writableEnded?: boolean
  writeHead(statusCode: number, headers?: Record<string, string>): unknown
  write(chunk: string | Uint8Array): unknown
  end(chunk?: string | Uint8Array): unknown
  on?(event: string, listener: () => void): unknown
}

/** One route body; a rejection is caught by the route's own guard. */
export type RouteHandler = (request: RouteRequest, response: RouteResponse) => void | Promise<void>

/** The request's decoded query parameters. */
export function queryOf(request: RouteRequest): URLSearchParams {
  return new URL(request.url ?? '/', 'http://dsh.internal').searchParams
}

/** Write one complete response, honoring HEAD and an absent body. */
export function send(
  response: RouteResponse,
  request: RouteRequest,
  statusCode: number,
  headers: Record<string, string>,
  body?: string | Uint8Array,
): void {
  response.writeHead(statusCode, { 'x-content-type-options': 'nosniff', ...headers })
  if (request.method === 'HEAD' || body === undefined) response.end()
  else response.end(body)
}

/** Write one JSON response with the cache and type headers the Panel expects. */
export function sendJson(
  response: RouteResponse,
  request: RouteRequest,
  statusCode: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  send(response, request, statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
  }, body)
}
