# Lyrical Context

Get Genius lyric references in an easy to view way.

## Genius API usage

This app is built to follow [Genius API Terms of Service](https://genius.com/api-terms)
and the expectations in the [Genius API documentation](https://docs.genius.com/):

- Uses the official Genius API only (no scraping).
- Shows short annotated fragments and annotation excerpts, not full lyrics pages.
- Links back to Genius via `sourceUrl` on songs and references.
- Does not cache or redistribute full lyric text from Genius.

## Setup

Copy `.env.example` to `.env.local` and add:

- a [Genius API](https://genius.com/api-clients) client access token
- Spotify Web API client credentials from a Spotify Developer app

```bash
cp .env.example .env.local
```

Album search and tracklists use Spotify's Web API. Set `SPOTIFY_CLIENT_ID`
and `SPOTIFY_CLIENT_SECRET`; `SPOTIFY_MARKET` is optional and defaults to `US`.
API responses are cached in SQLite at `.data/lyrical-context.sqlite` by default.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run test
npm run build
```

## Genius API

- Genius is used through the official API only.
- The app stores short annotated fragments and annotation bodies, not full lyrics.
- Commercial Genius API usage may require a separate Genius license.
