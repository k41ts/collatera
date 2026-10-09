import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Jaga-jaga file lokal (upload/DB lama) di dalam folder app: jangan sampai file watcher dev ikut bereaksi
  // (memicu rebuild di tengah request dan error "Unexpected end of JSON input").
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.next/**", "**/uploads/**", "**/prisma/*.db", "**/prisma/*.db-journal"],
      };
    }
    return config;
  },
};

export default nextConfig;
