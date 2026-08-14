import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "sources/**", "public/metadata/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    files: ["public/catalog-search-worker.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    files: ["*.config.{js,mjs,ts}", "catalog/scripts/**/*.{js,mjs}", "tests/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
