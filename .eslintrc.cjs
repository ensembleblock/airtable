module.exports = {
  extends: [
    `eslint:recommended`,
    `airbnb-base`,
    `plugin:typescript-sort-keys/recommended`,
    `@percuss.io/eslint-config-ericcarraway`,
  ],
  global: {
    RequestInit: true,
  },
  overrides: [
    {
      files: [`tests.spec.ts`],
      rules: {
        'import/no-extraneous-dependencies': `off`,
      },
    },
  ],
  parser: `@typescript-eslint/parser`,
  parserOptions: {
    ecmaVersion: 2018,
  },
  plugins: [`@typescript-eslint/eslint-plugin`, `typescript-sort-keys`],
  rules: {
    '@typescript-eslint/array-type': `error`,
    '@typescript-eslint/ban-types': `error`,
    '@typescript-eslint/consistent-type-imports': [
      `error`,
      { fixStyle: `separate-type-imports`, prefer: `type-imports` },
    ],
    '@typescript-eslint/no-duplicate-enum-values': `error`,
    '@typescript-eslint/no-extra-non-null-assertion': `error`,
    '@typescript-eslint/no-misused-new': `error`,
    '@typescript-eslint/no-namespace': `error`,
    '@typescript-eslint/no-non-null-asserted-optional-chain': `error`,
    '@typescript-eslint/no-this-alias': `error`,
    '@typescript-eslint/no-unnecessary-type-constraint': `error`,
    '@typescript-eslint/no-unsafe-declaration-merging': `error`,
    '@typescript-eslint/prefer-as-const': `error`,
    '@typescript-eslint/prefer-for-of': `error`,
    '@typescript-eslint/prefer-literal-enum-member': `error`,
    '@typescript-eslint/triple-slash-reference': `error`,
    'import/extensions': `off`,
    'import/no-unresolved': `off`,
  },
};
