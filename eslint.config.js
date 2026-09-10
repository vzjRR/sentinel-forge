// @ts-check
/**
 * ESLint configuration.
 *
 * Type-aware linting is enabled deliberately: most of the rules that matter for
 * a diagnostic product (unsound casts, floating promises, unchecked `any`
 * flowing out of a database row) are only detectable with type information.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'tests/fixtures/**', '**/*.generated.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // One program covering both packages and test suites. The package
        // tsconfigs exclude *.test.ts so tests stay out of build output, which
        // means the project service alone would not find them.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Product rules: diagnostics must never silently swallow a failure.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Scanned code is never executed; these constructs must not appear.
          selector: "CallExpression[callee.name='eval']",
          message: 'eval is not permitted anywhere in Sentinel Forge.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Dynamic function construction is not permitted in Sentinel Forge.',
        },
      ],
    },
  },
  {
    // Test files may use non-null assertions on fixtures they just created.
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Build scripts and config files run under plain Node and are not part of a
    // TypeScript project, so type-aware rules cannot apply to them.
    files: ['scripts/**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { project: null },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
