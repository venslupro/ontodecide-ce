// ESLint flat config based on Google TypeScript Style (gts).
import gts from 'gts';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      'apps/web/public/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      'infra/**',
      '*.config.js',
      '.dependency-cruiser.cjs',
      '.prettierrc.cjs',
    ],
  },
  ...gts,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'n/no-unpublished-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-extraneous-import': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
];
