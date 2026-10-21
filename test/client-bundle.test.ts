/**
 * The built browser bundle, loaded the way the shell loads it.
 *
 * This is the one test that goes through the real `__ModuleLoader__` envelope
 * in `dist/web/client.js`; a broken wrapper, id, or factory shape fails here
 * instead of in the Panel. The decisions themselves are tested directly from
 * `protocol.ts`; the React stub below never renders a component.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import type { ClientContext, BetterSidebarTab, NativeTabDefinition } from '../src/web/client/context.ts'

/** A minimal React stand-in: the client module defines components but these tests never render them. */
const React = {
  createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial }),
  useSyncExternalStore: (_subscribe: () => void, snapshot: () => unknown) => snapshot(),
}

/** The plugin object the bundle's factory returns. */
interface LoadedPlugin {
  readonly name: string
  readonly inject: string[]
  apply(ctx: ClientContext): void
}

/** A module-loader record. */
interface LoaderRecord {
  readonly id: string
  factory(require: (request: string) => unknown): LoadedPlugin
}

/**
 * The browser bundle is a classic script that hands a factory to the shell's
 * module loader. Evaluate it the way the shell would and keep the factory.
 */
let cachedPlugin: LoadedPlugin | undefined
async function loadClientPlugin(): Promise<LoadedPlugin> {
  if (cachedPlugin !== undefined) return cachedPlugin
  const source = await readFile(new URL('../dist/web/client.js', import.meta.url), 'utf8')
  let record: LoaderRecord | undefined
  const window = { __ModuleLoader__: { load: (value: LoaderRecord) => { record = value } } }
  new Function('window', source)(window)
  assert.ok(record, 'dist/web/client.js must register a factory with the module loader')
  assert.equal(record.id, 'dsh-pdfcraft')
  cachedPlugin = record.factory((request) => {
    if (request === 'react') return React
    throw new Error(`unexpected module request ${request}`)
  })
  return cachedPlugin
}

/** A recording client context with the services the plugin may use. */
function createClientContext({ betterSidebar }: { betterSidebar?: boolean } = {}) {
  const registered = {
    tabs: [] as Array<BetterSidebarTab & { removed?: boolean }>,
    types: [] as Array<NativeTabDefinition & { removed?: boolean }>,
    slotEntries: [] as Array<{ options: { name: string; key: string; locale: string }; component: unknown }>,
    locales: [] as Array<{ namespace: string; dicts: { en: Record<string, string>; zh: Record<string, string> } }>,
    disposers: [] as Array<() => unknown>,
    injects: [] as Array<{ deps: string[]; callback: (scoped: ClientContext) => void }>,
    opened: [] as string[],
  }
  let active = 'en'
  const dictionaries: Record<string, Record<string, Record<string, string>>> = {}
  let mountedSession: string | undefined
  const mountedListeners = new Set<() => void>()

  const locale = {
    register(namespace: string, dicts: { en: Record<string, string>; zh: Record<string, string> }) {
      dictionaries[namespace] = dicts
      registered.locales.push({ namespace, dicts })
      return () => {}
    },
    bind(namespace: string) {
      return (key: string, params?: Record<string, string | number>) => {
        const template = dictionaries[namespace]?.[active]?.[key]
          ?? dictionaries[namespace]?.en?.[key]
          ?? key
        return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
      }
    },
    getSnapshot: () => ({ active, locales: [{ id: 'en' }, { id: 'zh' }], revision: 1 }),
    subscribe: () => () => {},
    setActive(next: string) {
      active = next
    },
  }

  const slots = {
    inject(name: string, callback: () => () => void) {
      assert.equal(typeof name, 'string')
      const dispose = callback()
      assert.equal(typeof dispose, 'function')
      registered.disposers.push(dispose)
      return dispose
    },
    register(
      options: { name: string; key: string; locale: string },
      component: unknown,
    ) {
      registered.slotEntries.push({ options, component })
      return () => {}
    },
  }

  const sidebarRightTabs = {
    register(definition: NativeTabDefinition) {
      registered.types.push(definition)
      return () => { (definition as NativeTabDefinition & { removed?: boolean }).removed = true }
    },
  }

  const service = betterSidebar === undefined
    ? undefined
    : {
        registerTab(descriptor: BetterSidebarTab) {
          registered.tabs.push(descriptor)
          return () => { (descriptor as BetterSidebarTab & { removed?: boolean }).removed = true }
        },
      }

  const sidebarRight = {
    mounted: {
      getSnapshot: () => mountedSession,
      subscribe(listener: () => void) {
        mountedListeners.add(listener)
        return () => mountedListeners.delete(listener)
      },
    },
    openTab(kind: string) {
      registered.opened.push(kind)
    },
    setMounted(sessionId: string | undefined) {
      mountedSession = sessionId
      for (const listener of mountedListeners) listener()
    },
  }

  const ctx = {
    slots,
    locale,
    sidebarRight,
    sidebarRightTabs,
    get: (name: string) => {
      if (name === 'betterSidebar') return service
      if (name === 'sidebarRight') return sidebarRight
      return undefined
    },
    effect(body: () => (() => unknown) | undefined) {
      const dispose = body()
      registered.disposers.push(dispose ?? (() => {}))
      return dispose
    },
    inject(deps: string[], callback: (scoped: ClientContext) => void) {
      registered.injects.push({ deps, callback })
      return () => {}
    },
  }

  return { ctx: ctx as unknown as ClientContext, registered, locale, sidebarRight }
}

test('with the better-sidebar service, publishes exactly one page through it', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered } = createClientContext({ betterSidebar: true })
  plugin.apply(ctx)

  assert.equal(registered.tabs.length, 1, 'one tab registered through better-sidebar')
  assert.equal(registered.types.length, 0, 'no native tab type registered beside it')
  assert.equal(registered.slotEntries.length, 0, 'no native body registered beside it')

  const tab = registered.tabs[0]
  assert.ok(tab)
  assert.equal(tab.id, 'pdfcraft')
  assert.equal(tab.single, true)
  assert.equal(typeof tab.component, 'function')
  assert.equal(tab.title(), 'PdfCraft')
  assert.match(tab.description(), /right sidebar/i)

  assert.equal(registered.locales.length, 1)
  assert.equal(registered.locales[0]?.namespace, 'pdfcraft')
  assert.ok(registered.locales[0]?.dicts.en['page.title'])
  assert.ok(registered.locales[0]?.dicts.zh['page.title'])
})

test('without the better-sidebar service, publishes exactly one native right-sidebar page', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered } = createClientContext()
  plugin.apply(ctx)

  assert.equal(registered.tabs.length, 0, 'nothing registered through an absent service')
  assert.equal(registered.types.length, 1, 'one native page type registered')

  const type = registered.types[0]
  assert.ok(type)
  assert.equal(type.kind, 'pdfcraft')
  assert.notEqual((type as NativeTabDefinition & { multiple?: boolean }).multiple, true, 'the page is single-instance')
  assert.equal(type.guide.length, 1)
  assert.equal(type.guide[0]?.title(), 'PdfCraft')
  assert.match(type.guide[0]?.description() ?? '', /right sidebar/i)

  const bodies = registered.slotEntries.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
  const titles = registered.slotEntries.filter((entry) => entry.options.name === 'sidebar.right.pane.tab.title')
  assert.equal(bodies.length, 1)
  assert.equal(titles.length, 1)
  assert.equal(bodies[0]?.options.key, type.id)
  assert.equal(titles[0]?.options.key, type.id)
  assert.equal(typeof bodies[0]?.component, 'function')
  assert.equal(typeof titles[0]?.component, 'function')
})

test('uses the same page identity on both registration paths', async () => {
  const plugin = await loadClientPlugin()

  const better = createClientContext({ betterSidebar: true })
  plugin.apply(better.ctx)
  const native = createClientContext()
  plugin.apply(native.ctx)

  assert.equal(better.registered.tabs[0]?.id, native.registered.types[0]?.kind)
})

test('the plugin copy follows the DSH language', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered, locale } = createClientContext()
  plugin.apply(ctx)

  const type = registered.types[0]
  assert.ok(type)
  assert.match(type.guide[0]?.description() ?? '', /right sidebar/i)
  locale.setActive('zh')
  assert.match(type.guide[0]?.description() ?? '', /右侧边栏/)
  assert.equal(type.guide[0]?.title(), 'PdfCraft')
})

test('switches from the native page when better-sidebar arrives after activation', async () => {
  const plugin = await loadClientPlugin()
  const native = createClientContext()
  plugin.apply(native.ctx)

  assert.equal(native.registered.types.length, 1)
  assert.equal(native.registered.injects.length, 1)
  assert.deepEqual(native.registered.injects[0]?.deps, ['betterSidebar'])

  const better = createClientContext({ betterSidebar: true })
  native.registered.injects[0]?.callback(better.ctx)

  assert.equal(native.registered.types[0]?.removed, true, 'the native page type is withdrawn')
  assert.equal(better.registered.tabs.length, 1, 'the page moves to the service exactly once')
  assert.equal(native.registered.tabs.length, 0)
})

test('withdrawing the plugin releases every registration it made', async () => {
  const plugin = await loadClientPlugin()

  const better = createClientContext({ betterSidebar: true })
  plugin.apply(better.ctx)
  for (const dispose of better.registered.disposers) dispose()
  assert.equal(better.registered.tabs[0]?.removed, true)

  const native = createClientContext()
  plugin.apply(native.ctx)
  for (const dispose of native.registered.disposers) dispose()
  assert.equal(native.registered.types[0]?.removed, true)
})

/** The handle a test needs on a fake EventSource. */
interface FakeEventSourceHandle {
  readonly url: string
  readonly closed: boolean
  addEventListener(type: string, listener: (event: { data: string }) => void): void
  close(): void
  emit(data: string): void
}

/** A browser-shaped EventSource the push tests can drive. */
function withFakeEventSource<T>(run: (sources: FakeEventSourceHandle[]) => Promise<T>): Promise<T> {
  const sources: FakeEventSource[] = []
  const target = globalThis as unknown as { EventSource?: unknown }
  const original = target.EventSource
  class FakeEventSource {
    readonly url: string
    closed = false
    readonly listeners = new Map<string, Array<(event: { data: string }) => void>>()

    constructor(url: string) {
      this.url = url
      sources.push(this)
    }

    addEventListener(type: string, listener: (event: { data: string }) => void) {
      const registered = this.listeners.get(type) ?? []
      registered.push(listener)
      this.listeners.set(type, registered)
    }

    close() {
      this.closed = true
    }

    emit(data: string) {
      for (const listener of this.listeners.get('message') ?? []) listener({ data })
    }
  }
  target.EventSource = FakeEventSource
  const finish = (): void => {
    if (original === undefined) delete target.EventSource
    else target.EventSource = original
  }
  return run(sources).finally(finish)
}

test('a push opens the Panel only for the conversation on screen', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, registered, sidebarRight } = createClientContext()
  plugin.apply(ctx)

  await withFakeEventSource(async (sources) => {
    sidebarRight.setMounted('session-one')
    assert.equal(sources.length, 1, 'one Push Channel view for the on-screen conversation')
    assert.match(sources[0]?.url ?? '', /\/pdfcraft\/pushes\?session=session-one$/)

    sources[0]?.emit(JSON.stringify({
      type: 'open',
      id: 'open-one',
      sessionId: 'session-one',
      document: { path: 'report.pdf', name: 'report.pdf' },
    }))
    assert.deepEqual(registered.opened, ['pdfcraft'])

    sources[0]?.emit(JSON.stringify({ type: 'open', sessionId: 'session-two', document: null }))
    sources[0]?.emit('not json')
    assert.deepEqual(registered.opened, ['pdfcraft'], 'a frame for another conversation opens nothing')

    sidebarRight.setMounted('session-two')
    assert.equal(sources[0]?.closed, true, 'the old view is closed')
    assert.equal(sources.length, 2, 'the new conversation gets its own view')
    assert.match(sources[1]?.url ?? '', /session=session-two$/)
  })
})
