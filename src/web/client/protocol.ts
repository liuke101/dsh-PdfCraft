/**
 * The Panel's pure protocol decisions, shared by the browser glue and the
 * Node seam test.
 *
 * The released PdfCraft web build ships a same-origin postMessage bridge that
 * is enabled by framing it as `/pdfcraft/?host=parent` (upstream
 * `apps/pdfcraft-web/src/main.rs`). It posts `pdfcraft:ready`, `pdfcraft:save`
 * (with the saved bytes transferred), `pdfcraft:dirty` and `pdfcraft:failed`
 * to its parent, and accepts `pdfcraft:open` (`{ name, bytes }`) back. This
 * module repeats that protocol rather than inventing one.
 *
 * Nothing here touches fetch, the DOM, or React, so the test suite can drive
 * every decision without a browser. The host's addresses and release pin come
 * from `src/shared/paths.ts`, and the refusal codes from
 * `src/shared/protocol.ts`, so the two halves cannot drift.
 */
import { APP_PATH, BINDING_PATH, DOCUMENT_PATH, PUSHES_PATH } from '../../shared/paths.ts'
import {
  DOCUMENT_ERROR,
  type BoundDocument,
  type OpenRequest,
} from '../../shared/protocol.ts'

/** The one page identity both registration paths publish. */
export const PAGE_KIND = 'pdfcraft'

/** The locale namespace this component's own copy lives in. */
export const LOCALE_NS = 'pdfcraft'

/** The frame query that turns the Embedded App's Host Bridge on. */
export const BRIDGE_FRAME_QUERY = '?host=parent'

/** The messages of the Embedded App's Host Bridge. */
export const BRIDGE_MESSAGE = Object.freeze({
  READY: 'pdfcraft:ready',
  OPEN: 'pdfcraft:open',
  SAVE: 'pdfcraft:save',
  DIRTY: 'pdfcraft:dirty',
  FAILED: 'pdfcraft:failed',
})

/** The name used when the Embedded App sends no usable name. */
export const DEFAULT_DOCUMENT_NAME = 'document.pdf'

/**
 * A document's bytes, backed by a plain `ArrayBuffer`.
 *
 * The bridge and the routes always hand out their own buffer, and `fetch`
 * accepts this form without a cast; `SharedArrayBuffer`-backed views never
 * reach here.
 */
export type Bytes = Uint8Array<ArrayBuffer>

/** The Panel's own translator, bound to its locale namespace. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** The props either sidebar seat may pass to the Panel body. */
export interface PanelSeatProps {
  readonly sessionId?: unknown
  readonly scope?: unknown
  readonly session?: unknown
}

/** One frame the Push Channel can carry. */
export interface PushOpenEvent extends OpenRequest {
  readonly type: 'open'
}

/**
 * The iframe source for a bound document or for Standalone Mode.
 * Standalone Mode never asks the Embedded App to turn its bridge on.
 */
export function frameSource(document: BoundDocument | null | undefined): string {
  if (document === null || document === undefined) return APP_PATH
  return `${APP_PATH}${BRIDGE_FRAME_QUERY}`
}

/** The host route that reports the conversation's binding. */
export function bindingUrl(sessionId: string): string {
  return `${BINDING_PATH}?${new URLSearchParams({ session: sessionId }).toString()}`
}

/** The host route that serves a Workspace Document and accepts its Write-back. */
export function documentUrl(sessionId: string, documentPath: string): string {
  return `${DOCUMENT_PATH}?${new URLSearchParams({
    session: sessionId,
    path: documentPath,
  }).toString()}`
}

/** The host route that carries Panel open requests for one conversation. */
export function pushUrl(sessionId: string): string {
  return `${PUSHES_PATH}?${new URLSearchParams({ session: sessionId }).toString()}`
}

/** Whether one decoded JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A bound document's name, falling back to its path. */
function documentOfPath(path: string, name: unknown): BoundDocument {
  return {
    path,
    name: typeof name === 'string' && name !== '' ? name : path,
  }
}

/**
 * The conversation one Panel body belongs to. DSH's native seat passes
 * `sessionId`; better-sidebar passes its SessionScope under `scope`; a
 * caller with a Session object passes it under `session`.
 */
export function sessionIdOfPanelProps(props: PanelSeatProps | undefined): string | undefined {
  if (props === undefined || props === null) return undefined
  if (typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
  if (isRecord(props.scope)) {
    const scoped = props.scope.sessionId
    if (typeof scoped === 'string' && scoped !== '') return scoped
  }
  if (isRecord(props.session)) {
    const id = props.session.id
    if (typeof id === 'string' && id !== '') return id
  }
  return undefined
}

/**
 * Read one Push Channel frame. Only a declared `open` for a named
 * conversation is accepted; a malformed frame is ignored rather than
 * allowed to open the Panel for the wrong conversation.
 */
export function decodePushEvent(data: unknown): PushOpenEvent | undefined {
  if (typeof data !== 'string') return undefined
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return undefined
  }
  if (!isRecord(value) || value.type !== 'open') return undefined
  if (typeof value.sessionId !== 'string' || value.sessionId === '') return undefined

  const document = isRecord(value.document)
    && typeof value.document.path === 'string'
    && value.document.path !== ''
    ? documentOfPath(value.document.path, value.document.name)
    : null

  return {
    type: 'open',
    id: typeof value.id === 'string' ? value.id : '',
    sessionId: value.sessionId,
    document,
  }
}

/** A bridge message's bytes as a private copy, accepting the two forms upstream sends. */
function bridgeBytes(value: unknown): Bytes | undefined {
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength)
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return copy
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return undefined
}

/** One `message` event's fields the bridge reads. */
export interface BridgeMessageEvent {
  readonly data?: unknown
  readonly origin?: string
  readonly source?: unknown
}

/** The origin and frame a bridge message must have come from. */
export interface BridgeExpectation {
  readonly origin?: string
  readonly source?: unknown
}

/** A decoded Host Bridge message. */
export type BridgeMessage =
  | { readonly type: 'ready'; readonly version: string }
  | {
      readonly type: 'save'
      readonly name: string
      readonly saveAs: boolean
      readonly bytes: Bytes
    }
  | { readonly type: 'dirty'; readonly dirty: boolean }
  | { readonly type: 'failed'; readonly error: string }

/**
 * Read one postMessage event as a Host Bridge message, or undefined.
 * Only this origin, only this frame, and only the four declared messages.
 */
export function decodeBridgeMessage(
  event: unknown,
  expected: BridgeExpectation = {},
): BridgeMessage | undefined {
  if (!isRecord(event)) return undefined
  if (typeof expected.origin === 'string' && event.origin !== expected.origin) return undefined
  if (expected.source !== undefined && event.source !== expected.source) return undefined
  const data = event.data
  if (!isRecord(data)) return undefined

  if (data.type === BRIDGE_MESSAGE.READY) {
    return { type: 'ready', version: typeof data.version === 'string' ? data.version : '' }
  }
  if (data.type === BRIDGE_MESSAGE.SAVE) {
    const bytes = bridgeBytes(data.bytes)
    if (bytes === undefined || bytes.byteLength === 0) return undefined
    return {
      type: 'save',
      name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name : DEFAULT_DOCUMENT_NAME,
      saveAs: data.saveAs === true,
      bytes,
    }
  }
  if (data.type === BRIDGE_MESSAGE.DIRTY) {
    return { type: 'dirty', dirty: data.dirty === true }
  }
  if (data.type === BRIDGE_MESSAGE.FAILED) {
    return { type: 'failed', error: typeof data.error === 'string' ? data.error : '' }
  }
  return undefined
}

/** One Panel bridge's phase. */
export type BridgePhase =
  | 'standalone'
  | 'waiting-ready'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'conflict'
  | 'error'

/** A save waiting for the person's answer to a Revision Guard refusal. */
export interface PendingSave {
  readonly bytes: Bytes
  readonly name: string
  readonly saveAs: boolean
}

/** The Revision Guard refusal shown in the Panel's own dialog. */
export interface BridgeConflict {
  readonly message: string
  readonly currentRevision: string
}

/** One Panel's bridge state. */
export interface BridgeState {
  readonly phase: BridgePhase
  readonly document: BoundDocument | null
  readonly revision: string
  readonly dirty: boolean
  readonly pending: PendingSave | null
  readonly conflict: BridgeConflict | null
  readonly error: string | null
}

/** The events the bridge reducer accepts. */
export type BridgeAction =
  | { readonly type: 'frame/ready' }
  | { readonly type: 'document/loaded'; readonly bytes: Bytes; readonly revision: string }
  | { readonly type: 'document/failed'; readonly message: string }
  | {
      readonly type: 'bridge/save'
      readonly bytes: Bytes
      readonly name: string
      readonly saveAs: boolean
    }
  | { readonly type: 'write/succeeded'; readonly revision?: string }
  | { readonly type: 'write/conflicted'; readonly message: string; readonly currentRevision: string }
  | { readonly type: 'write/failed'; readonly message: string }
  | { readonly type: 'panel/reload' }
  | { readonly type: 'panel/retry' }
  | { readonly type: 'panel/overwrite' }
  | { readonly type: 'panel/dismiss' }
  | { readonly type: 'bridge/dirty'; readonly dirty: boolean }
  | { readonly type: 'bridge/failed'; readonly message: string }

/** The side effects the glue carries out for one transition. */
export type BridgeEffect =
  | { readonly kind: 'load'; readonly path: string }
  | { readonly kind: 'open'; readonly name: string; readonly bytes: Bytes }
  | { readonly kind: 'write'; readonly bytes: Bytes; readonly revision: string; readonly force: boolean }
  | { readonly kind: 'rebuild-frame' }

/** One transition's next state and the effects to carry out. */
export interface BridgeTransition {
  readonly state: BridgeState
  readonly effects: BridgeEffect[]
}

/** A fresh empty effect list, so callers never share a mutable transition result. */
const noEffects = (): BridgeEffect[] => []

/**
 * One Panel's bridge state. A bound document waits for the frame's ready;
 * Standalone Mode never leaves `standalone`, so no bridge effect can run.
 */
export function initialBridgeState(document: BoundDocument | null | undefined): BridgeState {
  const bound = document !== null && document !== undefined
  return {
    phase: bound ? 'waiting-ready' : 'standalone',
    document: bound ? document : null,
    revision: '',
    dirty: false,
    pending: null,
    conflict: null,
    error: null,
  }
}

/**
 * The bridge's pure state machine. Returns the next state and the effects the
 * glue must carry out (`load`, `open`, `write`, `rebuild-frame`). No fetch, no
 * DOM, no React: the seam test drives exactly this.
 */
export function reduceBridge(state: BridgeState, action: BridgeAction): BridgeTransition {
  switch (action.type) {
    case 'frame/ready':
      if (state.phase !== 'waiting-ready' || state.document === null) return { state, effects: noEffects() }
      return {
        state: { ...state, phase: 'loading', error: null },
        effects: [{ kind: 'load', path: state.document.path }],
      }
    case 'document/loaded':
      if (state.phase !== 'loading') return { state, effects: noEffects() }
      return {
        state: {
          ...state,
          phase: 'ready',
          revision: typeof action.revision === 'string' ? action.revision : '',
          error: null,
        },
        effects: [{
          kind: 'open',
          name: state.document === null ? DEFAULT_DOCUMENT_NAME : state.document.name,
          bytes: action.bytes,
        }],
      }
    case 'document/failed':
      if (state.phase !== 'loading') return { state, effects: noEffects() }
      return { state: { ...state, phase: 'error', error: action.message }, effects: noEffects() }
    case 'bridge/save':
      if (state.phase !== 'ready') return { state, effects: noEffects() }
      return {
        state: {
          ...state,
          phase: 'saving',
          pending: { bytes: action.bytes, name: action.name, saveAs: action.saveAs },
        },
        effects: [{
          kind: 'write',
          bytes: action.bytes,
          revision: state.revision,
          force: false,
        }],
      }
    case 'write/succeeded':
      return {
        state: {
          ...state,
          phase: 'ready',
          revision: typeof action.revision === 'string' ? action.revision : state.revision,
          pending: null,
          conflict: null,
          error: null,
        },
        effects: noEffects(),
      }
    case 'write/conflicted':
      return {
        state: {
          ...state,
          phase: 'conflict',
          conflict: {
            message: typeof action.message === 'string' ? action.message : '',
            currentRevision: typeof action.currentRevision === 'string' ? action.currentRevision : '',
          },
        },
        effects: noEffects(),
      }
    case 'write/failed':
      return {
        state: { ...state, phase: 'ready', pending: null, error: action.message },
        effects: noEffects(),
      }
    case 'panel/reload':
      if (state.phase !== 'conflict' && state.phase !== 'error') return { state, effects: noEffects() }
      return {
        state: {
          ...state,
          phase: 'waiting-ready',
          revision: '',
          pending: null,
          conflict: null,
          error: null,
        },
        effects: [{ kind: 'rebuild-frame' }],
      }
    case 'panel/retry':
      if (state.phase !== 'error') return { state, effects: noEffects() }
      return {
        state: {
          ...state,
          phase: 'waiting-ready',
          revision: '',
          error: null,
          conflict: null,
          pending: null,
        },
        effects: [{ kind: 'rebuild-frame' }],
      }
    case 'panel/overwrite':
      if (state.phase !== 'conflict' || state.pending === null) return { state, effects: noEffects() }
      return {
        state: { ...state, phase: 'saving' },
        effects: [{
          kind: 'write',
          bytes: state.pending.bytes,
          revision: state.revision,
          force: true,
        }],
      }
    case 'panel/dismiss':
      return { state: { ...state, error: null }, effects: noEffects() }
    case 'bridge/dirty':
      return { state: { ...state, dirty: action.dirty === true }, effects: noEffects() }
    case 'bridge/failed':
      return { state: { ...state, phase: 'error', error: action.message }, effects: noEffects() }
    default:
      return { state, effects: noEffects() }
  }
}

/** The JSON body of a refused read or Write-back, as the browser reads it. */
export interface DocumentFailureBody {
  readonly code?: string
  readonly message?: string
  readonly details?: unknown
}

/** The two response readers a refusal body may need. */
export interface FailureReader {
  json(): Promise<unknown>
  text(): Promise<string>
}

/**
 * Turn a host refusal into the plugin's own, localized copy. The size-limit
 * message names the limit; the host's English message is the fallback.
 */
export function describeDocumentFailure(failure: DocumentFailureBody, translate: Translate): string {
  const details = failure.details
  if (
    failure.code === DOCUMENT_ERROR.tooLarge
    && details !== null
    && typeof details === 'object'
    && typeof (details as Record<string, unknown>).limit === 'number'
  ) {
    return translate('error.tooLarge', { limit: (details as { limit: number }).limit })
  }
  if (failure.code === DOCUMENT_ERROR.outsideWorkspace) return translate('error.outside')
  if (failure.code === DOCUMENT_ERROR.notFound) return translate('error.notFound')
  if (failure.code === DOCUMENT_ERROR.notLoaded) return translate('error.notLoaded')
  if (failure.code === DOCUMENT_ERROR.noWorkspace) return translate('error.noWorkspace')
  if (typeof failure.message === 'string' && failure.message !== '') return failure.message
  return translate('error.load')
}

/**
 * Read one refusal's body without ever throwing. This runs on the save path,
 * where a body that is not the JSON the route promised would otherwise leave
 * the bridge stuck in `saving` with no message and no way to retry.
 */
export async function readFailure(response: FailureReader): Promise<DocumentFailureBody> {
  try {
    const payload = await response.json()
    if (payload !== null && typeof payload === 'object') return payload as DocumentFailureBody
  } catch {
    // Not JSON: fall through to the raw body.
  }
  try {
    return { message: await response.text() }
  } catch {
    return {}
  }
}
