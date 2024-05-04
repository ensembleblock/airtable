module.exports = {
  arrowParens: `always`,
  bracketSameLine: false,
  bracketSpacing: true,
  embeddedLanguageFormatting: `auto`,
  endOfLine: `lf`,
  insertPragma: false,
  printWidth: 80,
  proseWrap: `preserve`,
  quoteProps: `as-needed`,
  requirePragma: false,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: `all`,
  useTabs: false,
  overrides: [
    {
      files: [`*.yml`],
      options: {
        singleQuote: false,
      },
    },
  ],
};
