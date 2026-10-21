/**
 * The Host Bridge and Push Channel decisions, driven directly from the pure
 * protocol module. No browser, no DOM: the same functions the Panel's React
 * glue calls.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bindingUrl,
  decodeBridgeMessage,
  decodePushEvent,
  describeDocumentFailure,
  documentUrl,
  frameSource,
  initialBridgeState,
  pushUrl,
  readFailure,
  reduceBridge,
  sessionIdOfPanelProps,
  type Bytes,
  type BridgeState,
  type BridgeTransition,
} from '../src/web/client/protocol.ts'

const BYTES = new TextEncoder().encode('%PDF-1.4\nbridge\n') as Bytes

/** A frame the app would post from. */
const FRAME = { postMessage() {} }
const ORIGIN = 'http://127.0.0.1:3080'

function event(data: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { data, origin: ORIGIN, source: FRAME, ...overrides }
}

/** The state a bound, loaded document is in, for the save tests. */
function readyState(): BridgeState {
  return reduceBridge(
    reduceBridge(
      reduceBridge(initialBridgeState({ path: 'docs/report.pdf', name: 'report.pdf' }), { type: 'frame/ready' }).state,
      { type: 'document/loaded', bytes: BYTES, revision: 'abc123' },
    ).state,
    { type: 'bridge/save', bytes: BYTES, name: 'report.pdf', saveAs: false },
  ).state
}

test('Standalone Mode never turns the Host Bridge on', () => {
  assert.equal(frameSource(null), '/pdfcraft/')
  assert.equal(frameSource(undefined), '/pdfcraft/')
  assert.equal(frameSource({ path: 'docs/report.pdf', name: 'report.pdf' }), '/pdfcraft/?host=parent')

  const standalone = initialBridgeState(null)
  assert.equal(standalone.phase, 'standalone')

  // Even a ready message that somehow arrives cannot start a bridge effect.
  const stepped = reduceBridge(standalone, { type: 'frame/ready' })
  assert.equal(stepped.state.phase, 'standalone')
  assert.deepEqual(stepped.effects, [])
})

test('the host routes carry the conversation and document path encoded', () => {
  const binding = new URL(bindingUrl('session one'), 'http://dsh.internal')
  assert.equal(binding.pathname, '/pdfcraft/binding')
  assert.equal(binding.searchParams.get('session'), 'session one')

  const document = new URL(documentUrl('session one', 'docs/report 1.pdf'), 'http://dsh.internal')
  assert.equal(document.pathname, '/pdfcraft/document')
  assert.equal(document.searchParams.get('session'), 'session one')
  assert.equal(document.searchParams.get('path'), 'docs/report 1.pdf')

  assert.equal(pushUrl('a b'), '/pdfcraft/pushes?session=a+b')
})

test('only this origin, this frame, and the declared messages are read', () => {
  const expected = { origin: ORIGIN, source: FRAME }

  assert.equal(decodeBridgeMessage(event({ type: 'pdfcraft:ready' }, { origin: 'http://evil.example' }), expected), undefined)
  assert.equal(decodeBridgeMessage(event({ type: 'pdfcraft:ready' }, { source: {} }), expected), undefined)
  assert.equal(decodeBridgeMessage(event(null), expected), undefined)
  assert.equal(decodeBridgeMessage(event({ type: 'pdfcraft:unexpected' }), expected), undefined)

  assert.deepEqual(
    decodeBridgeMessage(event({ type: 'pdfcraft:ready', version: '0.9.0' }), expected),
    { type: 'ready', version: '0.9.0' },
  )

  const saved = decodeBridgeMessage(event({
    type: 'pdfcraft:save',
    name: 'report.pdf',
    saveAs: false,
    bytes: BYTES,
  }), expected)
  assert.ok(saved?.type === 'save')
  assert.equal(saved.name, 'report.pdf')
  assert.equal(saved.saveAs, false)
  assert.deepEqual([...saved.bytes], [...BYTES])

  const asBuffer = decodeBridgeMessage(event({
    type: 'pdfcraft:save',
    bytes: BYTES.buffer,
  }), expected)
  assert.ok(asBuffer?.type === 'save')
  assert.equal(asBuffer.name, 'document.pdf')
  assert.deepEqual([...asBuffer.bytes], [...BYTES])

  assert.equal(decodeBridgeMessage(event({ type: 'pdfcraft:save', bytes: new Uint8Array() }), expected), undefined)
  assert.deepEqual(
    decodeBridgeMessage(event({ type: 'pdfcraft:dirty', dirty: true }), expected),
    { type: 'dirty', dirty: true },
  )
  assert.deepEqual(
    decodeBridgeMessage(event({ type: 'pdfcraft:failed', error: 'no WebGL' }), expected),
    { type: 'failed', error: 'no WebGL' },
  )
})

test('a save is guarded by the revision the document was loaded with', () => {
  const document = { path: 'docs/report.pdf', name: 'report.pdf' }

  let state = initialBridgeState(document)
  assert.equal(state.phase, 'waiting-ready')

  let step: BridgeTransition = reduceBridge(state, { type: 'frame/ready' })
  assert.equal(step.state.phase, 'loading')
  assert.deepEqual(step.effects, [{ kind: 'load', path: 'docs/report.pdf' }])

  step = reduceBridge(step.state, {
    type: 'document/loaded',
    bytes: BYTES,
    revision: 'abc123',
  })
  state = step.state
  assert.equal(state.phase, 'ready')
  assert.equal(state.revision, 'abc123')
  assert.equal(step.effects[0]?.kind, 'open')
  const opened = step.effects[0]
  assert.ok(opened?.kind === 'open')
  assert.equal(opened.name, 'report.pdf')
  assert.deepEqual([...opened.bytes], [...BYTES])

  step = reduceBridge(state, {
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

  step = reduceBridge(state, { type: 'write/succeeded', revision: 'def456' })
  assert.equal(step.state.phase, 'ready')
  assert.equal(step.state.revision, 'def456')
  assert.equal(step.state.pending, null)
})

test('a Revision Guard refusal offers reload and overwrite, and both do what they say', () => {
  const state = reduceBridge(readyState(), {
    type: 'write/conflicted',
    message: 'This document changed on disk after the Panel loaded it.',
    currentRevision: 'def456',
  }).state
  assert.equal(state.phase, 'conflict')
  assert.equal(state.conflict?.currentRevision, 'def456')
  assert.deepEqual([...state.pending?.bytes ?? []], [...BYTES])

  // Reload: throw the frame away and load what is on disk now.
  const reload = reduceBridge(state, { type: 'panel/reload' })
  assert.equal(reload.state.phase, 'waiting-ready')
  assert.deepEqual(reload.effects, [{ kind: 'rebuild-frame' }])

  // Overwrite: send the Panel's bytes again, this time with force.
  const overwrite = reduceBridge(state, { type: 'panel/overwrite' })
  assert.equal(overwrite.state.phase, 'saving')
  assert.deepEqual(overwrite.effects, [{
    kind: 'write',
    bytes: BYTES,
    revision: 'abc123',
    force: true,
  }])

  const succeeded = reduceBridge(overwrite.state, { type: 'write/succeeded', revision: 'def456' })
  assert.equal(succeeded.state.phase, 'ready')
  assert.equal(succeeded.state.conflict, null)
  assert.equal(succeeded.state.pending, null)
})

test('a refused read stops the frame and can be retried', () => {
  const state = reduceBridge(initialBridgeState({ path: 'docs/huge.pdf', name: 'huge.pdf' }), {
    type: 'frame/ready',
  }).state
  const failed = reduceBridge(state, {
    type: 'document/failed',
    message: 'This document is 9000 bytes, over the configured limit of 64 bytes (maxDocumentBytes).',
  })
  assert.equal(failed.state.phase, 'error')
  assert.match(failed.state.error ?? '', /64 bytes/)

  const retried = reduceBridge(failed.state, { type: 'panel/retry' })
  assert.equal(retried.state.phase, 'waiting-ready')
  assert.deepEqual(retried.effects, [{ kind: 'rebuild-frame' }])
})

test('a failed save keeps the frame and shows a dismissible message', () => {
  const failed = reduceBridge(readyState(), { type: 'write/failed', message: 'too large' })
  assert.equal(failed.state.phase, 'ready')
  assert.equal(failed.state.error, 'too large')
  assert.equal(failed.state.pending, null)

  const dismissed = reduceBridge(failed.state, { type: 'panel/dismiss' })
  assert.equal(dismissed.state.error, null)
})

test('dirty and failed bridge events update the Panel without starting a save', () => {
  let state = reduceBridge(initialBridgeState({ path: 'a.pdf', name: 'a.pdf' }), {
    type: 'bridge/dirty',
    dirty: true,
  }).state
  assert.equal(state.dirty, true)

  state = reduceBridge(state, { type: 'bridge/failed', message: 'no WebGL' }).state
  assert.equal(state.phase, 'error')
  assert.equal(state.error, 'no WebGL')
})

test('refusals are described in the plugin copy, naming the configured limit', () => {
  const translate = (key: string, params?: Record<string, string | number>): string =>
    `${key}${params === undefined ? '' : `:${params.limit}`}`

  assert.equal(
    describeDocumentFailure({
      code: 'workspace-document/too-large',
      message: 'host text',
      details: { limit: 64 },
    }, translate),
    'error.tooLarge:64',
  )
  assert.equal(
    describeDocumentFailure({
      code: 'workspace-document/outside-workspace',
      message: 'host text',
      details: {},
    }, translate),
    'error.outside',
  )
  assert.equal(
    describeDocumentFailure({ code: '', message: 'host text', details: undefined }, translate),
    'host text',
  )
})

/**
 * The refusal body is read on the save path, where a throw would strand the
 * bridge in `saving`: the person would see neither the conflict dialog nor any
 * message, and later saves would be dropped as out-of-phase.
 */
test('a refusal body is read without throwing, whatever the route sent', async () => {
  const json = {
    json: async () => ({ code: 'workspace-document/revision-conflict', message: 'changed on disk' }),
    text: async () => { throw new Error('body consumed') },
  }
  assert.deepEqual(await readFailure(json), {
    code: 'workspace-document/revision-conflict',
    message: 'changed on disk',
  })

  const plain = {
    json: async () => { throw new SyntaxError('Unexpected token <') },
    text: async () => 'text/plain refusal',
  }
  assert.deepEqual(await readFailure(plain), { message: 'text/plain refusal' })

  const unreadable = {
    json: async () => { throw new SyntaxError('Unexpected token') },
    text: async () => { throw new Error('stream closed') },
  }
  assert.deepEqual(await readFailure(unreadable), {})
})

test('the Push Channel names one route per conversation and rejects malformed frames', () => {
  assert.equal(pushUrl('a b'), '/pdfcraft/pushes?session=a+b')
  assert.deepEqual(decodePushEvent('{"type":"open","sessionId":"s","document":null}'), {
    type: 'open',
    id: '',
    sessionId: 's',
    document: null,
  })
  assert.deepEqual(
    decodePushEvent('{"type":"open","id":"one","sessionId":"s","document":{"path":"a.pdf"}}'),
    { type: 'open', id: 'one', sessionId: 's', document: { path: 'a.pdf', name: 'a.pdf' } },
  )
  assert.equal(decodePushEvent('{"type":"other","sessionId":"s"}'), undefined)
  assert.equal(decodePushEvent('{"type":"open"}'), undefined)
  assert.equal(decodePushEvent('{'), undefined)
})

test('the Panel reads the conversation from either sidebar seat', () => {
  assert.equal(sessionIdOfPanelProps({ sessionId: 'native' }), 'native')
  assert.equal(sessionIdOfPanelProps({ scope: { sessionId: 'better' } }), 'better')
  assert.equal(sessionIdOfPanelProps({ session: { id: 'session-object' } }), 'session-object')
  assert.equal(sessionIdOfPanelProps({ scope: { sessionId: 'better' }, sessionId: 'native' }), 'native')
  assert.equal(sessionIdOfPanelProps({}), undefined)
  assert.equal(sessionIdOfPanelProps(undefined), undefined)
})
