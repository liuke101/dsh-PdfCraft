import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/web/index.ts'
import type { HostContext, SessionStore, WebServerRoute } from '../src/web/host.ts'
import type { RouteRequest, RouteResponse } from '../src/web/http.ts'
import type { BindingRegistry } from '../src/web/workspace-document.ts'

/** Public addresses of the Workspace Document surface. */
const BINDING_PATH = '/pdfcraft/binding'
const DOCUMENT_PATH = '/pdfcraft/document'

const SESSION = 'session-one'
const COLD_SESSION = 'session-without-cwd'
const UNKNOWN_SESSION = 'session-unknown'

/** Known-good SHA-256 digests, computed independently with `sha256sum`. */
const ORIGINAL = Buffer.from('%PDF-1.4\nhello\n', 'utf8')
const ORIGINAL_HASH = '76b4a08e9ce95dc471e5c8eff23d8b6a5a29c6cb2d9e6f471dbf9354740fbe31'
const EDITED = Buffer.from('%PDF-1.4\nedited\n', 'utf8')
const EDITED_HASH = '94122841e56684aa5f268fb1850109a49bdb3dad329695865c906bab12facc53'
const TAMPERED = Buffer.from('%PDF-1.4\ntampered\n', 'utf8')
const TAMPERED_HASH = '72f1682477c37e757eb975fa25561a652a313eaddd484a643e6ddda8ff28f525'

/**
 * A recording Host context: the Web server's route table, the effect scope
 * that owns the registrations, the Session store the routes resolve a
 * workspace through, and the service registry that carries the document
 * bindings the Push Channel will drive.
 */
function createContext({ sessions }: { sessions: SessionStore }) {
  const routes: WebServerRoute[] = []
  const effects: Array<() => unknown> = []
  const removals: string[] = []
  const services = new Map<string, unknown>()

  const context = {
    webServer: {
      register(route: WebServerRoute) {
        routes.push(route)
        return () => removals.push(route.path)
      },
    },
    sessions,
    effect(body: () => (() => unknown) | undefined) {
      const dispose = body()
      effects.push(dispose ?? (() => {}))
      return dispose
    },
    // The agent engines listen on the Agent lifecycle; these routes do not
    // drive them, so the stub only has to accept the subscriptions.
    on() {
      return () => {}
    },
    logger: {
      warn() {},
    },
    get(name: string) {
      return services.get(name)
    },
    provide(name: string, value: unknown) {
      services.set(name, value)
      return () => services.delete(name)
    },
  }

  return {
    ctx: context as unknown as HostContext,
    routes,
    services,
    route(kind: 'exact' | 'prefix', path: string): WebServerRoute {
      const route = routes.find((candidate) => candidate.kind === kind && candidate.path === path)
      assert.ok(route, `expected a ${kind} route at ${path}`)
      return route
    },
    bindings(): BindingRegistry {
      const bindings = services.get('pdfcraftBindings') as BindingRegistry | undefined
      assert.ok(bindings, 'the plugin exposes the per-conversation binding registry to the Push Channel')
      return bindings
    },
    dispose() {
      for (const effect of effects) effect()
    },
    removals,
  }
}

/** A node:http-shaped request the registered Web route handler receives. */
function request(
  url: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
): RouteRequest {
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
}

/** A node:http-shaped response that records what the adapter wrote. */
interface RecordedResponse extends RouteResponse {
  statusCode: number
  headers: Record<string, string>
  readonly body: string
  readonly bytes: Buffer
}

function response(): RecordedResponse {
  const chunks: Buffer[] = []
  const recorded: RecordedResponse = {
    statusCode: 200,
    headers: {},
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
    get bytes() {
      return Buffer.concat(chunks)
    },
    writeHead(status: number, headers: Record<string, string> = {}) {
      recorded.statusCode = status
      Object.assign(recorded.headers, headers)
    },
    write(chunk: string | Uint8Array) {
      chunks.push(Buffer.from(chunk))
      return true
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
    },
  }
  return recorded
}

/** Drive one registered route the way the Web server would. */
async function call(
  harness: ReturnType<typeof createContext>,
  path: string,
  options: { url?: string; method?: string; headers?: Record<string, string>; body?: Buffer } = {},
): Promise<RecordedResponse> {
  const res = response()
  await harness.route('exact', path).handler(request(options.url ?? path, options), res)
  return res
}

/** The JSON body of a response, for the cases that answer JSON. */
function json(res: RecordedResponse): any {
  return JSON.parse(res.body)
}

function documentUrl(
  { session = SESSION, path, revision, force }: {
    session?: string
    path?: string
    revision?: string
    force?: boolean
  } = {},
): string {
  const params = new URLSearchParams()
  if (session !== undefined) params.set('session', session)
  if (path !== undefined) params.set('path', path)
  if (revision !== undefined) params.set('revision', revision)
  if (force === true) params.set('force', '1')
  return `${DOCUMENT_PATH}?${params.toString()}`
}

function bindingUrl(session = SESSION): string {
  return `${BINDING_PATH}?${new URLSearchParams({ session }).toString()}`
}

async function workspace() {
  const area = await mkdtemp(join(tmpdir(), 'dsh-pdfcraft-doc-'))
  const root = join(area, 'workspace')
  const outside = join(area, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  return { area, root, outside, cleanup: () => rm(area, { recursive: true, force: true }) }
}

function sessionStore(root: string): SessionStore {
  return {
    get(id: string) {
      if (id === SESSION) return { header: { id, cwd: root } }
      if (id === COLD_SESSION) return { header: { id } }
      return undefined
    },
  }
}

/** Apply the plugin with the document routes and their size limit. */
function mount(
  harness: ReturnType<typeof createContext>,
  { maxDocumentBytes }: { maxDocumentBytes?: number } = {},
): void {
  apply(harness.ctx, {
    webBuildDir: join(tmpdir(), 'dsh-pdfcraft-no-build'),
    ...(maxDocumentBytes === undefined ? {} : { maxDocumentBytes }),
  })
}

async function readDocument(
  harness: ReturnType<typeof createContext>,
  options: Parameters<typeof documentUrl>[0],
): Promise<RecordedResponse> {
  return call(harness, DOCUMENT_PATH, { url: documentUrl(options) })
}

async function writeDocument(
  harness: ReturnType<typeof createContext>,
  options: Parameters<typeof documentUrl>[0],
  body: Buffer,
): Promise<RecordedResponse> {
  return call(harness, DOCUMENT_PATH, {
    url: documentUrl(options),
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body,
  })
}

test('a bound document loads through the read route and its revision is recorded', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')

    const binding = await call(harness, BINDING_PATH, { url: bindingUrl() })
    assert.equal(binding.statusCode, 200)
    assert.deepEqual(json(binding), {
      sessionId: SESSION,
      document: { path: 'report.pdf', name: 'report.pdf' },
    })

    const loaded = await readDocument(harness, { path: 'report.pdf' })
    assert.equal(loaded.statusCode, 200)
    assert.equal(loaded.headers['content-type'], 'application/pdf')
    assert.equal(loaded.headers['cache-control'], 'no-store')
    assert.equal(loaded.headers['x-pdfcraft-revision'], ORIGINAL_HASH)
    assert.deepEqual([...loaded.bytes], [...ORIGINAL])

    const throughBinding = await readDocument(harness, {})
    assert.equal(throughBinding.statusCode, 200)
    assert.deepEqual([...throughBinding.bytes], [...ORIGINAL])

    const absolute = await readDocument(harness, { path: file })
    assert.equal(absolute.statusCode, 200)
  } finally {
    await area.cleanup()
  }
})

test('a save lands in the bound file and the result reads back with a new revision', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')

    const loaded = await readDocument(harness, { path: 'report.pdf' })
    assert.equal(loaded.headers['x-pdfcraft-revision'], ORIGINAL_HASH)

    const saved = await writeDocument(harness, {
      path: 'report.pdf',
      revision: ORIGINAL_HASH,
    }, EDITED)
    assert.equal(saved.statusCode, 200)
    assert.deepEqual(json(saved), {
      ok: true,
      path: 'report.pdf',
      name: 'report.pdf',
      revision: EDITED_HASH,
      bytes: EDITED.byteLength,
    })
    assert.deepEqual([...await readFile(file)], [...EDITED])

    const reread = await readDocument(harness, { path: 'report.pdf' })
    assert.equal(reread.statusCode, 200)
    assert.equal(reread.headers['content-type'], 'application/pdf')
    assert.equal(reread.headers['x-pdfcraft-revision'], EDITED_HASH)
    assert.deepEqual([...reread.bytes], [...EDITED])
  } finally {
    await area.cleanup()
  }
})

test('a save after the file changed underneath is refused and no bytes are written', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')
    await readDocument(harness, { path: 'report.pdf' })

    // The agent (or another tool) edits the file after the Panel loaded it.
    await writeFile(file, TAMPERED)

    const refused = await writeDocument(harness, {
      path: 'report.pdf',
      revision: ORIGINAL_HASH,
    }, EDITED)

    assert.equal(refused.statusCode, 409)
    const body = json(refused)
    assert.equal(body.code, 'workspace-document/revision-conflict')
    assert.equal(body.details.currentRevision, TAMPERED_HASH)
    assert.deepEqual(body.choices, ['reload', 'overwrite'])
    assert.deepEqual([...await readFile(file)], [...TAMPERED], 'the refused write changed nothing')
  } finally {
    await area.cleanup()
  }
})

test('the refusal offers reload and overwrite, and both outcomes do what they say', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')
    await readDocument(harness, { path: 'report.pdf' })
    await writeFile(file, TAMPERED)
    await writeDocument(harness, { path: 'report.pdf', revision: ORIGINAL_HASH }, EDITED)

    // Reload: reading again shows what is on disk now, with its revision.
    const reloaded = await readDocument(harness, { path: 'report.pdf' })
    assert.equal(reloaded.statusCode, 200)
    assert.equal(reloaded.headers['x-pdfcraft-revision'], TAMPERED_HASH)
    assert.deepEqual([...reloaded.bytes], [...TAMPERED])

    // Overwrite: an explicit choice replaces the file with the Panel's bytes.
    const overwritten = await writeDocument(harness, {
      path: 'report.pdf',
      revision: ORIGINAL_HASH,
      force: true,
    }, EDITED)
    assert.equal(overwritten.statusCode, 200)
    assert.equal(json(overwritten).revision, EDITED_HASH)
    assert.deepEqual([...await readFile(file)], [...EDITED])
  } finally {
    await area.cleanup()
  }
})

test('a document over the configured size limit is refused with a message naming the limit', async () => {
  const area = await workspace()
  try {
    const limit = 64
    const small = Buffer.from('%PDF-1.4\nok\n', 'utf8')
    const large = Buffer.alloc(limit + 1, 0x61)
    await writeFile(join(area.root, 'small.pdf'), small)
    await writeFile(join(area.root, 'large.pdf'), large)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness, { maxDocumentBytes: limit })
    harness.bindings().bind(SESSION, 'small.pdf')

    const loaded = await readDocument(harness, { path: 'small.pdf' })
    assert.equal(loaded.statusCode, 200)

    const refusedRead = await readDocument(harness, { path: 'large.pdf' })
    assert.equal(refusedRead.statusCode, 413)
    const readBody = json(refusedRead)
    assert.equal(readBody.code, 'workspace-document/too-large')
    assert.equal(readBody.details.limit, limit)
    assert.match(readBody.message, new RegExp(String(limit)))
    assert.match(readBody.message, /maxDocumentBytes/)

    const refusedWrite = await writeDocument(harness, {
      path: 'small.pdf',
      revision: loaded.headers['x-pdfcraft-revision'] ?? '',
    }, large)
    assert.equal(refusedWrite.statusCode, 413)
    const writeBody = json(refusedWrite)
    assert.equal(writeBody.code, 'workspace-document/too-large')
    assert.equal(writeBody.details.limit, limit)
    assert.match(writeBody.message, new RegExp(String(limit)))
    assert.match(writeBody.message, /maxDocumentBytes/)
    assert.deepEqual([...await readFile(join(area.root, 'small.pdf'))], [...small])
  } finally {
    await area.cleanup()
  }
})

test('a path outside the workspace is refused for reads and writes, including symlink escapes', async () => {
  const area = await workspace()
  try {
    await writeFile(join(area.root, 'report.pdf'), ORIGINAL)
    const secret = join(area.outside, 'secret.pdf')
    await writeFile(secret, TAMPERED)
    await symlink(secret, join(area.root, 'escape.pdf'))

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')
    await readDocument(harness, { path: 'report.pdf' })

    for (const path of ['../outside/secret.pdf', secret, 'escape.pdf']) {
      const read = await readDocument(harness, { path })
      assert.equal(read.statusCode, 403, path)
      assert.equal(json(read).code, 'workspace-document/outside-workspace', path)
      assert.doesNotMatch(read.body, /SECRET-CONTENT/, path)
    }

    for (const path of ['../outside/secret.pdf', secret, 'escape.pdf']) {
      const write = await writeDocument(harness, {
        path,
        revision: ORIGINAL_HASH,
      }, EDITED)
      assert.equal(write.statusCode, 403, path)
      assert.equal(json(write).code, 'workspace-document/outside-workspace', path)
    }
    assert.deepEqual([...await readFile(secret)], [...TAMPERED], 'nothing outside the workspace changed')

    // The same boundary the agent has: an absolute path inside it is served.
    const inside = await readDocument(harness, { path: join(area.root, 'report.pdf') })
    assert.equal(inside.statusCode, 200)
  } finally {
    await area.cleanup()
  }
})

test('a save needs a document the read route served first, and a bad request says so', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')

    const unsaved = await writeDocument(harness, {
      path: 'report.pdf',
      revision: ORIGINAL_HASH,
    }, EDITED)
    assert.equal(unsaved.statusCode, 409)
    assert.equal(json(unsaved).code, 'workspace-document/not-loaded')
    assert.deepEqual([...await readFile(file)], [...ORIGINAL])

    const malformed = await writeDocument(harness, { path: 'report.pdf' }, EDITED)
    assert.equal(malformed.statusCode, 400)
    assert.equal(json(malformed).code, 'workspace-document/bad-request')

    const wrongMethod = await call(harness, BINDING_PATH, {
      url: bindingUrl(),
      method: 'POST',
      body: Buffer.from('{}'),
    })
    assert.equal(wrongMethod.statusCode, 405)
    assert.equal(wrongMethod.headers.allow, 'GET, HEAD')
  } finally {
    await area.cleanup()
  }
})

test('an unknown session, or one with no workspace root, is refused', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(UNKNOWN_SESSION, 'report.pdf')

    const unknown = await readDocument(harness, { session: UNKNOWN_SESSION, path: 'report.pdf' })
    assert.equal(unknown.statusCode, 404)
    assert.equal(json(unknown).code, 'workspace-document/unknown-session')

    const cold = await readDocument(harness, { session: COLD_SESSION, path: 'report.pdf' })
    assert.equal(cold.statusCode, 409)
    assert.equal(json(cold).code, 'workspace-document/no-workspace')
  } finally {
    await area.cleanup()
  }
})

test('the binding route reports Standalone Mode when no document is bound', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)

    const binding = await call(harness, BINDING_PATH, { url: bindingUrl() })
    assert.equal(binding.statusCode, 200)
    assert.deepEqual(json(binding), { sessionId: SESSION, document: null })

    const none = await readDocument(harness, {})
    assert.equal(none.statusCode, 409)
    assert.equal(json(none).code, 'workspace-document/not-bound')
  } finally {
    await area.cleanup()
  }
})

test('the binding drives the production path: a save with no explicit path writes the bound file', async () => {
  const area = await workspace()
  try {
    const file = join(area.root, 'report.pdf')
    await writeFile(file, ORIGINAL)

    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')

    const loaded = await readDocument(harness, {})
    const saved = await writeDocument(harness, {
      revision: loaded.headers['x-pdfcraft-revision'],
    }, EDITED)

    assert.equal(saved.statusCode, 200)
    assert.deepEqual([...await readFile(file)], [...EDITED])
  } finally {
    await area.cleanup()
  }
})

test('a conversation holds exactly one bound document, replaced in place by a later bind', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    const bindings = harness.bindings()

    const first = bindings.bind(SESSION, 'first.pdf')
    assert.deepEqual(first, { path: 'first.pdf', name: 'first.pdf' })

    bindings.bind(SESSION, 'docs/second.pdf')
    assert.equal(bindings.get(SESSION)?.path, 'docs/second.pdf')
    assert.equal(bindings.entries().length, 1)

    bindings.clear(SESSION)
    assert.equal(bindings.get(SESSION), undefined)
  } finally {
    await area.cleanup()
  }
})

test('withdrawing the plugin removes every route it added', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)

    harness.route('exact', BINDING_PATH)
    harness.route('exact', DOCUMENT_PATH)

    harness.dispose()
    assert.ok(harness.removals.includes(BINDING_PATH))
    assert.ok(harness.removals.includes(DOCUMENT_PATH))
  } finally {
    await area.cleanup()
  }
})

test('the read route answers HEAD without a body and GET only', async () => {
  const area = await workspace()
  try {
    await writeFile(join(area.root, 'report.pdf'), ORIGINAL)
    const harness = createContext({ sessions: sessionStore(area.root) })
    mount(harness)
    harness.bindings().bind(SESSION, 'report.pdf')

    const head = await call(harness, DOCUMENT_PATH, {
      url: documentUrl({ path: 'report.pdf' }),
      method: 'HEAD',
    })
    assert.equal(head.statusCode, 200)
    assert.equal(head.headers['x-pdfcraft-revision'], ORIGINAL_HASH)
    assert.equal(head.bytes.byteLength, 0)
  } finally {
    await area.cleanup()
  }
})
