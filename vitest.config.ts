// Vitest config — fast unit-test runner for /app/lib pure-function modules.
// We deliberately scope tests to `app/lib/**/*.test.ts(x)` so we don't try
// to render server components or hit Next.js runtime APIs (those would need
// a DOM env + Next-specific shims, which we don't yet need).
//
// Run:  npm test          (one-shot)
//       npm run test:watch (interactive)
//       npm run test:coverage

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/lib/**/*.ts"],
      exclude: ["app/lib/**/*.test.ts", "app/lib/supabase/**", "app/lib/types.ts"],
    },
  },
});
