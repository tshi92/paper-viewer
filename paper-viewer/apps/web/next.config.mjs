/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@paper-viewer/core", "@paper-viewer/db", "@paper-viewer/storage"]
};

export default nextConfig;
