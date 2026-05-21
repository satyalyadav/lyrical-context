import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

import { ALLOWED_REMOTE_IMAGE_HOSTS } from "./src/lib/image-hosts";

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
    remotePatterns: ALLOWED_REMOTE_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https",
      hostname,
    })),
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
