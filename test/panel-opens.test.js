import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'

const PUSHES_PATH = '/pdfcraft/pushes'
const BINDING_PATH = '/pdfcraft/binding'

const SESSION = 'session-one'
const OTHER_SESSION = 'session-two'

/**
 * A recording Host context: the Web server's route table, the effect scope,
 * the Session store the Panel reads a workspace through, the command and tool
 * registries, and the published services (bindings and the Push Channel).
 */
function createContext({ sessions = {} } = {}) {
  const routes = []
  const effects = []
  const services = new Map()
  const commands = []
  const tools = []

  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    sessions: {
      get(id) {
        return sessions[id]
      },
    },
    commands: {
      register(definition) {
        commands.push(definition)
        return () => {
          definition.removed = true
        }
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {
          definition.removed = true
        }
      },
    },
    effect(body) {
      const dispose = body()
      effects.push(dispose)
      return dispose
    },
    on() {
      return () => {}
    },
    logger: {
      warn() {},
    },
    get(name) {
      return services.get(name)
    },
    provide(name, value) {
      services.set(name, value)
      return () => services.delete(name)
    },
  }

  return {
    ctx,
    routes,
    commands,
    tools,
    services,
    route(kind, path) {
      const route = routes.find((candidate) => candidate.kind === kind && candidate.path === path)
      assert.ok(route, `expected a ${kind} route at ${path}`)
      return route
    },
    openCommand() {
      return commands.find((definition) => definition.name === 'pdfcraft')
    },
    openTool() {
      return tools.find((definition) => definition.name === 'pdfcraft_open')
    },
    opens() {
      const channel = services.get('pdfcraftOpens')
      assert.ok(channel, 'the plugin publishes the Push Channel as pdfcraftOpens')
      return channel
    },
    dispose() {
      for (const effect of effects) effect()
    },
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

/** A node:http-shaped response that records what the SSE adapter wrote. */
function response() {
  const chunks = []
  const listeners = new Map()
  return {
    statusCode: 200,
    headers: {},
    writableEnded: false,
    get body() {
      return Buffer.concat(chunks).toString('utf8')
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
      this.writableEnded = true
    },
    on(event, listener) {
      const registered = listeners.get(event) ?? []
      registered.push(listener)
      listeners.set(event, registered)
      return this
    },
  }
}

/** Drive one registered route the way the Web server would. */
async function attach(harness, session = SESSION) {
  const res = response()
  await harness.route('exact', PUSHES_PATH).handler(
    request(`${PUSHES_PATH}?${new URLSearchParams({ session }).toString()}`),
    res,
  )
  return res
}

/** Parse the SSE frames a response received into their JSON payloads. */
function events(res) {
  return res.body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => JSON.parse(frame.slice('data:'.length).trim()))
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pdfcraft-open-'))
  return {
    root,
    sessions: {
      [SESSION]: { header: { id: SESSION, cwd: root } },
      [OTHER_SESSION]: { header: { id: OTHER_SESSION, cwd: root } },
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

function mount(harness, config = {}) {
  apply(harness.ctx, {
    webBuildDir: join(tmpdir(), 'dsh-pdfcraft-no-build'),
    ...config,
  })
}

/** Run a registered command the way a human command adapter would. */
async function runCommand(harness, session = SESSION, rawInput = '') {
  const definition = harness.openCommand()
  assert.ok(definition, 'the plugin registers a /pdfcraft command')
  return definition.handler({
    commandId: 'command-one',
    agent: { id: `agent-${session}`, session: { id: session } },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  })
}

/** Run the registered open tool the way the agent loop would. */
async function runTool(harness, path, session = SESSION) {
  const definition = harness.openTool()
  assert.ok(definition, 'the plugin registers the pdfcraft_open tool')
  const args = path === undefined ? {} : { path }
  return definition.execute(
    args,
    {
      callId: 'call-one',
      name: 'pdfcraft_open',
      arguments: args,
      agent: { id: `agent-${session}`, session: { id: session } },
      signal: new AbortController().signal,
    },
  )
}

test('the command opens the Panel at the named document, exactly once', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    const result = await runCommand(harness, SESSION, '  report.pdf  ')
    assert.equal(result.kind, 'success')

    const first = await attach(harness)
    assert.equal(first.statusCode, 200)
    assert.match(first.headers['content-type'], /^text\/event-stream/)
    const [event] = events(first)
    assert.equal(event.type, 'open')
    assert.equal(typeof event.id, 'string')
    assert.notEqual(event.id, '')
    assert.equal(event.sessionId, SESSION)
    assert.deepEqual(event.document, { path: 'report.pdf', name: 'report.pdf' })
    assert.equal(events(first).length, 1)

    const binding = JSON.parse((await callRoute(harness, BINDING_PATH, `/pdfcraft/binding?session=${SESSION}`)).body)
    assert.deepEqual(binding.document, { path: 'report.pdf', name: 'report.pdf' })

    // A reconnect attaches to the same conversation but the consumed request
    // is not replayed: the Panel that was already opened stays as it is.
    const second = await attach(harness)
    assert.deepEqual(events(second), [])
  } finally {
    await area.cleanup()
  }
})

test("the agent's tool opens the Panel at the named document", async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    const value = await runTool(harness, 'chapter-3.pdf')
    assert.deepEqual(value, { path: 'chapter-3.pdf', delivered: false })

    const res = await attach(harness)
    const [event] = events(res)
    assert.equal(event.type, 'open')
    assert.equal(event.document.path, 'chapter-3.pdf')
    assert.equal(event.document.name, 'chapter-3.pdf')
  } finally {
    await area.cleanup()
  }
})

test('an open for a conversation that is not on screen waits for its own stream', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    await runCommand(harness, OTHER_SESSION, 'other.pdf')

    const wrong = await attach(harness, SESSION)
    assert.deepEqual(events(wrong), [], 'another conversation\u2019s stream receives nothing')

    const right = await attach(harness, OTHER_SESSION)
    assert.equal(events(right).length, 1)
    assert.equal(events(right)[0].document.path, 'other.pdf')
  } finally {
    await area.cleanup()
  }
})

test('one request reaches one attached stream', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    const first = await attach(harness, SESSION)
    const second = await attach(harness, SESSION)
    await runCommand(harness, SESSION, 'once.pdf')

    assert.deepEqual(events(first).map((event) => event.document.path), ['once.pdf'])
    assert.deepEqual(events(second), [], 'the second stream does not reopen the same Panel')
  } finally {
    await area.cleanup()
  }
})

test('a later open replaces the pending one, so one conversation never opens two documents', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    await runCommand(harness, SESSION, 'first.pdf')
    await runTool(harness, 'second.pdf')

    const res = await attach(harness, SESSION)
    assert.deepEqual(events(res).map((event) => event.document.path), ['second.pdf'])
  } finally {
    await area.cleanup()
  }
})

test('with the open switch off the command and tool are withdrawn and pending opens drain', async () => {
  const area = await workspace()
  try {
    const enabled = createContext({ sessions: area.sessions })
    mount(enabled)
    await runTool(enabled, 'queued.pdf')
    assert.equal(enabled.opens().pendingRequests().length, 1, 'an undelivered open waits in the queue')

    enabled.opens().setEnabled(false)
    assert.deepEqual(enabled.opens().pendingRequests(), [], 'turning the entries off drops the undelivered open')
    assert.deepEqual(events(await attach(enabled)), [], 'the dropped open is never delivered')

    const disabled = createContext({ sessions: area.sessions })
    mount(disabled, { openTool: false })
    assert.equal(disabled.openCommand(), undefined, 'the person\u2019s command is withdrawn with the switch')
    assert.equal(disabled.openTool(), undefined, 'the model-facing tool is not registered')
    assert.deepEqual(disabled.opens().pendingRequests(), [], 'nothing is left to deliver')
    assert.deepEqual(events(await attach(disabled)), [])
  } finally {
    await area.cleanup()
  }
})

test('opening with no document clears the binding and still opens Standalone Mode', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    await runCommand(harness, SESSION, 'bound.pdf')
    const bound = JSON.parse((await callRoute(harness, BINDING_PATH, `/pdfcraft/binding?session=${SESSION}`)).body)
    assert.equal(bound.document.path, 'bound.pdf')

    const result = await runCommand(harness, SESSION, '   ')
    assert.equal(result.kind, 'success')

    const standalone = JSON.parse((await callRoute(harness, BINDING_PATH, `/pdfcraft/binding?session=${SESSION}`)).body)
    assert.equal(standalone.document, null)

    const commandRes = await attach(harness, SESSION)
    const [commandEvent] = events(commandRes)
    assert.equal(commandEvent.type, 'open')
    assert.equal(commandEvent.document, null)

    // The agent's equivalent tool can also ask for Standalone Mode: no path
    // is a valid request, not an error.
    await runCommand(harness, OTHER_SESSION, 'bound-again.pdf')
    const value = await runTool(harness, undefined, OTHER_SESSION)
    assert.deepEqual(value, { path: '', delivered: false })
    const cleared = JSON.parse((await callRoute(harness, BINDING_PATH, `/pdfcraft/binding?session=${OTHER_SESSION}`)).body)
    assert.equal(cleared.document, null)
    const toolRes = await attach(harness, OTHER_SESSION)
    assert.equal(events(toolRes)[0].document, null)
  } finally {
    await area.cleanup()
  }
})

test('the delivery route needs the conversation id and refuses other methods', async () => {
  const area = await workspace()
  try {
    const harness = createContext({ sessions: area.sessions })
    mount(harness)

    const missing = response()
    await harness.route('exact', PUSHES_PATH).handler(request(PUSHES_PATH), missing)
    assert.equal(missing.statusCode, 400)

    const post = response()
    await harness.route('exact', PUSHES_PATH).handler(request(`${PUSHES_PATH}?session=${SESSION}`, 'POST'), post)
    assert.equal(post.statusCode, 405)
  } finally {
    await area.cleanup()
  }
})

/** Drive any registered exact route and return its response. */
async function callRoute(harness, path, url) {
  const res = response()
  await harness.route('exact', path).handler(request(url), res)
  return res
}
