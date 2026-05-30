import "server-only";

import { withJsonCache } from "@/lib/cache";
import { LyricalContextError } from "@/lib/errors";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";
import type { AlbumSearchResult, AlbumTrack } from "@/lib/types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_SPOTIFY_MARKET = "US";

type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

type SpotifyArtist = {
  name: string;
};

type SpotifyAlbum = {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  external_urls?: {
    spotify?: string;
  };
  images?: SpotifyImage[];
  release_date?: string;
  total_tracks?: number;
};

type SpotifyTrack = {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  disc_number?: number;
  track_number?: number;
  explicit?: boolean;
};

type SpotifyPage<T> = {
  items?: T[];
  next?: string | null;
};

type SpotifySearchResponse = {
  albums?: SpotifyPage<SpotifyAlbum>;
};

type SpotifyAlbumResponse = SpotifyAlbum & {
  tracks?: SpotifyPage<SpotifyTrack>;
};

type SpotifyTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type SpotifyToken = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: SpotifyToken | null = null;

export function resetSpotifyForTests() {
  tokenCache = null;
}

export async function searchSpotifyAlbums(query: string, limit = 12) {
  const market = getSpotifyMarket();
  const key = `spotify:album-search:${market}:${query.toLocaleLowerCase()}:${limit}`;

  return withJsonCache(key, SPOTIFY_TTL_SECONDS, async () => {
    const payload = await spotifyRequest<SpotifySearchResponse>(
      `/search?q=${encodeURIComponent(query)}&type=album&market=${market}&limit=${limit}`
    );

    return (payload.albums?.items ?? []).map(normalizeSpotifyAlbum);
  });
}

export async function getSpotifyAlbumTracks(albumId: string) {
  const market = getSpotifyMarket();
  const key = `spotify:album-tracks:${market}:${albumId}`;

  return withJsonCache(key, SPOTIFY_TTL_SECONDS, async () => {
    const album = await spotifyRequest<SpotifyAlbumResponse>(
      `/albums/${encodeURIComponent(albumId)}?market=${market}`
    );
    const tracks = [...(album.tracks?.items ?? [])];
    let nextUrl = album.tracks?.next ?? null;

    while (nextUrl) {
      const page = await spotifyRequestUrl<SpotifyPage<SpotifyTrack>>(nextUrl);
      tracks.push(...(page.items ?? []));
      nextUrl = page.next ?? null;
    }

    return {
      album: normalizeSpotifyAlbum(album),
      tracks: tracks.map(normalizeSpotifyTrack),
    };
  });
}

export function normalizeSpotifyAlbum(album: SpotifyAlbum): AlbumSearchResult {
  return {
    type: "album",
    id: encodeSpotifyAlbumId(album.id),
    title: album.name,
    artist: formatSpotifyArtists(album.artists),
    artworkUrl: pickSpotifyArtwork(album.images),
    sourceUrl:
      album.external_urls?.spotify ?? `https://open.spotify.com/album/${album.id}`,
    metadata: {
      collectionId: null,
      spotifyId: album.id,
      provider: "spotify",
      trackCount: album.total_tracks ?? null,
      releaseYear: album.release_date ? album.release_date.slice(0, 4) : null,
    },
  };
}

export function normalizeSpotifyTrack(track: SpotifyTrack): AlbumTrack {
  return {
    id: track.id,
    title: track.name,
    artist: formatSpotifyArtists(track.artists),
    trackNumber: track.track_number ?? 0,
    discNumber: track.disc_number ?? 1,
    explicitness: track.explicit ? "explicit" : "notExplicit",
  };
}

export function encodeSpotifyAlbumId(albumId: string) {
  return `spotify:${albumId}`;
}

export function decodeSpotifyAlbumId(value: string) {
  return value.startsWith("spotify:") ? value.slice("spotify:".length) : null;
}

export function isSpotifyAlbumId(value: string) {
  return /^[A-Za-z0-9]{1,64}$/u.test(value);
}

async function spotifyRequest<T>(path: string): Promise<T> {
  return spotifyRequestUrl(`${SPOTIFY_API_BASE}${path}`);
}

async function spotifyRequestUrl<T>(url: string): Promise<T> {
  const token = await getSpotifyAccessToken();
  const response = await fetchWithTimeout(
    url,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    8_000
  );

  if (!response.ok) {
    throw new Error(`Spotify request failed with ${response.status}`);
  }

  return readJsonResponse<T>(response, 1024 * 1024);
}

async function getSpotifyAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret } = getSpotifyCredentials();
  const response = await fetchWithTimeout(
    SPOTIFY_TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString(
          "base64"
        )}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    },
    8_000
  );

  if (!response.ok) {
    throw new Error(`Spotify token request failed with ${response.status}`);
  }

  const payload = await readJsonResponse<SpotifyTokenResponse>(response, 16 * 1024);

  if (!payload.access_token) {
    throw new Error("Spotify token response did not include an access token.");
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return tokenCache.accessToken;
}

function getSpotifyCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new LyricalContextError(
      "spotify_not_configured",
      "Spotify album search is not configured.",
      503
    );
  }

  return { clientId, clientSecret };
}

function getSpotifyMarket() {
  return process.env.SPOTIFY_MARKET?.trim().toUpperCase() || DEFAULT_SPOTIFY_MARKET;
}

function formatSpotifyArtists(artists: SpotifyArtist[] | undefined) {
  return artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown";
}

function pickSpotifyArtwork(images: SpotifyImage[] | undefined) {
  return images?.[0]?.url ?? null;
}
