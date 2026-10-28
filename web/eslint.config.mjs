import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party code copied in (React Bits, 21st.dev, transitions.dev): not linted. Kept as published, except
    // that the transitions.dev runtime builds its text panels from DOM nodes instead of innerHTML.
    "src/components/vendor/text-type.tsx",
    "src/components/vendor/ascii-voice-orb.tsx",
    "src/lib/generation/**",
  ]),
]);

export default eslintConfig;
