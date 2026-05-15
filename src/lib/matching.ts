import { normalizeArtist, normalizeTitle } from "@/lib/text";
import type { AlbumTrack, SongSearchResult } from "@/lib/types";

export type SongMatch = {
  song: SongSearchResult;
  confidence: number;
};

const MIN_CONFIDENCE = 0.68;

export function pickBestSongMatch(
  track: AlbumTrack,
  candidates: SongSearchResult[]
): SongMatch | null {
  const ranked = candidates
    .map((song) => ({
      song,
      confidence: scoreSongMatch(track, song),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0];

  if (!best || best.confidence < MIN_CONFIDENCE) {
    return null;
  }

  return best;
}

export function scoreSongMatch(track: AlbumTrack, song: SongSearchResult) {
  const trackTitle = normalizeTitle(track.title);
  const songTitle = normalizeTitle(song.title);
  const trackArtist = normalizeArtist(track.artist);
  const songArtist = normalizeArtist(song.artist);

  let titleScore = tokenSimilarity(trackTitle, songTitle);
  if (trackTitle === songTitle) {
    titleScore = 1;
  } else if (songTitle.includes(trackTitle) || trackTitle.includes(songTitle)) {
    titleScore = Math.max(titleScore, 0.86);
  }

  let artistScore = tokenSimilarity(trackArtist, songArtist);
  if (trackArtist === songArtist) {
    artistScore = 1;
  } else if (songArtist.includes(trackArtist) || trackArtist.includes(songArtist)) {
    artistScore = Math.max(artistScore, 0.75);
  }

  return roundConfidence(titleScore * 0.78 + artistScore * 0.22);
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = Array.from(leftTokens).filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}
