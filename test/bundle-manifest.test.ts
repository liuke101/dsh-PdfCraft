import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8')
}

test('the package is a loadable bundle with a Web Component entry, a browser half, and display resources', async () => {
  const manifest = JSON.parse(await text('package.json'))

  assert.equal(manifest.name, 'dsh-pdfcraft')
  assert.equal(manifest.type, 'module')
  // The bare package name is what the shell's client-modules scan uses to find
  // `dsh.client`; a subpath Loader row would contribute no browser bundle.
  assert.equal(manifest.exports['.'].default, './dist/web/index.js')
  assert.equal(manifest.exports['.'].types, './dist/web/index.d.ts')
  assert.equal(manifest.exports['./web'].default, './dist/web/index.js')
  assert.equal(manifest.exports['./web'].types, './dist/web/index.d.ts')
  assert.equal(manifest.exports['./client'], './dist/web/client.js')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.exports['./icon'], './icon.png')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))

  for (const file of [
    'dist/web/index.js',
    'dist/web/index.d.ts',
    'dist/web/client.js',
    'cordis.patch.yml',
    'icon.png',
    'locale/en.json',
    'locale/zh.json',
  ]) {
    assert.ok((await stat(new URL(file, root))).isFile(), `${file} is part of the package`)
  }
  const icon = await readFile(new URL('icon.png', root))
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'icon.png is a PNG')
  assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20), 'the artwork is square')

  for (const locale of ['en', 'zh']) {
    const dictionary = JSON.parse(await text(`locale/${locale}.json`))
    assert.equal(dictionary.meta.title, 'PdfCraft')
    assert.equal(typeof dictionary.meta.description, 'string')
    assert.notEqual(dictionary.meta.description.trim(), '')
  }
})

test('no old JavaScript implementation remains', async () => {
  for (const file of ['index.js', 'client.js']) {
    await assert.rejects(access(new URL(file, root)), `${file} is gone`)
  }
  await assert.rejects(stat(new URL('lib', root)), 'the lib/ JavaScript tree is gone')
})

test('the bundle patch inserts exactly this one Host row, names the Web Component, and points at the Harness home by default', async () => {
  const patch = await text('cordis.patch.yml')

  assert.match(patch, /^- insert:/m)
  assert.equal((patch.match(/^\s*-\s+id:/gm) ?? []).length, 1)
  assert.match(patch, /^\s*- id: pdfcraft$/m)
  assert.match(patch, /^\s+name: dsh-pdfcraft$/m)
  assert.doesNotMatch(patch, /^\s+name: dsh-pdfcraft\/web$/m, 'the row must stay a bare package specifier for client discovery')
  assert.match(patch, /webBuildDir: !!js dshHomePath\('pdfcraft', 'web'\)/)
})

test('the committed browser bundle keeps the module-loader envelope and the package id', async () => {
  const bundle = await text('dist/web/client.js')

  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{/m)
  assert.match(bundle, /^\s+id: 'dsh-pdfcraft',$/m)
  assert.match(bundle, /^\s+factory\(require\) \{$/m)
  assert.match(bundle, /return module\.exports;/)
})
