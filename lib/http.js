/**
 * The small HTTP helpers every route module shares: query parsing and the
 * response writers. They know nothing about the Panel, so a route module
 * keeps only its own policy and framing.
 */

/** The request's decoded query parameters. */
export function queryOf(request) {
  return new URL(request.url ?? '/', 'http://dsh.internal').searchParams
}

/** Write one complete response, honoring HEAD and an absent body. */
export function send(response, request, statusCode, headers, body) {
  response.writeHead(statusCode, { 'x-content-type-options': 'nosniff', ...headers })
  if (request.method === 'HEAD' || body === undefined) response.end()
  else response.end(body)
}

/** Write one JSON response with the cache and type headers the Panel expects. */
export function sendJson(response, request, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  send(response, request, statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
  }, body)
}
