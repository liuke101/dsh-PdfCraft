/**
 * The static check for the JavaScript that the type checker does not cover.
 *
 * The host's shared module is TypeScript and is checked by `tsc`; the host
 * entry, the `lib/` modules, the browser half, and the JS tests are still plain
 * JavaScript, and `tsc` does not see a name that is used but never defined.
 * That is exactly how `readFailure` reached a merged commit on a green suite,
 * so `no-undef` is the rule this config exists for until the port is complete.
 * Keep the set small: a rule earns its place by catching a defect this code can
 * have.
 */
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.npm-cache/**',
      'coverage/**',
      '.worktrees/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // The harness half runs in Node.
    files: ['index.js', 'lib/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The browser half is a classic script: no imports, host globals only.
    files: ['client.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
