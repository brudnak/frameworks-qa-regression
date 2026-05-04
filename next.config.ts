import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/signing-check": ["./bin/slsactl"],
  },
};

export default nextConfig;
