/**
 * Point the emitted declarations at the emitted JavaScript.
 *
 * The host is written with explicit `.ts` import specifiers so Node's type
 * stripping can run the sources directly. `tsc --rewriteRelativeImportExtensions`
 * rewrites those specifiers to `.js` in the JavaScript, but the declaration
 * files keep `.ts`, which a consumer cannot resolve because no `.ts` file is
 * published. This walk fixes the declarations only; it runs after `tsc` and
 * before the build artifact is committed.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = 'dist'

/** A relative module specifier in a declaration, whatever statement carries it. */
const RELATIVE_TS = /((?:\bfrom\s*|\bimport\s*\(\s*)(['"]))(\.{1,2}\/[^'"]+)\.ts(\2)/g

/** Every `.d.ts` file below one directory. */
async function declarationsOf(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await declarationsOf(target))
    else if (entry.name.endsWith('.d.ts')) found.push(target)
  }
  return found
}

const files = await declarationsOf(DIST)
for (const file of files) {
  const source = await readFile(file, 'utf8')
  const rewritten = source.replace(RELATIVE_TS, (match, head, _quote, specifier, quote) => {
    return `${head}${specifier}.js${quote}`
  })
  if (rewritten !== source) await writeFile(file, rewritten)
}

const leftovers = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)\.ts['"]/g)) {
    leftovers.push(`${file}: ${match[0]}`)
  }
}
if (leftovers.length > 0) {
  console.error('declaration imports still name .ts files:')
  for (const line of leftovers) console.error(`  ${line}`)
  process.exit(1)
}
