import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

async function text(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('the package is a loadable bundle with a Host half, a browser half, and display resources', async () => {
  const manifest = JSON.parse(await text('package.json'))

  assert.equal(manifest.name, 'dsh-pdfcraft')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.exports['./icon'], './icon.svg')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))

  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
    assert.ok((await stat(new URL(file, root))).isFile(), `${file} is part of the package`)
  }
  assert.match(await text('icon.svg'), /^<svg\b/)

  for (const locale of ['en', 'zh']) {
    const dictionary = JSON.parse(await text(`locale/${locale}.json`))
    assert.equal(dictionary.meta.title, 'PdfCraft')
    assert.equal(typeof dictionary.meta.description, 'string')
    assert.notEqual(dictionary.meta.description.trim(), '')
  }
})

test('the bundle patch inserts exactly this one Host row and points at the Harness home by default', async () => {
  const patch = await text('cordis.patch.yml')

  assert.match(patch, /^- insert:/m)
  assert.equal((patch.match(/^\s*-\s+id:/gm) ?? []).length, 1)
  assert.match(patch, /^\s*- id: pdfcraft$/m)
  assert.match(patch, /^\s+name: dsh-pdfcraft$/m)
  assert.match(patch, /webBuildDir: !!js dshHomePath\('pdfcraft', 'web'\)/)
})
