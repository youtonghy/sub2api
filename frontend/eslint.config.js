import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-constant-condition': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Arc 组件源码（shadcn 安装）：保留原样。源码里有针对 Next.js 规则的 disable 注释，
    // 这里注册一个空实现避免“规则未定义”报错。
    files: ['src/components/arc/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': { rules: { 'no-img-element': { create: () => ({}) } } }
    },
    rules: {
      'react-refresh/only-export-components': 'off'
    }
  }
)
