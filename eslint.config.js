// @ts-check

/**
 * ESLint flat config.
 *
 * Rules come from `@percuss.io/eslint-config-ericcarraway` (v9), which targets
 * ESLint 9. ESLint 9 is past its end of life; staying on it is a deliberate,
 * temporary tradeoff until the shared config & required plugins support ESLint 10.
 *
 * Formatting is owned by Prettier, so the `@stylistic` rule set is not applied.
 *
 * @see https://github.com/ericcarraway/eslint-config-ericcarraway#readme
 */

import eslint from '@eslint/js';
import {
  baseRules,
  disabledBasePersonalRules,
  disabledTypescriptExtensionRules,
  disabledTypescriptPersonalRules,
  disabledTypescriptRedundantRules,
  importRules,
  nodeRules,
  simpleImportSortRules,
  sortDestructureKeysRules,
  typescriptRules,
} from '@percuss.io/eslint-config-ericcarraway';
import { defineConfig, globalIgnores } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import nPlugin from 'eslint-plugin-n';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sortDestructureKeys from 'eslint-plugin-sort-destructure-keys';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // `*.cjs`: CommonJS config files (e.g. `.prettierrc.cjs`) & local scripts.
  globalIgnores([`dist/`, `node_modules/`, `**/*.cjs`]),

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [`*.js`],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      n: nPlugin,
      'simple-import-sort': simpleImportSort,
      'sort-destructure-keys': sortDestructureKeys,
    },
    rules: {
      ...baseRules,
      ...importRules,
      ...nodeRules,
      ...simpleImportSortRules,
      ...sortDestructureKeysRules,
      ...typescriptRules,

      ...disabledBasePersonalRules,
      ...disabledTypescriptExtensionRules,
      ...disabledTypescriptPersonalRules,
    },
  },

  {
    files: [`**/*.{ts,tsx,mts,cts}`],
    rules: disabledTypescriptRedundantRules,
  },

  {
    // ESLint requires a default export from its config file.
    files: [`eslint.config.js`],
    rules: { 'import/no-default-export': `off` },
  },
);
