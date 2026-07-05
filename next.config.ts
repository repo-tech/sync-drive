import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

  experimental: {
    optimizePackageImports: [
      "@google/genai",
      "mongodb",
    ],
  },
};

export default nextConfig;
