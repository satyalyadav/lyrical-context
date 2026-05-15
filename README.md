# Lyrical Context

A single-user Next.js MVP for browsing Genius references without showing full
lyrics. Search for a song or album, select a result, and review compact Genius
annotations grouped by song or album track.

## Setup

Create `.env.local` with a Genius API client access token:

```bash
GENIUS_ACCESS_TOKEN=your_genius_client_access_token
```

Album search and tracklists use the public iTunes Search API. API responses are
cached in SQLite at `.data/lyrical-context.sqlite` by default.

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run test
npm run build
```

## API Boundaries

- Genius is used through the official API only.
- The app stores short annotated fragments and annotation bodies, not full lyrics.
- Commercial Genius API usage requires a Genius license.
