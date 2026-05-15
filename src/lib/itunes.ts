import "server-only";

import { withJsonCache } from "@/lib/cache";
import type { AlbumSearchResult, AlbumTrack } from "@/lib/types";

const ITUNES_API_BASE = "https://itunes.apple.com";
const ITUNES_TTL_SECONDS = 60 * 60 * 24;

type ITunesSearchResponse = {
  results?: ITunesAlbum[];
};

type ITunesLookupResponse = {
  results?: Array<ITunesAlbum | ITunesTrack>;
};

type ITunesAlbum = {
  wrapperType: "collection";
  collectionType?: string;
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
  releaseDate?: string;
  trackCount?: number;
};

type ITunesTrack = {
  wrapperType: "track";
  trackId: number;
  trackName: string;
  artistName: string;
  trackNumber?: number;
  discNumber?: number;
  trackExplicitness?: string;
};

export async function searchITunesAlbums(query: string, limit = 12) {
  const key = `itunes:album-search:${query.toLocaleLowerCase()}:${limit}`;

  return withJsonCache(key, ITUNES_TTL_SECONDS, async () => {
    const payload = await itunesRequest<ITunesSearchResponse>(
      `/search?term=${encodeURIComponent(
        query
      )}&entity=album&media=music&limit=${limit}`
    );

    return (payload.results ?? []).map(normalizeITunesAlbum);
  });
}

export async function getITunesAlbumTracks(collectionId: string) {
  const key = `itunes:album-tracks:${collectionId}`;

  return withJsonCache(key, ITUNES_TTL_SECONDS, async () => {
    const payload = await itunesRequest<ITunesLookupResponse>(
      `/lookup?id=${encodeURIComponent(collectionId)}&entity=song`
    );
    const results = payload.results ?? [];
    const album = results.find(
      (result): result is ITunesAlbum => result.wrapperType === "collection"
    );
    const tracks = results
      .filter((result): result is ITunesTrack => result.wrapperType === "track")
      .sort((a, b) => {
        const discDelta = (a.discNumber ?? 1) - (b.discNumber ?? 1);
        return discDelta || (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
      });

    return {
      album: album ? normalizeITunesAlbum(album) : null,
      tracks: tracks.map(normalizeITunesTrack),
    };
  });
}

export function normalizeITunesAlbum(album: ITunesAlbum): AlbumSearchResult {
  return {
    type: "album",
    id: String(album.collectionId),
    title: album.collectionName,
    artist: album.artistName,
    artworkUrl: upscaleArtwork(album.artworkUrl100),
    sourceUrl: album.collectionViewUrl ?? "https://music.apple.com",
    metadata: {
      collectionId: album.collectionId,
      trackCount: album.trackCount ?? null,
      releaseYear: album.releaseDate ? album.releaseDate.slice(0, 4) : null,
    },
  };
}

export function normalizeITunesTrack(track: ITunesTrack): AlbumTrack {
  return {
    id: String(track.trackId),
    title: track.trackName,
    artist: track.artistName,
    trackNumber: track.trackNumber ?? 0,
    discNumber: track.discNumber ?? 1,
    explicitness: track.trackExplicitness ?? null,
  };
}

function upscaleArtwork(url: string | undefined) {
  if (!url) {
    return null;
  }

  return url.replace(/100x100bb\.(jpg|png)$/i, "600x600bb.$1");
}

async function itunesRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${ITUNES_API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`iTunes request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}
