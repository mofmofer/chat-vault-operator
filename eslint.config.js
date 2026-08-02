import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-globals': [
        'error',
        { name: 'XMLHttpRequest', message: 'Network access is forbidden in this extension.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'chrome', property: 'webRequest', message: 'chrome.webRequest is forbidden.' },
        { object: 'chrome', property: 'identity', message: 'chrome.identity is forbidden.' },
        { object: 'chrome', property: 'cookies', message: 'chrome.cookies is forbidden.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Network access is forbidden in this extension.',
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'Remote/dynamic code execution is forbidden.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-restricted-syntax': 'off',
      'no-undef': 'off',
    },
  },
);
