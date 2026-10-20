import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'vendor', '.claude-plugin/types'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['bin/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['hooks/**/*.tsx'],
    languageOptions: { globals: { h: 'readonly', Fragment: 'readonly' } },
  },
)
