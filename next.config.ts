import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const loopbackOrigins = ["localhost", "127.0.0.1"];
const localNetworkOrigins = Object.values(networkInterfaces())
  .flat()
  .flatMap((address) =>
    address &&
      address.family === "IPv4" &&
      !address.internal
      ? [address.address]
      : []
  );

const nextConfig: NextConfig = {
  allowedDevOrigins: [...loopbackOrigins, ...localNetworkOrigins],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.genius.com",
      },
      {
        protocol: "https",
        hostname: "is1-ssl.mzstatic.com",
      },
      {
        protocol: "https",
        hostname: "is2-ssl.mzstatic.com",
      },
      {
        protocol: "https",
        hostname: "is3-ssl.mzstatic.com",
      },
      {
        protocol: "https",
        hostname: "is4-ssl.mzstatic.com",
      },
      {
        protocol: "https",
        hostname: "is5-ssl.mzstatic.com",
      },
    ],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
