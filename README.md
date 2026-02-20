# Crucible

AI-assisted career services platform.

## Structure

- `apps/web` — Next.js 14 App Router (Vercel)
- `services/worker` — BullMQ job consumer (Docker on VPS)
- `packages/core` — Shared types, schemas, event definitions

## Setup

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp services/worker/.env.example services/worker/.env
```

## Development

```bash
npm run dev -w apps/web        # Web app on localhost:3000
npm run dev -w services/worker  # Worker process
npm run migrate -w packages/core # Run database migrations
```

## Build

```bash
npm run build -w apps/web
```
