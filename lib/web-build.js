/**
 * The Panel's HTTP surface as pure request-to-response decisions, with two
 * thin node:http adapters at the bottom.
 *
 * Everything the browser needs comes from the configured web build directory:
 * `index.html`, the wasm-bindgen glue, and the WebAssembly module. The route
 * deliberately knows nothing about DSH vocabulary beyond the paths it serves,
 * so its behavior is testable without a server and without a Cordis context.
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, resolve, sep } from 'node:path'

import { send, sendJson } from './http.js'
import { APP_PATH, ASSET_PREFIX, WEB_BUILD_FILENAME, WEB_RELEASE, WEB_RELEASE_URL } from './paths.js'

/** Media types the browser refuses to render under a generic fallback. */
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.pdf', 'application/pdf'],
])

/** The browser's required type for each file, by extension. */
function contentTypeFor(pathname) {
  return CONTENT_TYPES.get(extname(pathname).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * Hashed build files can be cached forever; only the document needs
 * revalidation (see the upstream HOSTING.md).
 */
function cacheControlFor(pathname) {
  if (basename(pathname) === 'index.html') return 'no-cache'
  return /\.(?:js|mjs|wasm|css|woff2?)$/i.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
}

/** The JSON readiness report the Panel asks for before it mounts the frame. */
async function inspectWebBuild(webBuildDir) {
  const status = {
    ready: false,
    reason: 'missing-build',
    directory: typeof webBuildDir === 'string' ? webBuildDir : '',
    file: WEB_BUILD_FILENAME,
    release: WEB_RELEASE,
    releaseUrl: WEB_RELEASE_URL,
    appPath: APP_PATH,
  }

  if (status.directory.trim() === '') return { ...status, reason: 'not-configured' }

  let info
  try {
    info = await stat(status.directory)
  } catch {
    return status
  }
  if (!info.isDirectory()) return { ...status, reason: 'not-a-directory' }

  try {
    const index = await stat(resolve(status.directory, 'index.html'))
    if (!index.isFile()) return { ...status, reason: 'missing-index' }
  } catch {
    return { ...status, reason: 'missing-index' }
  }

  return { ...status, ready: true, reason: 'ready' }
}

/** The request's pathname, resolved against the harness's own dummy origin. */
function pathnameOf(request) {
  return new URL(request.url ?? '/', 'http://dsh.internal').pathname
}

/** The plain-text answer a direct visit gets when the build is absent. */
function missingBuildMessage(status) {
  const directory = status.directory.trim() === '' ? '(not configured)' : status.directory
  return `PdfCraft web build not found. Fetch ${status.file} from ${status.releaseUrl}, `
    + `extract it, then set webBuildDir to the extracted folder. Currently configured: ${directory}.`
}

function isReadableMethod(method) {
  return method === 'GET' || method === 'HEAD'
}

function notFound(response, request) {
  send(response, request, 404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  }, 'not found')
}

function methodNotAllowed(response, request) {
  send(response, request, 405, {
    'content-type': 'text/plain; charset=utf-8',
    allow: 'GET, HEAD',
  }, 'method not allowed')
}

/** Resolve one URL pathname below the build directory, or undefined when it escapes. */
function resolveInside(webBuildDir, pathname) {
  const root = resolve(webBuildDir)
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  const target = resolve(root, `.${decoded}`)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined
  return { root, target }
}

async function realPathInside(root, target) {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) return undefined
    const info = await stat(realTarget)
    return info.isFile() ? realTarget : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the route handler that answers the Panel's readiness question.
 * @param {string} webBuildDir - the configured directory holding the web build.
 */
export function createStatusHandler(webBuildDir) {
  return async (request, response) => {
    if (!isReadableMethod(request.method)) {
      methodNotAllowed(response, request)
      return
    }
    sendJson(response, request, 200, await inspectWebBuild(webBuildDir))
  }
}

/**
 * Build the route handler that serves the Embedded App and its assets.
 * @param {string} webBuildDir - the configured directory holding the web build.
 */
export function createAssetHandler(webBuildDir) {
  return async (request, response) => {
    if (!isReadableMethod(request.method)) {
      methodNotAllowed(response, request)
      return
    }

    const pathname = pathnameOf(request)

    if (pathname === ASSET_PREFIX) {
      send(response, request, 308, { location: APP_PATH, 'cache-control': 'no-store' })
      return
    }

    const status = await inspectWebBuild(webBuildDir)
    if (!status.ready) {
      send(response, request, 503, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      }, missingBuildMessage(status))
      return
    }

    const relativePath = pathname.slice(ASSET_PREFIX.length) === '/'
      ? '/index.html'
      : pathname.slice(ASSET_PREFIX.length)
    const inside = resolveInside(webBuildDir, relativePath)
    if (inside === undefined) {
      notFound(response, request)
      return
    }

    const file = await realPathInside(inside.root, inside.target)
    if (file === undefined) {
      notFound(response, request)
      return
    }

    let body
    try {
      body = await readFile(file)
    } catch {
      notFound(response, request)
      return
    }

    send(response, request, 200, {
      'content-type': contentTypeFor(file),
      'cache-control': cacheControlFor(file),
      'content-length': String(body.byteLength),
    }, body)
  }
}
