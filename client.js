/**
 * Browser half of dsh-pdfcraft.
 *
 * Registers exactly one right-sidebar page for the PdfCraft Embedded App. The
 * page is published through the better-sidebar service when that service is
 * present, and otherwise as a page type of DSH's own right sidebar; the two
 * paths share one page identity (`PAGE_KIND`) and are never both taken.
 *
 * The Panel is the frame and nothing else: PdfCraft owns its own chrome,
 * appearance and language. Only the plugin's own waiting/missing copy is
 * translated through the DSH locale service.
 *
 * The locale namespace, page kind, addresses, release version, and web-build
 * filename are mirrored from `lib/paths.js` and `locale/*.json`; this file is a
 * self-contained classic script because the shell's module loader receives one
 * bundle per package.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pdfcraft',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared with lib/paths.js. */
    const LOCALE_NS = 'pdfcraft'
    const PAGE_KIND = 'pdfcraft'
    const APP_PATH = '/pdfcraft/'
    const STATUS_PATH = '/pdfcraft/status'
    const WEB_RELEASE = '0.9.0'
    const WEB_BUILD_FILENAME = `pdfcraft-web-${WEB_RELEASE}.zip`

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
    }

    const ZH = {
      'page.title': 'PdfCraft',
      'page.description': '在右侧边栏打开 PdfCraft。',
      'checking': '正在准备 PdfCraft…',
      'missing.title': '未找到 PdfCraft 网页版构建',
      'missing.body': '请从 PdfCraft {release} 发布页下载 {file}，解压后把插件的 webBuildDir 指向解压出的文件夹。',
      'missing.directory': '当前配置：',
      'missing.retry': '重新检查',
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

    /** The right-sidebar glyph; the Plugin Manager artwork comes from icon.svg. */
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

    /**
     * One Panel component, closed over the context that owns its registration.
     * @param {object} ctx - client context carrying the locale service.
     */
    function createPanel(ctx) {
      const face = translationFace(ctx)

      return function PdfCraftPanel() {
        const [attempt, setAttempt] = React.useState(0)
        const [check, setCheck] = React.useState({ phase: 'checking', status: null })

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

        if (check.phase === 'ready') {
          return h('iframe', {
            src: APP_PATH,
            title: t('page.title'),
            allow: 'fullscreen; clipboard-read; clipboard-write',
            allowFullScreen: true,
            style: PANEL_STYLE,
          })
        }

        if (check.phase === 'checking') {
          return h('div', { style: STATE_STYLE }, h('div', { style: CARD_STYLE }, t('checking')))
        }

        const status = normalizeStatus(check.status)
        const directory = typeof status.directory === 'string' ? status.directory.trim() : ''
        const retry = () => {
          setCheck({ phase: 'checking', status: null })
          setAttempt((value) => value + 1)
        }

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
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { en: EN, zh: ZH }),
          'dsh-pdfcraft: dictionaries',
        )

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
