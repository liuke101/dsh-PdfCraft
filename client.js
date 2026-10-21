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
 * ## The Host Bridge
 *
 * The released PdfCraft web build ships a same-origin postMessage bridge that
 * is enabled by framing it as `/pdfcraft/?host=parent` (upstream
 * `apps/pdfcraft-web/src/main.rs`). It posts `pdfcraft:ready`, `pdfcraft:save`
 * (with the saved bytes transferred), `pdfcraft:dirty` and `pdfcraft:failed`
 * to its parent, and accepts `pdfcraft:open` (`{ name, bytes }`) back. This
 * file repeats that protocol rather than inventing one.
 *
 * The protocol's decisions — which frame source turns the bridge on, which
 * messages are accepted, and what a ready/save/conflict means — are pure
 * functions in this bundle, exposed on the plugin object as `bridgeProtocol` so
 * the Node seam test can drive them without a DOM. The components hold only
 * the React and DOM glue.
 *
 * The locale namespace, page kind, addresses, release version, and web-build
 * filename are mirrored from `src/shared/paths.ts` and `locale/*.json`; this
 * file is a self-contained classic script because the shell's module loader
 * receives one bundle per package.
 */

window.__ModuleLoader__.load({
  id: 'dsh-pdfcraft',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Mirrored from src/shared/paths.ts; see ADR-0002. */
    const LOCALE_NS = 'pdfcraft'
    const PAGE_KIND = 'pdfcraft'
    const APP_PATH = '/pdfcraft/'
    const STATUS_PATH = '/pdfcraft/status'
    const BINDING_PATH = '/pdfcraft/binding'
    const DOCUMENT_PATH = '/pdfcraft/document'
    const PUSHES_PATH = '/pdfcraft/pushes'
    const WEB_RELEASE = '0.9.0'
    const WEB_BUILD_FILENAME = `pdfcraft-web-${WEB_RELEASE}.zip`

    /** The frame query that turns the Embedded App's Host Bridge on. */
    const BRIDGE_FRAME_QUERY = '?host=parent'

    /** The messages of the Embedded App's Host Bridge. */
    const BRIDGE_MESSAGE = Object.freeze({
      READY: 'pdfcraft:ready',
      OPEN: 'pdfcraft:open',
      SAVE: 'pdfcraft:save',
      DIRTY: 'pdfcraft:dirty',
      FAILED: 'pdfcraft:failed',
    })

    const DEFAULT_DOCUMENT_NAME = 'document.pdf'

    /**
     * The iframe source for a bound document or for Standalone Mode.
     * Standalone Mode never asks the Embedded App to turn its bridge on.
     */
    function frameSource(document) {
      if (document === null || document === undefined) return APP_PATH
      return `${APP_PATH}${BRIDGE_FRAME_QUERY}`
    }

    /** The host route that reports the conversation's binding. */
    function bindingUrl(sessionId) {
      return `${BINDING_PATH}?${new URLSearchParams({ session: sessionId }).toString()}`
    }

    /**
     * The conversation one Panel body belongs to. DSH's native seat passes
     * `sessionId`; better-sidebar passes its SessionScope under `scope`; a
     * caller with a Session object passes it under `session`.
     */
    function sessionIdOfPanelProps(props) {
      if (typeof props?.sessionId === 'string' && props.sessionId !== '') return props.sessionId
      if (typeof props?.scope?.sessionId === 'string' && props.scope.sessionId !== '') return props.scope.sessionId
      if (typeof props?.session?.id === 'string' && props.session.id !== '') return props.session.id
      return undefined
    }

    /** The host route that serves a Workspace Document and accepts its Write-back. */
    function documentUrl(sessionId, documentPath) {
      return `${DOCUMENT_PATH}?${new URLSearchParams({
        session: sessionId,
        path: documentPath,
      }).toString()}`
    }

    /** The host route that carries Panel open requests for one conversation. */
    function pushUrl(sessionId) {
      return `${PUSHES_PATH}?${new URLSearchParams({ session: sessionId }).toString()}`
    }

    /**
     * Read one Push Channel frame. Only a declared `open` for a named
     * conversation is accepted; a malformed frame is ignored rather than
     * allowed to open the Panel for the wrong conversation.
     */
    function decodePushEvent(data) {
      if (typeof data !== 'string') return undefined
      let value
      try {
        value = JSON.parse(data)
      } catch {
        return undefined
      }
      if (value === null || typeof value !== 'object' || value.type !== 'open') return undefined
      if (typeof value.sessionId !== 'string' || value.sessionId === '') return undefined
      const document = value.document !== null
        && typeof value.document === 'object'
        && typeof value.document.path === 'string'
        && value.document.path !== ''
        ? {
            path: value.document.path,
            name: typeof value.document.name === 'string' && value.document.name !== ''
              ? value.document.name
              : value.document.path,
          }
        : null
      return {
        type: 'open',
        id: typeof value.id === 'string' ? value.id : '',
        sessionId: value.sessionId,
        document,
      }
    }

    /**
     * The Panel body's revision of a push: one per conversation. A request
     * that arrived while the body was not mounted still leaves the latest
     * revision here, so the first mount reads it and fetches the new binding.
     */
    function createOpenFeed() {
      let snapshot = { revision: 0, sessionId: '' }
      const listeners = new Set()
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

    /** A bridge message's bytes as a Uint8Array, accepting the two forms upstream sends. */
    function bridgeBytes(value) {
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      }
      if (value instanceof ArrayBuffer) return new Uint8Array(value)
      return undefined
    }

    /**
     * Read one postMessage event as a Host Bridge message, or undefined.
     * Only this origin, only this frame, and only the four declared messages.
     */
    function decodeBridgeMessage(event, expected = {}) {
      if (event === null || typeof event !== 'object') return undefined
      if (typeof expected.origin === 'string' && event.origin !== expected.origin) return undefined
      if (expected.source !== undefined && event.source !== expected.source) return undefined
      const data = event.data
      if (data === null || typeof data !== 'object') return undefined

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

    /**
     * One Panel's bridge state. A bound document waits for the frame's ready;
     * Standalone Mode never leaves `standalone`, so no bridge effect can run.
     */
    function initialBridgeState(document) {
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
    function reduceBridge(state, action) {
      switch (action.type) {
        case 'frame/ready':
          if (state.phase !== 'waiting-ready') return { state, effects: [] }
          return {
            state: { ...state, phase: 'loading', error: null },
            effects: [{ kind: 'load', path: state.document.path }],
          }
        case 'document/loaded':
          if (state.phase !== 'loading') return { state, effects: [] }
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
          if (state.phase !== 'loading') return { state, effects: [] }
          return { state: { ...state, phase: 'error', error: action.message }, effects: [] }
        case 'bridge/save':
          if (state.phase !== 'ready') return { state, effects: [] }
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
            effects: [],
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
            effects: [],
          }
        case 'write/failed':
          return {
            state: { ...state, phase: 'ready', pending: null, error: action.message },
            effects: [],
          }
        case 'panel/reload':
          if (state.phase !== 'conflict' && state.phase !== 'error') return { state, effects: [] }
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
          if (state.phase !== 'error') return { state, effects: [] }
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
          if (state.phase !== 'conflict' || state.pending === null) return { state, effects: [] }
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
          return { state: { ...state, error: null }, effects: [] }
        case 'bridge/dirty':
          return { state: { ...state, dirty: action.dirty === true }, effects: [] }
        case 'bridge/failed':
          return { state: { ...state, phase: 'error', error: action.message }, effects: [] }
        default:
          return { state, effects: [] }
      }
    }

    /**
     * Turn a host refusal into the plugin's own, localized copy. The size-limit
     * message names the limit; the host's English message is the fallback.
     *
     * The codes mirror `DOCUMENT_ERROR` in `lib/workspace-document.js`; this
     * classic bundle cannot import it, so keep the two lists in sync.
     */
    function describeDocumentFailure(failure, translate) {
      if (
        failure.code === 'workspace-document/too-large'
        && failure.details !== null
        && typeof failure.details === 'object'
        && typeof failure.details.limit === 'number'
      ) {
        return translate('error.tooLarge', { limit: failure.details.limit })
      }
      if (failure.code === 'workspace-document/outside-workspace') return translate('error.outside')
      if (failure.code === 'workspace-document/not-found') return translate('error.notFound')
      if (failure.code === 'workspace-document/not-loaded') return translate('error.notLoaded')
      if (failure.code === 'workspace-document/no-workspace') return translate('error.noWorkspace')
      if (typeof failure.message === 'string' && failure.message !== '') return failure.message
      return translate('error.load')
    }

    /**
     * Read one refusal's body without ever throwing. This runs on the save path,
     * where a body that is not the JSON the route promised would otherwise leave
     * the bridge stuck in `saving` with no message and no way to retry.
     */
    async function readFailure(response) {
      try {
        const payload = await response.json()
        if (payload !== null && typeof payload === 'object') return payload
      } catch {
        // Not JSON: fall through to the raw body.
      }
      try {
        return { message: await response.text() }
      } catch {
        return {}
      }
    }

    const NATIVE_PAGE_ID = 'dsh-pdfcraft:panel'
    const BODY_SLOT = 'sidebar.right.pane.tab'
    const TITLE_SLOT = 'sidebar.right.pane.tab.title'

    const EN = {
      'page.title': 'PdfCraft',
      'page.description': 'Open PdfCraft in the right sidebar.',
      'checking': 'Preparing PdfCraft…',
      'missing.title': 'PdfCraft web build not found',
      'missing.body':
        'Fetch {file} from the PdfCraft {release} release, extract it, then set the plugin\'s webBuildDir to the extracted folder.',
      'missing.directory': 'Currently configured:',
      'missing.retry': 'Check again',
      'standalone.notice': 'Standalone Mode — saves download and do not reach the workspace.',
      'error.title': 'Could not open this document',
      'error.binding': 'The harness did not report which document this conversation is bound to.',
      'error.network': 'The harness did not answer. Check the connection and try again.',
      'error.load': 'Could not read the document from the workspace.',
      'error.notFound': 'That document is no longer in the workspace.',
      'error.outside': 'That path is outside this conversation\'s workspace.',
      'error.tooLarge': 'This document is over the configured limit of {limit} bytes (maxDocumentBytes).',
      'error.notLoaded': 'Open this document in the Panel before saving it.',
      'error.noWorkspace': 'This conversation has no workspace to save into.',
      'error.retry': 'Try again',
      'error.dismiss': 'Dismiss',
      'conflict.title': 'This document changed on disk',
      'conflict.body':
        'It changed after the Panel loaded it. Reload to show the current file, or overwrite it with what is in the Panel.',
      'conflict.reload': 'Reload',
      'conflict.overwrite': 'Overwrite anyway',
    }

    const ZH = {
      'page.title': 'PdfCraft',
      'page.description': '在右侧边栏打开 PdfCraft。',
      'checking': '正在准备 PdfCraft…',
      'missing.title': '未找到 PdfCraft 网页版构建',
      'missing.body': '请从 PdfCraft {release} 发布页下载 {file}，解压后把插件的 webBuildDir 指向解压出的文件夹。',
      'missing.directory': '当前配置：',
      'missing.retry': '重新检查',
      'standalone.notice': '独立模式 — 保存的文件会下载，不会写回工作区。',
      'error.title': '无法打开此文档',
      'error.binding': 'Harness 未告知此对话绑定的文档。',
      'error.network': 'Harness 没有响应。请检查连接后重试。',
      'error.load': '无法从工作区读取该文档。',
      'error.notFound': '该文档已不在工作区中。',
      'error.outside': '该路径在此对话的工作区之外。',
      'error.tooLarge': '此文档超过了配置的上限 {limit} 字节（maxDocumentBytes）。',
      'error.notLoaded': '请先在 Panel 中打开此文档再保存。',
      'error.noWorkspace': '此对话没有可写入的工作区。',
      'error.retry': '重试',
      'error.dismiss': '关闭',
      'conflict.title': '此文档已在磁盘上更改',
      'conflict.body': '文档在 Panel 载入后发生了更改。选择重新载入以查看当前文件，或用 Panel 中的内容覆盖它。',
      'conflict.reload': '重新载入',
      'conflict.overwrite': '仍然覆盖',
    }

    const PANEL_STYLE = {
      width: '100%',
      height: '100%',
      minHeight: 0,
      margin: 0,
      padding: 0,
      border: 0,
      display: 'block',
      background: '#f1f1f3',
    }

    const STATE_STYLE = {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      fontSize: '13px',
      lineHeight: '1.6',
    }

    const CARD_STYLE = { maxWidth: '420px' }

    const HEADING_STYLE = {
      margin: '0 0 8px',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
    }

    const COPY_STYLE = {
      margin: '0 0 8px',
      color: 'var(--dsw-alias-label-secondary)',
    }

    const CODE_STYLE = {
      padding: '1px 5px',
      borderRadius: '4px',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      wordBreak: 'break-all',
    }

    const LINK_STYLE = { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none' }

    const BUTTON_STYLE = {
      marginTop: '4px',
      padding: '5px 12px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      cursor: 'pointer',
    }

    /** The frame and its plugin-owned overlays share one positioning box. */
    const FRAME_WRAP_STYLE = {
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: 0,
      margin: 0,
      padding: 0,
      overflow: 'hidden',
    }

    const OVERLAY_STYLE = {
      position: 'absolute',
      inset: 0,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'rgba(10, 12, 16, 0.38)',
    }

    const DIALOG_STYLE = {
      maxWidth: '420px',
      boxSizing: 'border-box',
      padding: '18px 20px',
      borderRadius: '10px',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
    }

    const BUTTON_ROW_STYLE = {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '12px',
    }

    const BANNER_STYLE = {
      position: 'absolute',
      left: '12px',
      right: '12px',
      bottom: '12px',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '10px 12px',
      borderRadius: '8px',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)',
      fontSize: '12px',
    }

    const NOTICE_STYLE = {
      position: 'absolute',
      top: '12px',
      left: '12px',
      padding: '4px 10px',
      borderRadius: '999px',
      background: 'rgba(25, 25, 28, 0.72)',
      color: '#f5f5f7',
      fontSize: '11px',
      lineHeight: '1.5',
      pointerEvents: 'none',
    }

    /** The right-sidebar glyph; the Plugin Manager artwork comes from icon.png. */
    function PdfCraftGlyph(props) {
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

    /** The stable locale subscription and translator one component tree needs. */
    function translationFace(ctx) {
      return {
        subscribe: (listener) => ctx.locale.subscribe(listener),
        snapshot: () => ctx.locale.getSnapshot(),
        bind: () => ctx.locale.bind(LOCALE_NS),
      }
    }

    /** Re-render on a DSH language change and return the bound translator. */
    function useTranslation(face) {
      React.useSyncExternalStore(face.subscribe, face.snapshot, face.snapshot)
      return face.bind()
    }

    function normalizeStatus(status) {
      if (status !== null && typeof status === 'object' && typeof status.ready === 'boolean') return status
      return {
        ready: false,
        file: WEB_BUILD_FILENAME,
        release: WEB_RELEASE,
        directory: '',
        releaseUrl: '',
      }
    }

    /** Read the binding route's payload as a Workspace Document, or null for Standalone Mode. */
    function normalizeBinding(payload) {
      if (
        payload === null
        || typeof payload !== 'object'
        || payload.document === null
        || typeof payload.document !== 'object'
        || typeof payload.document.path !== 'string'
        || payload.document.path === ''
      ) {
        return null
      }
      return {
        path: payload.document.path,
        name: typeof payload.document.name === 'string' && payload.document.name !== ''
          ? payload.document.name
          : payload.document.path,
      }
    }

    /** The sidebar controller when the host has one, probed without injecting it. */
    function sidebarControllerOf(ctx) {
      let right
      try {
        right = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
      } catch {
        right = undefined
      }
      right ??= ctx.sidebarRight
      return right ?? undefined
    }

    /**
     * Open the Panel for one conversation, but only while that conversation is
     * the one on screen: the controller's open call is valid for the mounted
     * Session alone. `false` means the request must wait.
     */
    function openPanelAt(right, sessionId) {
      if (right === undefined || right === null) return false
      let mounted
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
        console.warn?.(`dsh-pdfcraft: could not open the Panel for ${sessionId}:`, error?.message ?? error)
        return false
      }
    }

    /**
     * Hold one Push Channel stream for the conversation on screen. A request
     * for another conversation is not read until that conversation's stream is
     * attached, so nothing is opened behind the person's back.
     *
     * @param {object} right - the `sidebarRight` controller.
     * @param {ReturnType<typeof createOpenFeed>} feed - revisions the Panel reads.
     * @returns {() => void} closes the stream and releases the subscription.
     */
    function startPushSource(right, feed) {
      let source
      let sessionId
      let disposed = false

      const stopSource = () => {
        if (source === undefined) return
        try {
          source.close()
        } catch {
          // A source already closed by the browser is harmless.
        }
        source = undefined
      }

      const receive = (event) => {
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

      const sync = () => {
        if (disposed) return
        let mounted
        try {
          mounted = right.mounted?.getSnapshot?.()
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
          console.warn?.(`dsh-pdfcraft: could not hold the Push Channel for ${sessionId}:`, error?.message ?? error)
        }
      }

      let unsubscribe
      try {
        unsubscribe = right.mounted?.subscribe?.(sync)
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
     *
     * @param {object} ctx - client context carrying the locale service.
     */
    function createPanel(ctx) {
      const face = translationFace(ctx)

      return function PdfCraftPanel(props) {
        // Without a conversation there is nothing to bind, so the Panel stays
        // standalone; with one, its binding decides between the two modes.
        const sessionId = sessionIdOfPanelProps(props)

        const [attempt, setAttempt] = React.useState(0)
        const [check, setCheck] = React.useState({ phase: 'checking', status: null })
        const [binding, setBinding] = React.useState({
          phase: sessionId === undefined ? 'standalone' : 'checking',
          document: null,
        })
        const [epoch, setEpoch] = React.useState(0)
        const [bridge, setBridge] = React.useState(() => initialBridgeState(null))
        const frameRef = React.useRef(null)
        const stateRef = React.useRef(bridge)
        const openState = React.useSyncExternalStore(
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

        React.useEffect(() => {
          let live = true
          const settle = (next) => {
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
            .then((status) => {
              const read = normalizeStatus(status)
              settle({ phase: read.ready ? 'ready' : 'missing', status: read })
            })
            .catch(() => settle({ phase: 'missing', status: null }))

          return () => {
            live = false
          }
        }, [attempt])

        React.useEffect(() => {
          if (sessionId === undefined) {
            setBinding({ phase: 'standalone', document: null })
            return undefined
          }

          let live = true
          setBinding({ phase: 'checking', document: null })
          fetch(bindingUrl(sessionId), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
          })
            .then((response) => {
              if (!response.ok) throw new Error(`binding ${response.status}`)
              return response.json()
            })
            .then((payload) => {
              if (!live) return
              const document = normalizeBinding(payload)
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
        React.useEffect(() => {
          if (sessionId === undefined || pushedRevision === 0) return undefined
          let live = true
          fetch(bindingUrl(sessionId), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
          })
            .then((response) => {
              if (!response.ok) throw new Error(`binding ${response.status}`)
              return response.json()
            })
            .then((payload) => {
              if (!live) return
              const document = normalizeBinding(payload)
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
        React.useEffect(() => {
          const next = initialBridgeState(boundDocument)
          stateRef.current = next
          setBridge(next)
        }, [documentPath, epoch, binding.phase])

        React.useEffect(() => {
          if (binding.phase !== 'bound') return undefined

          const onMessage = (event) => {
            const message = decodeBridgeMessage(event, {
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
        function runEffect(effect) {
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

        function dispatchBridge(action) {
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
        function postToApp(name, bytes) {
          const frame = frameRef.current
          if (frame === null || frame === undefined || frame.contentWindow === null) return
          const copy = new Uint8Array(bytes)
          try {
            frame.contentWindow.postMessage(
              { type: BRIDGE_MESSAGE.OPEN, name, bytes: copy },
              window.location.origin,
              [copy.buffer],
            )
          } catch {
            // A frame replaced mid-handshake cannot receive; its next ready retries.
          }
        }

        async function loadFromWorkspace(path) {
          let response
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

          let bytes
          try {
            bytes = new Uint8Array(await response.arrayBuffer())
          } catch {
            dispatchBridge({ type: 'document/failed', message: face.bind()('error.load') })
            return
          }

          dispatchBridge({
            type: 'document/loaded',
            bytes,
            revision: response.headers.get('x-pdfcraft-revision') ?? '',
          })
        }

        async function writeToWorkspace(effect) {
          const headers = {
            'content-type': 'application/pdf',
            accept: 'application/json',
            'x-pdfcraft-revision': effect.revision,
          }
          if (effect.force) headers['x-pdfcraft-force'] = '1'

          let response
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
            if (failure.code === 'workspace-document/revision-conflict') {
              dispatchBridge({
                type: 'write/conflicted',
                message: failure.message,
                currentRevision: typeof failure.details?.currentRevision === 'string'
                  ? failure.details.currentRevision
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

          let payload = null
          try {
            payload = await response.json()
          } catch {
            payload = null
          }
          dispatchBridge({
            type: 'write/succeeded',
            revision: payload !== null && typeof payload.revision === 'string'
              ? payload.revision
              : effect.revision,
          })
        }

        const retry = () => {
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
    function createTitle(ctx) {
      const face = translationFace(ctx)

      return function PdfCraftTitle() {
        const t = useTranslation(face)
        return t('page.title')
      }
    }

    /** BetterSidebar Registration: one page published through the service. */
    function publishBetterSidebarRegistration(ctx, service) {
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
    function publishNativeRegistration(ctx) {
      const title = () => ctx.locale.bind(LOCALE_NS)('page.title')
      const description = () => ctx.locale.bind(LOCALE_NS)('page.description')
      const disposers = []

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

    return {
      name: 'dsh-pdfcraft',
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      // Cordis reads `name`, `inject` and `apply`; the Node seam test also
      // drives the pure Host Bridge protocol and the Push Channel framing
      // from here.
      bridgeProtocol: {
        BRIDGE_MESSAGE,
        frameSource,
        bindingUrl,
        documentUrl,
        decodeBridgeMessage,
        initialBridgeState,
        reduceBridge,
        readFailure,
        describeDocumentFailure,
        sessionIdOfPanelProps,
      },
      pushProtocol: {
        PUSHES_PATH,
        pushUrl,
        decodePushEvent,
      },
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { en: EN, zh: ZH }),
          'dsh-pdfcraft: dictionaries',
        )

        // The Push Channel stream exists for the conversation on screen, not
        // for the Panel only: the Panel may still be closed when the agent
        // asks for it. A request for another conversation waits on the host.
        ctx.effect(() => {
          const right = sidebarControllerOf(ctx)
          if (right === undefined) return undefined
          return startPushSource(right, openFeed)
        }, 'dsh-pdfcraft: Push Channel stream')

        // The two publication paths are alternatives, never both: better-sidebar
        // itself registers a native page for every tab type, so also registering
        // here would put two entries in one column. The service is usually present
        // at activation; when it is not, the native page covers profiles without
        // better-sidebar and is withdrawn if the service arrives later.
        const betterSidebar = ctx.get('betterSidebar')
        if (betterSidebar !== undefined && betterSidebar !== null) {
          publishBetterSidebarRegistration(ctx, betterSidebar)
          return
        }

        const withdrawNative = publishNativeRegistration(ctx)
        ctx.inject(['betterSidebar'], (scoped) => {
          const service = scoped.get('betterSidebar')
          if (service === undefined || service === null) return
          withdrawNative()
          publishBetterSidebarRegistration(scoped, service)
        })
      },
    }
  },
})
