import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@elevenlabs/client"],
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
