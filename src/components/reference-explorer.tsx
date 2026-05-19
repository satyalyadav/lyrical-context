"use client";

import {
  Album,
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  Disc3,
  Loader2,
  Music2,
  Search,
  Target,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import { ReportIssueDialog } from "@/components/report-issue-dialog";
import { getApiRequestHeaders } from "@/lib/api-client";
import type {
  AlbumReferenceResponse,
  ApiErrorBody,
  Reference,
  ReferenceCategory,
  SearchResult,
  SearchType,
  SongReferenceResponse,
} from "@/lib/types";

type ReferenceFilter = "unverified" | ReferenceCategory;

type SearchPanelState = {
  query: string;
  results: SearchResult[];
  searching: boolean;
  error: string | null;
  hasSearched: boolean;
};

type DetailState =
  | { type: "idle" }
  | { type: "loading"; result: SearchResult }
  | {
      type: "song";
      result: SearchResult;
      data: SongReferenceResponse;
    }
  | {
      type: "album";
      result: SearchResult;
      data: AlbumReferenceResponse;
    }
  | { type: "error"; result: SearchResult; message: string };

type UsageBudgetStatus = {
  limit: number;
  remaining: number;
  resetAt: string;
  state: "ok" | "warning" | "blocked";
};

const FILTERS: Array<{
  value: ReferenceFilter;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "verified-accepted", label: "Accepted", icon: BadgeCheck },
  { value: "diss", label: "Likely disses", icon: Target },
  { value: "names-places", label: "Names & places", icon: UserRoundSearch },
  { value: "sample-interpolation", label: "Samples", icon: Disc3 },
  { value: "unverified", label: "Unverified", icon: CircleQuestionMark },
];

const SEARCH_DEBOUNCE_MS = 350;

const INITIAL_SEARCH_STATE: Record<SearchType, SearchPanelState> = {
  song: {
    query: "",
    results: [],
    searching: false,
    error: null,
    hasSearched: false,
  },
  album: {
    query: "",
    results: [],
    searching: false,
    error: null,
    hasSearched: false,
  },
};

type ExplorerState = {
  searchType: SearchType;
  searchState: Record<SearchType, SearchPanelState>;
  selectedKey: string | null;
  loadingMessage: string;
  detail: DetailState;
  filter: ReferenceFilter;
  budget: UsageBudgetStatus | null;
};

type ExplorerAction =
  | { type: "set-search-type"; searchType: SearchType }
  | {
      type: "patch-search-panel";
      searchType: SearchType;
      patch: Partial<SearchPanelState>;
    }
  | { type: "set-query"; searchType: SearchType; query: string }
  | { type: "open-result-started"; result: SearchResult; message: string }
  | { type: "set-detail"; detail: DetailState }
  | { type: "set-loading-message"; message: string }
  | { type: "set-filter"; filter: ReferenceFilter }
  | { type: "set-budget"; budget: UsageBudgetStatus };

const INITIAL_EXPLORER_STATE: ExplorerState = {
  searchType: "song",
  searchState: INITIAL_SEARCH_STATE,
  selectedKey: null,
  loadingMessage: "",
  detail: { type: "idle" },
  filter: "verified-accepted",
  budget: null,
};

function explorerReducer(
  state: ExplorerState,
  action: ExplorerAction
): ExplorerState {
  switch (action.type) {
    case "set-search-type":
      return {
        ...state,
        searchType: action.searchType,
      };
    case "patch-search-panel":
      return {
        ...state,
        searchState: {
          ...state.searchState,
          [action.searchType]: {
            ...state.searchState[action.searchType],
            ...action.patch,
          },
        },
      };
    case "set-query":
      return {
        ...state,
        selectedKey: null,
        detail: { type: "idle" },
        searchState: {
          ...state.searchState,
          [action.searchType]: {
            ...state.searchState[action.searchType],
            query: action.query,
            error: null,
          },
        },
      };
    case "open-result-started":
      return {
        ...state,
        selectedKey: resultIdentity(action.result),
        loadingMessage: action.message,
        detail: { type: "loading", result: action.result },
        filter: "verified-accepted",
      };
    case "set-detail":
      return {
        ...state,
        detail: action.detail,
      };
    case "set-loading-message":
      return {
        ...state,
        loadingMessage: action.message,
      };
    case "set-filter":
      return {
        ...state,
        filter: action.filter,
      };
    case "set-budget":
      return {
        ...state,
        budget: action.budget,
      };
  }
}

const RESULT_SKELETON_KEYS = [
  "result-skeleton-1",
  "result-skeleton-2",
  "result-skeleton-3",
  "result-skeleton-4",
  "result-skeleton-5",
  "result-skeleton-6",
];

const SONG_LOADING_SKELETONS = [
  { key: "song-loading-reference-1", compact: false },
  { key: "song-loading-reference-2", compact: false },
  { key: "song-loading-reference-3", compact: true },
  { key: "song-loading-reference-4", compact: true },
];

const ALBUM_LOADING_SKELETONS = [
  ...SONG_LOADING_SKELETONS,
  { key: "album-loading-reference-5", compact: true },
  { key: "album-loading-reference-6", compact: true },
];

const ANNOTATION_BODY_CLASS =
  "mt-4 [font-family:var(--font-literata)] text-[15px] leading-7 text-[#474741] [&_a]:text-[#181916] [&_a]:underline [&_a]:decoration-[#7d562d]/70 [&_a]:underline-offset-4 [&_a:hover]:text-[#7d562d] [&_blockquote]:my-4 [&_blockquote]:border-l [&_blockquote]:border-[#c8c7bf] [&_blockquote]:pl-4 [&_blockquote]:text-[#181916] [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-xs [&_figcaption]:text-[#777770] [&_figure]:my-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_img]:mx-auto [&_img]:my-4 [&_img]:max-h-[420px] [&_img]:max-w-full [&_img]:rounded [&_img]:border [&_img]:border-[#c8c7bf]/70 [&_img]:object-contain [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#c8c7bf] [&_td]:p-2 [&_th]:border [&_th]:border-[#c8c7bf] [&_th]:p-2 [&_ul]:list-disc";

const SAFE_ANNOTATION_TAGS = new Set([
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
]);

const SAFE_VOID_ANNOTATION_TAGS = new Set(["br", "hr", "img"]);

type SafeAnnotationNode =
  | { type: "text"; key: string; text: string }
  | {
      type: "element";
      key: string;
      tag: string;
      props: Record<string, string>;
      children: SafeAnnotationNode[];
    };

export function ReferenceExplorer() {
  const [state, dispatch] = useReducer(
    explorerReducer,
    INITIAL_EXPLORER_STATE
  );
  const searchAbortRef = useRef<Record<SearchType, AbortController | null>>({
    song: null,
    album: null,
  });
  const searchRequestRef = useRef<Record<SearchType, number>>({
    song: 0,
    album: 0,
  });
  const lastRequestedQueryRef = useRef<Record<SearchType, string>>({
    song: "",
    album: "",
  });
  const {
    budget,
    detail,
    filter,
    loadingMessage,
    searchState,
    searchType,
    selectedKey,
  } = state;
  const currentSearch = searchState[searchType];
  const query = currentSearch.query;

  const allReferences = useMemo(() => {
    if (detail.type === "song") {
      return detail.data.references;
    }

    if (detail.type === "album") {
      return detail.data.tracks.flatMap((track) => track.references);
    }

    return [];
  }, [detail]);

  const filteredReferences = useMemo(
    () => filterReferences(allReferences, filter),
    [allReferences, filter]
  );

  const filterCounts = useMemo(() => {
    return FILTERS.reduce<Record<ReferenceFilter, number>>((counts, item) => {
      counts[item.value] = filterReferences(allReferences, item.value).length;
      return counts;
    }, {} as Record<ReferenceFilter, number>);
  }, [allReferences]);

  const performSearch = useCallback(
    async (
      type: SearchType,
      rawQuery: string,
      options: { force?: boolean } = {}
    ) => {
      const trimmedQuery = rawQuery.trim();

      if (trimmedQuery.length < 2) {
        searchAbortRef.current[type]?.abort();
        lastRequestedQueryRef.current[type] = "";
        dispatch({
          type: "patch-search-panel",
          searchType: type,
          patch: {
            results: [],
            searching: false,
            error: null,
            hasSearched: false,
          },
        });
        return;
      }

      if (
        !options.force &&
        lastRequestedQueryRef.current[type] === trimmedQuery
      ) {
        return;
      }

      lastRequestedQueryRef.current[type] = trimmedQuery;
      searchRequestRef.current[type] += 1;
      const requestId = searchRequestRef.current[type];

      searchAbortRef.current[type]?.abort();
      const controller = new AbortController();
      searchAbortRef.current[type] = controller;

      dispatch({
        type: "patch-search-panel",
        searchType: type,
        patch: {
          searching: true,
          error: null,
          hasSearched: true,
        },
      });

      try {
        const response = await fetch(
          `/api/search?type=${type}&q=${encodeURIComponent(trimmedQuery)}`,
          {
            signal: controller.signal,
            headers: getApiRequestHeaders(),
          }
        );
        const budgetStatus = parseBudgetHeaders(response.headers);

        if (budgetStatus) {
          dispatch({ type: "set-budget", budget: budgetStatus });
        }

        const payload = await parseResponse<{ results: SearchResult[] }>(
          response
        );

        if (searchRequestRef.current[type] !== requestId) {
          return;
        }

        dispatch({
          type: "patch-search-panel",
          searchType: type,
          patch: {
            results: payload.results,
            searching: false,
            error: null,
            hasSearched: true,
          },
        });
      } catch (requestError) {
        if (isAbortError(requestError)) {
          return;
        }

        if (searchRequestRef.current[type] !== requestId) {
          return;
        }

        dispatch({
          type: "patch-search-panel",
          searchType: type,
          patch: {
            results: [],
            searching: false,
            error: publicMessage(requestError),
            hasSearched: true,
          },
        });
      } finally {
        if (searchRequestRef.current[type] === requestId) {
          searchAbortRef.current[type] = null;
        }
      }
    },
    []
  );

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      searchAbortRef.current[searchType]?.abort();
      lastRequestedQueryRef.current[searchType] = "";
      dispatch({
        type: "patch-search-panel",
        searchType,
        patch: {
          results: [],
          searching: false,
          hasSearched: false,
        },
      });
      return;
    }

    const timeout = window.setTimeout(() => {
      void performSearch(searchType, query);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [performSearch, query, searchType]);

  useEffect(() => {
    const abortControllers = searchAbortRef.current;

    return () => {
      abortControllers.song?.abort();
      abortControllers.album?.abort();
    };
  }, []);

  async function submitSearch(event?: FormEvent) {
    event?.preventDefault();

    if (query.trim().length < 2) {
      dispatch({
        type: "patch-search-panel",
        searchType,
        patch: {
          error: "Search for at least two characters.",
        },
      });
      return;
    }

    await performSearch(searchType, query, {
      force: Boolean(currentSearch.error),
    });
  }

  function updateQuery(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;

    dispatch({ type: "set-query", searchType, query: nextQuery });
  }

  async function openResult(result: SearchResult) {
    dispatch({
      type: "open-result-started",
      result,
      message:
        result.type === "album"
          ? "Resolving tracks and loading Genius references"
          : "Loading Genius references",
    });

    try {
      const endpoint =
        result.type === "song"
          ? `/api/songs/${result.id}/references?${new URLSearchParams({
              title: result.title,
              artist: result.artist,
              artworkUrl: result.artworkUrl ?? "",
              sourceUrl: result.sourceUrl,
            }).toString()}`
          : `/api/albums/${result.id}/references`;
      const response = await fetch(endpoint, {
        headers: getApiRequestHeaders(),
      });
      const budgetStatus = parseBudgetHeaders(response.headers);

      if (budgetStatus) {
        dispatch({ type: "set-budget", budget: budgetStatus });
      }

      if (result.type === "song") {
        const data = await parseResponse<SongReferenceResponse>(response);
        dispatch({ type: "set-detail", detail: { type: "song", result, data } });
      } else {
        const data = await parseResponse<AlbumReferenceResponse>(response);
        dispatch({ type: "set-detail", detail: { type: "album", result, data } });
      }
    } catch (requestError) {
      dispatch({
        type: "set-detail",
        detail: {
          type: "error",
          result,
          message: publicMessage(requestError),
        },
      });
    } finally {
      dispatch({ type: "set-loading-message", message: "" });
    }
  }

  return (
    <main className="min-h-screen bg-[#fbf9f4] text-[#1b1c19] lg:flex lg:h-screen lg:overflow-hidden">
      <SearchSidebar
        budget={budget}
        currentSearch={currentSearch}
        detail={detail}
        searchType={searchType}
        selectedKey={selectedKey}
        onOpenResult={openResult}
        onQueryChange={updateQuery}
        onSearchTypeChange={(nextSearchType) =>
          dispatch({ type: "set-search-type", searchType: nextSearchType })
        }
        onSubmit={submitSearch}
      />
      <WorkspacePanel
        detail={detail}
        filter={filter}
        filterCounts={filterCounts}
        filteredReferences={filteredReferences}
        loadingMessage={loadingMessage}
        onFilterChange={(nextFilter) =>
          dispatch({ type: "set-filter", filter: nextFilter })
        }
      />
    </main>
  );
}

function SearchSidebar({
  budget,
  currentSearch,
  detail,
  searchType,
  selectedKey,
  onOpenResult,
  onQueryChange,
  onSearchTypeChange,
  onSubmit,
}: {
  budget: UsageBudgetStatus | null;
  currentSearch: SearchPanelState;
  detail: DetailState;
  searchType: SearchType;
  selectedKey: string | null;
  onOpenResult: (result: SearchResult) => void;
  onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSearchTypeChange: (type: SearchType) => void;
  onSubmit: (event?: FormEvent) => void;
}) {
  const { error, hasSearched, query, results, searching } = currentSearch;

  return (
    <aside className="border-b border-[#c8c7bf] bg-[#f5f3ee] lg:flex lg:h-screen lg:w-80 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="border-b border-[#c8c7bf] p-6">
        <h1 className="mb-5 [font-family:var(--font-newsreader)] text-3xl font-medium italic tracking-tight text-[#181916]">
          Lyrical Context
        </h1>

        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="flex rounded border border-[#c8c7bf] bg-[#e4e2dd] p-1">
            <TypeButton
              active={searchType === "song"}
              icon={Music2}
              label="Song"
              onClick={() => onSearchTypeChange("song")}
            />
            <TypeButton
              active={searchType === "album"}
              icon={Album}
              label="Album"
              onClick={() => onSearchTypeChange("album")}
            />
          </div>

          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#777770]" />
              <input
                className="h-10 w-full rounded-t border-0 border-b border-[#777770] bg-[#f0eee9] pl-9 pr-3 text-sm text-[#1b1c19] outline-none transition focus:border-[#181916] focus:ring-0"
                placeholder={
                  searchType === "song" ? "e.g. God's Plan" : "e.g. Scorpion"
                }
                value={query}
                onChange={onQueryChange}
              />
            </label>
            <button
              className="flex size-10 shrink-0 items-center justify-center rounded bg-[#181916] text-white transition hover:bg-[#2d2d2a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={searching}
              type="submit"
            >
              {searching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              <span className="sr-only">Search</span>
            </button>
          </div>
        </form>

        <BudgetNotice budget={budget} />
        {error ? <InlineError message={error} /> : null}
      </div>

      <SearchResultsPanel
        hasSearched={hasSearched}
        query={query}
        results={results}
        searching={searching}
        selectedKey={selectedKey}
        onOpenResult={onOpenResult}
      />

      <div className="mt-auto shrink-0 border-t border-[#c8c7bf] p-3">
        <ReportIssueDialog
          detail={detail}
          query={query}
          searchType={searchType}
        />
      </div>
    </aside>
  );
}

function SearchResultsPanel({
  hasSearched,
  query,
  results,
  searching,
  selectedKey,
  onOpenResult,
}: {
  hasSearched: boolean;
  query: string;
  results: SearchResult[];
  searching: boolean;
  selectedKey: string | null;
  onOpenResult: (result: SearchResult) => void;
}) {
  return (
    <div className="p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777770]">
        {query.trim() ? `Results for "${query.trim()}"` : "Results"}
      </div>
      <div className="space-y-1">
        {searching ? (
          RESULT_SKELETON_KEYS.map((key) => <ResultSkeleton key={key} />)
        ) : results.length > 0 ? (
          results.map((result) => (
            <SearchResultButton
              key={resultIdentity(result)}
              active={selectedKey === resultIdentity(result)}
              result={result}
              onClick={() => onOpenResult(result)}
            />
          ))
        ) : (
          <SearchEmptyState hasSearched={hasSearched} query={query} />
        )}
      </div>
    </div>
  );
}

function WorkspacePanel({
  detail,
  filter,
  filterCounts,
  filteredReferences,
  loadingMessage,
  onFilterChange,
}: {
  detail: DetailState;
  filter: ReferenceFilter;
  filterCounts: Record<ReferenceFilter, number>;
  filteredReferences: Reference[];
  loadingMessage: string;
  onFilterChange: (filter: ReferenceFilter) => void;
}) {
  return (
    <section className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
      {detail.type === "idle" ? (
        <WorkspaceEmpty />
      ) : detail.type === "loading" ? (
        <WorkspaceLoading result={detail.result} message={loadingMessage} />
      ) : detail.type === "error" ? (
        <WorkspaceError result={detail.result} message={detail.message} />
      ) : (
        <ReferenceWorkspace
          detail={detail}
          filter={filter}
          filterCounts={filterCounts}
          filteredReferences={filteredReferences}
          onFilterChange={onFilterChange}
        />
      )}
    </section>
  );
}

function TypeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Music2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-8 flex-1 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition ${
        active
          ? "bg-[#fbf9f4] text-[#181916] shadow-sm"
          : "text-[#474741] hover:text-[#181916]"
      }`}
      type="button"
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function SearchResultButton({
  active,
  result,
  onClick,
}: {
  active: boolean;
  result: SearchResult;
  onClick: () => void;
}) {
  const year = result.type === "album" ? result.metadata.releaseYear : null;

  return (
    <button
      className={`group flex w-full items-center gap-3 rounded p-3 text-left transition ${
        active
          ? "bg-[#eae8e3] text-[#181916]"
          : "hover:bg-[#e4e2dd] text-[#1b1c19]"
      }`}
      type="button"
      onClick={onClick}
    >
      <Artwork url={result.artworkUrl} title={result.title} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold leading-5">
          {result.title}
        </div>
        <div className="truncate text-xs leading-5 text-[#777770]">
          {result.artist}
        </div>
      </div>
      {year ? (
        <span className="shrink-0 text-[11px] text-[#777770]">{year}</span>
      ) : null}
    </button>
  );
}

function ReferenceWorkspace({
  detail,
  filter,
  filterCounts,
  filteredReferences,
  onFilterChange,
}: {
  detail: Extract<DetailState, { type: "song" | "album" }>;
  filter: ReferenceFilter;
  filterCounts: Record<ReferenceFilter, number>;
  filteredReferences: Reference[];
  onFilterChange: (filter: ReferenceFilter) => void;
}) {
  const result = detail.type === "song" ? detail.data.song : detail.data.album;
  const totalReferences =
    detail.type === "song"
      ? detail.data.references.length
      : detail.data.tracks.reduce(
          (total, track) => total + track.references.length,
          0
        );
  const metadataItems = [
    result.artist,
    result.metadata.releaseYear ?? null,
    formatReferenceCount(totalReferences),
    ...(detail.type === "song"
      ? [
          detail.data.song.metadata.albumTitle
            ? `Album: ${detail.data.song.metadata.albumTitle}`
            : null,
          detail.data.song.metadata.featuredArtists?.length
            ? `Feat. ${formatArtistList(
                detail.data.song.metadata.featuredArtists
              )}`
            : null,
        ]
      : [
          detail.data.album.metadata.trackCount
            ? `${detail.data.album.metadata.trackCount} tracks`
            : `${detail.data.tracks.length} tracks`,
        ]),
  ].filter((item): item is string => Boolean(item));

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-[#c8c7bf]/70 bg-[#fbf9f4]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1120px] items-center gap-4">
          <Artwork url={result.artworkUrl} title={result.title} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="[font-family:var(--font-newsreader)] text-2xl font-semibold leading-8 text-[#181916] md:text-3xl md:leading-9">
              {result.title}
            </h2>
            <div className="mt-2 flex min-h-[3.25rem] flex-wrap items-start gap-x-2 gap-y-1 text-sm leading-6 text-[#777770] md:min-h-6 md:items-center">
              <MetadataItems items={metadataItems} />
              <a
                className="inline-flex items-center gap-1 rounded border border-[#c8c7bf] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#474741] transition hover:border-[#181916] hover:text-[#181916] md:ml-auto"
                href={result.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-3 flex max-w-[1120px] gap-2 overflow-x-auto pb-1">
          {FILTERS.map((item) => {
            const Icon = item.icon;
            const active = filter === item.value;
            return (
              <button
                key={item.value}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-[#181916] bg-[#181916] text-white"
                    : "border-[#c8c7bf] bg-[#f0eee9] text-[#474741] hover:bg-[#e4e2dd] hover:text-[#181916]"
                }`}
                type="button"
                onClick={() => onFilterChange(item.value)}
              >
                <Icon className="size-3.5" />
                {item.label}
                <span className="font-mono text-[11px] opacity-70">
                  {filterCounts[item.value] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="p-6">
        <div className="mx-auto max-w-[1120px]">
          {detail.type === "song" ? (
            <ReferenceList references={filteredReferences} />
          ) : (
            <AlbumTrackList
              data={detail.data}
              filter={filter}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AlbumTrackList({
  data,
  filter,
}: {
  data: AlbumReferenceResponse;
  filter: ReferenceFilter;
}) {
  if (data.tracks.length === 0) {
    return (
      <EmptyPanel
        title="No tracks found"
        body="This album did not return any track records."
      />
    );
  }

  return (
    <div className="space-y-0">
      {data.tracks.map((group) => {
        const references = filterReferences(group.references, filter);

        return (
          <AlbumTrackDisclosure
            key={trackGroupKey(group)}
            group={group}
            references={references}
          />
        );
      })}
    </div>
  );
}

function AlbumTrackDisclosure({
  group,
  references,
}: {
  group: AlbumReferenceResponse["tracks"][number];
  references: Reference[];
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `album-track-panel-${group.track.id}`;
  const Icon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-[#c8c7bf]/70 py-4">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-4 text-left"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="w-5 shrink-0 text-right font-mono text-xs text-[#777770]">
          {group.track.trackNumber || 0}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="[font-family:var(--font-newsreader)] text-2xl font-medium leading-8 text-[#181916] transition group-hover:text-[#7d562d]">
            {group.track.title}
          </h3>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#777770]">
            {group.track.artist}
          </div>
        </div>
        <TrackStatus group={group} referenceCount={references.length} />
        <Icon className="size-4 shrink-0 text-[#777770]" />
      </button>

      {expanded ? (
        <div
          id={panelId}
          className="ml-7 mt-4 grid gap-4 border-l border-[#7d562d]/25 pl-5 xl:grid-cols-2"
        >
          {references.length ? (
            references.map((reference) => (
              <ReferenceCard
                key={referenceKey(reference)}
                reference={reference}
              />
            ))
          ) : (
            <div className="rounded border border-dashed border-[#c8c7bf] bg-[#f5f3ee] p-4 text-sm text-[#777770]">
              {group.matchStatus === "matched"
                ? group.references.length
                  ? "No references match this filter."
                  : "No references yet."
                : group.error}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TrackStatus({
  group,
  referenceCount,
}: {
  group: AlbumReferenceResponse["tracks"][number];
  referenceCount: number;
}) {
  if (group.matchStatus === "matched") {
    return (
      <span className="shrink-0 rounded-full bg-[#ffca98]/25 px-2 py-1 text-xs font-semibold text-[#7a532a]">
        {referenceCount} refs
      </span>
    );
  }

  return (
    <span className="shrink-0 rounded-full bg-[#ffdad6] px-2 py-1 text-xs font-semibold text-[#93000a]">
      missing
    </span>
  );
}

function ReferenceList({ references }: { references: Reference[] }) {
  if (!references.length) {
    return (
      <EmptyPanel
        title="No references yet"
        body="Genius does not have annotations for this selection or filter yet."
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {references.map((reference) => (
        <ReferenceCard key={referenceKey(reference)} reference={reference} />
      ))}
    </div>
  );
}

function ReferenceCard({ reference }: { reference: Reference }) {
  const visibleCategories = reference.categories.filter(
    (category) => category !== "verified-accepted"
  );

  return (
    <article className="relative overflow-hidden rounded border border-[#c8c7bf]/70 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
      <div className="absolute bottom-0 left-0 top-0 w-1 bg-[#7d562d]" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map((category) => (
            <span
              key={category}
              className="inline-flex items-center rounded border border-[#c8c7bf] bg-[#f0eee9] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#474741]"
            >
              {categoryLabel(category)}
            </span>
          ))}
        </div>
        <a
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#777770] transition hover:text-[#181916]"
          href={reference.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Source
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>

      <blockquote className="mt-4 border-l border-[#c8c7bf] pl-4 [font-family:var(--font-literata)] text-base italic leading-7 text-[#181916]">
        {reference.fragment}
      </blockquote>
      <AnnotationBody reference={reference} />
      <div className="mt-4 flex items-center gap-3 border-t border-[#c8c7bf]/70 pt-3 text-xs font-medium text-[#777770]">
        {reference.verified ? <BadgeCheck className="size-3.5 text-[#7d562d]" /> : null}
        <span>{reference.state ?? reference.classification ?? "Genius"}</span>
        {typeof reference.votesTotal === "number" ? (
          <span>{reference.votesTotal} votes</span>
        ) : null}
      </div>
    </article>
  );
}

function AnnotationBody({ reference }: { reference: Reference }) {
  if (reference.annotationHtml) {
    return (
      <SafeAnnotationHtml
        fallback={reference.annotation}
        html={reference.annotationHtml}
      />
    );
  }

  return (
    <p className="mt-4 [font-family:var(--font-literata)] text-[15px] leading-7 text-[#474741]">
      {reference.annotation}
    </p>
  );
}

function SafeAnnotationHtml({
  fallback,
  html,
}: {
  fallback: string;
  html: string;
}) {
  const nodes = useMemo(() => parseSafeAnnotationHtml(html), [html]);

  if (!nodes.length) {
    return <p className={ANNOTATION_BODY_CLASS}>{fallback}</p>;
  }

  return (
    <div className={ANNOTATION_BODY_CLASS}>
      {nodes.map((node) => renderSafeAnnotationNode(node))}
    </div>
  );
}

function parseSafeAnnotationHtml(html: string): SafeAnnotationNode[] {
  if (typeof window === "undefined" || !html.trim()) {
    return [];
  }

  const document = new window.DOMParser().parseFromString(html, "text/html");

  return parseSafeAnnotationChildNodes(document.body.childNodes, "annotation");
}

function parseSafeAnnotationChildNodes(
  childNodes: NodeListOf<ChildNode>,
  keyPrefix: string
): SafeAnnotationNode[] {
  const nodes: SafeAnnotationNode[] = [];
  let nodeIndex = 0;

  childNodes.forEach((childNode) => {
    const parsedNodes = parseSafeAnnotationNode(
      childNode,
      `${keyPrefix}-${nodeIndex}`
    );
    nodes.push(...parsedNodes);
    nodeIndex += 1;
  });

  return nodes;
}

function parseSafeAnnotationNode(
  node: ChildNode,
  key: string
): SafeAnnotationNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ type: "text", key, text: node.textContent ?? "" }];
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const tag = node.tagName.toLocaleLowerCase();
  const isSafeTag =
    SAFE_ANNOTATION_TAGS.has(tag) || SAFE_VOID_ANNOTATION_TAGS.has(tag);

  if (!isSafeTag) {
    if (tag === "script" || tag === "style") {
      return [];
    }

    return parseSafeAnnotationChildNodes(node.childNodes, key);
  }

  return [
    {
      type: "element",
      key,
      tag,
      props: safeAnnotationElementProps(node, tag),
      children: SAFE_VOID_ANNOTATION_TAGS.has(tag)
        ? []
        : parseSafeAnnotationChildNodes(node.childNodes, key),
    },
  ];
}

function safeAnnotationElementProps(
  element: HTMLElement,
  tag: string
): Record<string, string> {
  if (tag === "a") {
    const href = safeAnnotationUrl(element.getAttribute("href"));

    return {
      ...(href ? { href } : {}),
      ...(element.getAttribute("title")
        ? { title: element.getAttribute("title") ?? "" }
        : {}),
      target: "_blank",
      rel: "noopener noreferrer",
    };
  }

  if (tag === "img") {
    const src = safeAnnotationUrl(element.getAttribute("src"));

    return {
      ...(src ? { src } : {}),
      ...(element.getAttribute("alt")
        ? { alt: element.getAttribute("alt") ?? "" }
        : { alt: "" }),
      ...(element.getAttribute("height")
        ? { height: element.getAttribute("height") ?? "" }
        : {}),
      loading: "lazy",
      ...(element.getAttribute("title")
        ? { title: element.getAttribute("title") ?? "" }
        : {}),
      ...(element.getAttribute("width")
        ? { width: element.getAttribute("width") ?? "" }
        : {}),
    };
  }

  return {};
}

function safeAnnotationUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function renderSafeAnnotationNode(node: SafeAnnotationNode): ReactNode {
  if (node.type === "text") {
    return node.text;
  }

  if (SAFE_VOID_ANNOTATION_TAGS.has(node.tag)) {
    return createElement(node.tag, { ...node.props, key: node.key });
  }

  return createElement(
    node.tag,
    { ...node.props, key: node.key },
    node.children.map((child) => renderSafeAnnotationNode(child))
  );
}

function WorkspaceEmpty() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16 lg:h-screen">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded border border-[#c8c7bf] bg-[#f0eee9]">
          <Search className="size-5 text-[#7d562d]" />
        </div>
        <h2 className="[font-family:var(--font-newsreader)] text-3xl font-medium text-[#181916]">
          Search for a song or album
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#777770]">
          Pick a result to view the references Genius has for it.
        </p>
      </div>
    </div>
  );
}

function WorkspaceLoading({
  result,
  message,
}: {
  result: SearchResult;
  message: string;
}) {
  const isAlbum = result.type === "album";
  const skeletons = isAlbum
    ? ALBUM_LOADING_SKELETONS
    : SONG_LOADING_SKELETONS;
  const metadataItems = [
    result.artist,
    result.type === "album" ? result.metadata.releaseYear : null,
    "Loading references",
    ...(result.type === "album" && result.metadata.trackCount
      ? [`${result.metadata.trackCount} tracks`]
      : []),
  ].filter((item): item is string => Boolean(item));
  const loadingItem =
    result.type === "album" && result.metadata.trackCount
      ? null
      : message;

  return (
    <div aria-live="polite">
      <header className="sticky top-0 z-20 border-b border-[#c8c7bf]/70 bg-[#fbf9f4]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1120px] items-center gap-4">
          <Artwork url={result.artworkUrl} title={result.title} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="[font-family:var(--font-newsreader)] text-2xl font-semibold leading-8 text-[#181916] md:text-3xl md:leading-9">
              {result.title}
            </h2>
            <div className="mt-2 flex min-h-[3.25rem] flex-wrap items-start gap-x-2 gap-y-1 text-sm leading-6 text-[#777770] md:min-h-6 md:items-center">
              <MetadataItems items={metadataItems} />
              {loadingItem ? <span className="sr-only">{loadingItem}</span> : null}
              <a
                className="inline-flex items-center gap-1 rounded border border-[#c8c7bf] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#474741] transition hover:border-[#181916] hover:text-[#181916] md:ml-auto"
                href={result.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </div>

        <LoadingFilterPills />
      </header>

      <div className="p-6">
        <div className="mx-auto grid max-w-[1120px] gap-4 xl:grid-cols-2">
          {skeletons.map((item) => (
            <LoadingReferenceSkeleton
              key={item.key}
              compact={item.compact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingFilterPills() {
  return (
    <div className="mx-auto mt-3 flex max-w-[1120px] gap-2 overflow-x-auto pb-1">
      {FILTERS.map((item) => {
        const Icon = item.icon;
        const active = item.value === "verified-accepted";

        return (
          <div
            key={item.value}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              active
                ? "border-[#181916] bg-[#181916] text-white"
                : "border-[#c8c7bf] bg-[#f0eee9] text-[#474741]"
            }`}
          >
            <Icon className="size-3.5" />
            {item.label}
            <span
              className={`h-3 w-4 animate-pulse rounded ${
                active ? "bg-white/35" : "bg-[#d8d6cf]"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}

function LoadingReferenceSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="rounded border border-[#c8c7bf]/70 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div className="h-6 w-24 animate-pulse rounded border border-[#c8c7bf] bg-[#f0eee9]" />
        <div className="h-4 w-14 animate-pulse rounded bg-[#e4e2dd]" />
      </div>
      <div className="mt-5 border-l border-[#c8c7bf] pl-4">
        <div className="h-4 w-11/12 animate-pulse rounded bg-[#e4e2dd]" />
        <div className="mt-3 h-4 w-7/12 animate-pulse rounded bg-[#e4e2dd]" />
      </div>
      <div className="mt-6 space-y-3">
        <div className="h-3 w-full animate-pulse rounded bg-[#f0eee9]" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-[#f0eee9]" />
        <div className="h-3 w-9/12 animate-pulse rounded bg-[#f0eee9]" />
        {!compact ? (
          <div className="h-3 w-2/3 animate-pulse rounded bg-[#f0eee9]" />
        ) : null}
      </div>
      <div className="mt-5 border-t border-[#c8c7bf]/70 pt-3">
        <div className="h-3 w-28 animate-pulse rounded bg-[#e4e2dd]" />
      </div>
    </div>
  );
}

function trackGroupKey(group: AlbumReferenceResponse["tracks"][number]) {
  return [
    group.track.id,
    group.track.discNumber ?? 0,
    group.track.trackNumber ?? 0,
  ].join("-");
}

function referenceKey(reference: Reference) {
  return [
    reference.id,
    reference.referentId,
    reference.fragment.slice(0, 24),
  ].join("-");
}

function MetadataItems({
  className = "",
  items,
}: {
  className?: string;
  items: string[];
}) {
  return (
    <>
      {items.map((item, index) => (
        <span key={item} className="contents">
          {index > 0 ? (
            <span className="size-1 rounded-full bg-[#c8c7bf]" />
          ) : null}
          <span className={className}>{item}</span>
        </span>
      ))}
    </>
  );
}

function formatArtistList(artists: string[]) {
  const visibleArtists = artists.slice(0, 2).join(", ");
  const hiddenArtistCount = artists.length - 2;

  return hiddenArtistCount > 0
    ? `${visibleArtists} +${hiddenArtistCount}`
    : visibleArtists;
}

function formatReferenceCount(count: number) {
  return `${count} ${count === 1 ? "reference" : "references"}`;
}

function WorkspaceError({
  result,
  message,
}: {
  result: SearchResult;
  message: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16 lg:h-screen">
      <div className="max-w-md rounded border border-[#ba1a1a]/30 bg-[#ffdad6]/40 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 text-[#ba1a1a]" />
          <div>
            <h2 className="font-semibold text-[#181916]">Could not load {result.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#777770]">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-dashed border-[#c8c7bf] bg-[#f5f3ee] p-5 text-center">
      <div className="text-sm font-semibold text-[#181916]">{title}</div>
      <div className="mt-1 text-sm text-[#777770]">{body}</div>
    </div>
  );
}

function SearchEmptyState({
  hasSearched,
  query,
}: {
  hasSearched: boolean;
  query: string;
}) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length > 0 && trimmedQuery.length < 2) {
    return (
      <EmptyPanel
        title="Keep typing"
        body="Search starts after two characters."
      />
    );
  }

  if (hasSearched) {
    return <EmptyPanel title="No results" body="Try another search." />;
  }

  return (
    <EmptyPanel
      title="No search yet"
      body="Start typing to search songs or albums."
    />
  );
}

function BudgetNotice({ budget }: { budget: UsageBudgetStatus | null }) {
  if (!budget || budget.state === "ok") {
    return null;
  }

  const blocked = budget.state === "blocked";

  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded border p-3 text-sm ${
        blocked
          ? "border-[#ba1a1a]/30 bg-[#ffdad6]/40 text-[#93000a]"
          : "border-[#8a6b16]/30 bg-[#fff4cc]/70 text-[#594500]"
      }`}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>
        {blocked
          ? `The shared Genius API budget is cooling down. Searches resume around ${formatBudgetReset(
              budget.resetAt
            )}.`
          : `The shared Genius API budget is low (${budget.remaining} of ${budget.limit} left). It resets around ${formatBudgetReset(
              budget.resetAt
            )}.`}
      </span>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded border border-[#ba1a1a]/30 bg-[#ffdad6]/40 p-3 text-sm text-[#93000a]">
      <AlertCircle className="mt-0.5 size-4" />
      <span>{message}</span>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex gap-3 rounded p-3">
      <div className="size-12 animate-pulse rounded bg-[#e4e2dd]" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-[#e4e2dd]" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-[#e4e2dd]" />
      </div>
    </div>
  );
}

function Artwork({
  url,
  title,
  size,
}: {
  url: string | null;
  title: string;
  size: "md" | "lg";
}) {
  const className =
    size === "lg"
      ? "size-20 rounded object-cover shadow-sm md:size-24"
      : "size-12 rounded object-cover";

  if (url) {
    return (
      <Image
        alt=""
        className={className}
        height={size === "lg" ? 96 : 48}
        src={url}
        width={size === "lg" ? 96 : 48}
      />
    );
  }

  return (
    <div
      aria-label={`${title} artwork placeholder`}
      className={`${className} flex items-center justify-center border border-[#c8c7bf] bg-[#e4e2dd] text-[#777770]`}
    >
      <Music2 className="size-5" />
    </div>
  );
}

function filterReferences(references: Reference[], filter: ReferenceFilter) {
  const sortBySongOrder = (filtered: Reference[]) =>
    filtered.toSorted((first, second) => {
      const firstIndex = Number.isFinite(first.sortIndex)
        ? first.sortIndex
        : Number.MAX_SAFE_INTEGER;
      const secondIndex = Number.isFinite(second.sortIndex)
        ? second.sortIndex
        : Number.MAX_SAFE_INTEGER;

      return firstIndex - secondIndex;
    });

  if (filter === "unverified") {
    return sortBySongOrder(
      references.filter((reference) => !isAcceptedReference(reference))
    );
  }

  if (filter === "verified-accepted") {
    return sortBySongOrder(references.filter(isAcceptedReference));
  }

  return sortBySongOrder(
    references.filter(
      (reference) =>
        isAcceptedReference(reference) && reference.categories.includes(filter)
    )
  );
}

function isAcceptedReference(reference: Reference) {
  return (
    reference.verified ||
    reference.state === "accepted" ||
    reference.classification === "accepted" ||
    reference.categories.includes("verified-accepted")
  );
}

function resultIdentity(result: SearchResult) {
  return `${result.type}:${result.id}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function categoryLabel(category: ReferenceCategory) {
  switch (category) {
    case "diss":
      return "likely diss";
    case "names-places":
      return "name/place";
    case "sample-interpolation":
      return "sample";
    case "verified-accepted":
      return "accepted";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ApiErrorBody;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorBody;
    throw new Error(errorPayload.error?.message ?? "Request failed.");
  }

  return payload as T;
}

function parseBudgetHeaders(headers: Headers): UsageBudgetStatus | null {
  const state = headers.get("x-lyrical-budget-state");
  const limit = Number(headers.get("x-lyrical-budget-limit"));
  const remaining = Number(headers.get("x-lyrical-budget-remaining"));
  const resetAt = headers.get("x-lyrical-budget-reset-at");

  if (
    state !== "ok" &&
    state !== "warning" &&
    state !== "blocked"
  ) {
    return null;
  }

  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !resetAt) {
    return null;
  }

  return {
    limit,
    remaining,
    resetAt,
    state,
  };
}

function formatBudgetReset(resetAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(resetAt));
}

function publicMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong while loading data.";
}
