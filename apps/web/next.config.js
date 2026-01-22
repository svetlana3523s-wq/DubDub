/** @type {import('next').NextConfig} */
const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME;
if (!botUsername || !botUsername.trim()) {
  throw new Error("NEXT_PUBLIC_BOT_USERNAME is required");
}

const nextConfig = {
  transpilePackages: ["@dubdub/shared"],
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
    NEXT_PUBLIC_BOT_USERNAME: botUsername,
  },
  // Generate unique build ID to bust cache
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

module.exports = nextConfig;
