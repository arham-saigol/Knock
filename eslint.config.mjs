import clerkNext from "@clerk/eslint-plugin/next";
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    plugins: { "@clerk/next": clerkNext },
    rules: {
      "@clerk/next/require-auth-protection": [
        "error",
        {
          protected: ["src/app/(app)/**", "src/app/api/**", "src/app/page.tsx"],
          public: ["src/app/sign-in/**"],
        },
      ],
    },
  },
  globalIgnores([".next/**", "coverage/**", "convex/_generated/**"]),
]);
