import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  logging: { incomingRequests: false },
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  serverExternalPackages: ["@grpc/grpc-js", "@grpc/proto-loader"],
  outputFileTracingIncludes: {
    "/api/**": ["./src/server/proto/**"],
  },
};

export default nextConfig;
