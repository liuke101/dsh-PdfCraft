import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'

const CLI = '/opt/pdfcraft/pdfcraft-cli'

/**
 * A recording Host context. Besides the Web server, this plugin uses three
 * Host facilities: the effect scope, agent lifecycle events, and the logger.
 * The child-plugin facility lives on the agent's own scoped context, so the
 * fake agent below records mounts the way the Agent scope would.
 */
function createHostContext() {
  const routes = []
  const effects = []
  const listeners = new Map()
  const warnings = []

  const remove = (event, listener) => {
    const list = listeners.get(event) ?? []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(body) {
      const dispose = body()
      effects.push(dispose)
      return dispose
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => remove(event, listener)
    },
    logger: {
      warn(...parts) {
        warnings.push(parts.join(' '))
      },
    },
  }

  return {
    ctx,
    routes,
    warnings,
    async emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) await listener(payload)
    },
    /** Plugin unload: withdraw effects and listeners the way the fiber would. */
    dispose() {
      for (const effect of effects) effect()
      listeners.clear()
    },
  }
}

/**
 * A fake live Agent: its scoped context records the child plugin it is asked
 * to mount and exposes the returned fiber's disposal.
 */
function createAgent({ id, cwd }) {
  const mounts = []
  const listeners = new Map()

  const remove = (event, listener) => {
    const list = listeners.get(event) ?? []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  const agent = {
    id,
    session: { header: cwd === undefined ? {} : { cwd } },
    ctx: {
      plugin(plugin, config) {
        const fiber = {
          disposed: false,
          dispose() {
            this.disposed = true
          },
        }
        mounts.push({ plugin, config, fiber })
        return fiber
      },
      on(event, listener) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => remove(event, listener)
      },
    },
  }

  return {
    agent,
    mounts,
    /** Events that stay on the agent's own scoped context, as a subagent's do. */
    async emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) await listener(payload)
    },
    listenerCount(event) {
      return listeners.get(event)?.length ?? 0
    },
  }
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pdfcraft-agent-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/** Wait for fire-and-forget engine work the lifecycle listeners started. */
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('the expected engine work did not settle')
}

test('mounts the shipped MCP bridge on the conversation workspace with the compact surface', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts } = createAgent({ id: 'agent-1', cwd: area.root })
    await harness.emit('agent/created', { agent, source: 'startup' })

    assert.equal(mounts.length, 1, 'one engine per live conversation')
    const [{ plugin, config }] = mounts
    assert.equal(plugin.name, 'mcp-client', 'the shipped MCP client bridge is the child plugin')
    assert.deepEqual([...plugin.inject], ['tools'])
    assert.equal(config.transport, 'stdio')
    assert.equal(config.command, CLI)
    assert.deepEqual(config.args, ['mcp', '--root', area.root, '--compact'])
    assert.equal(config.cwd, area.root)
    assert.match(config.serverName, /^[A-Za-z0-9_-]{1,32}$/)
  } finally {
    await area.cleanup()
  }
})

test('the compact surface is the default and the switch exposes the full catalogue', async () => {
  const area = await workspace()
  try {
    const compact = createAgent({ id: 'a', cwd: area.root })
    const defaultHarness = createHostContext()
    apply(defaultHarness.ctx, { cliPath: CLI })
    await defaultHarness.emit('agent/created', { agent: compact.agent })
    assert.deepEqual(compact.mounts[0].config.args, ['mcp', '--root', area.root, '--compact'])

    const fullAgent = createAgent({ id: 'b', cwd: area.root })
    const fullHarness = createHostContext()
    apply(fullHarness.ctx, { cliPath: CLI, compactSurface: false })
    await fullHarness.emit('agent/created', { agent: fullAgent.agent })
    assert.deepEqual(fullAgent.mounts[0].config.args, ['mcp', '--root', area.root])
  } finally {
    await area.cleanup()
  }
})

test('a configured static root pins every conversation to that root instead', async () => {
  const pinned = await workspace()
  const elsewhere = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI, staticRoot: pinned.root })

    const first = createAgent({ id: 'a', cwd: elsewhere.root })
    const second = createAgent({ id: 'b' })
    await harness.emit('agent/created', { agent: first.agent })
    await harness.emit('agent/created', { agent: second.agent })

    for (const { mounts } of [first, second]) {
      assert.equal(mounts[0].config.args[2], pinned.root, 'the static root is the Agent MCP Root')
      assert.equal(mounts[0].config.cwd, pinned.root)
    }
    assert.equal(first.mounts[0].config.serverName, second.mounts[0].config.serverName)
  } finally {
    await Promise.all([pinned.cleanup(), elsewhere.cleanup()])
  }
})

test('several live workspaces get distinct, stable namespaces and engines', async () => {
  const one = await workspace()
  const two = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const first = createAgent({ id: 'a1', cwd: one.root })
    const other = createAgent({ id: 'b', cwd: two.root })
    await harness.emit('agent/created', { agent: first.agent })
    await harness.emit('agent/created', { agent: other.agent })

    const firstKey = first.mounts[0].config.serverName
    assert.notEqual(firstKey, other.mounts[0].config.serverName, 'different roots never share a namespace')
    assert.equal(first.mounts[0].fiber.disposed, false)
    assert.equal(other.mounts[0].fiber.disposed, false)

    await harness.emit('agent/disposed', { agent: first.agent })
    const again = createAgent({ id: 'a2', cwd: one.root })
    await harness.emit('agent/created', { agent: again.agent })

    assert.equal(again.mounts[0].config.serverName, firstKey, 'one root always keeps its tool names')
  } finally {
    await Promise.all([one.cleanup(), two.cleanup()])
  }
})

test('an idle workspace releases its engine and a later turn starts it again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts } = createAgent({ id: 'a', cwd: area.root })
    await harness.emit('agent/created', { agent })
    const first = mounts[0].fiber
    assert.equal(first.disposed, false)

    await harness.emit('agent/status', { agent, status: 'idle' })
    mock.timers.tick(1_000)
    assert.equal(first.disposed, false, 'a short pause keeps the engine')

    mock.timers.tick(60 * 60 * 1_000)
    assert.equal(first.disposed, true, 'an idle workspace releases its engine')

    await harness.emit('agent/status', { agent, status: 'running' })
    await until(() => mounts.length === 2)
    assert.equal(mounts[1].fiber.disposed, false, 'activity starts the engine again')
    assert.equal(mounts[1].config.serverName, mounts[0].config.serverName, 'the tool names stay stable')
  } finally {
    mock.timers.reset()
    await area.cleanup()
  }
})

test('an agent whose lifecycle events stay on its own context still releases its engine', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts, emit } = createAgent({ id: 'child', cwd: area.root })
    await harness.emit('agent/created', { agent })
    const first = mounts[0].fiber
    assert.equal(first.disposed, false)

    // A subagent's status is dispatched in its own context tree, which the host
    // context's listeners never see; the engine has to listen where the agent does.
    await emit('agent/status', { agent, status: 'idle' })
    mock.timers.tick(60 * 60 * 1_000)
    assert.equal(first.disposed, true, 'the scoped idle status releases the engine')

    await emit('agent/status', { agent, status: 'running' })
    await until(() => mounts.length === 2)
    assert.equal(mounts[1].fiber.disposed, false, 'scoped activity starts the engine again')
    assert.equal(mounts[1].config.serverName, mounts[0].config.serverName, 'the tool names stay stable')
  } finally {
    mock.timers.reset()
    await area.cleanup()
  }
})

test('a conversation disposed on its own context withdraws its engine and subscriptions', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts, emit, listenerCount } = createAgent({ id: 'child', cwd: area.root })
    await harness.emit('agent/created', { agent })
    assert.ok(listenerCount('agent/status') > 0, 'the engine listens on the agent context')
    assert.ok(listenerCount('agent/disposed') > 0, 'the engine listens for the agent leaving')

    await emit('agent/disposed', { agent })
    assert.equal(mounts[0].fiber.disposed, true, 'the scoped disposal withdraws the engine')
    assert.equal(listenerCount('agent/status'), 0, 'status subscriptions are released with the conversation')
    assert.equal(listenerCount('agent/disposed'), 0, 'disposal subscriptions are released too')
  } finally {
    await area.cleanup()
  }
})

test('disposing the conversation or the plugin withdraws every engine', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const first = createAgent({ id: 'a', cwd: area.root })
    const second = createAgent({ id: 'b', cwd: area.root })
    await harness.emit('agent/created', { agent: first.agent })
    await harness.emit('agent/created', { agent: second.agent })

    await harness.emit('agent/disposed', { agent: first.agent })
    assert.equal(first.mounts[0].fiber.disposed, true, 'the conversation engine is withdrawn')
    assert.equal(second.mounts[0].fiber.disposed, false, 'another live engine is untouched')

    harness.dispose()
    assert.equal(second.mounts[0].fiber.disposed, true, 'unloading the plugin withdraws the rest')
  } finally {
    await area.cleanup()
  }
})

test('a conversation without a usable Agent MCP Root starts no engine and says why', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const noWorkspace = createAgent({ id: 'a' })
    await harness.emit('agent/created', { agent: noWorkspace.agent })
    assert.equal(noWorkspace.mounts.length, 0)
    assert.match(harness.warnings.join('\n'), /no workspace/i)

    const missing = createAgent({ id: 'b', cwd: join(area.root, 'not-there') })
    await harness.emit('agent/created', { agent: missing.agent })
    assert.equal(missing.mounts.length, 0)
    assert.match(harness.warnings.join('\n'), /not a usable directory/i)
  } finally {
    await area.cleanup()
  }
})
