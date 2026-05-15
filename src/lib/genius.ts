import "server-only";

import { LyricalContextError } from "@/lib/errors";
import { withJsonCache } from "@/lib/cache";
import {
  detectReferenceCategories,
  stripHtml,
  truncateText,
} from "@/lib/text";
import type { Reference, SongSearchResult } from "@/lib/types";

const GENIUS_API_BASE = "https://api.genius.com";
const SEARCH_TTL_SECONDS = 60 * 60 * 24;
const REFERENCES_TTL_SECONDS = 60 * 30;
const MAX_REFERENT_PAGES = 6;
const REFERENTS_PER_PAGE = 50;

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

export async function getGeniusSongReferences(songId: string) {
  const key = `genius:references:${songId}`;

  return withJsonCache(key, REFERENCES_TTL_SECONDS, async () => {
    const references: Reference[] = [];

    for (let page = 1; page <= MAX_REFERENT_PAGES; page += 1) {
      const payload = await geniusRequest<GeniusReferentsResponse>(
        `/referents?song_id=${encodeURIComponent(
          songId
        )}&text_format=plain,html&per_page=${REFERENTS_PER_PAGE}&page=${page}`
      );
      const referents = payload.response?.referents ?? [];

      references.push(...referents.flatMap(normalizeReferent));

      if (referents.length < REFERENTS_PER_PAGE) {
        break;
      }
    }

    return references;
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

export function normalizeReferent(referent: GeniusReferent): Reference[] {
  const fragment = truncateText(referent.fragment ?? "Annotated lyric fragment", 360);

  return (referent.annotations ?? [])
    .map((annotation) => {
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
        fragment,
        annotation: annotationText,
        annotationHtml: annotation.body?.html ?? null,
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
