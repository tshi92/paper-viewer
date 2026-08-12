import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig's paths so tests can import modules that rely on "@/lib/*"
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) }
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"]
  }
});
