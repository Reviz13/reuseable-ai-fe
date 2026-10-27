/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ai/contracts"],
  experimental: {
    // Uploads go through Server Actions; ai-service caps documents at 20 MB.
    serverActions: { bodySizeLimit: "21mb" },
  },
};
export default nextConfig;
