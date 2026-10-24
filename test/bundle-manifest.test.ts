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
  assert.equal(manifest.exports['./cli/locale/*.json'], './locale/cli/*.json')
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
    'locale/cli/en.json',
    'locale/cli/zh.json',
  ]) {
    assert.ok((await stat(new URL(file, root))).isFile(), `${file} is part of the package`)
  }
  const icon = await readFile(new URL('icon.png', root))
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'icon.png is a PNG')
  assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20), 'the artwork is square')

  // The bare package name serves both the bundle and the Web row, so those two
  // carry the package title `dsh-pdfcraft`; the CLI row keeps its own
  // `dsh-pdfcraft-cli`. The Panel page keeps its own title in the browser
  // half's copy.
  for (const locale of ['en', 'zh']) {
    const dictionary = JSON.parse(await text(`locale/${locale}.json`))
    assert.equal(dictionary.meta.title, 'dsh-pdfcraft')
    assert.equal(typeof dictionary.meta.description, 'string')
    assert.match(dictionary.meta.description, /PdfCraft/)
    assert.match(dictionary.meta.description, /agent/, 'the listing covers the agent tools too')

    const cli = JSON.parse(await text(`locale/cli/${locale}.json`))
    assert.equal(cli.meta.title, 'dsh-pdfcraft-cli')
    assert.equal(typeof cli.meta.description, 'string')
    assert.match(cli.meta.description, /PdfCraft/)
    assert.match(cli.meta.description, /agent/, 'the CLI row listing covers the agent tools')
  }
})

test('each component specifier resolves its own locale file', () => {
  for (const language of ['en', 'zh']) {
    assert.equal(
      import.meta.resolve(`dsh-pdfcraft/locale/${language}.json`),
      new URL(`../locale/${language}.json`, import.meta.url).href,
      `dsh-pdfcraft resolves the Web row ${language} locale`,
    )
    assert.equal(
      import.meta.resolve(`dsh-pdfcraft/cli/locale/${language}.json`),
      new URL(`../locale/cli/${language}.json`, import.meta.url).href,
      `dsh-pdfcraft/cli resolves the CLI row ${language} locale`,
    )
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

test('both README editions carry the migration table for the split rows', async () => {
  // The English edition is the entry point; the Chinese edition has to keep
  // the same table, so a reader of either language can move every override.
  for (const edition of [
    { file: 'README.md', heading: '### Migrating from the old single row' },
    { file: 'README.zh.md', heading: '### 从旧的单行迁移' },
  ]) {
    const readme = await text(edition.file)
    const start = readme.indexOf(edition.heading)
    assert.ok(start >= 0, `${edition.file} documents the migration from the old row`)
    const section = readme.slice(start).split(/\n#{2,3} /)[0] ?? ''

    for (const field of [
      'webBuildDir',
      'openTool',
      'maxDocumentBytes',
      'cliPath',
      'staticRoot',
      'compactSurface',
    ]) {
      assert.match(section, new RegExp(`\`${field}\``), `${field} is in the ${edition.file} migration table`)
    }
    assert.match(section, /pdfcraft-web/)
    assert.match(section, /pdfcraft-cli/)
  }
})

test('both README editions open on the banner and link to each other under it', async () => {
  const english = await text('README.md')
  const chinese = await text('README.zh.md')

  for (const readme of [english, chinese]) {
    const banner = readme.indexOf('docs/assets/banner.png')
    const switcher = readme.indexOf('<p align="center">')
    assert.ok(banner >= 0, 'the banner is in the README')
    assert.ok(switcher > banner, 'the language switcher sits under the banner')
    assert.ok(readme.indexOf('</p>', switcher) > switcher, 'the switcher is a centered block')
  }
  assert.match(english, /href="README\.zh\.md"/, 'the English edition links to the Chinese one')
  assert.match(chinese, /href="README\.md"/, 'the Chinese edition links to the English one')
})

// The harness supplies its own copies of the shared packages and routes a
// plugin's bare import of one to the copy the running runtime was built with
// (`routeLinked` in `@deepseek-ai/dsh-app-boot`). That routing only fires when
// the plugin lists the package as a *peer*: a `dependencies` entry lets the
// plugin's own tree win, so a pinned copy shadows the runtime's and the two
// drift apart on the next harness release. Declaring them as peers also makes
// `evaluatePluginCompatibility` see the requirement at all, because it reads
// `engines.dsh` or the `@deepseek-ai/dsh-*` peer ranges and ignores plain
// dependencies.
test('the harness-owned packages are peers, not bundled dependencies', async () => {
  const manifest = JSON.parse(await text('package.json'))
  const harnessOwned = [
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-mcp-client',
  ]

  for (const name of harnessOwned) {
    assert.equal(
      manifest.dependencies?.[name],
      undefined,
      `${name} must not be a dependency: a pinned copy shadows the runtime's`,
    )
    assert.equal(
      typeof manifest.peerDependencies?.[name],
      'string',
      `${name} is a peer the harness supplies`,
    )
    // The runtime ships these at the version it was built with, so the range
    // has to admit both the version this repo develops against and the one the
    // harness installs. A caret on a prerelease admits the whole 0.2.1 line.
    assert.match(
      manifest.peerDependencies[name],
      /^\^0\.2\.1-rc\.1$/,
      `${name} admits the runtime's own copy`,
    )
    assert.equal(
      typeof manifest.devDependencies?.[name],
      'string',
      `${name} stays a dev dependency so the suite and the types resolve`,
    )
  }

  // schemastery is a plain library, not a harness service: it carries no
  // `@deepseek-ai/dsh-` prefix, so compatibility never inspects it and a
  // dependency is the correct declaration.
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '~3.18.5')
  assert.equal(manifest.peerDependencies['@deepseek-ai/schemastery'], undefined)
})

test('the committed browser bundle keeps the module-loader envelope and the package id', async () => {
  const bundle = await text('dist/web/client.js')

  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{/m)
  assert.match(bundle, /^\s+id: 'dsh-pdfcraft',$/m)
  assert.match(bundle, /^\s+factory\(require\) \{$/m)
  assert.match(bundle, /return module\.exports;/)
})
