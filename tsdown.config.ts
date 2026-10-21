/**
 * The browser bundle: one CommonJS body wrapped in the shell's module-loader
 * envelope.
 *
 * The shell reads `exports["./client"]` and evaluates the file as a classic
 * script, so the bundle must register a factory under the package's id and
 * return the plugin object from it. React comes from the shell's module table;
 * everything else (the shared routes, the protocol decisions, the copy and the
 * styles) is inlined.
 */
import { defineConfig } from 'tsdown'

/** The loader id the shell registers this package under; it does not change. */
const BUNDLE_ID = 'dsh-pdfcraft'

export default defineConfig({
  entry: { client: 'src/web/client/index.ts' },
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  outDir: 'dist/web',
  clean: false,
  dts: false,
  sourcemap: false,
  minify: false,
  tsconfig: 'tsconfig.client.json',
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  // The package is ESM but this file is a classic script; keep the .js name
  // the shell's bundle route and the package export both point at.
  outExtensions: () => ({ js: '.js' }),
  banner:
    `window.__ModuleLoader__.load({\n`
    + `  id: '${BUNDLE_ID}',\n`
    + `  factory(require) {\n`
    + `    var module = { exports: {} };\n`
    + `    var exports = module.exports;\n`,
  footer: `\n    return module.exports;\n  },\n});\n`,
})
