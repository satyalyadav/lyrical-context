import "server-only";

import { LyricalContextError } from "@/lib/errors";
import { withJsonCache } from "@/lib/cache";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";
import { consumeGeniusBudget } from "@/lib/usage-budget";
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
const SEARCH_CACHE_VERSION = 2;
const SEARCH_TTL_SECONDS = 60 * 60 * 24;
const REFERENCES_TTL_SECONDS = 60 * 30;
const REFERENCES_CACHE_VERSION = 12;
const MAX_REFERENT_PAGES = 6;
const REFERENTS_PER_PAGE = 50;
const GENIUS_REFERENT_TIMEOUT_MS = 15_000;
const FUZZY_POSITION_MAX_CANDIDATES = 4;
const ANNOTATION_SORT_BUCKET_SIZE = 1000;
const LYRIC_POSITION_SORT_BUCKET_SIZE = 10_000;
const FALLBACK_SORT_BASE = 1_000_000_000;
const DEFAULT_LYRIC_LOOKUP_TIMEOUT_MS = 4000;
const FUZZY_POSITION_MIN_TOKENS = 5;
const FUZZY_POSITION_MIN_SIGNIFICANT_TOKENS = 2;
const EXACT_POSITION_MIN_SIGNIFICANT_TOKENS = 4;
const FUZZY_POSITION_MIN_SCORE = 0.8;
const FUZZY_POSITION_MAX_TOKEN_DELTA = 2;
const FUZZY_POSITION_MAX_ANCHOR_TOKENS = 4;
const FUZZY_POSITION_MAX_CANDIDATE_TOKENS = 80;
const FUZZY_POSITION_MAX_WINDOW_EVALUATIONS = 3000;
const POSITION_CANDIDATE_MAX_CHUNK_LINES = 4;
const POSITION_CANDIDATE_MAX_JOIN_TOKENS = 24;
const POSITION_CANDIDATE_MAX_JOIN_VARIANTS = 16;

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
  lyricLookupTimeoutMs?: number;
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

type LyricPositionSearchContext = {
  normalizedLyrics: string;
  lyricTokens: LyricToken[];
  lyricTokenIndex: Map<string, number[]>;
};

export async function searchGeniusSongs(query: string, limit = 12) {
  const key = `genius:search:v${SEARCH_CACHE_VERSION}:${query.toLocaleLowerCase()}:${limit}`;

  return withJsonCache(key, SEARCH_TTL_SECONDS, async () => {
    const payload = await geniusRequest<GeniusSearchResponse>(
      `/search?q=${encodeURIComponent(query)}`
    );

    return (payload.response?.hits ?? [])
      .flatMap((hit) => (hit.result ? [hit.result] : []))
      .slice(0, limit)
      .map((song) => normalizeGeniusSong(song));
  });
}

export async function getGeniusSongReferences(
  songId: string,
  orderContext?: SongReferenceOrderContext
) {
  const resolvedOrderContext = await resolveSongReferenceOrderContext(
    songId,
    orderContext
  );
  const canResolveLyricOrder = Boolean(
    resolvedOrderContext.title && resolvedOrderContext.artist
  );
  const lyricLookupTimeoutMs =
    resolvedOrderContext.lyricLookupTimeoutMs ?? DEFAULT_LYRIC_LOOKUP_TIMEOUT_MS;
  const key = `genius:references:v${REFERENCES_CACHE_VERSION}:${songId}:${
    canResolveLyricOrder ? `lyric-order:${lyricLookupTimeoutMs}` : "api-order"
  }`;

  return withJsonCache(key, REFERENCES_TTL_SECONDS, async () => {
    const lyricTextsPromise = fetchLyricOrderTexts(resolvedOrderContext).catch(
      () => []
    );
    const referents = await fetchGeniusReferents(songId);

    const lyricPositions = await resolveReferentLyricPositions(
      referents,
      lyricTextsPromise
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

async function fetchGeniusReferents(songId: string) {
  const firstPageReferents = await fetchGeniusReferentPage(songId, 1);

  if (firstPageReferents.length < REFERENTS_PER_PAGE) {
    return firstPageReferents;
  }

  const remainingPageResults = await Promise.all(
    Array.from({ length: MAX_REFERENT_PAGES - 1 }, (_, index) =>
      fetchGeniusReferentPage(songId, index + 2).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason })
      )
    )
  );
  const referents = [...firstPageReferents];

  for (const pageResult of remainingPageResults) {
    if (pageResult.status === "rejected") {
      throw pageResult.reason;
    }

    referents.push(...pageResult.value);

    if (pageResult.value.length < REFERENTS_PER_PAGE) {
      break;
    }
  }

  return referents;
}

async function fetchGeniusReferentPage(songId: string, page: number) {
  const payload = await geniusRequest<GeniusReferentsResponse>(
    `/referents?song_id=${encodeURIComponent(
      songId
    )}&text_format=plain,html&per_page=${REFERENTS_PER_PAGE}&page=${page}`,
    GENIUS_REFERENT_TIMEOUT_MS
  );

  return payload.response?.referents ?? [];
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
      featuredArtists: (song.featured_artists ?? []).flatMap((artist) =>
        artist.name ? [artist.name] : []
      ),
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
    .flatMap((annotation, annotationIndex) => {
      const bodyPlain =
        annotation.body?.plain ??
        (annotation.body?.html ? stripHtml(annotation.body.html) : "");
      const annotationText = truncateText(bodyPlain, 900);

      if (!annotationText) {
        return [];
      }

      const state = annotation.state ?? null;
      const classification = referent.classification ?? null;
      const verified = Boolean(annotation.verified);

      return [
        {
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
        } satisfies Reference,
      ];
    });
}

function sortReferencesChronologically(references: Reference[]) {
  return references.toSorted((first, second) => first.sortIndex - second.sortIndex);
}

async function resolveReferentLyricPositions(
  referents: GeniusReferent[],
  lyricTextsPromise: Promise<LyricOrderText[]>
) {
  const lyricTexts = await lyricTextsPromise;
  const positions = new Map<number, number>();

  if (!lyricTexts.length) {
    return positions;
  }

  const lyricPositionSets = lyricTexts.map((lyricText) => {
    const searchContext = createLyricPositionSearchContext(lyricText.lyrics);
    const sourcePositions = new Map<number, number>();

    for (const referent of referents) {
      const position = findFragmentPositionInContext(
        referent.range?.content ?? referent.fragment ?? "",
        searchContext
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
  const fallbackPositions = new Map<number, number>();

  for (const lyricSet of lyricPositionSets) {
    if (lyricSet === primaryLyricSet) {
      continue;
    }

    for (const [referentId, fallbackPosition] of lyricSet.positions) {
      if (fallbackPositions.has(referentId)) {
        continue;
      }

      fallbackPositions.set(
        referentId,
        projectLyricPosition(fallbackPosition, lyricSet, primaryLyricSet)
      );
    }
  }

  for (const referent of referents) {
    const primaryPosition = primaryLyricSet.positions.get(referent.id);

    if (primaryPosition !== undefined) {
      positions.set(referent.id, primaryPosition);
      continue;
    }

    const fallbackPosition = fallbackPositions.get(referent.id);

    if (fallbackPosition !== undefined) {
      positions.set(referent.id, fallbackPosition);
    }
  }

  return positions;
}

async function resolveSongReferenceOrderContext(
  songId: string,
  orderContext?: SongReferenceOrderContext
): Promise<SongReferenceOrderContext> {
  const title = orderContext?.title?.trim();
  const artist = orderContext?.artist?.trim();

  if (title && artist) {
    return {
      ...orderContext,
      title,
      artist,
    };
  }

  const { value: songDetails } = await getGeniusSongDetails(songId);

  return {
    ...orderContext,
    title: title ?? songDetails.title,
    artist: artist ?? songDetails.artist,
  };
}

async function fetchLyricOrderTexts(orderContext?: SongReferenceOrderContext) {
  const title = orderContext?.title?.trim();
  const artist = orderContext?.artist?.trim();
  const timeoutMs =
    orderContext?.lyricLookupTimeoutMs ?? DEFAULT_LYRIC_LOOKUP_TIMEOUT_MS;

  if (!title || !artist) {
    return [];
  }

  const lyricResults = await Promise.all([
    fetchLrclibLyrics(artist, title, timeoutMs),
    fetchLyricsOvhLyrics(artist, title, timeoutMs),
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

async function fetchLrclibLyrics(
  artist: string,
  title: string,
  timeoutMs: number
) {
  const url = new URL(`${LRCLIB_API_BASE}/get`);
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);

  const payload = await fetchJsonSafely<LrclibLyricsResponse>(url, timeoutMs);

  if (!payload || payload.instrumental) {
    return null;
  }

  return payload.plainLyrics ?? stripSyncedLyricsTimestamps(payload.syncedLyrics);
}

async function fetchLyricsOvhLyrics(
  artist: string,
  title: string,
  timeoutMs: number
) {
  const url = new URL(
    `${LYRICS_OVH_API_BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(
      title
    )}`
  );
  const payload = await fetchJsonSafely<LyricsOvhResponse>(url, timeoutMs);

  return payload?.lyrics ?? null;
}

async function fetchJsonSafely<T>(url: URL, timeoutMs: number) {
  try {
    const response = await fetchWithTimeout(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "lyrical-context/0.1",
      },
    }, timeoutMs);

    if (!response.ok) {
      return null;
    }

    return await readJsonResponse<T>(response, 512 * 1024);
  } catch {
    return null;
  }
}

function stripSyncedLyricsTimestamps(value?: string | null) {
  return value?.replace(/^\[[\d:.]+]\s*/gm, "") ?? null;
}

export function findFragmentLyricPosition(fragment: string, lyrics: string) {
  return findFragmentPositionInContext(
    fragment,
    createLyricPositionSearchContext(lyrics)
  );
}

function createLyricPositionSearchContext(
  lyrics: string
): LyricPositionSearchContext {
  const normalizedLyrics = normalizeLyricsForPosition(lyrics);
  const lyricTokens = tokenizeNormalizedLyrics(normalizedLyrics);
  const lyricTokenIndex = new Map<string, number[]>();

  lyricTokens.forEach((token, index) => {
    const positions = lyricTokenIndex.get(token.looseValue) ?? [];
    positions.push(index);
    lyricTokenIndex.set(token.looseValue, positions);
  });

  return {
    normalizedLyrics,
    lyricTokens,
    lyricTokenIndex,
  };
}

function findFragmentPositionInContext(
  fragment: string,
  searchContext: LyricPositionSearchContext
) {
  if (!searchContext.normalizedLyrics) {
    return null;
  }

  const normalizedCandidates = getNormalizedFragmentPositionCandidates(fragment);
  let bestExactMatch: { position: number; candidateLength: number } | null = null;

  for (const normalizedCandidate of normalizedCandidates) {
    const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);

    if (
      countSignificantTokens(candidateTokens) <
      EXACT_POSITION_MIN_SIGNIFICANT_TOKENS
    ) {
      continue;
    }

    const position = findNormalizedLyricTextPosition(
      searchContext.normalizedLyrics,
      normalizedCandidate
    );

    if (
      position !== -1 &&
      (!bestExactMatch || normalizedCandidate.length > bestExactMatch.candidateLength)
    ) {
      bestExactMatch = {
        position,
        candidateLength: normalizedCandidate.length,
      };
    }
  }

  if (bestExactMatch) {
    return bestExactMatch.position;
  }

  for (const normalizedCandidate of getFuzzyNormalizedCandidates(
    normalizedCandidates
  )) {
    const position = findFuzzyFragmentPosition(normalizedCandidate, searchContext);

    if (position !== null) {
      return position;
    }
  }

  return null;
}

function getFuzzyNormalizedCandidates(normalizedCandidates: string[]) {
  return normalizedCandidates
    .filter(
      (candidate) =>
        candidate.split(" ").filter(Boolean).length >= FUZZY_POSITION_MIN_TOKENS
    )
    .toSorted((first, second) => second.length - first.length)
    .slice(0, FUZZY_POSITION_MAX_CANDIDATES);
}

function findNormalizedLyricTextPosition(lyrics: string, fragment: string) {
  return lyrics.search(escapeRegExp(fragment));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFuzzyFragmentPosition(
  normalizedCandidate: string,
  searchContext: LyricPositionSearchContext
) {
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  const { lyricTokens } = searchContext;

  if (
    candidateTokens.length < FUZZY_POSITION_MIN_TOKENS ||
    candidateTokens.length > FUZZY_POSITION_MAX_CANDIDATE_TOKENS ||
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
  const windowStarts = getFuzzyCandidateWindowStarts(
    candidateTokens,
    searchContext,
    minWindowSize
  );
  const windowEvaluationCount =
    windowStarts.length * (maxWindowSize - minWindowSize + 1);

  if (windowEvaluationCount > FUZZY_POSITION_MAX_WINDOW_EVALUATIONS) {
    return null;
  }

  for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize += 1) {
    for (const index of windowStarts) {
      if (index > lyricTokens.length - windowSize) {
        continue;
      }

      const score =
        longestCommonTokenSubsequenceLength(
          candidateTokens,
          lyricTokens,
          index,
          windowSize
        ) / Math.max(candidateTokens.length, windowSize);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          score,
          position: lyricTokens[index].position,
        };
      }
    }
  }

  return bestMatch && bestMatch.score >= FUZZY_POSITION_MIN_SCORE
    ? bestMatch.position
    : null;
}

function getFuzzyCandidateWindowStarts(
  candidateTokens: string[],
  searchContext: LyricPositionSearchContext,
  minWindowSize: number
) {
  const candidateAnchors = candidateTokens
    .reduce<
      Array<{ index: number; looseValue: string; lyricIndexes: number[] }>
    >((anchors, token, index) => {
      const looseValue = normalizeLooseLyricToken(token);

      if (isLowSignalLyricToken(looseValue)) {
        return anchors;
      }

      const lyricIndexes = searchContext.lyricTokenIndex.get(looseValue) ?? [];

      if (lyricIndexes.length > 0) {
        anchors.push({ index, looseValue, lyricIndexes });
      }

      return anchors;
    }, [])
    .toSorted(
      (first, second) => first.lyricIndexes.length - second.lyricIndexes.length
    )
    .slice(0, FUZZY_POSITION_MAX_ANCHOR_TOKENS);
  const starts = new Set<number>();

  for (const anchor of candidateAnchors) {
    for (const lyricIndex of anchor.lyricIndexes) {
      for (
        let delta = -FUZZY_POSITION_MAX_TOKEN_DELTA;
        delta <= FUZZY_POSITION_MAX_TOKEN_DELTA;
        delta += 1
      ) {
        const start = lyricIndex - anchor.index + delta;

        if (
          start >= 0 &&
          start <= searchContext.lyricTokens.length - minWindowSize
        ) {
          starts.add(start);
        }
      }
    }
  }

  return Array.from(starts).toSorted((first, second) => first - second);
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
  lyricTokens: LyricToken[],
  windowStart: number,
  windowSize: number
) {
  const previousRow = Array(windowSize + 1).fill(0);
  const currentRow = Array(windowSize + 1).fill(0);

  for (const candidateToken of candidateTokens) {
    const candidateLooseToken = normalizeLooseLyricToken(candidateToken);

    for (let index = 0; index < windowSize; index += 1) {
      const lyricToken = lyricTokens[windowStart + index];

      currentRow[index + 1] =
        candidateToken === lyricToken.value ||
        candidateLooseToken === lyricToken.looseValue
          ? previousRow[index] + 1
          : Math.max(previousRow[index + 1], currentRow[index]);
    }

    for (let index = 0; index < currentRow.length; index += 1) {
      previousRow[index] = currentRow[index];
      currentRow[index] = 0;
    }
  }

  return previousRow[windowSize];
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
  const lines = cleanedFragment.split(/\r?\n/).reduce<string[]>((items, line) => {
    const trimmedLine = line.trim();

    if (trimmedLine) {
      items.push(trimmedLine);
    }

    return items;
  }, []);
  const candidates = [cleanedFragment];
  const maxChunkSize = Math.min(
    lines.length,
    POSITION_CANDIDATE_MAX_CHUNK_LINES
  );

  for (let chunkSize = maxChunkSize; chunkSize >= 1; chunkSize -= 1) {
    for (let index = 0; index <= lines.length - chunkSize; index += 1) {
      candidates.push(lines.slice(index, index + chunkSize).join(" "));
    }
  }

  return Array.from(new Set(candidates));
}

function getNormalizedFragmentPositionCandidates(fragment: string) {
  const normalizedCandidates = getFragmentPositionCandidates(fragment).flatMap(
    (candidate) => {
      const normalizedCandidate = normalizeLyricsForPosition(candidate);

      return normalizedCandidate ? [normalizedCandidate] : [];
    }
  );

  return Array.from(
    new Set(normalizedCandidates.flatMap((candidate) => [
      candidate,
      ...getAdjacentTokenJoinVariants(candidate),
    ]))
  );
}

function getAdjacentTokenJoinVariants(normalizedCandidate: string) {
  const tokens = normalizedCandidate.split(" ").filter(Boolean);

  if (
    tokens.length < 2 ||
    tokens.length > POSITION_CANDIDATE_MAX_JOIN_TOKENS
  ) {
    return [];
  }

  return tokens
    .slice(0, Math.min(tokens.length - 1, POSITION_CANDIDATE_MAX_JOIN_VARIANTS))
    .map((_, index) => [
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

async function geniusRequest<T>(
  path: string,
  timeoutMs = 8_000
): Promise<T> {
  const token = process.env.GENIUS_ACCESS_TOKEN;

  if (!token) {
    throw new LyricalContextError(
      "missing_genius_token",
      "Set GENIUS_ACCESS_TOKEN in .env.local to use Genius references.",
      500
    );
  }

  await consumeGeniusBudget();

  const response = await fetchWithTimeout(
    `${GENIUS_API_BASE}${path}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
    timeoutMs
  );

  if (!response.ok) {
    const body = (await readJsonResponse<
      | { meta?: { message?: string } }
      | null
    >(response, 64 * 1024).catch(() => null)) as
      | { meta?: { message?: string } }
      | null;
    const message = body?.meta?.message ?? "Genius API request failed.";

    throw new LyricalContextError(
      response.status === 429 ? "genius_rate_limited" : "genius_api_error",
      message,
      response.status
    );
  }

  return readJsonResponse<T>(response, 1024 * 1024);
}
