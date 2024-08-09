module.exports = {
  extends: [
    `eslint:recommended`,
    `airbnb-base`,
    `plugin:typescript-sort-keys/recommended`,
    `@percuss.io/eslint-config-ericcarraway`,
  ],
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
    'import/extensions': `off`,
    'import/no-unresolved': `off`,
  },
};
