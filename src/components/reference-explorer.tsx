"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Album,
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  Disc3,
  Loader2,
  Music2,
  Search,
  Sparkles,
  Tags,
  Target,
  UserRoundSearch,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type {
  AlbumReferenceResponse,
  ApiErrorBody,
  Reference,
  ReferenceCategory,
  SearchResult,
  SearchType,
  SongReferenceResponse,
} from "@/lib/types";

type ReferenceFilter = "all" | ReferenceCategory;

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
  { value: "all", label: "All", icon: Sparkles },
  { value: "diss", label: "Likely disses", icon: Target },
  { value: "names-places", label: "Names & places", icon: UserRoundSearch },
  { value: "sample-interpolation", label: "Samples", icon: Disc3 },
  { value: "verified-accepted", label: "Accepted", icon: BadgeCheck },
];

export function ReferenceExplorer() {
  const [searchType, setSearchType] = useState<SearchType>("song");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ type: "idle" });
  const [filter, setFilter] = useState<ReferenceFilter>("all");

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

  async function submitSearch(event?: FormEvent) {
    event?.preventDefault();

    if (query.trim().length < 2) {
      setError("Search for at least two characters.");
      return;
    }

    setSearching(true);
    setError(null);
    setDetail({ type: "idle" });
    setSelectedId(null);

    try {
      const response = await fetch(
        `/api/search?type=${searchType}&q=${encodeURIComponent(query.trim())}`
      );
      const payload = await parseResponse<{ results: SearchResult[] }>(response);
      setResults(payload.results);
    } catch (requestError) {
      setResults([]);
      setError(publicMessage(requestError));
    } finally {
      setSearching(false);
    }
  }

  async function openResult(result: SearchResult) {
    setSelectedId(result.id);
    setFilter("all");
    setError(null);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.2_0.04_250),transparent_34rem),linear-gradient(180deg,oklch(0.14_0.02_250),oklch(0.1_0.015_250))] px-4 py-5 text-foreground md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-md border border-border/70 bg-background/70 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Tags className="size-4" />
              </div>
              <span className="text-sm font-medium text-primary">
                Lyrical Context
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
              Search references, not full lyrics.
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pick a song or album and review Genius annotations in one readable
              workspace, grouped by track when needed.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center md:min-w-72">
            <Metric label="Source" value="Genius" />
            <Metric label="Lyrics" value="Hidden" />
            <Metric label="Albums" value="iTunes" />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[390px_1fr]">
          <Card className="rounded-md border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle>Search</CardTitle>
              <CardDescription>
                Find one song or an album tracklist, then load every available
                annotation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="space-y-3" onSubmit={submitSearch}>
                <div className="grid grid-cols-2 gap-2">
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
                  <Input
                    className="h-10 rounded-md"
                    placeholder={
                      searchType === "song"
                        ? "e.g. Drake God's Plan"
                        : "e.g. Drake Scorpion"
                    }
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button
                    className="h-10 rounded-md px-3"
                    disabled={searching}
                    type="submit"
                  >
                    {searching ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    <span className="sr-only">Search</span>
                  </Button>
                </div>
              </form>

              {error ? <InlineError message={error} /> : null}

              <Separator />

              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Results
                </h2>
                <Badge variant="outline" className="rounded-md">
                  {results.length}
                </Badge>
              </div>

              <ScrollArea className="h-[390px] pr-3">
                <div className="space-y-2">
                  {searching ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <ResultSkeleton key={index} />
                    ))
                  ) : results.length > 0 ? (
                    results.map((result) => (
                      <SearchResultButton
                        key={`${result.type}-${result.id}`}
                        active={selectedId === result.id}
                        result={result}
                        onClick={() => openResult(result)}
                      />
                    ))
                  ) : (
                    <EmptyPanel
                      title="No search yet"
                      body="Search for a song or album to begin."
                    />
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="min-h-[650px] rounded-md border-border/70 bg-card/80">
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
          </Card>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
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
    <Button
      className="h-10 rounded-md"
      type="button"
      variant={active ? "default" : "outline"}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </Button>
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
  return (
    <button
      className={`flex w-full gap-3 rounded-md border p-3 text-left transition ${
        active
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-background/40 hover:border-primary/60 hover:bg-muted/40"
      }`}
      type="button"
      onClick={onClick}
    >
      <Artwork url={result.artworkUrl} title={result.title} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-md">
            {result.type}
          </Badge>
          {result.type === "album" && result.metadata.releaseYear ? (
            <span className="text-xs text-muted-foreground">
              {result.metadata.releaseYear}
            </span>
          ) : null}
        </div>
        <div className="mt-2 truncate text-sm font-medium">{result.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {result.artist}
        </div>
      </div>
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

  return (
    <div className="flex h-full flex-col">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 gap-4">
            <Artwork url={result.artworkUrl} title={result.title} size="lg" />
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="default" className="rounded-md">
                  {result.type === "song" ? "Song" : "Album"}
                </Badge>
                <Badge variant="outline" className="rounded-md">
                  {totalReferences} references
                </Badge>
                {unmatchedTracks ? (
                  <Badge variant="destructive" className="rounded-md">
                    {unmatchedTracks} track issues
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="truncate text-xl md:text-2xl">
                {result.title}
              </CardTitle>
              <CardDescription className="mt-1">{result.artist}</CardDescription>
            </div>
          </div>
          <Button
            className="w-fit rounded-md"
            nativeButton={false}
            variant="outline"
            render={<a href={result.sourceUrl} target="_blank" rel="noreferrer" />}
          >
            Source
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 py-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.value}
                className="rounded-md"
                size="sm"
                type="button"
                variant={filter === item.value ? "default" : "outline"}
                onClick={() => onFilterChange(item.value)}
              >
                <Icon className="size-3.5" />
                {item.label}
                <span className="font-mono text-xs opacity-70">
                  {filterCounts[item.value] ?? 0}
                </span>
              </Button>
            );
          })}
        </div>

        {detail.type === "song" ? (
          <ReferenceList references={filteredReferences} />
        ) : (
          <AlbumTrackList
            data={detail.data}
            filter={filter}
            filteredReferences={filteredReferences}
          />
        )}
      </CardContent>
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
  if (filteredReferences.length === 0 && filter !== "all") {
    return (
      <EmptyPanel
        title="No references match this filter"
        body="Try All or another category."
      />
    );
  }

  return (
    <ScrollArea className="h-[500px] pr-3">
      <div className="space-y-3">
        {data.tracks.map((group) => {
          const references = filterReferences(group.references, filter);

          if (filter !== "all" && references.length === 0) {
            return null;
          }

          return (
            <div
              key={group.track.id}
              className="rounded-md border border-border/70 bg-background/35"
            >
              <div className="flex flex-col gap-2 border-b border-border/60 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {String(group.track.trackNumber || 0).padStart(2, "0")}
                    </span>
                    <span>{group.track.artist}</span>
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">
                    {group.track.title}
                  </div>
                </div>
                <TrackStatus group={group} />
              </div>
              {references.length ? (
                <div className="space-y-2 p-3">
                  {references.map((reference) => (
                    <ReferenceCard key={reference.id} reference={reference} />
                  ))}
                </div>
              ) : (
                <div className="p-3 text-sm text-muted-foreground">
                  {group.matchStatus === "matched"
                    ? "No Genius references yet."
                    : group.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function TrackStatus({
  group,
}: {
  group: AlbumReferenceResponse["tracks"][number];
}) {
  if (group.matchStatus === "matched") {
    return (
      <Badge variant="outline" className="rounded-md">
        {group.references.length} refs
        {group.matchConfidence ? ` · ${Math.round(group.matchConfidence * 100)}%` : ""}
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className="rounded-md">
      {group.matchStatus}
    </Badge>
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
    <ScrollArea className="h-[500px] pr-3">
      <div className="grid gap-3 xl:grid-cols-2">
        {references.map((reference) => (
          <ReferenceCard key={reference.id} reference={reference} />
        ))}
      </div>
    </ScrollArea>
  );
}

function ReferenceCard({ reference }: { reference: Reference }) {
  return (
    <article className="rounded-md border border-border/70 bg-background/45 p-4">
      <div className="flex flex-wrap gap-2">
        {reference.categories.length ? (
          reference.categories.map((category) => (
            <Badge key={category} variant="secondary" className="rounded-md">
              {categoryLabel(category)}
            </Badge>
          ))
        ) : (
          <Badge variant="outline" className="rounded-md">
            reference
          </Badge>
        )}
      </div>

      <blockquote className="mt-3 border-l-2 border-primary/70 pl-3 text-sm leading-6 text-foreground">
        {reference.fragment}
      </blockquote>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {reference.annotation}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {reference.verified ? <BadgeCheck className="size-3.5 text-primary" /> : null}
          <span>{reference.state ?? reference.classification ?? "Genius"}</span>
          {typeof reference.votesTotal === "number" ? (
            <span className="font-mono">{reference.votesTotal} votes</span>
          ) : null}
        </div>
        <Button
          className="rounded-md"
          nativeButton={false}
          size="sm"
          variant="ghost"
          render={
            <a href={reference.sourceUrl} target="_blank" rel="noreferrer" />
          }
        >
          Open
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}

function WorkspaceEmpty() {
  return (
    <div className="flex min-h-[650px] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border border-border bg-muted/50">
          <Search className="size-5 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Choose a search result</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The reference workspace will show annotated fragments, context, source
          links, filter chips, and album track grouping.
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
  return (
    <div className="flex min-h-[650px] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-md border border-border bg-background/40 p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <h2 className="font-medium">{result.title}</h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <Progress className="mt-5" value={66} />
      </div>
    </div>
  );
}

function WorkspaceError({
  result,
  message,
}: {
  result: SearchResult;
  message: string;
}) {
  return (
    <div className="flex min-h-[650px] items-center justify-center p-6">
      <div className="max-w-md rounded-md border border-destructive/40 bg-destructive/10 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 text-destructive" />
          <div>
            <h2 className="font-medium">Could not load {result.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {message}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/80 bg-background/30 p-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4" />
      <span>{message}</span>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="flex gap-3 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="size-14 animate-pulse rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
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
      ? "size-20 rounded-md object-cover"
      : "size-14 rounded-md object-cover";

  if (url) {
    return <img alt="" className={className} src={url} />;
  }

  return (
    <div
      aria-label={`${title} artwork placeholder`}
      className={`${className} flex items-center justify-center border border-border bg-muted text-muted-foreground`}
    >
      <Music2 className="size-5" />
    </div>
  );
}

function filterReferences(references: Reference[], filter: ReferenceFilter) {
  if (filter === "all") {
    return references;
  }

  return references.filter((reference) => reference.categories.includes(filter));
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
