import sanitizeHtml from "sanitize-html";

import type { ReferenceCategory } from "@/lib/types";

const FEATURE_PATTERN =
  /\s*(?:\(|\[)?(?:feat\.?|ft\.?|with)\s+[^)\]]+(?:\)|\])?/gi;

const VERSION_PATTERN =
  /\s*(?:\(|\[)(?:clean|explicit|edit(?:ed)?|remaster(?:ed)?|radio edit|album edit|album version|bonus track|deluxe|single version)[^)\]]*(?:\)|\])/gi;

const NON_WORD_PATTERN = /[^\p{L}\p{N}\s]/gu;

const TITLE_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\ba\*+e\b/gi, "asshole"],
  [/\bb['’]?s\b/gi, "bitches"],
];

const DISS_TERMS = [
  "beef",
  "diss",
  "shot",
  "shots",
  "sub",
  "subliminal",
  "respond",
  "response",
  "kendrick",
  "pusha",
  "meek",
  "kanye",
  "metro",
  "future",
  "weeknd",
];

const SAMPLE_TERMS = [
  "sample",
  "samples",
  "sampled",
  "interpolation",
  "interpolates",
  "interpolated",
  "remix",
  "flip",
  "beat",
];

const ANNOTATION_ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

export function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtml(value: string) {
  return compactWhitespace(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
  );
}

export function sanitizeAnnotationHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ANNOTATION_ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["alt", "height", "loading", "src", "title", "width"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
      img: sanitizeHtml.simpleTransform("img", {
        loading: "lazy",
      }),
    },
  }).trim();
}

export function truncateText(value: string, maxLength: number) {
  const text = compactWhitespace(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function normalizeTitle(value: string) {
  return compactWhitespace(
    applyTitleAliases(
      value
        .toLocaleLowerCase()
        .replace(FEATURE_PATTERN, "")
        .replace(VERSION_PATTERN, "")
    ).replace(NON_WORD_PATTERN, " ")
  );
}

export function normalizeTitleForSearch(value: string) {
  return compactWhitespace(
    applyTitleAliases(
      value
        .toLocaleLowerCase()
        .replace(FEATURE_PATTERN, "")
        .replace(VERSION_PATTERN, "")
    )
  );
}

export function normalizeArtist(value: string) {
  return compactWhitespace(
    value.toLocaleLowerCase().replace(/\band\b/g, "&").replace(NON_WORD_PATTERN, " ")
  );
}

export function detectReferenceCategories(input: {
  fragment: string;
  annotation: string;
  verified: boolean;
  state: string | null;
  classification: string | null;
}): ReferenceCategory[] {
  const text = `${input.fragment} ${input.annotation}`.toLocaleLowerCase();
  const categories = new Set<ReferenceCategory>();

  if (DISS_TERMS.some((term) => text.includes(term))) {
    categories.add("diss");
  }

  if (SAMPLE_TERMS.some((term) => text.includes(term))) {
    categories.add("sample-interpolation");
  }

  if (hasLikelyNameOrPlace(input.fragment) || hasLikelyNameOrPlace(input.annotation)) {
    categories.add("names-places");
  }

  if (
    input.verified ||
    input.state === "accepted" ||
    input.classification === "accepted"
  ) {
    categories.add("verified-accepted");
  }

  return Array.from(categories);
}

function hasLikelyNameOrPlace(value: string) {
  return /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(value);
}

function applyTitleAliases(value: string) {
  return TITLE_ALIAS_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}
