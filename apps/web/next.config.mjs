import createNextIntlPlugin from "next-intl/plugin";

// Environment loading: Next only reads .env files from this directory, and the
// monorepo's single .env lives at the repo root — the root package.json scripts
// (dev, build, db:*, test:e2e) load it with dotenv-cli before any process
// starts. Nothing here can do that job: `experimental.envDir` was never a real
// Next option, and variables injected while this config is evaluated get wiped
// when Next resets the worker environment to its startup snapshot.

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@paper-viewer/core", "@paper-viewer/db", "@paper-viewer/storage"]
};

export default withNextIntl(nextConfig);
