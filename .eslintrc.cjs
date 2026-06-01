module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
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
  overrides: [
    {
      // Vitest globals for the test suite
      files: ['tests/**/*.{js,jsx}'],
      env: { node: true },
      globals: {
        describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  ],
}
