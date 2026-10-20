import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, Config } from '../index.js'

/**
 * A recording Host context: the only facilities this plugin may use are the
 * Web server's route table and the effect scope that owns the registrations.
 */
function createContext() {
  const routes = []
  const effects = []
  const removals = []
  const listeners = new Map()

  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => removals.push(route.path)
      },
    },
    effect(body) {
      const dispose = body()
      effects.push(dispose)
      return dispose
    },
    on(event, listener) {
      const registered = listeners.get(event) ?? []
      registered.push(listener)
      listeners.set(event, registered)
      return () => {}
    },
    logger: {
      warn() {},
    },
  }

  return {
    ctx,
    routes,
    route(kind, path) {
      const route = routes.find((candidate) => candidate.kind === kind && candidate.path === path)
      assert.ok(route, `expected a ${kind} route at ${path}`)
      return route
    },
    dispose() {
      for (const effect of effects) effect()
    },
    removals,
  }
}

/** A node:http-shaped request the registered Web route handler receives. */
function request(url, method = 'GET') {
  return {
    url,
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {},
  }
}

/** A node:http-shaped response that records what the adapter wrote. */
function response() {
  const chunks = []
  return {
    statusCode: 200,
    headers: {},
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
    get bytes() {
      return Buffer.concat(chunks)
    },
    writeHead(status, headers = {}) {
      this.statusCode = status
      Object.assign(this.headers, headers)
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk))
      return true
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
    },
  }
}

/** Drive one registered route the way the Web server would. */
async function call(harness, kind, path, url, method = 'GET') {
  const res = response()
  await harness.route(kind, path).handler(request(url, method), res)
  return res
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pdfcraft-'))
  return {
    root,
    directory: join(root, 'pdfcraft-web-0.9.0'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

async function installWebBuild(directory, { index = '<!doctype html><title>PdfCraft</title>' } = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), index)
  await writeFile(join(directory, 'pdfcraft-web-abc123.js'), 'export default 1\n')
  await writeFile(join(directory, 'pdfcraft-web-abc123_bg.wasm'), Buffer.from([0, 97, 115, 109]))
}

test('configuration carries one per-document size limit with a safe default', () => {
  const defaults = Config({})
  assert.equal(defaults.maxDocumentBytes, 32 * 1024 * 1024)
  assert.equal(defaults.webBuildDir, '')
  assert.equal(defaults.openTool, true)
  assert.throws(() => Config({ maxDocumentBytes: -1 }), /maxDocumentBytes/)
  assert.throws(() => Config({ maxDocumentBytes: 1.5 }), /maxDocumentBytes/)
})

test('registers the asset, status, Workspace Document and Push Channel routes, and withdrawing the plugin removes them', async () => {
  const harness = createContext()
  apply(harness.ctx, { webBuildDir: '/nonexistent/pdfcraft-web' })

  harness.route('prefix', '/pdfcraft')
  harness.route('exact', '/pdfcraft/status')
  harness.route('exact', '/pdfcraft/binding')
  harness.route('exact', '/pdfcraft/document')
  harness.route('exact', '/pdfcraft/pushes')
  assert.equal(harness.routes.length, 5)

  harness.dispose()
  assert.deepEqual(harness.removals.sort(), [
    '/pdfcraft',
    '/pdfcraft/binding',
    '/pdfcraft/document',
    '/pdfcraft/pushes',
    '/pdfcraft/status',
  ])
})

test('serves the app document and the web assembly with the types the browser requires', async () => {
  const area = await workspace()
  try {
    await installWebBuild(area.directory)
    const harness = createContext()
    apply(harness.ctx, { webBuildDir: area.directory })

    const status = JSON.parse((await call(harness, 'exact', '/pdfcraft/status', '/pdfcraft/status')).body)
    assert.equal(status.ready, true)

    const index = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/')
    assert.equal(index.statusCode, 200)
    assert.equal(index.headers['content-type'], 'text/html; charset=utf-8')
    assert.match(index.body, /<title>PdfCraft<\/title>/)
    assert.equal(index.headers['cache-control'], 'no-cache')

    const wasm = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/pdfcraft-web-abc123_bg.wasm')
    assert.equal(wasm.statusCode, 200)
    assert.equal(wasm.headers['content-type'], 'application/wasm')
    assert.equal(wasm.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.deepEqual([...wasm.bytes], [0, 97, 115, 109])

    const glue = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/pdfcraft-web-abc123.js')
    assert.equal(glue.headers['content-type'], 'text/javascript; charset=utf-8')
    assert.equal(glue.body, 'export default 1\n')

    const head = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/pdfcraft-web-abc123_bg.wasm', 'HEAD')
    assert.equal(head.statusCode, 200)
    assert.equal(head.headers['content-type'], 'application/wasm')
    assert.equal(head.bytes.byteLength, 0)
  } finally {
    await area.cleanup()
  }
})

test('the app route names what to fetch when the build is absent', async () => {
  const area = await workspace()
  try {
    const harness = createContext()
    apply(harness.ctx, { webBuildDir: area.directory })

    const res = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/')
    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
    assert.match(res.body, /pdfcraft-web-0\.9\.0\.zip/)
    assert.match(res.body, /webBuildDir/)
    assert.match(res.body, new RegExp(area.directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await area.cleanup()
  }
})

test('refuses paths outside the build directory, including symlink escapes', async () => {
  const area = await workspace()
  try {
    await installWebBuild(area.directory)
    await writeFile(join(area.root, 'secret.txt'), 'outside the build')
    await symlink(join(area.root, 'secret.txt'), join(area.directory, 'escape.txt'))

    const harness = createContext()
    apply(harness.ctx, { webBuildDir: area.directory })

    for (const url of [
      '/pdfcraft/../secret.txt',
      '/pdfcraft/%2e%2e/secret.txt',
      '/pdfcraft/..%2Fsecret.txt',
      '/pdfcraft/escape.txt',
    ]) {
      const res = await call(harness, 'prefix', '/pdfcraft', url)
      assert.equal(res.statusCode, 404, url)
      assert.doesNotMatch(res.body, /outside the build/, url)
    }
  } finally {
    await area.cleanup()
  }
})

test('reports a wrong configured directory, an unknown asset, and a write attempt', async () => {
  const area = await workspace()
  try {
    await writeFile(join(area.root, 'not-a-directory'), '')
    const harness = createContext()
    apply(harness.ctx, { webBuildDir: join(area.root, 'not-a-directory') })

    const status = JSON.parse((await call(harness, 'exact', '/pdfcraft/status', '/pdfcraft/status')).body)
    assert.equal(status.ready, false)
    assert.equal(status.reason, 'not-a-directory')
    assert.equal(status.file, 'pdfcraft-web-0.9.0.zip')

    const page = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/')
    assert.equal(page.statusCode, 503)
    assert.match(page.body, /pdfcraft-web-0\.9\.0\.zip/)

    const post = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/', 'POST')
    assert.equal(post.statusCode, 405)
  } finally {
    await area.cleanup()
  }
})

test('an unknown asset is not found and the bare prefix lands on the app path', async () => {
  const area = await workspace()
  try {
    await installWebBuild(area.directory)
    const harness = createContext()
    apply(harness.ctx, { webBuildDir: area.directory })

    const unknown = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft/nope.png')
    assert.equal(unknown.statusCode, 404)

    const bare = await call(harness, 'prefix', '/pdfcraft', '/pdfcraft')
    assert.equal(bare.statusCode, 308)
    assert.equal(bare.headers.location, '/pdfcraft/')
  } finally {
    await area.cleanup()
  }
})

test('reports a missing web build with the file the person has to fetch', async () => {
  const area = await workspace()
  try {
    const harness = createContext()
    const directory = join(area.root, 'not-there')
    apply(harness.ctx, { webBuildDir: directory })

    const res = await call(harness, 'exact', '/pdfcraft/status', '/pdfcraft/status')
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'], /^application\/json/)

    const status = JSON.parse(res.body)
    assert.equal(status.ready, false)
    assert.equal(status.file, 'pdfcraft-web-0.9.0.zip')
    assert.equal(status.directory, directory)
    assert.equal(status.reason, 'missing-build')
  } finally {
    await area.cleanup()
  }
})
