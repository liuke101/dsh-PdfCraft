/**
 * Per-conversation PdfCraft engines for the model.
 *
 * Each live Agent gets the upstream PdfCraft command-line tool mounted on its
 * own scoped context as the shipped MCP client bridge (`dsh-mcp-client`), so
 * the tools it registers belong to that Agent alone and disappear with it.
 * The upstream CLI runs in MCP mode with the Agent MCP Root as its `--root`
 * and working directory, which is what confines every path its tools touch.
 *
 * The namespace is derived from the root, so two live workspaces coexist and
 * the qualified tool names (`mcp__<serverName>__<tool>`) stay stable for a
 * given workspace across remounts. A configured static root replaces the
 * conversation workspace for every Agent, trading isolation for one shared
 * root.
 *
 * The engine starts when an Agent appears, is released after a fixed idle
 * grace, and starts again on the next activity. Its lifecycle listeners follow
 * both the host context and the Agent's own scoped context, because a
 * subagent's status and disposal are dispatched inside the latter.
 * Unloading the plugin or disposing the Agent withdraws every remaining engine.
 */
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** The command that starts the upstream engine when configuration names no other. */
export const DEFAULT_CLI = 'pdfcraft-cli'

/** How long a workspace may sit idle before its engine is released. */
const IDLE_RELEASE_MS = 5 * 60 * 1000

/** The module namespace of the shipped MCP client bridge, loaded once. */
let bridge

/** Load the bridge lazily so a missing copy cannot break the rest of the plugin. */
async function loadBridge() {
  bridge ??= await import('@deepseek-ai/dsh-mcp-client')
  return bridge
}

/**
 * The MCP server namespace for one root: distinct roots never share it, the
 * same root always does, and it satisfies the bridge's name pattern.
 */
function serverNameFor(root) {
  return `pdfcraft-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`
}

/** Resolve the row's configuration to the values the engines run with. */
function settingsFrom(config) {
  const cliPath = typeof config.cliPath === 'string' ? config.cliPath.trim() : ''
  const staticRoot = typeof config.staticRoot === 'string' ? config.staticRoot.trim() : ''
  return {
    cliPath: cliPath === '' ? DEFAULT_CLI : cliPath,
    staticRoot: staticRoot === '' ? '' : resolve(staticRoot),
    compactSurface: config.compactSurface !== false,
  }
}

/** The Agent MCP Root for one Agent: the static override, else its workspace. */
function rootFor(agent, settings) {
  if (settings.staticRoot !== '') return settings.staticRoot
  const cwd = agent.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return undefined
  return resolve(cwd)
}

/**
 * The bridge configuration for one root. `--root` is the upstream Agent MCP
 * Root; `--compact` asks for its small search-and-call surface and is omitted
 * when the full catalogue is configured.
 */
function bridgeConfigFor(root, settings) {
  return {
    serverName: serverNameFor(root),
    transport: 'stdio',
    command: settings.cliPath,
    args: settings.compactSurface
      ? ['mcp', '--root', root, '--compact']
      : ['mcp', '--root', root],
    cwd: root,
    // A machine without the upstream tool should keep its conversation; the
    // bridge logs the failure and offers no tools instead of failing creation.
    failOnStartupError: false,
  }
}

/**
 * Register the agent lifecycle listeners that mount and release engines.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context owning the listeners.
 * @param {{ cliPath?: string, staticRoot?: string, compactSurface?: boolean }} [config] - resolved plugin configuration.
 */
export function registerAgentTools(ctx, config = {}) {
  const settings = settingsFrom(config)
  /** One entry per live Agent, keyed by Agent id. */
  const engines = new Map()

  const warn = (message) => ctx.logger?.warn?.(message)

  const clearIdle = (entry) => {
    if (entry.timer === undefined) return
    clearTimeout(entry.timer)
    entry.timer = undefined
  }

  const release = (entry) => {
    const fiber = entry.fiber
    entry.fiber = undefined
    if (fiber === undefined) return Promise.resolve()
    const stopping = (async () => {
      try {
        await fiber.dispose()
      } catch (error) {
        warn(`dsh-pdfcraft: releasing the engine for ${entry.root} failed: ${error.message}`)
      }
    })()
    entry.releasing = stopping
    void stopping.finally(() => {
      if (entry.releasing === stopping) entry.releasing = undefined
    })
    return stopping
  }

  /** Withdraw the engine after the idle grace; activity cancels the timer. */
  const scheduleIdleRelease = (entry) => {
    if (entry.timer !== undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      if (!entry.wanted) return
      entry.wanted = false
      void release(entry)
    }, IDLE_RELEASE_MS)
    entry.timer.unref?.()
  }

  /**
   * Start the engine for one Agent if it has a usable root and none is running.
   * Mount failures are logged, never allowed to reject Agent creation.
   */
  const provision = async (agent) => {
    const entry = engines.get(agent.id)
    if (entry === undefined || !entry.wanted || entry.fiber !== undefined) return
    if (entry.mounting !== undefined) return entry.mounting

    entry.mounting = (async () => {
      // A remount after the idle release must not race the old namespace
      // reservation: wait for the previous engine to finish unloading first.
      if (entry.releasing !== undefined) await entry.releasing
      if (entry.fiber !== undefined || !entry.wanted) return

      const root = rootFor(agent, settings)
      if (root === undefined) {
        warn('dsh-pdfcraft: this conversation has no workspace, so no PdfCraft engine was started')
        return
      }

      let usable = false
      try {
        usable = (await stat(root)).isDirectory()
      } catch {
        // The configured root cannot be opened; report it below.
      }
      if (!usable) {
        warn(`dsh-pdfcraft: the Agent MCP Root ${root} is not a usable directory, so no PdfCraft engine was started; `
          + 'set staticRoot to an existing directory or leave it empty')
        return
      }

      try {
        const client = await loadBridge()
        const fiber = agent.ctx.plugin(client, bridgeConfigFor(root, settings))
        await fiber
        if (!entry.wanted || engines.get(agent.id) !== entry) {
          await fiber.dispose()
          return
        }
        entry.fiber = fiber
        entry.root = root
      } catch (error) {
        warn(`dsh-pdfcraft: the PdfCraft engine for ${root} could not start: ${error.message}`)
      }
    })()

    try {
      await entry.mounting
    } finally {
      entry.mounting = undefined
    }
  }

  /**
   * Subscribe to the Agent's own scoped context as well as the host.
   *
   * A subagent's lifecycle events stay inside its own context tree, so a host
   * listener never sees them and a subagent's engine would outlive its Agent.
   * The scoped listener also catches agent-scoped descendants, which are
   * filtered out below because each of them has an entry of its own.
   */
  const subscribe = (entry, agent) => {
    const on = agent.ctx?.on
    if (typeof on !== 'function') return
    const add = (event, listener) => {
      const off = on.call(agent.ctx, event, listener)
      if (typeof off === 'function') entry.subscriptions.push(off)
    }
    add('agent/status', (payload = {}) => {
      if (payload.agent !== undefined && payload.agent.id !== agent.id) return
      applyStatus(agent, payload.status)
    })
    add('agent/disposed', () => {
      void retire(agent.id)
    })
  }

  /** Handle an Agent's status where it is observed: host or scoped context. */
  const applyStatus = (agent, status) => {
    const entry = engines.get(agent.id)
    if (entry === undefined) return
    if (status === 'idle') {
      scheduleIdleRelease(entry)
      return
    }
    if (status !== 'running') return
    entry.wanted = true
    clearIdle(entry)
    void provision(agent).catch((error) => warn(`dsh-pdfcraft: starting the PdfCraft engine failed: ${error.message}`))
  }

  /** Forget one Agent and withdraw its engine and subscriptions. */
  const retire = async (agentId) => {
    const entry = engines.get(agentId)
    if (entry === undefined) return
    engines.delete(agentId)
    entry.wanted = false
    clearIdle(entry)
    for (const off of entry.subscriptions.splice(0)) {
      try {
        off()
      } catch {
        // The scoped context may already be disposed; its listeners are gone.
      }
    }
    await release(entry)
  }

  ctx.on('agent/created', async ({ agent }) => {
    const entry = {
      wanted: true,
      timer: undefined,
      mounting: undefined,
      releasing: undefined,
      fiber: undefined,
      root: undefined,
      subscriptions: [],
    }
    engines.set(agent.id, entry)
    subscribe(entry, agent)
    await provision(agent)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    applyStatus(agent, status)
  })

  ctx.on('agent/disposed', async ({ agent }) => {
    await retire(agent.id)
  })

  // Unloading the plugin releases every engine it still owns.
  ctx.effect(() => () => {
    const entries = [...engines.values()]
    engines.clear()
    for (const entry of entries) {
      entry.wanted = false
      clearIdle(entry)
      for (const off of entry.subscriptions.splice(0)) {
        try {
          off()
        } catch {
          // The scoped context may already be disposed.
        }
      }
    }
    return Promise.all(entries.map((entry) => release(entry)))
  }, 'dsh-pdfcraft: per-workspace engines')
}
