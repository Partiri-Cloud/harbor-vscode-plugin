import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    // test/e2e/** are plain CommonJS scripts consumed directly by node/mocha
    // for the optional @vscode/test-electron smoke test, outside the
    // TypeScript/strict-style pipeline the rest of this extension follows —
    // same treatment as the *.mjs build scripts.
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**', '*.mjs', 'test/e2e/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Test fixtures frequently index into arrays/objects whose shape is
    // fixed by the test data itself; non-null assertions there are noise
    // reduction, not a correctness risk the way they are in src/.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
