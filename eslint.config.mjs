import typescriptParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["**/.next/**", "**/dist/**", "**/node_modules/**", "build/**", "/runtime/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
  },
];
