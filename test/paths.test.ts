/**
 * The shared route and release module is the contract between the host, the
 * browser half, and whatever is installed. These tests pin the published
 * addresses and the release pin, and prove the module loads under Node's own
 * type stripping — `node --test` runs this file with no transpile step.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APP_PATH,
  ASSET_PREFIX,
  BINDING_PATH,
  DOCUMENT_PATH,
  PLUGIN_NAME,
  PUSHES_PATH,
  REVISION_HEADER,
  STATUS_PATH,
  WEB_BUILD_FILENAME,
  WEB_RELEASE,
  WEB_RELEASE_URL,
} from '../src/shared/paths.ts'

test('every public route sits below the one asset prefix, and none repeats', () => {
  const routes = [APP_PATH, STATUS_PATH, BINDING_PATH, DOCUMENT_PATH, PUSHES_PATH]

  assert.equal(new Set(routes).size, routes.length, 'two routes share an address')
  for (const route of routes) {
    assert.ok(
      route.startsWith(`${ASSET_PREFIX}/`),
      `${route} must sit below ${ASSET_PREFIX}`,
    )
  }
})

test('the published addresses, the Revision Guard header, and the package name do not move', () => {
  assert.equal(PLUGIN_NAME, 'dsh-pdfcraft')
  assert.equal(ASSET_PREFIX, '/pdfcraft')
  assert.equal(APP_PATH, '/pdfcraft/')
  assert.equal(STATUS_PATH, '/pdfcraft/status')
  assert.equal(BINDING_PATH, '/pdfcraft/binding')
  assert.equal(DOCUMENT_PATH, '/pdfcraft/document')
  assert.equal(PUSHES_PATH, '/pdfcraft/pushes')
  assert.equal(REVISION_HEADER, 'x-pdfcraft-revision')
})

test('the release pin names the file to fetch and the page that publishes it', () => {
  assert.equal(WEB_RELEASE, '0.9.0')
  assert.equal(WEB_BUILD_FILENAME, 'pdfcraft-web-0.9.0.zip')
  assert.equal(
    WEB_RELEASE_URL,
    'https://github.com/storytold/pdfcraft/releases/tag/v0.9.0',
  )
})
