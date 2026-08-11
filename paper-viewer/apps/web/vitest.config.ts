import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 与 tsconfig 的 paths 对齐，测试里才能 import 依赖 "@/lib/*" 的模块
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) }
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"]
  }
});
