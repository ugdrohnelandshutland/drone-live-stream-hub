// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "sim/reports/", "release/", ".cache/"] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  { files: ["src/web/**/*.{ts,tsx}", "test/web/**/*.tsx"], ...reactHooks.configs.flat["recommended-latest"] },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.{ts,tsx}"],
    rules: {
      // Tests assert presence explicitly; non-null assertions keep them readable.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
