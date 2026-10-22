import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { apply, Config } from '../src/cli/index.ts'
import { apply as applyWeb } from '../src/web/index.ts'
import type { AgentLike, HostContext } from '../src/cli/host.ts'
import type { HostContext as WebHostContext } from '../src/web/host.ts'

const CLI = '/opt/pdfcraft/pdfcraft-cli'

/** The child plugin the fake Agent scope records. */
interface MountedBridge {
  readonly name?: string
  readonly inject?: readonly string[]
}

/** The bridge configuration the engine passes to the MCP client. */
interface MountedConfig {
  readonly serverName: string
  readonly transport: string
  readonly command: string
  readonly args: string[]
  readonly cwd: string
}

/** One recorded child-plugin mount. */
interface Mount {
  readonly plugin: MountedBridge
  readonly config: MountedConfig
  readonly fiber: { disposed: boolean; dispose(): void }
}

/**
 * A recording Host context. The CLI Component uses four Host facilities: the
 * effect scope, agent lifecycle events, the live-agent registry, and the
 * logger. The Web server is absent by default, which proves the engines need
 * no Panel to run; the two-row test asks for one to compose both components in
 * a single host. The child-plugin facility lives on the agent's own scoped
 * context, so the fake agent below records mounts the way the Agent scope
 * would.
 */
function createHostContext({
  webServer = false,
  agents = [],
}: { webServer?: boolean; agents?: AgentLike[] } = {}) {
  const routes: Array<{ kind: string; path: string; handler: unknown }> = []
  const effects: Array<() => unknown> = []
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()
  const warnings: string[] = []

  const remove = (event: string, listener: (payload: unknown) => unknown): void => {
    const list = listeners.get(event) ?? []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  const context = {
    ...webServer
      ? {
          webServer: {
            register(route: { kind: string; path: string; handler: unknown }) {
              routes.push(route)
              return () => {}
            },
          },
        }
      : {},
    agents: {
      list: () => [...agents],
    },
    effect(body: () => (() => unknown) | undefined) {
      const dispose = body()
      effects.push(dispose ?? (() => {}))
      return dispose
    },
    on(event: string, listener: (payload: unknown) => unknown) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => remove(event, listener)
    },
    logger: {
      warn(...parts: unknown[]) {
        warnings.push(parts.join(' '))
      },
    },
  }

  return {
    ctx: context as unknown as HostContext,
    routes,
    warnings,
    async emit(event: string, payload: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) await listener(payload)
    },
    /** Plugin unload: withdraw effects and listeners the way the fiber would. */
    dispose() {
      for (const effect of effects) effect()
      listeners.clear()
    },
  }
}

interface FakeAgent {
  readonly agent: AgentLike
  readonly mounts: Mount[]
  /** Events that stay on the agent's own scoped context, as a subagent's do. */
  emit(event: string, payload: unknown): Promise<void>
  listenerCount(event: string): number
}

/**
 * A fake live Agent: its scoped context records the child plugin it is asked
 * to mount and exposes the returned fiber's disposal.
 */
function createAgent({
  id,
  cwd,
  status,
}: { id: string; cwd?: string; status?: string }): FakeAgent {
  const mounts: Mount[] = []
  const listeners = new Map<string, Array<(payload: unknown) => unknown>>()

  const remove = (event: string, listener: (payload: unknown) => unknown): void => {
    const list = listeners.get(event) ?? []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  const agent = {
    id,
    status,
    session: { header: cwd === undefined ? {} : { cwd } },
    ctx: {
      plugin(plugin: unknown, config?: unknown) {
        const fiber = {
          disposed: false,
          dispose() {
            this.disposed = true
          },
        }
        mounts.push({
          plugin: plugin as MountedBridge,
          config: config as MountedConfig,
          fiber,
        })
        return fiber
      },
      on(event: string, listener: (payload: unknown) => unknown) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => remove(event, listener)
      },
    },
  }

  return {
    agent: agent as unknown as AgentLike,
    mounts,
    async emit(event: string, payload: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) await listener(payload)
    },
    listenerCount(event: string) {
      return listeners.get(event)?.length ?? 0
    },
  }
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pdfcraft-agent-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/**
 * Wait for the fire-and-forget engine work the lifecycle listeners started.
 *
 * The wait is bounded by the clock, not by a turn count. A fixed number of
 * `setImmediate` turns elapses in a millisecond or two, while the work being
 * awaited — a directory `stat`, the lazy bridge import, a fiber mount — needs
 * real wall time and stretches on a loaded machine, so a turn-counted wait
 * fails intermittently instead of waiting longer.
 *
 * `timers/promises` is used rather than the global `setTimeout` because the
 * idle-grace tests here mock that global; this wait must keep working while
 * the engine's own grace timer is mocked.
 */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n
  for (;;) {
    if (predicate()) return
    if (process.hrtime.bigint() >= deadline) break
    await sleep(1)
  }
  assert.fail(`the expected engine work did not settle within ${timeoutMs}ms`)
}

/** The engine mount every live Agent must get for one root. */
function assertEngineMount(mount: Mount | undefined, root: string): void {
  assert.ok(mount)
  assert.equal(mount.config.command, CLI)
  assert.deepEqual(mount.config.args, ['mcp', '--root', root, '--compact'])
  assert.equal(mount.config.cwd, root)
}

test('the CLI row configures only the three engine fields', () => {
  const defaults = Config({})
  assert.equal(defaults.cliPath, 'pdfcraft-cli')
  assert.equal(defaults.staticRoot, '')
  assert.equal(defaults.compactSurface, true)
  assert.deepEqual(Object.keys(defaults).sort(), ['cliPath', 'compactSurface', 'staticRoot'])
  const extra = defaults as unknown as Record<string, unknown>
  assert.equal(extra.webBuildDir, undefined, 'the web build directory belongs to the Web row')
  assert.equal(extra.openTool, undefined, 'the open entries belong to the Web row')
  assert.equal(extra.maxDocumentBytes, undefined, 'the document limit belongs to the Web row')
  assert.throws(() => Config({ compactSurface: 'yes' } as never), /compactSurface/)

  // A field from the other row is not validated here and cannot change this
  // row's own values: the CLI Component reads only its three fields.
  const foreign = Config({ compactSurface: false, webBuildDir: 42, openTool: 'no' } as never)
  assert.equal(foreign.compactSurface, false)
  assert.equal(foreign.cliPath, 'pdfcraft-cli')
  assert.equal(foreign.staticRoot, '')
})

test('the CLI row mounts engines without the Panel\'s Web server', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts } = createAgent({ id: 'no-panel', cwd: area.root })
    await harness.emit('agent/created', { agent })

    assert.equal(mounts.length, 1, 'the engine mounts with no Web server in the host')
    assert.equal(harness.routes.length, 0, 'the CLI row serves no Panel route')
  } finally {
    await area.cleanup()
  }
})

test('activating the CLI row again adopts agents that were already live', async () => {
  const area = await workspace()
  try {
    const live = createAgent({ id: 'already-live', cwd: area.root })
    const harness = createHostContext({ agents: [live.agent] })

    // A row reload replaces the component fiber while the conversation stays
    // open; the new activation has to reattach its engine, not wait for a new
    // agent to be created.
    apply(harness.ctx, { cliPath: CLI })
    await until(() => live.mounts.length === 1)

    assertEngineMount(live.mounts[0], area.root)
    assert.ok(live.listenerCount('agent/disposed') > 0, 'the adopted agent is watched for disposal')
  } finally {
    await area.cleanup()
  }
})

test('an agent adopted while idle still gets the idle grace', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const area = await workspace()
  try {
    const live = createAgent({ id: 'idle-live', cwd: area.root, status: 'idle' })
    const harness = createHostContext({ agents: [live.agent] })

    apply(harness.ctx, { cliPath: CLI })
    await until(() => live.mounts.length === 1)
    const engine = live.mounts[0]?.fiber
    assert.ok(engine)
    assert.equal(engine.disposed, false)

    // Adoption happens while idle, so no `agent/status idle` arrives to start
    // the usual five-minute timer; adoption has to start it itself.
    mock.timers.tick(60 * 60 * 1_000)
    assert.equal(engine.disposed, true, 'an adopted idle agent does not hold its engine')
  } finally {
    mock.timers.reset()
    await area.cleanup()
  }
})

test('both component rows activate in one host: Panel routes and the per-agent engine coexist', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext({ webServer: true })
    applyWeb(harness.ctx as unknown as WebHostContext, { webBuildDir: join(area.root, 'not-there') })
    apply(harness.ctx, { cliPath: CLI })

    assert.equal(harness.routes.length, 5, 'the Web row serves the Panel surface')

    const { agent, mounts } = createAgent({ id: 'both-rows', cwd: area.root })
    await harness.emit('agent/created', { agent })

    assert.equal(mounts.length, 1, 'the CLI row mounts an engine beside the Panel')
    assertEngineMount(mounts[0], area.root)
  } finally {
    await area.cleanup()
  }
})

test('mounts the shipped MCP bridge on the conversation workspace with the compact surface', async () => {
  const area = await workspace()
  try {
    const harness = createHostContext()
    apply(harness.ctx, { cliPath: CLI })

    const { agent, mounts } = createAgent({ id: 'agent-1', cwd: area.root })
    await harness.emit('agent/created', { agent, source: 'startup' })

    assert.equal(mounts.length, 1, 'one engine per live conversation')
    const mount = mounts[0]
    assert.ok(mount)
    assert.equal(mount.plugin.name, 'mcp-client', 'the shipped MCP client bridge is the child plugin')
    assert.deepEqual([...mount.plugin.inject ?? []], ['tools'])
    assert.equal(mount.config.transport, 'stdio')
    assert.equal(mount.config.command, CLI)
    assert.deepEqual(mount.config.args, ['mcp', '--root', area.root, '--compact'])
    assert.equal(mount.config.cwd, area.root)
    assert.match(mount.config.serverName, /^[A-Za-z0-9_-]{1,32}$/)
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
    assert.deepEqual(compact.mounts[0]?.config.args, ['mcp', '--root', area.root, '--compact'])

    const fullAgent = createAgent({ id: 'b', cwd: area.root })
    const fullHarness = createHostContext()
    apply(fullHarness.ctx, { cliPath: CLI, compactSurface: false })
    await fullHarness.emit('agent/created', { agent: fullAgent.agent })
    assert.deepEqual(fullAgent.mounts[0]?.config.args, ['mcp', '--root', area.root])
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
      assert.equal(mounts[0]?.config.args[2], pinned.root, 'the static root is the Agent MCP Root')
      assert.equal(mounts[0]?.config.cwd, pinned.root)
    }
    assert.equal(first.mounts[0]?.config.serverName, second.mounts[0]?.config.serverName)
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

    const firstKey = first.mounts[0]?.config.serverName
    assert.notEqual(firstKey, other.mounts[0]?.config.serverName, 'different roots never share a namespace')
    assert.equal(first.mounts[0]?.fiber.disposed, false)
    assert.equal(other.mounts[0]?.fiber.disposed, false)

    await harness.emit('agent/disposed', { agent: first.agent })
    const again = createAgent({ id: 'a2', cwd: one.root })
    await harness.emit('agent/created', { agent: again.agent })

    assert.equal(again.mounts[0]?.config.serverName, firstKey, 'one root always keeps its tool names')
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
    const first = mounts[0]?.fiber
    assert.ok(first)
    assert.equal(first.disposed, false)

    await harness.emit('agent/status', { agent, status: 'idle' })
    mock.timers.tick(1_000)
    assert.equal(first.disposed, false, 'a short pause keeps the engine')

    mock.timers.tick(60 * 60 * 1_000)
    assert.equal(first.disposed, true, 'an idle workspace releases its engine')

    await harness.emit('agent/status', { agent, status: 'running' })
    await until(() => mounts.length === 2)
    assert.equal(mounts[1]?.fiber.disposed, false, 'activity starts the engine again')
    assert.equal(mounts[1]?.config.serverName, mounts[0]?.config.serverName, 'the tool names stay stable')
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
    const first = mounts[0]?.fiber
    assert.ok(first)
    assert.equal(first.disposed, false)

    // A subagent's status is dispatched in its own context tree, which the host
    // context's listeners never see; the engine has to listen where the agent does.
    await emit('agent/status', { agent, status: 'idle' })
    mock.timers.tick(60 * 60 * 1_000)
    assert.equal(first.disposed, true, 'the scoped idle status releases the engine')

    await emit('agent/status', { agent, status: 'running' })
    await until(() => mounts.length === 2)
    assert.equal(mounts[1]?.fiber.disposed, false, 'scoped activity starts the engine again')
    assert.equal(mounts[1]?.config.serverName, mounts[0]?.config.serverName, 'the tool names stay stable')
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
    assert.equal(mounts[0]?.fiber.disposed, true, 'the scoped disposal withdraws the engine')
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
    assert.equal(first.mounts[0]?.fiber.disposed, true, 'the conversation engine is withdrawn')
    assert.equal(second.mounts[0]?.fiber.disposed, false, 'another live engine is untouched')

    harness.dispose()
    assert.equal(second.mounts[0]?.fiber.disposed, true, 'unloading the plugin withdraws the rest')
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
