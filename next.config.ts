import type { NextConfig } from "next";
import dns from "node:dns";

// Prevent Node.js connect timeouts caused by unroutable IPv6 / NAT64 DNS addresses
dns.setDefaultResultOrder("ipv4first");

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  allowedDevOrigins: ['localhost', '127.0.0.1', '10.96.175.247'],
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
