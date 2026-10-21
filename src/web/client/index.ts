/**
 * Browser half of dsh-pdfcraft.
 *
 * Registers exactly one right-sidebar page for the PdfCraft Embedded App. The
 * page is published through the better-sidebar service when that service is
 * present, and otherwise as a page type of DSH's own right sidebar; the two
 * paths share one page identity (`PAGE_KIND`) and are never both taken.
 *
 * The Panel is the frame and nothing else: PdfCraft owns its own chrome,
 * appearance and language. The plugin's own copy appears only where it must
 * speak — the waiting/missing states, the Standalone Mode notice, and the
 * Revision Guard's reload/overwrite refusal.
 *
 * The Host Bridge protocol and the Push Channel decode are pure functions in
 * `protocol.ts`; this file holds only the React and DOM glue. The shell loads
 * the built bundle with the package's id (`dsh-pdfcraft`), and React and
 * `react/jsx-runtime` come from its module table.
 */
import {
  createElement as h,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { DOCUMENT_ERROR, type BoundDocument } from '../../shared/protocol.ts'
import { FORCE_HEADER, REVISION_HEADER, STATUS_PATH, WEB_BUILD_FILENAME, WEB_RELEASE } from '../../shared/paths.ts'
import type {
  BetterSidebarService,
  ClientContext,
  PanelComponent,
  SidebarRightController,
} from './context.ts'
import { DICTIONARIES } from './copy.ts'
import {
  bindingUrl,
  BRIDGE_MESSAGE,
  decodeBridgeMessage,
  decodePushEvent,
  describeDocumentFailure,
  documentUrl,
  frameSource,
  initialBridgeState,
  LOCALE_NS,
  PAGE_KIND,
  pushUrl,
  readFailure,
  reduceBridge,
  sessionIdOfPanelProps,
  type BridgeAction,
  type BridgeEffect,
  type BridgeMessage,
  type BridgeState,
  type Bytes,
  type PanelSeatProps,
  type Translate,
} from './protocol.ts'
import {
  BANNER_STYLE,
  BUTTON_ROW_STYLE,
  BUTTON_STYLE,
  CARD_STYLE,
  CODE_STYLE,
  COPY_STYLE,
  DIALOG_STYLE,
  FRAME_WRAP_STYLE,
  HEADING_STYLE,
  LINK_STYLE,
  NOTICE_STYLE,
  OVERLAY_STYLE,
  PANEL_STYLE,
  STATE_STYLE,
} from './styles.ts'

/** The native page identity and its two slot names. */
const NATIVE_PAGE_ID = 'dsh-pdfcraft:panel'
const BODY_SLOT = 'sidebar.right.pane.tab'
const TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** One panel's own status shape; the host may send more, and none of it is used. */
interface PanelStatus {
  readonly ready: boolean
  readonly file: string
  readonly release: string
  readonly directory: string
  readonly releaseUrl: string
}

/** The readiness check's state. */
interface CheckState {
  readonly phase: 'checking' | 'ready' | 'missing'
  readonly status: PanelStatus | null
}

/** The binding check's state. */
type BindingState =
  | { readonly phase: 'checking'; readonly document: null }
  | { readonly phase: 'standalone'; readonly document: null }
  | { readonly phase: 'bound'; readonly document: BoundDocument }
  | { readonly phase: 'error'; readonly document: null }

/** One open revision the Panel body reads. */
interface OpenFeedSnapshot {
  readonly revision: number
  readonly sessionId: string
}

/** The notification face the Push Channel publishes revisions into. */
interface OpenFeed {
  publish(sessionId: string): void
  getSnapshot(): OpenFeedSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * The Panel body's revision of a push: one per conversation. A request
 * that arrived while the body was not mounted still leaves the latest
 * revision here, so the first mount reads it and fetches the new binding.
 */
function createOpenFeed(): OpenFeed {
  let snapshot: OpenFeedSnapshot = { revision: 0, sessionId: '' }
  const listeners = new Set<() => void>()
  return {
    publish(sessionId) {
      snapshot = { revision: snapshot.revision + 1, sessionId }
      for (const listener of listeners) listener()
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** One feed shared by the Push Channel and the Panels it opens. */
const openFeed = createOpenFeed()

/** The stable locale subscription and translator one component tree needs. */
function translationFace(ctx: ClientContext): {
  subscribe: (listener: () => void) => () => void
  snapshot: () => unknown
  bind: () => Translate
} {
  return {
    subscribe: (listener) => ctx.locale.subscribe(listener),
    snapshot: () => ctx.locale.getSnapshot(),
    bind: () => ctx.locale.bind(LOCALE_NS),
  }
}

/** Re-render on a DSH language change and return the bound translator. */
function useTranslation(face: ReturnType<typeof translationFace>): Translate {
  useSyncExternalStore(face.subscribe, face.snapshot, face.snapshot)
  return face.bind()
}

/** The right sidebar glyph; the Plugin Manager artwork comes from icon.png. */
function PdfCraftGlyph(props: { readonly size?: number }) {
  const size = typeof props?.size === 'number' ? props.size : 16
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    h('path', {
      d: 'M6.5 2.75h7.25L18 7v13.25a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z',
      fill: 'currentColor',
      opacity: 0.16,
    }),
    h('path', {
      d: 'M6.5 2.75h7.25L18 7v13.25a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M13.5 3v4.25h4.25M8 11.5h7M8 15h5',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    h('circle', { cx: 17.25, cy: 17.25, r: 4, fill: '#e9a23b' }),
    h('path', {
      d: 'M17.25 15.25v4M15.25 17.25h4',
      stroke: '#5a3a08',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
    }),
  )
}

/** The readiness report, narrowed to the fields the Panel renders. */
function normalizeStatus(status: unknown): PanelStatus {
  if (status !== null && typeof status === 'object' && typeof (status as { ready?: unknown }).ready === 'boolean') {
    return status as PanelStatus
  }
  return {
    ready: false,
    file: WEB_BUILD_FILENAME,
    release: WEB_RELEASE,
    directory: '',
    releaseUrl: '',
  }
}

/** Read the binding route's payload as a Workspace Document, or null for Standalone Mode. */
function normalizeBinding(payload: unknown): BoundDocument | null {
  if (payload === null || typeof payload !== 'object') return null
  const document = (payload as { document?: unknown }).document
  if (document === null || typeof document !== 'object') return null
  const path = (document as { path?: unknown }).path
  if (typeof path !== 'string' || path === '') return null
  const name = (document as { name?: unknown }).name
  return {
    path,
    name: typeof name === 'string' && name !== '' ? name : path,
  }
}

/** Read the conversation's current binding, or null for Standalone Mode. */
async function readBinding(sessionId: string): Promise<BoundDocument | null> {
  const response = await fetch(bindingUrl(sessionId), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`binding ${response.status}`)
  return normalizeBinding(await response.json())
}

/** The sidebar controller when the host has one, probed without injecting it. */
function sidebarControllerOf(ctx: ClientContext): SidebarRightController | null | undefined {
  let right: unknown
  try {
    right = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
  } catch {
    right = undefined
  }
  right ??= ctx.sidebarRight
  return right as SidebarRightController | null | undefined
}

/**
 * Open the Panel for one conversation, but only while that conversation is
 * the one on screen: the controller's open call is valid for the mounted
 * Session alone. `false` means the request must wait.
 */
function openPanelAt(right: SidebarRightController | null | undefined, sessionId: string): boolean {
  if (right === undefined || right === null) return false
  let mounted: unknown
  try {
    mounted = right.mounted?.getSnapshot?.()
  } catch {
    return false
  }
  if (mounted !== sessionId) return false
  try {
    right.openTab(PAGE_KIND)
    return true
  } catch (error) {
    console.warn?.(`dsh-pdfcraft: could not open the Panel for ${sessionId}:`, (error as Error)?.message ?? error)
    return false
  }
}

/**
 * Hold one Push Channel stream for the conversation on screen. A request
 * for another conversation is not read until that conversation's stream is
 * attached, so nothing is opened behind the person's back.
 */
function startPushSource(
  right: SidebarRightController | null | undefined,
  feed: OpenFeed,
): () => void {
  let source: EventSource | undefined
  let sessionId: string | undefined
  let disposed = false

  const stopSource = (): void => {
    if (source === undefined) return
    try {
      source.close()
    } catch {
      // A source already closed by the browser is harmless.
    }
    source = undefined
  }

  const receive = (event: MessageEvent): void => {
    const message = decodePushEvent(event?.data)
    if (message === undefined || message.sessionId !== sessionId) return
    feed.publish(message.sessionId)
    if (openPanelAt(right, message.sessionId)) return
    // A push can arrive while the page kind is still being registered at
    // activation. One short retry keeps that race from losing the open;
    // if the conversation moved on, the next attach replays nothing and
    // the host's consume-on-send rule still holds.
    setTimeout(() => {
      if (!disposed && sessionId === message.sessionId) openPanelAt(right, message.sessionId)
    }, 0)
  }

  const sync = (): void => {
    if (disposed) return
    let mounted: unknown
    try {
      mounted = right?.mounted?.getSnapshot?.()
    } catch {
      mounted = undefined
    }
    const next = typeof mounted === 'string' && mounted !== '' ? mounted : undefined
    if (next === sessionId) return
    stopSource()
    sessionId = next
    if (sessionId === undefined || typeof EventSource !== 'function') return
    try {
      const opened = new EventSource(pushUrl(sessionId))
      source = opened
      opened.addEventListener('message', receive)
    } catch (error) {
      console.warn?.(`dsh-pdfcraft: could not hold the Push Channel for ${sessionId}:`, (error as Error)?.message ?? error)
    }
  }

  let unsubscribe: (() => void) | undefined
  try {
    unsubscribe = right?.mounted?.subscribe?.(sync)
  } catch {
    unsubscribe = undefined
  }
  sync()

  return () => {
    disposed = true
    if (typeof unsubscribe === 'function') unsubscribe()
    stopSource()
  }
}

/**
 * One Panel component, closed over the context that owns its registration.
 *
 * Mounting is the only place the mode is decided: a request for the
 * conversation's binding either returns a Workspace Document (Host Bridge
 * on, `?host=parent`) or nothing (Standalone Mode, no bridge, no listener).
 */
function createPanel(ctx: ClientContext): PanelComponent {
  const face = translationFace(ctx)

  return function PdfCraftPanel(props: PanelSeatProps) {
    // Without a conversation there is nothing to bind, so the Panel stays
    // standalone; with one, its binding decides between the two modes.
    const sessionId = sessionIdOfPanelProps(props)

    const [attempt, setAttempt] = useState(0)
    const [check, setCheck] = useState<CheckState>({ phase: 'checking', status: null })
    const [binding, setBinding] = useState<BindingState>({
      phase: sessionId === undefined ? 'standalone' : 'checking',
      document: null,
    })
    const [epoch, setEpoch] = useState(0)
    const [bridge, setBridge] = useState<BridgeState>(() => initialBridgeState(null))
    const frameRef = useRef<HTMLIFrameElement | null>(null)
    const stateRef = useRef(bridge)
    const openState = useSyncExternalStore(
      openFeed.subscribe,
      openFeed.getSnapshot,
      openFeed.getSnapshot,
    )
    // A push for this conversation asks the body to read the binding again,
    // even when the Page was already open and the controller only focused it.
    const pushedRevision = sessionId !== undefined && openState.sessionId === sessionId
      ? openState.revision
      : 0

    const t = useTranslation(face)

    useEffect(() => {
      let live = true
      const settle = (next: CheckState): void => {
        if (live) setCheck(next)
      }

      fetch(STATUS_PATH, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      })
        .then((response) => {
          if (!response.ok) throw new Error(`status ${response.status}`)
          return response.json()
        })
        .then((status: unknown) => {
          const read = normalizeStatus(status)
          settle({ phase: read.ready ? 'ready' : 'missing', status: read })
        })
        .catch(() => settle({ phase: 'missing', status: null }))

      return () => {
        live = false
      }
    }, [attempt])

    useEffect(() => {
      if (sessionId === undefined) {
        setBinding({ phase: 'standalone', document: null })
        return undefined
      }

      let live = true
      setBinding({ phase: 'checking', document: null })
      readBinding(sessionId)
        .then((document) => {
          if (!live) return
          setBinding(document === null
            ? { phase: 'standalone', document: null }
            : { phase: 'bound', document })
        })
        .catch(() => {
          if (live) setBinding({ phase: 'error', document: null })
        })

      return () => {
        live = false
      }
    }, [sessionId, attempt])

    // A push for an already-open Panel must not replace the frame with the
    // checking state: that would throw away unsaved work in the Embedded
    // App. Refetch quietly and only commit when the bound document changed.
    useEffect(() => {
      if (sessionId === undefined || pushedRevision === 0) return undefined
      let live = true
      readBinding(sessionId)
        .then((document) => {
          if (!live) return
          setBinding((current) => {
            const currentDocument = current.phase === 'bound' ? current.document : null
            const same = currentDocument === null
              ? document === null
              : document !== null && document.path === currentDocument.path
            if (same) return current
            return document === null
              ? { phase: 'standalone', document: null }
              : { phase: 'bound', document }
          })
        })
        .catch(() => {
          // The visible state stays usable; the next open retries the read.
        })
      return () => {
        live = false
      }
    }, [sessionId, pushedRevision])

    const boundDocument = binding.phase === 'bound' ? binding.document : null
    const documentPath = boundDocument === null ? '' : boundDocument.path

    // A new binding, or a reload's fresh frame, starts the bridge over.
    useEffect(() => {
      const next = initialBridgeState(boundDocument)
      stateRef.current = next
      setBridge(next)
    }, [documentPath, epoch, binding.phase])

    useEffect(() => {
      if (binding.phase !== 'bound') return undefined

      const onMessage = (event: MessageEvent): void => {
        const message: BridgeMessage | undefined = decodeBridgeMessage(event, {
          origin: window.location.origin,
          source: frameRef.current === null ? undefined : frameRef.current.contentWindow,
        })
        if (message === undefined) return
        if (message.type === 'ready') {
          dispatchBridge({ type: 'frame/ready' })
        } else if (message.type === 'save') {
          dispatchBridge({
            type: 'bridge/save',
            bytes: message.bytes,
            name: message.name,
            saveAs: message.saveAs,
          })
        } else if (message.type === 'dirty') {
          dispatchBridge({ type: 'bridge/dirty', dirty: message.dirty })
        } else if (message.type === 'failed') {
          dispatchBridge({ type: 'bridge/failed', message: message.error })
        }
      }

      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }, [binding.phase, epoch, sessionId, documentPath])

    /** Turn the reducer's effects into fetch and postMessage calls. */
    function runEffect(effect: BridgeEffect): void {
      if (effect.kind === 'rebuild-frame') {
        setEpoch((value) => value + 1)
        return
      }
      if (effect.kind === 'load') {
        void loadFromWorkspace(effect.path)
        return
      }
      if (effect.kind === 'open') {
        postToApp(effect.name, effect.bytes)
        return
      }
      if (effect.kind === 'write') {
        void writeToWorkspace(effect)
      }
    }

    function dispatchBridge(action: BridgeAction): void {
      // A frame can report ready in the same commit that the binding
      // arrives, before the reset effect has run. Start from the bound
      // state then, so the first ready is not dropped.
      if (stateRef.current.phase === 'standalone' && boundDocument !== null) {
        const reset = initialBridgeState(boundDocument)
        stateRef.current = reset
        setBridge(reset)
      }
      const result = reduceBridge(stateRef.current, action)
      if (result.state !== stateRef.current) {
        stateRef.current = result.state
        setBridge(result.state)
      }
      for (const effect of result.effects) runEffect(effect)
    }

    /** Post the document's bytes into the Embedded App, transferring a copy. */
    function postToApp(name: string, bytes: Bytes): void {
      const frame = frameRef.current
      if (frame === null || frame === undefined || frame.contentWindow === null) return
      const copy = new Uint8Array(bytes)
      try {
        frame.contentWindow.postMessage(
          { type: BRIDGE_MESSAGE.OPEN, name, bytes: copy },
          window.location.origin,
          [copy.buffer as ArrayBuffer],
        )
      } catch {
        // A frame replaced mid-handshake cannot receive; its next ready retries.
      }
    }

    async function loadFromWorkspace(path: string): Promise<void> {
      if (sessionId === undefined) {
        dispatchBridge({ type: 'document/failed', message: face.bind()('error.binding') })
        return
      }
      let response: Response
      try {
        response = await fetch(documentUrl(sessionId, path), {
          headers: { accept: 'application/pdf' },
          cache: 'no-store',
          credentials: 'same-origin',
        })
      } catch {
        dispatchBridge({ type: 'document/failed', message: face.bind()('error.network') })
        return
      }

      if (!response.ok) {
        const failure = await readFailure(response)
        dispatchBridge({
          type: 'document/failed',
          message: describeDocumentFailure(failure, face.bind()),
        })
        return
      }

      let bytes: Bytes
      try {
        bytes = new Uint8Array(await response.arrayBuffer())
      } catch {
        dispatchBridge({ type: 'document/failed', message: face.bind()('error.load') })
        return
      }

      dispatchBridge({
        type: 'document/loaded',
        bytes,
        revision: response.headers.get(REVISION_HEADER) ?? '',
      })
    }

    async function writeToWorkspace(effect: Extract<BridgeEffect, { readonly kind: 'write' }>): Promise<void> {
      if (sessionId === undefined) {
        dispatchBridge({ type: 'write/failed', message: face.bind()('error.binding') })
        return
      }
      const headers: Record<string, string> = {
        'content-type': 'application/pdf',
        accept: 'application/json',
        [REVISION_HEADER]: effect.revision,
      }
      if (effect.force) headers[FORCE_HEADER] = '1'

      let response: Response
      try {
        response = await fetch(documentUrl(sessionId, documentPath), {
          method: 'POST',
          headers,
          body: effect.bytes,
          credentials: 'same-origin',
        })
      } catch {
        dispatchBridge({ type: 'write/failed', message: face.bind()('error.network') })
        return
      }

      if (response.status === 409) {
        const failure = await readFailure(response)
        if (failure.code === DOCUMENT_ERROR.revisionConflict) {
          const details = failure.details
          dispatchBridge({
            type: 'write/conflicted',
            message: typeof failure.message === 'string' ? failure.message : '',
            currentRevision: details !== null
              && typeof details === 'object'
              && typeof (details as { currentRevision?: unknown }).currentRevision === 'string'
              ? (details as { currentRevision: string }).currentRevision
              : '',
          })
          return
        }
        dispatchBridge({
          type: 'write/failed',
          message: describeDocumentFailure(failure, face.bind()),
        })
        return
      }

      if (!response.ok) {
        const failure = await readFailure(response)
        dispatchBridge({
          type: 'write/failed',
          message: describeDocumentFailure(failure, face.bind()),
        })
        return
      }

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      dispatchBridge({
        type: 'write/succeeded',
        revision: payload !== null
          && typeof payload === 'object'
          && typeof (payload as { revision?: unknown }).revision === 'string'
          ? (payload as { revision: string }).revision
          : effect.revision,
      })
    }

    const retry = (): void => {
      setCheck({ phase: 'checking', status: null })
      setBinding({ phase: sessionId === undefined ? 'standalone' : 'checking', document: null })
      setAttempt((value) => value + 1)
    }

    if (check.phase === 'checking' || binding.phase === 'checking') {
      return h('div', { style: STATE_STYLE }, h('div', { style: CARD_STYLE }, t('checking')))
    }

    if (check.phase === 'missing') {
      const status = normalizeStatus(check.status)
      const directory = typeof status.directory === 'string' ? status.directory.trim() : ''

      return h(
        'div',
        { style: STATE_STYLE },
        h(
          'div',
          { style: CARD_STYLE },
          h('div', { style: HEADING_STYLE }, t('missing.title')),
          h(
            'p',
            { style: COPY_STYLE },
            t('missing.body', {
              file: status.file ?? WEB_BUILD_FILENAME,
              release: status.release ?? WEB_RELEASE,
            }),
          ),
          typeof status.releaseUrl === 'string' && status.releaseUrl !== ''
            ? h(
                'p',
                { style: COPY_STYLE },
                h(
                  'a',
                  { href: status.releaseUrl, target: '_blank', rel: 'noreferrer', style: LINK_STYLE },
                  status.releaseUrl,
                ),
              )
            : null,
          directory !== ''
            ? h(
                'p',
                { style: COPY_STYLE },
                t('missing.directory'),
                ' ',
                h('code', { style: CODE_STYLE }, directory),
              )
            : null,
          h('button', { type: 'button', onClick: retry, style: BUTTON_STYLE }, t('missing.retry')),
        ),
      )
    }

    if (binding.phase === 'error') {
      return h(
        'div',
        { style: STATE_STYLE },
        h(
          'div',
          { style: CARD_STYLE },
          h('div', { style: HEADING_STYLE }, t('error.title')),
          h('p', { style: COPY_STYLE }, t('error.binding')),
          h('button', { type: 'button', onClick: retry, style: BUTTON_STYLE }, t('error.retry')),
        ),
      )
    }

    const bound = binding.phase === 'bound'
    const document = bound ? binding.document : null

    // A refused read (too large, outside the workspace, unreadable) keeps
    // the frame away and says why; the host's message names the limit.
    if (bound && bridge.phase === 'error' && bridge.error !== null) {
      return h(
        'div',
        { style: STATE_STYLE },
        h(
          'div',
          { style: CARD_STYLE },
          h('div', { style: HEADING_STYLE }, t('error.title')),
          h('p', { style: COPY_STYLE }, bridge.error),
          h(
            'button',
            {
              type: 'button',
              onClick: () => dispatchBridge({ type: 'panel/retry' }),
              style: BUTTON_STYLE,
            },
            t('error.retry'),
          ),
        ),
      )
    }

    const conflict = bridge.phase === 'conflict'
      ? h(
          'div',
          { style: OVERLAY_STYLE },
          h(
            'div',
            { style: DIALOG_STYLE, role: 'alertdialog', 'aria-modal': 'true' },
            h('div', { style: HEADING_STYLE }, t('conflict.title')),
            h('p', { style: COPY_STYLE }, t('conflict.body')),
            h(
              'div',
              { style: BUTTON_ROW_STYLE },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => dispatchBridge({ type: 'panel/reload' }),
                  style: BUTTON_STYLE,
                },
                t('conflict.reload'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => dispatchBridge({ type: 'panel/overwrite' }),
                  style: BUTTON_STYLE,
                },
                t('conflict.overwrite'),
              ),
            ),
          ),
        )
      : null

    const failureBanner = bridge.error !== null && bridge.phase !== 'error'
      ? h(
          'div',
          { style: BANNER_STYLE, role: 'alert' },
          h('span', null, bridge.error),
          h(
            'button',
            {
              type: 'button',
              onClick: () => dispatchBridge({ type: 'panel/dismiss' }),
              style: BUTTON_STYLE,
            },
            t('error.dismiss'),
          ),
        )
      : null

    return h(
      'div',
      { style: FRAME_WRAP_STYLE },
      h('iframe', {
        key: `${document === null ? 'standalone' : document.path}:${epoch}`,
        ref: frameRef,
        src: frameSource(document),
        title: t('page.title'),
        allow: 'fullscreen; clipboard-read; clipboard-write',
        allowFullScreen: true,
        style: PANEL_STYLE,
      }),
      bound ? null : h('div', { style: NOTICE_STYLE, role: 'status' }, t('standalone.notice')),
      conflict,
      failureBanner,
    )
  }
}

/** The tab title, kept live so a language switch updates the tab. */
function createTitle(ctx: ClientContext): PanelComponent {
  const face = translationFace(ctx)

  return function PdfCraftTitle() {
    const t = useTranslation(face)
    return t('page.title')
  }
}

/** BetterSidebar Registration: one page published through the service. */
function publishBetterSidebarRegistration(ctx: ClientContext, service: BetterSidebarService): void {
  ctx.effect(
    () => service.registerTab({
      id: PAGE_KIND,
      title: () => ctx.locale.bind(LOCALE_NS)('page.title'),
      description: () => ctx.locale.bind(LOCALE_NS)('page.description'),
      icon: (size) => h(PdfCraftGlyph, { size }),
      order: 40,
      single: true,
      component: createPanel(ctx),
    }),
    'dsh-pdfcraft: better-sidebar page',
  )
}

/** Native Registration: one page type of DSH's own right sidebar. */
function publishNativeRegistration(ctx: ClientContext): () => void {
  const title = (): string => ctx.locale.bind(LOCALE_NS)('page.title')
  const description = (): string => ctx.locale.bind(LOCALE_NS)('page.description')
  const disposers: Array<() => void> = []

  disposers.push(ctx.effect(
    () => ctx.sidebarRightTabs.register({
      id: NATIVE_PAGE_ID,
      kind: PAGE_KIND,
      priority: 'extension',
      title,
      guide: [{
        id: PAGE_KIND,
        order: 40,
        title,
        description,
        icon: PdfCraftGlyph,
      }],
    }),
    'dsh-pdfcraft: native page type',
  ))

  disposers.push(ctx.effect(
    () => ctx.slots.inject(BODY_SLOT, () => ctx.slots.register({
      name: BODY_SLOT,
      key: NATIVE_PAGE_ID,
      locale: LOCALE_NS,
    }, createPanel(ctx))),
    'dsh-pdfcraft: native page body',
  ))

  disposers.push(ctx.effect(
    () => ctx.slots.inject(TITLE_SLOT, () => ctx.slots.register({
      name: TITLE_SLOT,
      key: NATIVE_PAGE_ID,
      locale: LOCALE_NS,
    }, createTitle(ctx))),
    'dsh-pdfcraft: native page title',
  ))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** Plugin name used in the shell's diagnostics and in `__ModuleLoader__`. */
export const name = 'dsh-pdfcraft'

/** The client services this component needs before it can register. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/**
 * Client plugin body: register the Panel's copy, hold the Push Channel stream
 * for the conversation on screen, and publish exactly one page.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => {
      ctx.locale.register(LOCALE_NS, DICTIONARIES)
    },
    'dsh-pdfcraft: dictionaries',
  )

  // The Push Channel stream exists for the conversation on screen, not
  // for the Panel only: the Panel may still be closed when the agent
  // asks for it. A request for another conversation waits on the host.
  ctx.effect(() => {
    const right = sidebarControllerOf(ctx)
    if (right === undefined || right === null) return undefined
    return startPushSource(right, openFeed)
  }, 'dsh-pdfcraft: Push Channel stream')

  // The two publication paths are alternatives, never both: better-sidebar
  // itself registers a native page for every tab type, so also registering
  // here would put two entries in one column. The service is usually present
  // at activation; when it is not, the native page covers profiles without
  // better-sidebar and is withdrawn if the service arrives later.
  const betterSidebar = ctx.get('betterSidebar')
  if (betterSidebar !== undefined && betterSidebar !== null) {
    publishBetterSidebarRegistration(ctx, betterSidebar as BetterSidebarService)
    return
  }

  const withdrawNative = publishNativeRegistration(ctx)
  ctx.inject(['betterSidebar'], (scoped) => {
    const service = scoped.get('betterSidebar')
    if (service === undefined || service === null) return
    withdrawNative()
    publishBetterSidebarRegistration(scoped, service as BetterSidebarService)
  })
}
