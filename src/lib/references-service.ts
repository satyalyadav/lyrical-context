import "server-only";

import { getCachedJson, setCachedJson } from "@/lib/cache";
import { LyricalContextError } from "@/lib/errors";
import {
  getGeniusSongReferences,
  searchGeniusSongs,
} from "@/lib/genius";
import { getITunesAlbumTracks, searchITunesAlbums } from "@/lib/itunes";
import { pickBestSongMatch } from "@/lib/matching";
import type {
  AlbumReferenceResponse,
  SearchResult,
  SearchType,
  SongReferenceResponse,
  TrackReferenceGroup,
} from "@/lib/types";

const TRACK_MATCH_TTL_SECONDS = 60 * 60 * 24;

export async function search(type: SearchType, query: string) {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length < 2) {
    throw new LyricalContextError(
      "short_query",
      "Search for at least two characters.",
      400
    );
  }

  if (type === "song") {
    const { value } = await searchGeniusSongs(normalizedQuery);
    return value satisfies SearchResult[];
  }

  const { value } = await searchITunesAlbums(normalizedQuery);
  return value satisfies SearchResult[];
}

export async function getSongReferenceResponse(
  songId: string,
  fallback?: {
    title?: string | null;
    artist?: string | null;
    artworkUrl?: string | null;
    sourceUrl?: string | null;
  }
): Promise<SongReferenceResponse> {
  const { value: references, source } = await getGeniusSongReferences(songId);

  return {
    song: {
      type: "song",
      id: songId,
      title: fallback?.title || "Selected song",
      artist: fallback?.artist || "Genius",
      artworkUrl: fallback?.artworkUrl ?? null,
      sourceUrl:
        fallback?.sourceUrl ?? `https://genius.com/songs/${encodeURIComponent(songId)}`,
      metadata: {
        geniusId: Number(songId),
      },
    },
    references,
    source,
  };
}

export async function getAlbumReferenceResponse(
  collectionId: string
): Promise<AlbumReferenceResponse> {
  const { value: albumPayload, source: albumSource } =
    await getITunesAlbumTracks(collectionId);

  if (!albumPayload.album) {
    throw new LyricalContextError(
      "album_not_found",
      "That album could not be found in iTunes.",
      404
    );
  }

  const tracks = await mapWithConcurrency(albumPayload.tracks, 3, async (track) => {
    try {
      const match = await resolveTrackMatch(collectionId, track);

      if (!match) {
        return {
          track,
          matchStatus: "unmatched",
          matchConfidence: null,
          matchedSong: null,
          references: [],
          error: "No confident Genius match found.",
        } satisfies TrackReferenceGroup;
      }

      const { value: references } = await getGeniusSongReferences(match.song.id);

      return {
        track,
        matchStatus: "matched",
        matchConfidence: match.confidence,
        matchedSong: match.song,
        references,
        error: null,
      } satisfies TrackReferenceGroup;
    } catch (error) {
      return {
        track,
        matchStatus: "error",
        matchConfidence: null,
        matchedSong: null,
        references: [],
        error:
          error instanceof Error
            ? error.message
            : "This track could not be loaded.",
      } satisfies TrackReferenceGroup;
    }
  });

  return {
    album: albumPayload.album,
    tracks,
    source: albumSource,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

async function resolveTrackMatch(
  collectionId: string,
  track: Parameters<typeof pickBestSongMatch>[0]
) {
  const cacheKey = `album-track-match:${collectionId}:${track.id}`;
  const cached = getCachedJson<ReturnType<typeof pickBestSongMatch>>(cacheKey);

  if (cached !== null) {
    return cached;
  }

  const { value: candidates } = await searchGeniusSongs(
    `${track.artist} ${track.title}`,
    8
  );
  const match = pickBestSongMatch(track, candidates);
  setCachedJson(cacheKey, match, TRACK_MATCH_TTL_SECONDS);

  return match;
}
