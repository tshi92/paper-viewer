import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@paper-viewer/core", "@paper-viewer/db", "@paper-viewer/storage"],
  env: {},
  experimental: {
    // Load .env from monorepo root
    envDir: resolve(__dirname, "../..")
  }
};

export default nextConfig;
