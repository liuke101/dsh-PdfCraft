/**
 * The Push Channel: per-conversation open requests and the two entries that
 * create them.
 *
 * A request names one conversation and, optionally, one Workspace Document.
 * The person creates one with `/pdfcraft <path>`; the agent creates one with
 * the model-facing `pdfcraft_open` tool. Both behave the same way:
 *
 * - Binding happens before delivery, so a Panel that mounts because of this
 *   request already sees the new Workspace Document (or Standalone Mode).
 * - A later request for the same conversation replaces an undelivered one.
 *   One conversation has one Panel and one bound document, so there is
 *   nothing to queue twice.
 * - Delivery is consume-on-send. A request that reaches an attached stream is
 *   removed, so a reconnect never replays it and a Panel that was already
 *   opened is not opened again. A request for a conversation with no attached
 *   stream waits until that conversation's stream attaches.
 * - `setEnabled(false)` drops everything still waiting; disposing the plugin
 *   closes the queues and detaches every stream.
 *
 * The stream is the browser half's `/pdfcraft/pushes` connection; this module keeps
 * only the decisions, and `open-routes.js` owns the HTTP adapter.
 */
import { randomUUID } from 'node:crypto'

import { defineTool } from '@deepseek-ai/dsh-tools'

/** The human entry point; the command name without its leading slash. */
export const OPEN_COMMAND_NAME = 'pdfcraft'

/** The model-facing entry point. */
export const OPEN_TOOL_NAME = 'pdfcraft_open'

/**
 * One open request's canonical shape on the push stream.
 * @typedef {object} OpenRequest
 * @property {string} id - opaque id for logs and tests.
 * @property {string} sessionId - the conversation whose Panel should open.
 * @property {{path: string, name: string} | null} document - the bound document, or null for Standalone Mode.
 */

/**
 * Create the Push Channel over one conversation binding registry.
 *
 * @param {object} options
 * @param {object} options.bindings - the per-conversation binding registry.
 * @param {boolean} [options.enabled] - whether the two entries may create requests.
 * @param {(message: string) => void} [options.warn] - receives non-fatal failures.
 */
export function createPanelOpens({ bindings, enabled = true, warn = () => {} }) {
  /** Undelivered request per conversation; a later request replaces it. */
  const pending = new Map()
  /** Attached Push Channel streams per conversation, each a sender of one request. */
  const streams = new Map()
  let openEnabled = enabled !== false

  const documentOf = (sessionId) => {
    const document = bindings.get(sessionId)
    return document === undefined ? null : { path: document.path, name: document.name }
  }

  /**
   * Bind a conversation and queue (or deliver) its open request.
   * @param {string} sessionId - the conversation whose Panel should open.
   * @param {string | null | undefined} documentPath - the Workspace Document, or nothing for Standalone Mode.
   * @returns {{id: string, delivered: boolean, document: {path: string, name: string} | null}}
   */
  function open(sessionId, documentPath) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new TypeError('an open request needs a conversation id')
    }
    if (!openEnabled) throw new Error('the PdfCraft open entries are disabled')

    if (documentPath === null || documentPath === undefined || documentPath === '') {
      bindings.clear(sessionId)
    } else {
      bindings.bind(sessionId, documentPath)
    }

    const request = Object.freeze({
      id: randomUUID(),
      sessionId,
      document: documentOf(sessionId),
    })

    pending.delete(sessionId)
    const attached = streams.get(sessionId)
    if (attached !== undefined && attached.size > 0) {
      // One request goes to one stream: a second browser window attached to
      // the same conversation is not a second delivery of the same open.
      for (const send of [...attached]) {
        try {
          send(request)
          return { id: request.id, delivered: true, document: request.document }
        } catch (error) {
          warn(`dsh-pdfcraft: could not deliver an open for ${sessionId}: ${error.message}`)
        }
      }
    }

    pending.set(sessionId, request)
    return { id: request.id, delivered: false, document: request.document }
  }

  /**
   * Attach one browser stream for a conversation and flush what was waiting.
   * A sender that throws is detached by its owner; the request it was handed
   * is not replayed, which keeps delivery exactly once.
   *
   * @param {string} sessionId - the conversation the stream shows.
   * @param {(request: OpenRequest) => void} send - writes one request to the stream.
   * @returns {() => void} detaches the stream.
   */
  function attach(sessionId, send) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new TypeError('a Push Channel stream needs a conversation id')
    }
    let attached = streams.get(sessionId)
    if (attached === undefined) {
      attached = new Set()
      streams.set(sessionId, attached)
    }
    attached.add(send)

    const waiting = pending.get(sessionId)
    if (waiting !== undefined) {
      pending.delete(sessionId)
      try {
        send(waiting)
      } catch (error) {
        warn(`dsh-pdfcraft: could not replay an open for ${sessionId}: ${error.message}`)
      }
    }

    return () => {
      const current = streams.get(sessionId)
      if (current === undefined) return
      current.delete(send)
      if (current.size === 0) streams.delete(sessionId)
    }
  }

  /**
   * Turn the entries on or off. Turning them off drops every request that has
   * not reached a stream yet; an already-opened Panel is untouched.
   */
  function setEnabled(next) {
    openEnabled = next !== false
    if (!openEnabled) pending.clear()
  }

  /** Drop the queues and every attached stream; the plugin is going away. */
  function dispose() {
    pending.clear()
    streams.clear()
  }

  /** Pending requests in bind order, for diagnostics and tests. */
  function pendingRequests() {
    return [...pending.values()]
  }

  return { open, attach, setEnabled, dispose, pendingRequests }
}

/** The success text shared by the command and the tool's renderer. */
function deliveryText(document, delivered) {
  const name = document === null ? 'PdfCraft' : document.name
  return delivered
    ? `Opened ${name} in the PdfCraft Panel.`
    : `Queued ${name} for the PdfCraft Panel; it opens when this conversation is next on screen.`
}

/** A registry service, probed without assuming it was injected. */
function registryOf(ctx, name) {
  try {
    return ctx.get?.(name) ?? ctx[name]
  } catch {
    return undefined
  }
}

/**
 * Register the person's `/pdfcraft` command.
 *
 * With a path the command binds that Workspace Document and asks the browser
 * to open the Panel at it. With no path it clears the binding, so the Panel
 * opens in Standalone Mode instead of failing. The handler never submits a
 * model message; this is the whole point of the command.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying the command registry.
 * @param {ReturnType<typeof createPanelOpens>} opens - the Push Channel.
 * @returns {(() => void) | undefined} unregisters the command, or undefined without a registry.
 */
export function registerOpenCommand(ctx, opens) {
  const commands = registryOf(ctx, 'commands')
  if (typeof commands?.register !== 'function') {
    ctx.logger?.warn?.('dsh-pdfcraft: no command registry is composed; the /pdfcraft command is unavailable')
    return undefined
  }

  return commands.register({
    name: OPEN_COMMAND_NAME,
    description: 'Open a PDF from this conversation\'s workspace in the PdfCraft Panel',
    input: { hint: '[<path>] — omit the path to open Standalone Mode' },
    handler: ({ agent, rawInput }) => {
      const sessionId = agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { kind: 'error', text: 'PdfCraft needs a conversation to open the Panel in.' }
      }
      const path = rawInput.trim()
      if (path.includes('\0')) return { kind: 'error', text: 'A document path cannot contain a NUL byte.' }
      try {
        const result = opens.open(sessionId, path === '' ? null : path)
        return { kind: 'success', text: deliveryText(result.document, result.delivered) }
      } catch (error) {
        return { kind: 'error', text: `Could not open the PdfCraft Panel: ${error.message}` }
      }
    },
  })
}

/**
 * Register the model-facing `pdfcraft_open` tool.
 *
 * The tool binds one Workspace Document for the calling conversation and asks
 * that conversation's Panel to open it. It never opens a second Panel and
 * never names another conversation: the agent speaks for the conversation it
 * is running in, exactly like the person's command. A path that is not in the
 * workspace is refused later, when the Panel reads it, by the same route that
 * guards the person's own opens.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context carrying the tool registry.
 * @param {ReturnType<typeof createPanelOpens>} opens - the Push Channel.
 * @returns {(() => void) | undefined} unregisters the tool, or undefined without a registry.
 */
export function registerOpenTool(ctx, opens) {
  const tools = registryOf(ctx, 'tools')
  if (typeof tools?.register !== 'function') {
    ctx.logger?.warn?.('dsh-pdfcraft: no tool registry is composed; the pdfcraft_open tool is unavailable')
    return undefined
  }

  return tools.register(defineTool({
    name: OPEN_TOOL_NAME,
    description:
      'Open a PDF from the current conversation\'s workspace in the PdfCraft Panel, so the person can see and edit it. '
      + 'The Panel is a single page per conversation: a later open replaces the document it shows. '
      + 'If the conversation is not on screen, the open waits and is delivered when it is; the result reports '
      + '`delivered` so you know whether it is visible now. The path must be inside the conversation workspace.',
    parameters: {
      path: {
        type: 'string',
        description: 'Path of the PDF to open, relative to the conversation workspace or absolute inside it. '
          + 'Omit it to open the Panel in Standalone Mode.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          delivered: {
            type: 'boolean',
            required: true,
            description: 'Whether a Push Channel stream was attached and received the open immediately.',
          },
        },
      },
      render: (_args, value) => {
        if (value.path === '') {
          return [{
            type: 'text',
            text: value.delivered
              ? 'Opened the PdfCraft Panel in Standalone Mode.'
              : 'Queued the PdfCraft Panel in Standalone Mode; it opens when this conversation is next on screen.',
          }]
        }
        return [{
          type: 'text',
          text: value.delivered
            ? `Opened ${value.path} in the PdfCraft Panel.`
            : `Queued ${value.path} for the PdfCraft Panel; it opens when this conversation is next on screen.`,
        }]
      },
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const sessionId = exec.agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('pdfcraft_open needs an agent conversation')
      }
      const requested = typeof args.path === 'string' ? args.path : ''
      const path = requested.trim() === '' ? null : requested
      const result = opens.open(sessionId, path)
      return { path: path ?? '', delivered: result.delivered }
    },
  }))
}
