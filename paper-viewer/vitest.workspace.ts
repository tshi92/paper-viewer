import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/db/vitest.config.ts",
  "packages/storage/vitest.config.ts"
]);
