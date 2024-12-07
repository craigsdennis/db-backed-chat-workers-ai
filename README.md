# Database Backed Workers AI Chat

This is an example AI chat application that makes use of the [D1](https://developers.cloudflare.com/d1/) database to store conversations. It uses [Workers AI](https://developers.cloudflare.com/workers-ai/) for the hosting provider.

Users authenticate and then are given a JWT via the [Hono](https://honojs.dev) framework.

## Setup

Create a D1 database

```bash
npx wrangler d1 create chat
```

Copy the results to your [wrangler.toml](./wrangler.toml) file.

## Develop

Run any database migrations

```bash
npx wrangler d1 migrations apply chat
```

```bash
npm run dev
```

## Deploy

Run the database migrations (on the remote DB)
```bash
npm run predeploy
```

```bash
npm run deploy
```
