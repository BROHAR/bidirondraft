import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

// Flat config (ESLint 9). Mirrors the previous .eslintrc.cjs:
//   eslint:recommended + react/recommended + react/jsx-runtime +
//   react-hooks/recommended, with the react-refresh Vite rule.
export default [
  // Lint scope matches the previous `eslint . --ext js,jsx`: .js/.jsx only.
  // The scripts/*.mjs refresh tooling was never linted; keep it out of this
  // tooling-only upgrade (linting it can be a separate, focused change).
  { ignores: ['dist', '**/*.mjs'] },

  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,

  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // React Compiler rules newly added to react-hooks 7's recommended set.
      // They flag optimization hints (cascading-render setState, manual
      // memoization), not bugs. Kept as warnings to preserve the prior lint
      // baseline (0 errors) — addressing them is welcome but out of scope for
      // the ESLint upgrade.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react/prop-types': 'off',
      // Unescaped apostrophes/quotes in JSX copy are fine.
      'react/no-unescaped-entities': 'off',
      // Intentional in the synchronous simulateDraft loop (`while (true)`).
      'no-constant-condition': ['error', { checkLoops: false }],
      // Overridable strategy methods share a signature, so unused params are
      // intentional. Remaining unused locals are reported as warnings rather than
      // blocking — the codebase predates linting; cleaning them up is welcome but
      // shouldn't fail a contributor's build. Real errors (undef, syntax) still fail.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  {
    // Vitest globals for the test suite
    files: ['tests/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]
