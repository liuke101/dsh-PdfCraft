import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8')
}

test('the package carries both component entries, a browser half, and display resources', async () => {
  const manifest = JSON.parse(await text('package.json'))

  assert.equal(manifest.name, 'dsh-pdfcraft')
  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.type, 'module')
  // The bare package name is what the shell's client-modules scan uses to find
  // `dsh.client`; a subpath Loader row would contribute no browser bundle.
  assert.equal(manifest.exports['.'].default, './dist/web/index.js')
  assert.equal(manifest.exports['.'].types, './dist/web/index.d.ts')
  assert.equal(manifest.exports['./web'].default, './dist/web/index.js')
  assert.equal(manifest.exports['./web'].types, './dist/web/index.d.ts')
  assert.equal(manifest.exports['./cli'].default, './dist/cli/index.js')
  assert.equal(manifest.exports['./cli'].types, './dist/cli/index.d.ts')
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
    'dist/cli/index.js',
    'dist/cli/index.d.ts',
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

  // The package listing names both components; the Panel page keeps its own
  // title in the browser half's copy.
  for (const locale of ['en', 'zh']) {
    const dictionary = JSON.parse(await text(`locale/${locale}.json`))
    assert.equal(dictionary.meta.title, 'dsh-pdfcraft')
    assert.equal(typeof dictionary.meta.description, 'string')
    assert.match(dictionary.meta.description, /PdfCraft/)
    assert.match(dictionary.meta.description, /agent/, 'the listing covers the agent tools too')
  }
})

test('both component specifiers resolve the shared package locale', () => {
  for (const component of ['dsh-pdfcraft', 'dsh-pdfcraft/cli']) {
    for (const language of ['en', 'zh']) {
      assert.equal(
        import.meta.resolve(`${component}/locale/${language}.json`),
        new URL(`../locale/${language}.json`, import.meta.url).href,
        `${component} resolves the shared ${language} locale`,
      )
    }
  }
})

test('no old JavaScript implementation remains', async () => {
  for (const file of ['index.js', 'client.js']) {
    await assert.rejects(access(new URL(file, root)), `${file} is gone`)
  }
  await assert.rejects(stat(new URL('lib', root)), 'the lib/ JavaScript tree is gone')
})

test('the bundle patch inserts the two component rows and keeps the web row a bare package specifier', async () => {
  const patch = await text('cordis.patch.yml')

  assert.match(patch, /^- insert:/m)
  assert.equal((patch.match(/^\s*-\s+id:/gm) ?? []).length, 2)
  assert.match(patch, /^\s*- id: pdfcraft-web$/m)
  assert.match(patch, /^\s+name: dsh-pdfcraft$/m)
  assert.match(patch, /^\s*- id: pdfcraft-cli$/m)
  assert.match(patch, /^\s+name: dsh-pdfcraft\/cli$/m)
  assert.doesNotMatch(patch, /^\s*- id: pdfcraft$/m, 'the old single row is gone')
  assert.doesNotMatch(patch, /^\s+name: dsh-pdfcraft\/web$/m, 'the web row must stay a bare package specifier for client discovery')
  assert.match(patch, /webBuildDir: !!js dshHomePath\('pdfcraft', 'web'\)/)
})

test('the README migration table moves every old field to its component row', async () => {
  const readme = await text('README.md')
  const start = readme.indexOf('### Migrating from the old single row')
  assert.ok(start >= 0, 'the README documents the migration from the old row')
  const section = readme.slice(start).split(/\n#{2,3} /)[0] ?? ''

  for (const field of [
    'webBuildDir',
    'openTool',
    'maxDocumentBytes',
    'cliPath',
    'staticRoot',
    'compactSurface',
  ]) {
    assert.match(section, new RegExp(`\`${field}\``), `${field} is in the migration table`)
  }
  assert.match(section, /pdfcraft-web/)
  assert.match(section, /pdfcraft-cli/)
})

test('the committed browser bundle keeps the module-loader envelope and the package id', async () => {
  const bundle = await text('dist/web/client.js')

  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{/m)
  assert.match(bundle, /^\s+id: 'dsh-pdfcraft',$/m)
  assert.match(bundle, /^\s+factory\(require\) \{$/m)
  assert.match(bundle, /return module\.exports;/)
})
