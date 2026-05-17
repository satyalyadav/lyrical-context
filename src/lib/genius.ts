import "server-only";

import { LyricalContextError } from "@/lib/errors";
import { withJsonCache } from "@/lib/cache";
import {
  detectReferenceCategories,
  sanitizeAnnotationHtml,
  stripHtml,
  truncateText,
} from "@/lib/text";
import type { Reference, SongSearchResult } from "@/lib/types";

const GENIUS_API_BASE = "https://api.genius.com";
const LRCLIB_API_BASE = "https://lrclib.net/api";
const LYRICS_OVH_API_BASE = "https://api.lyrics.ovh/v1";
const SEARCH_TTL_SECONDS = 60 * 60 * 24;
const REFERENCES_TTL_SECONDS = 60 * 30;
const REFERENCES_CACHE_VERSION = 7;
const MAX_REFERENT_PAGES = 6;
const REFERENTS_PER_PAGE = 50;
const ANNOTATION_SORT_BUCKET_SIZE = 1000;
const LYRIC_POSITION_SORT_BUCKET_SIZE = 10_000;
const FALLBACK_SORT_BASE = 1_000_000_000;
const LYRIC_LOOKUP_TIMEOUT_MS = 4000;
const FUZZY_POSITION_MIN_TOKENS = 5;
const FUZZY_POSITION_MIN_SIGNIFICANT_TOKENS = 2;
const FUZZY_POSITION_MIN_SCORE = 0.8;
const FUZZY_POSITION_MAX_TOKEN_DELTA = 2;

type GeniusSearchResponse = {
  response?: {
    hits?: GeniusHit[];
  };
};

type GeniusSongResponse = {
  response?: {
    song?: GeniusSong;
  };
};

type GeniusHit = {
  result?: GeniusSong;
};

type GeniusSong = {
  id: number;
  title: string;
  full_title?: string;
  url: string;
  api_path?: string;
  release_date_for_display?: string | null;
  song_art_image_thumbnail_url?: string;
  song_art_image_url?: string;
  album?: {
    name?: string | null;
  } | null;
  featured_artists?: Array<{
    name?: string | null;
  }>;
  primary_artist?: {
    name?: string;
  };
};

type GeniusReferentsResponse = {
  response?: {
    referents?: GeniusReferent[];
  };
};

type GeniusReferent = {
  id: number;
  fragment?: string;
  url?: string;
  classification?: string;
  range?: {
    content?: string;
  };
  annotations?: GeniusAnnotation[];
};

type GeniusAnnotation = {
  id: number;
  url?: string;
  state?: string;
  verified?: boolean;
  votes_total?: number;
  body?: {
    plain?: string;
    html?: string;
  };
};

type SongReferenceOrderContext = {
  title?: string | null;
  artist?: string | null;
};

type LrclibLyricsResponse = {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
};

type LyricsOvhResponse = {
  lyrics?: string | null;
};

type LyricOrderText = {
  lyrics: string;
  normalizedLength: number;
};

export async function searchGeniusSongs(query: string, limit = 12) {
  const key = `genius:search:${query.toLocaleLowerCase()}:${limit}`;

  return withJsonCache(key, SEARCH_TTL_SECONDS, async () => {
    const payload = await geniusRequest<GeniusSearchResponse>(
      `/search?q=${encodeURIComponent(query)}`
    );

    return (payload.response?.hits ?? [])
      .map((hit) => hit.result)
      .filter(Boolean)
      .slice(0, limit)
      .map((song) => normalizeGeniusSong(song as GeniusSong));
  });
}

export async function getGeniusSongReferences(
  songId: string,
  orderContext?: SongReferenceOrderContext
) {
  const canResolveLyricOrder = Boolean(orderContext?.title && orderContext.artist);
  const key = `genius:references:v${REFERENCES_CACHE_VERSION}:${songId}:${
    canResolveLyricOrder ? "lyric-order" : "api-order"
  }`;

  return withJsonCache(key, REFERENCES_TTL_SECONDS, async () => {
    const referents: GeniusReferent[] = [];

    for (let page = 1; page <= MAX_REFERENT_PAGES; page += 1) {
      const payload = await geniusRequest<GeniusReferentsResponse>(
        `/referents?song_id=${encodeURIComponent(
          songId
        )}&text_format=plain,html&per_page=${REFERENTS_PER_PAGE}&page=${page}`
      );
      const pageReferents = payload.response?.referents ?? [];

      referents.push(...pageReferents);

      if (pageReferents.length < REFERENTS_PER_PAGE) {
        break;
      }
    }

    const lyricPositions = await resolveReferentLyricPositions(
      referents,
      orderContext
    );
    const references = referents.flatMap((referent, referentIndex) => {
      const lyricPosition = lyricPositions.get(referent.id);
      const sortIndex =
        lyricPosition === undefined
          ? FALLBACK_SORT_BASE + referentIndex * ANNOTATION_SORT_BUCKET_SIZE
          : lyricPosition * LYRIC_POSITION_SORT_BUCKET_SIZE +
            referentIndex * ANNOTATION_SORT_BUCKET_SIZE;

      return normalizeReferent(referent, sortIndex);
    });

    return sortReferencesChronologically(references);
  });
}

export async function getGeniusSongDetails(songId: string) {
  const key = `genius:song:${songId}`;

  return withJsonCache(key, SEARCH_TTL_SECONDS, async () => {
    const payload = await geniusRequest<GeniusSongResponse>(
      `/songs/${encodeURIComponent(songId)}`
    );
    const song = payload.response?.song;

    if (!song) {
      throw new LyricalContextError(
        "song_not_found",
        "That song could not be found on Genius.",
        404
      );
    }

    return normalizeGeniusSong(song);
  });
}

export function normalizeGeniusSong(song: GeniusSong): SongSearchResult {
  return {
    type: "song",
    id: String(song.id),
    title: song.title,
    artist: song.primary_artist?.name ?? "Unknown artist",
    artworkUrl: song.song_art_image_thumbnail_url ?? song.song_art_image_url ?? null,
    sourceUrl: song.url,
    metadata: {
      geniusId: song.id,
      releaseYear: extractReleaseYear(song.release_date_for_display),
      albumTitle: song.album?.name ?? null,
      featuredArtists: (song.featured_artists ?? [])
        .map((artist) => artist.name)
        .filter((name): name is string => Boolean(name)),
    },
  };
}

function extractReleaseYear(value?: string | null) {
  return value?.match(/\b\d{4}\b/)?.[0] ?? null;
}

export function normalizeReferent(
  referent: GeniusReferent,
  referentSortIndex: number
): Reference[] {
  const fragment = truncateText(referent.fragment ?? "Annotated lyric fragment", 360);

  return (referent.annotations ?? [])
    .map((annotation, annotationIndex) => {
      const bodyPlain =
        annotation.body?.plain ??
        (annotation.body?.html ? stripHtml(annotation.body.html) : "");
      const annotationText = truncateText(bodyPlain, 900);

      if (!annotationText) {
        return null;
      }

      const state = annotation.state ?? null;
      const classification = referent.classification ?? null;
      const verified = Boolean(annotation.verified);

      return {
        id: String(annotation.id),
        referentId: String(referent.id),
        sortIndex: referentSortIndex + annotationIndex,
        fragment,
        annotation: annotationText,
        annotationHtml: annotation.body?.html
          ? sanitizeAnnotationHtml(annotation.body.html)
          : null,
        sourceUrl: annotation.url ?? referent.url ?? "https://genius.com",
        state,
        classification,
        verified,
        votesTotal: annotation.votes_total ?? null,
        categories: detectReferenceCategories({
          fragment,
          annotation: annotationText,
          verified,
          state,
          classification,
        }),
      } satisfies Reference;
    })
    .filter((reference): reference is Reference => Boolean(reference));
}

function sortReferencesChronologically(references: Reference[]) {
  return [...references].sort((first, second) => first.sortIndex - second.sortIndex);
}

async function resolveReferentLyricPositions(
  referents: GeniusReferent[],
  orderContext?: SongReferenceOrderContext
) {
  const lyricTexts = await fetchLyricOrderTexts(orderContext);
  const positions = new Map<number, number>();

  if (!lyricTexts.length) {
    return positions;
  }

  const lyricPositionSets = lyricTexts.map((lyricText) => {
    const sourcePositions = new Map<number, number>();

    for (const referent of referents) {
      const position = findFragmentLyricPosition(
        referent.range?.content ?? referent.fragment ?? "",
        lyricText.lyrics
      );

      if (position !== null) {
        sourcePositions.set(referent.id, position);
      }
    }

    return {
      ...lyricText,
      positions: sourcePositions,
    };
  });

  const primaryLyricSet = lyricPositionSets.reduce((best, current) =>
    current.positions.size > best.positions.size ? current : best
  );

  for (const referent of referents) {
    const primaryPosition = primaryLyricSet.positions.get(referent.id);

    if (primaryPosition !== undefined) {
      positions.set(referent.id, primaryPosition);
      continue;
    }

    const fallbackSet = lyricPositionSets.find((lyricSet) =>
      lyricSet.positions.has(referent.id)
    );

    if (!fallbackSet) {
      continue;
    }

    const fallbackPosition = fallbackSet.positions.get(referent.id);

    if (fallbackPosition !== undefined) {
      positions.set(
        referent.id,
        projectLyricPosition(fallbackPosition, fallbackSet, primaryLyricSet)
      );
    }
  }

  return positions;
}

async function fetchLyricOrderTexts(orderContext?: SongReferenceOrderContext) {
  const title = orderContext?.title?.trim();
  const artist = orderContext?.artist?.trim();

  if (!title || !artist) {
    return [];
  }

  const lyricResults = await Promise.all([
    fetchLrclibLyrics(artist, title),
    fetchLyricsOvhLyrics(artist, title),
  ]);
  const seen = new Set<string>();

  return lyricResults.flatMap((lyrics) => {
    const normalizedLyrics = lyrics ? normalizeLyricsForPosition(lyrics) : "";

    if (!lyrics || !normalizedLyrics || seen.has(normalizedLyrics)) {
      return [];
    }

    seen.add(normalizedLyrics);
    return [
      {
        lyrics,
        normalizedLength: normalizedLyrics.length,
      } satisfies LyricOrderText,
    ];
  });
}

async function fetchLrclibLyrics(artist: string, title: string) {
  const url = new URL(`${LRCLIB_API_BASE}/get`);
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);

  const payload = await fetchJsonSafely<LrclibLyricsResponse>(url);

  if (!payload || payload.instrumental) {
    return null;
  }

  return payload.plainLyrics ?? stripSyncedLyricsTimestamps(payload.syncedLyrics);
}

async function fetchLyricsOvhLyrics(artist: string, title: string) {
  const url = new URL(
    `${LYRICS_OVH_API_BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(
      title
    )}`
  );
  const payload = await fetchJsonSafely<LyricsOvhResponse>(url);

  return payload?.lyrics ?? null;
}

async function fetchJsonSafely<T>(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LYRIC_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "lyrical-context/0.1",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripSyncedLyricsTimestamps(value?: string | null) {
  return value?.replace(/^\[[\d:.]+]\s*/gm, "") ?? null;
}

export function findFragmentLyricPosition(fragment: string, lyrics: string) {
  const normalizedLyrics = normalizeLyricsForPosition(lyrics);

  if (!normalizedLyrics) {
    return null;
  }

  const normalizedCandidates = getNormalizedFragmentPositionCandidates(fragment);

  for (const normalizedCandidate of normalizedCandidates) {
    const position = normalizedLyrics.indexOf(normalizedCandidate);

    if (position !== -1) {
      return position;
    }
  }

  const lyricTokens = tokenizeNormalizedLyrics(normalizedLyrics);

  for (const normalizedCandidate of normalizedCandidates) {
    const position = findFuzzyFragmentPosition(normalizedCandidate, lyricTokens);

    if (position !== null) {
      return position;
    }
  }

  return null;
}

function findFuzzyFragmentPosition(
  normalizedCandidate: string,
  lyricTokens: LyricToken[]
) {
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);

  if (
    candidateTokens.length < FUZZY_POSITION_MIN_TOKENS ||
    countSignificantTokens(candidateTokens) <
      FUZZY_POSITION_MIN_SIGNIFICANT_TOKENS
  ) {
    return null;
  }

  let bestMatch: { score: number; position: number } | null = null;
  const minWindowSize = Math.max(
    FUZZY_POSITION_MIN_TOKENS,
    candidateTokens.length - FUZZY_POSITION_MAX_TOKEN_DELTA
  );
  const maxWindowSize = candidateTokens.length + FUZZY_POSITION_MAX_TOKEN_DELTA;

  for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize += 1) {
    for (let index = 0; index <= lyricTokens.length - windowSize; index += 1) {
      const windowTokens = lyricTokens.slice(index, index + windowSize);
      const score =
        longestCommonTokenSubsequenceLength(candidateTokens, windowTokens) /
        Math.max(candidateTokens.length, windowTokens.length);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          score,
          position: windowTokens[0].position,
        };
      }
    }
  }

  return bestMatch && bestMatch.score >= FUZZY_POSITION_MIN_SCORE
    ? bestMatch.position
    : null;
}

type LyricToken = {
  value: string;
  looseValue: string;
  position: number;
};

function tokenizeNormalizedLyrics(value: string): LyricToken[] {
  return Array.from(value.matchAll(/\S+/g), (match) => {
    const token = match[0];

    return {
      value: token,
      looseValue: normalizeLooseLyricToken(token),
      position: match.index ?? 0,
    };
  });
}

function longestCommonTokenSubsequenceLength(
  candidateTokens: string[],
  lyricTokens: LyricToken[]
) {
  const previousRow = Array(lyricTokens.length + 1).fill(0);
  const currentRow = Array(lyricTokens.length + 1).fill(0);

  for (const candidateToken of candidateTokens) {
    const candidateLooseToken = normalizeLooseLyricToken(candidateToken);

    for (let index = 0; index < lyricTokens.length; index += 1) {
      currentRow[index + 1] =
        candidateToken === lyricTokens[index].value ||
        candidateLooseToken === lyricTokens[index].looseValue
          ? previousRow[index] + 1
          : Math.max(previousRow[index + 1], currentRow[index]);
    }

    for (let index = 0; index < currentRow.length; index += 1) {
      previousRow[index] = currentRow[index];
      currentRow[index] = 0;
    }
  }

  return previousRow[lyricTokens.length];
}

function countSignificantTokens(tokens: string[]) {
  return tokens.filter((token) => !isLowSignalLyricToken(token)).length;
}

function isLowSignalLyricToken(token: string) {
  return token.length <= 1 || LOW_SIGNAL_LYRIC_TOKENS.has(token);
}

function normalizeLooseLyricToken(token: string) {
  return token.endsWith("ing") && token.length > 5 ? token.slice(0, -1) : token;
}

const LOW_SIGNAL_LYRIC_TOKENS = new Set([
  "a",
  "an",
  "and",
  "be",
  "for",
  "i",
  "in",
  "is",
  "it",
  "m",
  "my",
  "of",
  "on",
  "the",
  "to",
  "uh",
  "yeah",
]);

function projectLyricPosition(
  position: number,
  source: LyricOrderText,
  target: LyricOrderText
) {
  if (source.normalizedLength <= 0 || target.normalizedLength <= 0) {
    return position;
  }

  return Math.round((position / source.normalizedLength) * target.normalizedLength);
}

function getFragmentPositionCandidates(fragment: string) {
  const cleanedFragment = removeLyricSectionLabels(fragment);
  const lines = cleanedFragment
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [cleanedFragment];

  for (let chunkSize = lines.length; chunkSize >= 1; chunkSize -= 1) {
    for (let index = 0; index <= lines.length - chunkSize; index += 1) {
      candidates.push(lines.slice(index, index + chunkSize).join(" "));
    }
  }

  return Array.from(new Set(candidates));
}

function getNormalizedFragmentPositionCandidates(fragment: string) {
  const normalizedCandidates = getFragmentPositionCandidates(fragment)
    .map((candidate) => normalizeLyricsForPosition(candidate))
    .filter(Boolean);

  return Array.from(
    new Set(normalizedCandidates.flatMap((candidate) => [
      candidate,
      ...getAdjacentTokenJoinVariants(candidate),
    ]))
  );
}

function getAdjacentTokenJoinVariants(normalizedCandidate: string) {
  const tokens = normalizedCandidate.split(" ").filter(Boolean);

  if (tokens.length < 2) {
    return [];
  }

  return tokens.slice(0, -1).map((_, index) => [
    ...tokens.slice(0, index),
    `${tokens[index]}${tokens[index + 1]}`,
    ...tokens.slice(index + 2),
  ].join(" "));
}

function removeLyricSectionLabels(value: string) {
  return value.replace(/^\s*\[[^\]]+]\s*$/gm, " ");
}

function normalizeLyricsForPosition(value: string) {
  return removeLyricSectionLabels(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\bwoah\b/gi, "whoa")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function geniusRequest<T>(path: string): Promise<T> {
  const token = process.env.GENIUS_ACCESS_TOKEN;

  if (!token) {
    throw new LyricalContextError(
      "missing_genius_token",
      "Set GENIUS_ACCESS_TOKEN in .env.local to use Genius references.",
      500
    );
  }

  const response = await fetch(`${GENIUS_API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { meta?: { message?: string } }
      | null;
    const message = body?.meta?.message ?? "Genius API request failed.";

    throw new LyricalContextError(
      response.status === 429 ? "genius_rate_limited" : "genius_api_error",
      message,
      response.status
    );
  }

  return (await response.json()) as T;
}
