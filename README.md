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

Create `.env.local`:

```bash
GENIUS_ACCESS_TOKEN=your_genius_client_access_token
```

Album search and tracklists use the public iTunes Search API. API responses are
cached in SQLite at `.data/lyrical-context.sqlite` by default.

### Deployed API route protection

On Vercel/production, `/api/*` routes require a short-lived, HttpOnly session
cookie that is minted when someone loads the app. They also reject cross-site
browser requests and direct navigations to API URLs before calling Genius.

```bash
GENIUS_ACCESS_TOKEN=your_genius_client_access_token
# Optional, but recommended so the Genius token is not also the cookie signer.
LYRICAL_CONTEXT_SESSION_SECRET=long-random-secret

# Global Genius API circuit breaker. Limit 0 disables it.
LYRICAL_CONTEXT_GENIUS_BUDGET_LIMIT=500
LYRICAL_CONTEXT_GENIUS_BUDGET_WINDOW_SECONDS=3600
LYRICAL_CONTEXT_GENIUS_BUDGET_WARNING_REMAINING=50

# Durable shared budget storage. Use Vercel KV or Upstash Redis.
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...
# or:
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

All deployments also get per-IP rate limiting (60 requests per minute) on API
routes to reduce accidental abuse of your Genius token. Genius calls also pass
through a global budget. When the shared budget gets low, API responses include
budget headers and the app shows a warning. When the budget is exhausted, Genius
calls stop until the window resets.

Set either the `KV_*` variables or the `UPSTASH_REDIS_*` variables in Vercel so
the budget is shared across serverless instances. Without Redis/KV, the app falls
back to an in-memory budget that is useful locally but not durable on Vercel.

This is not a substitute for real user authentication or Vercel Deployment
Protection if the app should be private.

For a small private group, use Vercel Deployment Protection, Cloudflare Access,
or HTTP basic auth in front of the app. An unlisted URL is not a security boundary.

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

CI runs the same commands on pushes and pull requests to `main`.

## API boundaries

- Genius is used through the official API only.
- The app stores short annotated fragments and annotation bodies, not full lyrics.
- Commercial Genius API usage may require a separate Genius license.
