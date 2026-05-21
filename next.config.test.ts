import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";
import { ALLOWED_REMOTE_IMAGE_HOSTS } from "./src/lib/image-hosts";

describe("next image configuration", () => {
  it("allows current and legacy Genius artwork hosts", () => {
    const hostnames = nextConfig.images?.remotePatterns?.map((pattern) =>
      typeof pattern === "object" && "hostname" in pattern
        ? pattern.hostname
        : null
    );

    expect(hostnames).toContain("images.genius.com");
    expect(hostnames).toContain("images.rapgenius.com");
    expect(hostnames).toEqual([...ALLOWED_REMOTE_IMAGE_HOSTS]);
  });
});
