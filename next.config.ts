import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.96.175.247'],
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
