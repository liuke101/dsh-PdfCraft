import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** A minimal React stand-in: the client module defines components but these tests never render them. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}

/**
 * The browser bundle is a classic script that hands a factory to the shell's
 * module loader. Evaluate it the way the shell would and keep the factory.
 */
let cachedPlugin
async function loadClientPlugin() {
  if (cachedPlugin !== undefined) return cachedPlugin
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let record
  const window = { __ModuleLoader__: { load: (value) => { record = value } } }
  new Function('window', source)(window)
  assert.ok(record, 'client.js must register a factory with the module loader')
  assert.equal(record.id, 'dsh-pdfcraft')
  cachedPlugin = record.factory((request) => {
    if (request === 'react') return React
    throw new Error(`unexpected module request ${request}`)
  })
  return cachedPlugin
}

/** A recording client context with the services the plugin may use. */
function createClientContext({ betterSidebar } = {}) {
  const registered = {
    tabs: [],
    types: [],
    slotEntries: [],
    locales: [],
    disposers: [],
    injects: [],
    opened: [],
  }
  let active = 'en'
  const dictionaries = {}
  let mountedSession
  const mountedListeners = new Set()

  const locale = {
    register(namespace, dicts) {
      dictionaries[namespace] = dicts
      registered.locales.push({ namespace, dicts })
      return () => {}
    },
    bind(namespace) {
      return (key, params) => {
        const template = dictionaries[namespace]?.[active]?.[key]
          ?? dictionaries[namespace]?.en?.[key]
          ?? key
        return template.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
      }
    },
    getSnapshot: () => ({ active, locales: [{ id: 'en' }, { id: 'zh' }], revision: 1 }),
    subscribe: () => () => {},
    setActive(next) {
      active = next
    },
  }

  const slots = {
    inject(name, callback) {
      assert.equal(typeof name, 'string')
      const dispose = callback()
      assert.equal(typeof dispose, 'function')
      registered.disposers.push(dispose)
      return dispose
    },
    register(options, component) {
      registered.slotEntries.push({ options, component })
      return () => {}
    },
  }

  const sidebarRightTabs = {
    register(definition) {
      registered.types.push(definition)
      return () => { definition.removed = true }
    },
  }

  const service = betterSidebar === undefined
    ? undefined
    : {
        registerTab(descriptor) {
          registered.tabs.push(descriptor)
          return () => { descriptor.removed = true }
        },
      }

  const sidebarRight = {
    mounted: {
      getSnapshot: () => mountedSession,
      subscribe(listener) {
        mountedListeners.add(listener)
        return () => mountedListeners.delete(listener)
      },
    },
    openTab(kind) {
      registered.opened.push(kind)
    },
    setMounted(sessionId) {
      mountedSession = sessionId
      for (const listener of mountedListeners) listener()
    },
  }

  const ctx = {
    slots,
    locale,
    sidebarRight,
    sidebarRightTabs,
    get: (name) => {
      if (name === 'betterSidebar') return service
      if (name === 'sidebarRight') return sidebarRight
      return undefined
    },
    effect(body, _label) {
      const dispose = body()
      registered.disposers.push(dispose)
      return dispose
    },
    inject(deps, callback) {
      registered.injects.push({ deps, callback })
      return () => {}
    },
  }

  return { ctx, registered, locale, sidebarRight }
}

test('with the better-sidebar service, publishes exactly one page through it', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered } = createClientContext({ betterSidebar: true })
  plugin.apply(ctx)

  assert.equal(registered.tabs.length, 1, 'one tab registered through better-sidebar')
  assert.equal(registered.types.length, 0, 'no native tab type registered beside it')
  assert.equal(registered.slotEntries.length, 0, 'no native body registered beside it')

  const tab = registered.tabs[0]
  assert.equal(tab.id, 'pdfcraft')
  assert.equal(tab.single, true)
  assert.equal(typeof tab.component, 'function')
  assert.equal(tab.title(), 'PdfCraft')
  assert.match(tab.description(), /right sidebar/i)

  assert.equal(registered.locales.length, 1)
  assert.equal(registered.locales[0].namespace, 'pdfcraft')
  assert.ok(registered.locales[0].dicts.en['page.title'])
  assert.ok(registered.locales[0].dicts.zh['page.title'])
})

test('without the better-sidebar service, publishes exactly one native right-sidebar page', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered } = createClientContext()
  plugin.apply(ctx)

  assert.equal(registered.tabs.length, 0, 'nothing registered through an absent service')
  assert.equal(registered.types.length, 1, 'one native page type registered')

  const type = registered.types[0]
  assert.equal(type.kind, 'pdfcraft')
  assert.notEqual(type.multiple, true, 'the page is single-instance')
  assert.equal(type.guide.length, 1)
  assert.equal(type.guide[0].title(), 'PdfCraft')
  assert.match(type.guide[0].description(), /right sidebar/i)

  const bodies = registered.slotEntries.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
  const titles = registered.slotEntries.filter((entry) => entry.options.name === 'sidebar.right.pane.tab.title')
  assert.equal(bodies.length, 1)
  assert.equal(titles.length, 1)
  assert.equal(bodies[0].options.key, type.id)
  assert.equal(titles[0].options.key, type.id)
  assert.equal(typeof bodies[0].component, 'function')
  assert.equal(typeof titles[0].component, 'function')
})

test('uses the same page identity on both registration paths', async () => {
  const plugin = await loadClientPlugin()

  const better = createClientContext({ betterSidebar: true })
  plugin.apply(better.ctx)
  const native = createClientContext()
  plugin.apply(native.ctx)

  assert.equal(better.registered.tabs[0].id, native.registered.types[0].kind)
})

test('the plugin copy follows the DSH language', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered, locale } = createClientContext()
  plugin.apply(ctx)

  const type = registered.types[0]
  assert.match(type.guide[0].description(), /right sidebar/i)
  locale.setActive('zh')
  assert.match(type.guide[0].description(), /右侧边栏/)
  assert.equal(type.guide[0].title(), 'PdfCraft')
})

test('switches from the native page when better-sidebar arrives after activation', async () => {
  const plugin = await loadClientPlugin()
  const native = createClientContext()
  plugin.apply(native.ctx)

  assert.equal(native.registered.types.length, 1)
  assert.equal(native.registered.injects.length, 1)
  assert.deepEqual(native.registered.injects[0].deps, ['betterSidebar'])

  const better = createClientContext({ betterSidebar: true })
  native.registered.injects[0].callback(better.ctx)

  assert.equal(native.registered.types[0].removed, true, 'the native page type is withdrawn')
  assert.equal(better.registered.tabs.length, 1, 'the page moves to the service exactly once')
  assert.equal(native.registered.tabs.length, 0)
})

test('withdrawing the plugin releases every registration it made', async () => {
  const plugin = await loadClientPlugin()

  const better = createClientContext({ betterSidebar: true })
  plugin.apply(better.ctx)
  for (const dispose of better.registered.disposers) dispose()
  assert.equal(better.registered.tabs[0].removed, true)

  const native = createClientContext()
  plugin.apply(native.ctx)
  for (const dispose of native.registered.disposers) dispose()
  assert.equal(native.registered.types[0].removed, true)
})

/** A browser-shaped EventSource the push tests can drive. */
function withFakeEventSource(run) {
  const sources = []
  const original = globalThis.EventSource
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.listeners = new Map()
      sources.push(this)
    }

    addEventListener(type, listener) {
      const registered = this.listeners.get(type) ?? []
      registered.push(listener)
      this.listeners.set(type, registered)
    }

    close() {
      this.closed = true
    }

    emit(data) {
      for (const listener of this.listeners.get('message') ?? []) listener({ data })
    }
  }
  globalThis.EventSource = FakeEventSource
  try {
    return run(sources)
  } finally {
    if (original === undefined) delete globalThis.EventSource
    else globalThis.EventSource = original
  }
}

test('a push opens the Panel only for the conversation on screen', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered, sidebarRight } = createClientContext()
  plugin.apply(ctx)

  await withFakeEventSource((sources) => {
    sidebarRight.setMounted('session-one')
    assert.equal(sources.length, 1, 'one Push Channel view for the on-screen conversation')
    assert.match(sources[0].url, /\/pdfcraft\/pushes\?session=session-one$/)

    sources[0].emit(JSON.stringify({
      type: 'open',
      id: 'open-one',
      sessionId: 'session-one',
      document: { path: 'report.pdf', name: 'report.pdf' },
    }))
    assert.deepEqual(registered.opened, ['pdfcraft'])

    sources[0].emit(JSON.stringify({ type: 'open', sessionId: 'session-two', document: null }))
    sources[0].emit('not json')
    assert.deepEqual(registered.opened, ['pdfcraft'], 'a frame for another conversation opens nothing')

    sidebarRight.setMounted('session-two')
    assert.equal(sources[0].closed, true, 'the old view is closed')
    assert.equal(sources.length, 2, 'the new conversation gets its own view')
    assert.match(sources[1].url, /session=session-two$/)
  })
})

test('the push protocol names one route per conversation and rejects malformed frames', async () => {
  const plugin = await loadClientPlugin()
  const { pushProtocol } = plugin

  assert.equal(pushProtocol.pushUrl('a b'), '/pdfcraft/pushes?session=a+b')
  assert.deepEqual(pushProtocol.decodePushEvent('{"type":"open","sessionId":"s","document":null}'), {
    type: 'open',
    id: '',
    sessionId: 's',
    document: null,
  })
  assert.equal(pushProtocol.decodePushEvent('{"type":"other","sessionId":"s"}'), undefined)
  assert.equal(pushProtocol.decodePushEvent('{"type":"open"}'), undefined)
  assert.equal(pushProtocol.decodePushEvent('{'), undefined)
})

test('the Panel reads the conversation from either sidebar seat', async () => {
  const plugin = await loadClientPlugin()
  const { sessionIdOfPanelProps } = plugin.bridgeProtocol

  assert.equal(sessionIdOfPanelProps({ sessionId: 'native' }), 'native')
  assert.equal(sessionIdOfPanelProps({ scope: { sessionId: 'better' } }), 'better')
  assert.equal(sessionIdOfPanelProps({ session: { id: 'session-object' } }), 'session-object')
  assert.equal(sessionIdOfPanelProps({ scope: { sessionId: 'better' }, sessionId: 'native' }), 'native')
  assert.equal(sessionIdOfPanelProps({}), undefined)
})
