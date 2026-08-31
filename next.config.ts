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
  async rewrites() {
    return [
      {
        source: '/brands/:brand/payment-approvals/submit',
        destination: '/brands/:brand/approvals/submit',
      },
      {
        source: '/api/brands/:brand/approvals/resubmit',
        destination: '/api/brands/kia/approvals/resubmit',
      },
    ];
  },
};

export default nextConfig;
