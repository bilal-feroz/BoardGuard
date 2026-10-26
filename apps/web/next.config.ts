import type { NextConfig } from "next";

// Static export: the workstation is a client-side app that talks to the
// BoardGuard vision API (local FastAPI in development, AWS in production).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
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
