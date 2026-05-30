import "server-only";

import { getCachedJson, setCachedJson } from "@/lib/cache";
import { LyricalContextError } from "@/lib/errors";
import {
  getGeniusSongDetails,
  getGeniusSongReferences,
  searchGeniusSongs,
} from "@/lib/genius";
import { getITunesAlbumTracks } from "@/lib/itunes";
import { pickBestSongMatch, type SongMatch } from "@/lib/matching";
import {
  decodeSpotifyAlbumId,
  getSpotifyAlbumTracks,
  searchSpotifyAlbums,
} from "@/lib/spotify";
import { normalizeTitle, normalizeTitleForSearch } from "@/lib/text";
import type {
  AlbumReferenceResponse,
  AlbumTrack,
  SearchResult,
  SearchType,
  SongSearchResult,
  SongReferenceResponse,
  TrackReferenceGroup,
} from "@/lib/types";

const TRACK_MATCH_TTL_SECONDS = 60 * 60 * 24;
const TRACK_MATCH_CACHE_VERSION = 9;
const TRACK_MATCH_CONCURRENCY = 6;
const TRACK_REFERENCE_CONCURRENCY = 6;
const TRACK_SEARCH_RESULT_LIMIT = 8;
const HIGH_CONFIDENCE_TRACK_MATCH = 0.9;
const ALBUM_LYRIC_LOOKUP_TIMEOUT_MS = 2500;
export const MAX_ALBUM_TRACKS = 80;

type TrackMatchResolution = {
  track: AlbumTrack;
  match: SongMatch | null;
  error: string | null;
};

type CachedTrackMatch = {
  match: SongMatch | null;
};

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

  const { value } = await searchSpotifyAlbums(normalizedQuery);
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
  const [{ value: references, source }, { value: songDetails }] = await Promise.all([
    getGeniusSongReferences(songId, {
      title: fallback?.title,
      artist: fallback?.artist,
    }),
    getGeniusSongDetails(songId),
  ]);

  return {
    song: {
      type: "song",
      id: songId,
      title: fallback?.title || songDetails.title,
      artist: fallback?.artist || songDetails.artist,
      artworkUrl: fallback?.artworkUrl ?? songDetails.artworkUrl,
      sourceUrl: fallback?.sourceUrl ?? songDetails.sourceUrl,
      metadata: {
        geniusId: Number(songId),
        releaseYear: songDetails.metadata.releaseYear ?? null,
        albumTitle: songDetails.metadata.albumTitle ?? null,
        featuredArtists: songDetails.metadata.featuredArtists ?? [],
      },
    },
    references,
    source,
  };
}

export async function getAlbumReferenceResponse(
  collectionId: string
): Promise<AlbumReferenceResponse> {
  const spotifyAlbumId = decodeSpotifyAlbumId(collectionId);
  const { value: albumPayload, source: albumSource } = spotifyAlbumId
    ? await getSpotifyAlbumTracks(spotifyAlbumId)
    : await getITunesAlbumTracks(collectionId);

  const album = albumPayload.album;

  if (!album) {
    throw new LyricalContextError(
      "album_not_found",
      "That album could not be found.",
      404
    );
  }

  if (albumPayload.tracks.length > MAX_ALBUM_TRACKS) {
    throw new LyricalContextError(
      "album_too_large",
      `Albums with more than ${MAX_ALBUM_TRACKS} tracks are too expensive to load.`,
      413
    );
  }

  const matchLimiter = createConcurrencyLimiter(TRACK_MATCH_CONCURRENCY);
  const referenceLimiter = createConcurrencyLimiter(TRACK_REFERENCE_CONCURRENCY);
  const tracks = await Promise.all(
    albumPayload.tracks.map((track) =>
      matchLimiter(() => resolveTrackMatchResolution(collectionId, track, album.artist))
        .then((trackMatch) =>
          referenceLimiter(() => resolveTrackReferenceGroup(trackMatch))
        )
    )
  );

  return {
    album,
    tracks,
    source: albumSource,
  };
}

function publicTrackError(error: unknown) {
  return error instanceof Error ? error.message : "This track could not be loaded.";
}

async function resolveTrackMatchResolution(
  collectionId: string,
  track: AlbumTrack,
  albumArtist: string
): Promise<TrackMatchResolution> {
  try {
    return {
      track,
      match: await resolveTrackMatch(collectionId, track, albumArtist),
      error: null,
    };
  } catch (error) {
    return {
      track,
      match: null,
      error: publicTrackError(error),
    };
  }
}

async function resolveTrackReferenceGroup({
  track,
  match,
  error,
}: TrackMatchResolution): Promise<TrackReferenceGroup> {
  if (error) {
    return {
      track,
      matchStatus: "error",
      matchConfidence: null,
      matchedSong: null,
      references: [],
      error,
    };
  }

  if (!match) {
    return {
      track,
      matchStatus: "unmatched",
      matchConfidence: null,
      matchedSong: null,
      references: [],
      error: "No confident Genius match found.",
    };
  }

  try {
    const { value: references } = await getGeniusSongReferences(match.song.id, {
      title: match.song.title,
      artist: match.song.artist,
      lyricLookupTimeoutMs: ALBUM_LYRIC_LOOKUP_TIMEOUT_MS,
    });

    return {
      track,
      matchStatus: "matched",
      matchConfidence: match.confidence,
      matchedSong: match.song,
      references,
      error: null,
    };
  } catch (referenceError) {
    return {
      track,
      matchStatus: "error",
      matchConfidence: null,
      matchedSong: null,
      references: [],
      error: publicTrackError(referenceError),
    };
  }
}

function createConcurrencyLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  function runNext() {
    if (activeCount >= concurrency) {
      return;
    }

    const task = queue.shift();

    if (!task) {
      return;
    }

    activeCount += 1;
    task();
  }

  return function runLimited<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      });
      runNext();
    });
  };
}

async function resolveTrackMatch(
  collectionId: string,
  track: AlbumTrack,
  albumArtist?: string | null
) {
  const cacheKey = `album-track-match:v${TRACK_MATCH_CACHE_VERSION}:${collectionId}:${track.id}`;
  const cached = getCachedJson<CachedTrackMatch>(cacheKey);

  if (cached) {
    return cached.match;
  }

  const candidates = new Map<string, SongSearchResult>();
  const match = await resolveBestTrackMatch(
    track,
    buildTrackSearchQueries(track, albumArtist),
    candidates
  );

  setCachedJson(cacheKey, { match }, TRACK_MATCH_TTL_SECONDS);

  return match;
}

async function resolveBestTrackMatch(
  track: AlbumTrack,
  queries: string[],
  candidates: Map<string, SongSearchResult>,
  queryIndex = 0
): Promise<SongMatch | null> {
  if (queryIndex >= queries.length) {
    return pickBestSongMatch(track, Array.from(candidates.values()));
  }

  const { value: searchResults } = await searchGeniusSongs(
    queries[queryIndex],
    TRACK_SEARCH_RESULT_LIMIT
  );

  for (const song of searchResults) {
    candidates.set(song.id, song);
  }

  const match = pickBestSongMatch(track, Array.from(candidates.values()));

  if (match && match.confidence >= HIGH_CONFIDENCE_TRACK_MATCH) {
    return match;
  }

  return resolveBestTrackMatch(track, queries, candidates, queryIndex + 1);
}

function buildTrackSearchQueries(
  track: AlbumTrack,
  albumArtist?: string | null
) {
  const titleVariants = buildTrackTitleSearchVariants(track.title);
  const artists = [
    track.artist,
    albumArtist,
    firstCreditedArtist(track.artist),
    albumArtist ? firstCreditedArtist(albumArtist) : null,
  ].filter((artist): artist is string => Boolean(artist));
  const queries = artists.flatMap((artist) =>
    titleVariants.map((title) => `${artist} ${title}`)
  );

  if (artists[0]) {
    queries.push(...titleVariants.map((title) => `${title} ${artists[0]}`));
  }

  return uniqueSearchQueries(queries);
}

function buildTrackTitleSearchVariants(title: string) {
  const titleForSearch = normalizeTitleForSearch(title);
  const normalizedTitle = normalizeTitle(title);
  const variants = [
    titleForSearch,
    ...extractSoundtrackTitleVariants(title),
    ...extractLeadingInitialismTitleVariants(title),
  ];

  if (shouldAddCompactInitialismTitle(titleForSearch, normalizedTitle)) {
    variants.push(titleForSearch.replace(/[^\p{L}\p{N}]+/gu, ""));
  }

  variants.push(normalizedTitle);

  return uniqueSearchQueries(variants);
}

function extractSoundtrackTitleVariants(title: string) {
  const variants: string[] = [];
  const dashMatch = title.match(
    /^\s*(.+?)\s+[-–—]\s+(?:theme\s+from|from\s+["“”']?[^"“”']+["“”']?\s+soundtrack|.*\bsoundtrack\b).*/iu
  );
  const parentheticalMatch = title.match(
    /^\s*(.+?)\s*[\[(]\s*(?:theme\s+from|from\s+["“”']?[^"“”']+["“”']?\s+soundtrack|.*\bsoundtrack\b).*[\])]\s*$/iu
  );

  for (const match of [dashMatch, parentheticalMatch]) {
    const variant = match?.[1] ? normalizeTitleForSearch(match[1]) : "";

    if (variant) {
      variants.push(variant);
    }
  }

  return variants;
}

function extractLeadingInitialismTitleVariants(title: string) {
  const match = title.match(/^\s*([\p{Lu}\p{N}][\p{Lu}\p{N}.]*)(?:\s|\()/u);
  const candidate = match?.[1]?.replace(/\.+$/u, "").toLocaleLowerCase() ?? "";

  return candidate.length >= 2 && /[\p{L}]/u.test(candidate) ? [candidate] : [];
}

function shouldAddCompactInitialismTitle(
  titleForSearch: string,
  normalizedTitle: string
) {
  const tokens = normalizedTitle.split(" ").filter(Boolean);

  return (
    /[^\p{L}\p{N}\s]/u.test(titleForSearch) &&
    tokens.length >= 2 &&
    tokens.every((token) => token.length === 1)
  );
}

function firstCreditedArtist(value: string) {
  return value.split(ARTIST_CREDIT_SEPARATOR)[0]?.trim() ?? "";
}

function uniqueSearchQueries(queries: string[]) {
  const seen = new Set<string>();

  return queries.filter((query) => {
    const normalizedQuery = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();

    if (!normalizedQuery || seen.has(normalizedQuery)) {
      return false;
    }

    seen.add(normalizedQuery);
    return true;
  });
}

const ARTIST_CREDIT_SEPARATOR =
  /\s*(?:,|&|\band\b|\bwith\b|\bfeat\.?|\bft\.?|\bx\b)\s*/i;
