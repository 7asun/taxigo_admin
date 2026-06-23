/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: 'next/core-web-vitals',
  plugins: ['@typescript-eslint', 'invalidation-contract'],
  ignorePatterns: ['src/eslint-rules/**'],
  rules: {
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/naming-convention': [
      'warn',
      {
        selector: 'default',
        format: ['camelCase'],
        leadingUnderscore: 'allow'
      },
      {
        selector: 'typeLike',
        format: ['PascalCase']
      },
      {
        selector: 'interface',
        format: ['PascalCase']
      },
      {
        selector: 'enumMember',
        format: ['PascalCase', 'UPPER_CASE']
      }
    ],
    'import/no-unresolved': 'off',
    'import/named': 'off',
    'no-console': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'invalidation-contract/no-direct-widget-invalidation': 'error'
  },
  overrides: [
    {
      files: ['src/**/*.{js,jsx,ts,tsx}'],
      excludedFiles: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        'src/eslint-rules/**'
      ],
      rules: {
        'invalidation-contract/no-direct-widget-invalidation': 'error'
      }
    }
  ]
};
