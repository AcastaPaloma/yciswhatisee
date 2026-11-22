import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@elevenlabs/client"],
  // Let phones reach the dev server through the Cloudflare tunnel (Next blocks unknown dev origins).
  allowedDevOrigins: ["*.trycloudflare.com"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
