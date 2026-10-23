// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "apps/web/public/sw.js", "data/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused vars are fine when deliberately prefixed with "_" (callback params, destructuring rest).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // `any` is occasionally the honest type at a third-party boundary (dockerode, test fakes) — flag it, don't fail on it.
      "@typescript-eslint/no-explicit-any": "warn",
      // Used deliberately for typed EventEmitter subclasses (an interface declares the on/emit overloads the class inherits).
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
    },
  },
  {
    files: ["apps/api/**/*.ts", "packages/shared/**/*.ts", "**/*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // Test fakes stand in for wide third-party types (PrismaClient, dockerode).
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
