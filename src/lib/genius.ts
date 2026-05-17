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
const REFERENCES_CACHE_VERSION = 4;
const MAX_REFERENT_PAGES = 6;
const REFERENTS_PER_PAGE = 50;
const ANNOTATION_SORT_BUCKET_SIZE = 1000;
const LYRIC_POSITION_SORT_BUCKET_SIZE = 10_000;
const FALLBACK_SORT_BASE = 1_000_000_000;
const LYRIC_LOOKUP_TIMEOUT_MS = 4000;

type GeniusSearchResponse = {
  response?: {
    hits?: GeniusHit[];
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
  song_art_image_thumbnail_url?: string;
  song_art_image_url?: string;
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
    },
  };
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
  const lyrics = await fetchLyricOrderText(orderContext);
  const positions = new Map<number, number>();

  if (!lyrics) {
    return positions;
  }

  for (const referent of referents) {
    const position = findFragmentLyricPosition(
      referent.range?.content ?? referent.fragment ?? "",
      lyrics
    );

    if (position !== null) {
      positions.set(referent.id, position);
    }
  }

  return positions;
}

async function fetchLyricOrderText(orderContext?: SongReferenceOrderContext) {
  const title = orderContext?.title?.trim();
  const artist = orderContext?.artist?.trim();

  if (!title || !artist) {
    return null;
  }

  return (
    (await fetchLrclibLyrics(artist, title)) ??
    (await fetchLyricsOvhLyrics(artist, title))
  );
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

  for (const candidate of getFragmentPositionCandidates(fragment)) {
    const normalizedCandidate = normalizeLyricsForPosition(candidate);

    if (!normalizedCandidate) {
      continue;
    }

    const position = normalizedLyrics.indexOf(normalizedCandidate);

    if (position !== -1) {
      return position;
    }
  }

  return null;
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
