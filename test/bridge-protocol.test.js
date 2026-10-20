import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The browser half is a classic script that hands the shell a factory. Evaluate
 * it the way the shell would, materialize the factory once, and read the pure
 * Host Bridge protocol it exposes so these decisions can be driven from Node
 * without a DOM.
 */
async function loadBridgeProtocol() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let record
  const window = { __ModuleLoader__: { load: (value) => { record = value } } }
  new Function('window', source)(window)
  assert.ok(record, 'client.js must register a factory with the module loader')
  assert.equal(record.id, 'dsh-pdfcraft')

  // The factory only needs React's createElement while defining components;
  // no component is rendered here.
  const React = { createElement: () => undefined }
  const plugin = record.factory((request) => {
    if (request === 'react') return React
    throw new Error(`unexpected module request ${request}`)
  })
  assert.ok(plugin.bridgeProtocol, 'the Host Bridge protocol is exposed for the Node seam test')
  return plugin.bridgeProtocol
}

const BYTES = new TextEncoder().encode('%PDF-1.4\nbridge\n')

/** A frame the app would post from. */
const FRAME = { postMessage() {} }
const ORIGIN = 'http://127.0.0.1:3080'

function event(data, overrides = {}) {
  return { data, origin: ORIGIN, source: FRAME, ...overrides }
}

test('Standalone Mode never turns the Host Bridge on', async () => {
  const bridge = await loadBridgeProtocol()

  assert.equal(bridge.frameSource(null), '/pdfcraft/')
  assert.equal(bridge.frameSource(undefined), '/pdfcraft/')
  assert.equal(bridge.frameSource({ path: 'docs/report.pdf', name: 'report.pdf' }), '/pdfcraft/?host=parent')

  const standalone = bridge.initialBridgeState(null)
  assert.equal(standalone.phase, 'standalone')

  // Even a ready message that somehow arrives cannot start a bridge effect.
  const stepped = bridge.reduceBridge(standalone, { type: 'frame/ready' })
  assert.equal(stepped.state.phase, 'standalone')
  assert.deepEqual(stepped.effects, [])
})

test('the host routes carry the conversation and document path encoded', async () => {
  const bridge = await loadBridgeProtocol()

  const binding = new URL(bridge.bindingUrl('session one'), 'http://dsh.internal')
  assert.equal(binding.pathname, '/pdfcraft/binding')
  assert.equal(binding.searchParams.get('session'), 'session one')

  const document = new URL(bridge.documentUrl('session one', 'docs/report 1.pdf'), 'http://dsh.internal')
  assert.equal(document.pathname, '/pdfcraft/document')
  assert.equal(document.searchParams.get('session'), 'session one')
  assert.equal(document.searchParams.get('path'), 'docs/report 1.pdf')
})

test('only this origin, this frame, and the declared messages are read', async () => {
  const bridge = await loadBridgeProtocol()
  const expected = { origin: ORIGIN, source: FRAME }

  assert.equal(bridge.decodeBridgeMessage(event({ type: 'pdfcraft:ready' }, { origin: 'http://evil.example' }), expected), undefined)
  assert.equal(bridge.decodeBridgeMessage(event({ type: 'pdfcraft:ready' }, { source: {} }), expected), undefined)
  assert.equal(bridge.decodeBridgeMessage(event(null), expected), undefined)
  assert.equal(bridge.decodeBridgeMessage(event({ type: 'pdfcraft:unexpected' }), expected), undefined)

  assert.deepEqual(
    bridge.decodeBridgeMessage(event({ type: 'pdfcraft:ready', version: '0.9.0' }), expected),
    { type: 'ready', version: '0.9.0' },
  )

  const saved = bridge.decodeBridgeMessage(event({
    type: 'pdfcraft:save',
    name: 'report.pdf',
    saveAs: false,
    bytes: BYTES,
  }), expected)
  assert.equal(saved.type, 'save')
  assert.equal(saved.name, 'report.pdf')
  assert.equal(saved.saveAs, false)
  assert.deepEqual([...saved.bytes], [...BYTES])

  const asBuffer = bridge.decodeBridgeMessage(event({
    type: 'pdfcraft:save',
    bytes: BYTES.buffer,
  }), expected)
  assert.equal(asBuffer.name, 'document.pdf')
  assert.deepEqual([...asBuffer.bytes], [...BYTES])

  assert.equal(bridge.decodeBridgeMessage(event({ type: 'pdfcraft:save', bytes: new Uint8Array() }), expected), undefined)
  assert.deepEqual(
    bridge.decodeBridgeMessage(event({ type: 'pdfcraft:dirty', dirty: true }), expected),
    { type: 'dirty', dirty: true },
  )
  assert.deepEqual(
    bridge.decodeBridgeMessage(event({ type: 'pdfcraft:failed', error: 'no WebGL' }), expected),
    { type: 'failed', error: 'no WebGL' },
  )
})

test('a save is guarded by the revision the document was loaded with', async () => {
  const bridge = await loadBridgeProtocol()
  const document = { path: 'docs/report.pdf', name: 'report.pdf' }

  let state = bridge.initialBridgeState(document)
  assert.equal(state.phase, 'waiting-ready')

  let step = bridge.reduceBridge(state, { type: 'frame/ready' })
  assert.equal(step.state.phase, 'loading')
  assert.deepEqual(step.effects, [{ kind: 'load', path: 'docs/report.pdf' }])

  step = bridge.reduceBridge(step.state, {
    type: 'document/loaded',
    bytes: BYTES,
    revision: 'abc123',
  })
  state = step.state
  assert.equal(state.phase, 'ready')
  assert.equal(state.revision, 'abc123')
  assert.equal(step.effects[0].kind, 'open')
  assert.equal(step.effects[0].name, 'report.pdf')
  assert.deepEqual([...step.effects[0].bytes], [...BYTES])

  step = bridge.reduceBridge(state, {
    type: 'bridge/save',
    bytes: BYTES,
    name: 'report.pdf',
    saveAs: false,
  })
  state = step.state
  assert.equal(state.phase, 'saving')
  assert.deepEqual(step.effects, [{
    kind: 'write',
    bytes: BYTES,
    revision: 'abc123',
    force: false,
  }])

  step = bridge.reduceBridge(state, { type: 'write/succeeded', revision: 'def456' })
  assert.equal(step.state.phase, 'ready')
  assert.equal(step.state.revision, 'def456')
  assert.equal(step.state.pending, null)
})

test('a Revision Guard refusal offers reload and overwrite, and both do what they say', async () => {
  const bridge = await loadBridgeProtocol()
  const document = { path: 'docs/report.pdf', name: 'report.pdf' }

  let state = bridge.reduceBridge(
    bridge.reduceBridge(
      bridge.reduceBridge(bridge.initialBridgeState(document), { type: 'frame/ready' }).state,
      { type: 'document/loaded', bytes: BYTES, revision: 'abc123' },
    ).state,
    { type: 'bridge/save', bytes: BYTES, name: 'report.pdf', saveAs: false },
  ).state

  const refused = bridge.reduceBridge(state, {
    type: 'write/conflicted',
    message: 'This document changed on disk after the Panel loaded it.',
    currentRevision: 'def456',
  })
  state = refused.state
  assert.equal(state.phase, 'conflict')
  assert.equal(state.conflict.currentRevision, 'def456')
  assert.deepEqual([...state.pending.bytes], [...BYTES])

  // Reload: throw the frame away and load what is on disk now.
  const reload = bridge.reduceBridge(state, { type: 'panel/reload' })
  assert.equal(reload.state.phase, 'waiting-ready')
  assert.deepEqual(reload.effects, [{ kind: 'rebuild-frame' }])

  // Overwrite: send the Panel's bytes again, this time with force.
  const overwrite = bridge.reduceBridge(state, { type: 'panel/overwrite' })
  assert.equal(overwrite.state.phase, 'saving')
  assert.deepEqual(overwrite.effects, [{
    kind: 'write',
    bytes: BYTES,
    revision: 'abc123',
    force: true,
  }])

  const succeeded = bridge.reduceBridge(overwrite.state, { type: 'write/succeeded', revision: 'def456' })
  assert.equal(succeeded.state.phase, 'ready')
  assert.equal(succeeded.state.conflict, null)
  assert.equal(succeeded.state.pending, null)
})

test('a refused read stops the frame and can be retried', async () => {
  const bridge = await loadBridgeProtocol()
  const document = { path: 'docs/huge.pdf', name: 'huge.pdf' }

  let state = bridge.reduceBridge(bridge.initialBridgeState(document), { type: 'frame/ready' }).state
  const failed = bridge.reduceBridge(state, {
    type: 'document/failed',
    message: 'This document is 9000 bytes, over the configured limit of 64 bytes (maxDocumentBytes).',
  })
  state = failed.state
  assert.equal(state.phase, 'error')
  assert.match(state.error, /64 bytes/)

  const retried = bridge.reduceBridge(state, { type: 'panel/retry' })
  assert.equal(retried.state.phase, 'waiting-ready')
  assert.deepEqual(retried.effects, [{ kind: 'rebuild-frame' }])
})

test('a failed save keeps the frame and shows a dismissible message', async () => {
  const bridge = await loadBridgeProtocol()
  const document = { path: 'docs/report.pdf', name: 'report.pdf' }

  let state = bridge.reduceBridge(
    bridge.reduceBridge(
      bridge.reduceBridge(bridge.initialBridgeState(document), { type: 'frame/ready' }).state,
      { type: 'document/loaded', bytes: BYTES, revision: 'abc123' },
    ).state,
    { type: 'bridge/save', bytes: BYTES, name: 'report.pdf', saveAs: false },
  ).state

  const failed = bridge.reduceBridge(state, { type: 'write/failed', message: 'too large' })
  assert.equal(failed.state.phase, 'ready')
  assert.equal(failed.state.error, 'too large')
  assert.equal(failed.state.pending, null)

  const dismissed = bridge.reduceBridge(failed.state, { type: 'panel/dismiss' })
  assert.equal(dismissed.state.error, null)
})

test('dirty and failed bridge events update the Panel without starting a save', async () => {
  const bridge = await loadBridgeProtocol()
  let state = bridge.reduceBridge(bridge.initialBridgeState({ path: 'a.pdf', name: 'a.pdf' }), {
    type: 'bridge/dirty',
    dirty: true,
  }).state
  assert.equal(state.dirty, true)

  state = bridge.reduceBridge(state, { type: 'bridge/failed', message: 'no WebGL' }).state
  assert.equal(state.phase, 'error')
  assert.equal(state.error, 'no WebGL')
})

test('refusals are described in the plugin copy, naming the configured limit', async () => {
  const bridge = await loadBridgeProtocol()
  const translate = (key, params) => `${key}${params === undefined ? '' : `:${params.limit}`}`

  assert.equal(
    bridge.describeDocumentFailure({
      code: 'workspace-document/too-large',
      message: 'host text',
      details: { limit: 64 },
    }, translate),
    'error.tooLarge:64',
  )
  assert.equal(
    bridge.describeDocumentFailure({
      code: 'workspace-document/outside-workspace',
      message: 'host text',
      details: {},
    }, translate),
    'error.outside',
  )
  assert.equal(
    bridge.describeDocumentFailure({ code: '', message: 'host text', details: undefined }, translate),
    'host text',
  )
})

/**
 * The refusal body is read on the save path, where a throw would strand the
 * bridge in `saving`: the person would see neither the conflict dialog nor any
 * message, and later saves would be dropped as out-of-phase.
 */
test('a refusal body is read without throwing, whatever the route sent', async () => {
  const bridge = await loadBridgeProtocol()

  const json = {
    json: async () => ({ code: 'workspace-document/revision-conflict', message: 'changed on disk' }),
    text: async () => { throw new Error('body consumed') },
  }
  assert.deepEqual(await bridge.readFailure(json), {
    code: 'workspace-document/revision-conflict',
    message: 'changed on disk',
  })

  const plain = {
    json: async () => { throw new SyntaxError('Unexpected token <') },
    text: async () => 'text/plain refusal',
  }
  assert.deepEqual(await bridge.readFailure(plain), { message: 'text/plain refusal' })

  const unreadable = {
    json: async () => { throw new SyntaxError('Unexpected token') },
    text: async () => { throw new Error('stream closed') },
  }
  assert.deepEqual(await bridge.readFailure(unreadable), {})
})

