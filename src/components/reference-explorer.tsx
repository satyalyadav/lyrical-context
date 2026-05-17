"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Album,
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Disc3,
  Loader2,
  Music2,
  Search,
  Sparkles,
  Target,
  UserRoundSearch,
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

const FILTERS: Array<{
  value: ReferenceFilter;
  label: string;
  icon: typeof Sparkles;
}> = [
  { value: "verified-accepted", label: "Accepted", icon: BadgeCheck },
  { value: "diss", label: "Likely disses", icon: Target },
  { value: "names-places", label: "Names & places", icon: UserRoundSearch },
  { value: "sample-interpolation", label: "Samples", icon: Disc3 },
  { value: "unverified", label: "Unverified", icon: Sparkles },
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

export function ReferenceExplorer() {
  const [searchType, setSearchType] = useState<SearchType>("song");
  const [searchState, setSearchState] =
    useState<Record<SearchType, SearchPanelState>>(INITIAL_SEARCH_STATE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [detail, setDetail] = useState<DetailState>({ type: "idle" });
  const [filter, setFilter] = useState<ReferenceFilter>("verified-accepted");
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
  const currentSearch = searchState[searchType];
  const query = currentSearch.query;
  const results = currentSearch.results;
  const searching = currentSearch.searching;

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
        setSearchState((current) => {
          const panel = current[type];

          if (
            !panel.results.length &&
            !panel.searching &&
            !panel.error &&
            !panel.hasSearched
          ) {
            return current;
          }

          return {
            ...current,
            [type]: {
              ...panel,
              results: [],
              searching: false,
              error: null,
              hasSearched: false,
            },
          };
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

      setSearchState((current) => ({
        ...current,
        [type]: {
          ...current[type],
          searching: true,
          error: null,
          hasSearched: true,
        },
      }));

      try {
        const response = await fetch(
          `/api/search?type=${type}&q=${encodeURIComponent(trimmedQuery)}`,
          { signal: controller.signal }
        );
        const payload = await parseResponse<{ results: SearchResult[] }>(
          response
        );

        if (searchRequestRef.current[type] !== requestId) {
          return;
        }

        setSearchState((current) => ({
          ...current,
          [type]: {
            ...current[type],
            results: payload.results,
            searching: false,
            error: null,
            hasSearched: true,
          },
        }));
      } catch (requestError) {
        if (isAbortError(requestError)) {
          return;
        }

        if (searchRequestRef.current[type] !== requestId) {
          return;
        }

        setSearchState((current) => ({
          ...current,
          [type]: {
            ...current[type],
            results: [],
            searching: false,
            error: publicMessage(requestError),
            hasSearched: true,
          },
        }));
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
      setSearchState((current) => {
        const panel = current[searchType];

        if (!panel.results.length && !panel.searching && !panel.hasSearched) {
          return current;
        }

        return {
          ...current,
          [searchType]: {
            ...panel,
            results: [],
            searching: false,
            hasSearched: false,
          },
        };
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
      setSearchState((current) => ({
        ...current,
        [searchType]: {
          ...current[searchType],
          error: "Search for at least two characters.",
        },
      }));
      return;
    }

    await performSearch(searchType, query, {
      force: Boolean(currentSearch.error),
    });
  }

  function updateQuery(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;

    setSearchState((current) => ({
      ...current,
      [searchType]: {
        ...current[searchType],
        query: nextQuery,
        error: null,
      },
    }));
    setSelectedKey(null);
    setDetail({ type: "idle" });
  }

  async function openResult(result: SearchResult) {
    setSelectedKey(resultIdentity(result));
    setFilter("verified-accepted");
    setLoadingMessage(
      result.type === "album"
        ? "Resolving tracks and loading Genius references"
        : "Loading Genius references"
    );
    setDetail({ type: "loading", result });

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
      const response = await fetch(endpoint);

      if (result.type === "song") {
        const data = await parseResponse<SongReferenceResponse>(response);
        setDetail({ type: "song", result, data });
      } else {
        const data = await parseResponse<AlbumReferenceResponse>(response);
        setDetail({ type: "album", result, data });
      }
    } catch (requestError) {
      setDetail({
        type: "error",
        result,
        message: publicMessage(requestError),
      });
    } finally {
      setLoadingMessage("");
    }
  }

  return (
    <main className="min-h-screen bg-[#fbf9f4] text-[#1b1c19] lg:flex lg:h-screen lg:overflow-hidden">
      <aside className="border-b border-[#c8c7bf] bg-[#f5f3ee] lg:flex lg:h-screen lg:w-80 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="border-b border-[#c8c7bf] px-6 py-6">
          <h1 className="mb-5 [font-family:var(--font-newsreader)] text-3xl font-medium italic tracking-tight text-[#181916]">
            Lyrical Context
          </h1>

          <form className="space-y-3" onSubmit={submitSearch}>
            <div className="flex rounded border border-[#c8c7bf] bg-[#e4e2dd] p-1">
              <TypeButton
                active={searchType === "song"}
                icon={Music2}
                label="Song"
                onClick={() => setSearchType("song")}
              />
              <TypeButton
                active={searchType === "album"}
                icon={Album}
                label="Album"
                onClick={() => setSearchType("album")}
              />
            </div>

            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#777770]" />
                <input
                  className="h-10 w-full rounded-t border-0 border-b border-[#777770] bg-[#f0eee9] pl-9 pr-3 text-sm text-[#1b1c19] outline-none transition focus:border-[#181916] focus:ring-0"
                  placeholder={
                    searchType === "song"
                      ? "e.g. God's Plan"
                      : "e.g. Scorpion"
                  }
                  value={query}
                  onChange={updateQuery}
                />
              </label>
              <button
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#181916] text-white transition hover:bg-[#2d2d2a] disabled:cursor-not-allowed disabled:opacity-60"
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

          {currentSearch.error ? (
            <InlineError message={currentSearch.error} />
          ) : null}
        </div>

        <div className="px-3 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777770]">
            {query.trim() ? `Results for "${query.trim()}"` : "Results"}
          </div>
          <div className="space-y-1">
            {searching ? (
              Array.from({ length: 6 }).map((_, index) => (
                <ResultSkeleton key={index} />
              ))
            ) : results.length > 0 ? (
              results.map((result, index) => (
                <SearchResultButton
                  key={`${result.type}-${result.id}-${index}`}
                  active={selectedKey === resultIdentity(result)}
                  result={result}
                  onClick={() => openResult(result)}
                />
              ))
            ) : (
              <SearchEmptyState
                hasSearched={currentSearch.hasSearched}
                query={query}
              />
            )}
          </div>
        </div>
      </aside>

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
            onFilterChange={setFilter}
          />
        )}
      </section>
    </main>
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
  const result = detail.result;
  const totalReferences =
    detail.type === "song"
      ? detail.data.references.length
      : detail.data.tracks.reduce(
          (total, track) => total + track.references.length,
          0
        );
  const unmatchedTracks =
    detail.type === "album"
      ? detail.data.tracks.filter((track) => track.matchStatus !== "matched").length
      : 0;
  const year = result.type === "album" ? result.metadata.releaseYear : null;

  return (
    <div>
      <header className="sticky top-0 z-20 border-b border-[#c8c7bf]/70 bg-[#fbf9f4]/95 px-6 py-8 backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] items-end gap-6">
          <Artwork url={result.artworkUrl} title={result.title} size="lg" />
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="[font-family:var(--font-newsreader)] text-4xl font-semibold leading-tight tracking-[-0.02em] text-[#181916] md:text-5xl">
              {result.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[#777770]">
              <span>{result.artist}</span>
              {year ? (
                <>
                  <span className="size-1 rounded-full bg-[#c8c7bf]" />
                  <span>{year}</span>
                </>
              ) : null}
              <a
                className="ml-auto inline-flex items-center gap-1 rounded border border-[#c8c7bf] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#474741] transition hover:border-[#181916] hover:text-[#181916]"
                href={result.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex h-6 min-w-[8.75rem] items-center justify-center gap-1 rounded-full bg-[#ffca98]/30 px-3 text-xs font-semibold text-[#7a532a]">
                <Sparkles className="size-3.5" />
                {totalReferences} references
              </span>
              {unmatchedTracks ? (
                <span className="rounded border border-[#ba1a1a]/30 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ba1a1a]">
                  {unmatchedTracks} track issues
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-6 flex max-w-[1120px] gap-2 overflow-x-auto pb-1">
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

      <div className="px-6 py-6">
        <div className="mx-auto max-w-[1120px]">
          {detail.type === "song" ? (
            <ReferenceList references={filteredReferences} />
          ) : (
            <AlbumTrackList
              data={detail.data}
              filter={filter}
              filteredReferences={filteredReferences}
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
  filteredReferences,
}: {
  data: AlbumReferenceResponse;
  filter: ReferenceFilter;
  filteredReferences: Reference[];
}) {
  if (filteredReferences.length === 0) {
    return (
      <EmptyPanel
        title="No references match this filter"
        body="Try another category."
      />
    );
  }

  return (
    <div className="space-y-0">
      {data.tracks.map((group, index) => {
        const references = filterReferences(group.references, filter);

        if (references.length === 0) {
          return null;
        }

        return (
          <AlbumTrackDisclosure
            key={trackGroupKey(group, index)}
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
          className="ml-7 mt-4 grid gap-4 border-l-2 border-[#7d562d]/25 pl-5 xl:grid-cols-2"
        >
          {references.length ? (
            references.map((reference, index) => (
              <ReferenceCard
                key={referenceKey(reference, index)}
                reference={reference}
              />
            ))
          ) : (
            <div className="rounded border border-dashed border-[#c8c7bf] bg-[#f5f3ee] p-4 text-sm text-[#777770]">
              {group.matchStatus === "matched"
                ? "No references yet."
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
      {group.matchStatus}
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
      {references.map((reference, index) => (
        <ReferenceCard key={referenceKey(reference, index)} reference={reference} />
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
          {visibleCategories.map((category, index) => (
            <span
              key={`${category}-${index}`}
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

      <blockquote className="mt-4 border-l-2 border-[#c8c7bf] pl-4 [font-family:var(--font-literata)] text-base italic leading-7 text-[#181916]">
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
      <div
        className="mt-4 [font-family:var(--font-literata)] text-[15px] leading-7 text-[#474741] [&_a]:text-[#181916] [&_a]:underline [&_a]:decoration-[#7d562d]/70 [&_a]:underline-offset-4 [&_a:hover]:text-[#7d562d] [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[#c8c7bf] [&_blockquote]:pl-4 [&_blockquote]:text-[#181916] [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-xs [&_figcaption]:text-[#777770] [&_figure]:my-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_img]:mx-auto [&_img]:my-4 [&_img]:max-h-[420px] [&_img]:max-w-full [&_img]:rounded [&_img]:border [&_img]:border-[#c8c7bf]/70 [&_img]:object-contain [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#c8c7bf] [&_td]:p-2 [&_th]:border [&_th]:border-[#c8c7bf] [&_th]:p-2 [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: reference.annotationHtml }}
      />
    );
  }

  return (
    <p className="mt-4 [font-family:var(--font-literata)] text-[15px] leading-7 text-[#474741]">
      {reference.annotation}
    </p>
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
  const year = result.type === "album" ? result.metadata.releaseYear : null;

  return (
    <div aria-live="polite">
      <header className="sticky top-0 z-20 border-b border-[#c8c7bf]/70 bg-[#fbf9f4]/95 px-6 py-8 backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] items-end gap-6">
          <Artwork url={result.artworkUrl} title={result.title} size="lg" />
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="[font-family:var(--font-newsreader)] text-4xl font-semibold leading-tight tracking-[-0.02em] text-[#181916] md:text-5xl">
              {result.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[#777770]">
              <span>{result.artist}</span>
              {year ? (
                <>
                  <span className="size-1 rounded-full bg-[#c8c7bf]" />
                  <span>{year}</span>
                </>
              ) : null}
              <a
                className="ml-auto inline-flex items-center gap-1 rounded border border-[#c8c7bf] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#474741] transition hover:border-[#181916] hover:text-[#181916]"
                href={result.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex h-6 min-w-[8.75rem] items-center justify-center gap-1 rounded-full bg-[#ffca98]/30 px-3 text-xs font-semibold text-[#7a532a]">
                <Sparkles className="size-3.5" />
                <span className="sr-only">{message}</span>
                <span className="h-3 w-24 animate-pulse rounded bg-[#d59a65]/35" />
              </span>
            </div>
          </div>
        </div>

        <LoadingFilterPills />
      </header>

      <div className="px-6 py-6">
        <div className="mx-auto grid max-w-[1120px] gap-4 xl:grid-cols-2">
          {Array.from({ length: isAlbum ? 6 : 4 }).map((_, index) => (
            <LoadingReferenceSkeleton key={index} compact={index > 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingFilterPills() {
  return (
    <div className="mx-auto mt-6 flex max-w-[1120px] gap-2 overflow-x-auto pb-1">
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
      <div className="mt-5 border-l-2 border-[#c8c7bf] pl-4">
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

function trackGroupKey(
  group: AlbumReferenceResponse["tracks"][number],
  index: number
) {
  return [
    group.track.id,
    group.track.discNumber ?? 0,
    group.track.trackNumber ?? index,
    index,
  ].join("-");
}

function referenceKey(reference: Reference, index: number) {
  return [
    reference.id,
    reference.referentId,
    reference.fragment.slice(0, 24),
    index,
  ].join("-");
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
      ? "size-28 rounded object-cover shadow-sm md:size-32"
      : "size-12 rounded object-cover";

  if (url) {
    return <img alt="" className={className} src={url} />;
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
  if (filter === "unverified") {
    return references.filter((reference) => !isAcceptedReference(reference));
  }

  if (filter === "verified-accepted") {
    return references.filter(isAcceptedReference);
  }

  return references.filter(
    (reference) =>
      isAcceptedReference(reference) && reference.categories.includes(filter)
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

function publicMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong while loading data.";
}
