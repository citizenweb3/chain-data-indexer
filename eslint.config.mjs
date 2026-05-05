// @ts-check
import nextPlugin from '@next/eslint-plugin-next';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'protos/**',
      'scripts/**',
      'initdb/**',
      // indexer source files — not part of this Next.js project
      'src/assemble/**',
      'src/config/**',
      'src/db/batch.ts',
      'src/db/progress.ts',
      'src/db/pool.ts',
      'src/decode/**',
      'src/generated/**',
      'src/normalize/**',
      'src/rpc/**',
      'src/runner/**',
      'src/sink/**',
      'src/utils/**',
      'src/index.ts',
      'src/config.ts',
      'src/types.d.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
];
