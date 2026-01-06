/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@dubdub/shared"],
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
    NEXT_PUBLIC_BOT_USERNAME: process.env.NEXT_PUBLIC_BOT_USERNAME || "DubDubBot",
  },
};

module.exports = nextConfig;

