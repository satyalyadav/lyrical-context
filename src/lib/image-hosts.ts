export const ALLOWED_REMOTE_IMAGE_HOSTS = [
  "images.genius.com",
  "images.rapgenius.com",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
] as const;

const allowedRemoteImageHosts = new Set<string>(ALLOWED_REMOTE_IMAGE_HOSTS);

export function isAllowedRemoteImageUrl(
  value: string | null | undefined
): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedRemoteImageHosts.has(url.hostname);
  } catch {
    return false;
  }
}
