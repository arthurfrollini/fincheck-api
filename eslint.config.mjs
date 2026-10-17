// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import jestPlugin from 'eslint-plugin-jest';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // No type assertions at all (const assertions stay allowed): narrow
      // with a check, parse with a schema, or type the source instead.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
          message: 'No `as unknown as`: type the value (mock<T>(), a narrower type, or a schema).',
        },
        {
          selector: 'TSAsExpression[typeAnnotation.type="TSNeverKeyword"]',
          message: 'No `as never`: type the value instead.',
        },
        {
          // A bare jest.fn() is Mock<any, any>: whatever it returns or is
          // called with goes unchecked.
          selector: 'CallExpression[callee.object.name="jest"][callee.property.name="fn"][arguments.length=0]:not([typeArguments])',
          message: 'No untyped jest.fn(): use mock<T>(), jest.fn<Return, Args>(), or pass a typed implementation.',
        },
      ],
      // Handle the missing case instead of asserting it away.
      '@typescript-eslint/no-non-null-assertion': 'error',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // In tests, expect(mock.method) is the normal way to assert on a mock;
    // jest/unbound-method knows that, the base rule doesn't.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    plugins: { jest: jestPlugin },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      'jest/unbound-method': 'error',
    },
  },
);
