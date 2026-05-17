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
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
