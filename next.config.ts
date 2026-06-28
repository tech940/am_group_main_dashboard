import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === 'development'

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  distDir: isDevelopment ? '.next' : '.next-build',
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.96.175.247'],
  experimental: {
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
