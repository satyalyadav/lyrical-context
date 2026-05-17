export type SearchType = "song" | "album";

export type ReferenceCategory =
  | "diss"
  | "names-places"
  | "sample-interpolation"
  | "verified-accepted";

export type SongSearchResult = {
  type: "song";
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  sourceUrl: string;
  metadata: {
    geniusId: number;
  };
};

export type AlbumSearchResult = {
  type: "album";
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  sourceUrl: string;
  metadata: {
    collectionId: number;
    trackCount: number | null;
    releaseYear: string | null;
  };
};

export type SearchResult = SongSearchResult | AlbumSearchResult;

export type Reference = {
  id: string;
  referentId: string;
  sortIndex: number;
  fragment: string;
  annotation: string;
  annotationHtml: string | null;
  sourceUrl: string;
  state: string | null;
  classification: string | null;
  verified: boolean;
  votesTotal: number | null;
  categories: ReferenceCategory[];
};

export type SongReferenceResponse = {
  song: SongSearchResult;
  references: Reference[];
  source: "cache" | "live";
};

export type AlbumTrack = {
  id: string;
  title: string;
  artist: string;
  trackNumber: number;
  discNumber: number;
  explicitness: string | null;
};

export type TrackReferenceGroup = {
  track: AlbumTrack;
  matchStatus: "matched" | "unmatched" | "error";
  matchConfidence: number | null;
  matchedSong: SongSearchResult | null;
  references: Reference[];
  error: string | null;
};

export type AlbumReferenceResponse = {
  album: AlbumSearchResult;
  tracks: TrackReferenceGroup[];
  source: "cache" | "live" | "mixed";
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
