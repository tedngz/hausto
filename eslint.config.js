import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // .claude/ holds agent worktrees - whole other checkouts of this repo -
      // so linting it lints every copy of the codebase at once.
      ".claude",
      // Generated from src/lib/mcp/ by the @lovable.dev/mcp-js Vite plugin on
      // every build, and CI fails if it differs from what a build produces -
      // so it cannot be hand-fixed, only regenerated.
      "supabase/functions/mcp/index.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      // Some 600 of these predate lint running at all - it crashed on its
      // first file until typescript-eslint was upgraded. A warning keeps them
      // in view without failing every run; type them as the code is touched.
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": [
        "error",
        {
          // A destructure where only some names are reassigned stays `let`,
          // rather than being split in two to satisfy the rule.
          destructuring: "all",
          // A variable declared ahead of a callback that reads it - a timer
          // its own completion handler clears - stays `let`.
          ignoreReadBeforeAssign: true,
        },
      ],
      // A combining mark written as an escape inside a character class is
      // deliberate, not a pasted glyph that looks like one character:
      // concierge-email's padding class lists a joiner on its own.
      "no-misleading-character-class": ["error", { allowEscape: true }],
    },
  },
  {
    // shadcn/ui primitives, kept as generated. They export variants and hooks
    // beside their components by design.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  }
);
