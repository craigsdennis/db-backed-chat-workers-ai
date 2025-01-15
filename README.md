# Database Backed Workers AI Chat

Users can sign up and begin chatting with an AI model hosted on [Workers AI](https://developers.cloudflare.com/workers-ai/). Conversations and messages are stored in [D1](https://developers.cloudflare.com/d1/). Conversations are automatically titled and summarized using a [Cron trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and AI.

NOTE: Authentication is not in place in this demo, the password is always `12345`. However, it does use JSON Web Tokens (JWT) via the [Hono](https://honojs.dev) web framework.

Users => Conversations => Messages

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
