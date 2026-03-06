# Instagram DM Filter

A Node.js server that automatically filters incoming Instagram DMs and Reel shares. It classifies content using the Claude API and takes action based on the classification:

- **POKEMON** content -- auto-replies "cool"
- **GYM** content -- sends a push notification
- **HATEFUL** content -- sends a random dismissive reply or heart reaction
- **OTHER** content -- sends a push notification

## Tech Stack

- **Node.js 18+** / Express.js
- **Anthropic Claude API** (claude-haiku-4-5, with prompt caching)
- **Meta Graph API + Webhooks** (Instagram messaging)
- **ntfy.sh** (push notifications)

## Project Structure

```
instagram-dm-filter/
├── server.js          -- main entry point (Express, webhook handlers)
├── classifier.js      -- Claude API classification logic
├── instagram.js       -- Meta Graph API helpers
├── notify.js          -- ntfy.sh push notification helper
├── config.js          -- env vars and whitelist
├── .env               -- secrets (never commit)
├── .env.example       -- template for .env
└── package.json
```

## Environment Variables

| Variable | Description |
|---|---|
| `INSTAGRAM_PAGE_ACCESS_TOKEN` | Long-lived Page Access Token from Meta Developer Console |
| `INSTAGRAM_APP_SECRET` | App Secret for webhook signature verification |
| `WEBHOOK_VERIFY_TOKEN` | Any random string, used during webhook setup |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `NTFY_TOPIC` | Your private ntfy.sh topic name |
| `WHITELISTED_SENDER_IDS` | Comma-separated Instagram user IDs to monitor |

## Deployment

1. Clone the repo and run `npm install`
2. Copy `.env.example` to `.env` and fill in all values
3. Deploy to Render.com (free tier):
   - New Web Service -> connect GitHub repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Add all env vars in the Render dashboard
4. Copy the public Render URL (e.g. `https://ig-filter.onrender.com`)
5. Go to Meta Developer Console -> your app -> Webhooks
6. Subscribe to the `messages` field on the Instagram object
7. Set callback URL to `https://your-app.onrender.com/webhook`
8. Set verify token to match your `WEBHOOK_VERIFY_TOKEN` env var
9. To find a sender's Instagram user ID: use Graph API Explorer -> `GET /{username}?fields=id`
10. Add the ID(s) to `WHITELISTED_SENDER_IDS` in your `.env`

## Local Development

1. Copy `.env.example` to `.env` and fill in your credentials
2. Run the dev server with file watching:
   ```
   npm run dev
   ```
3. Use [ngrok](https://ngrok.com) to expose your local server:
   ```
   ngrok http 3000
   ```
4. Set the ngrok URL as your webhook callback URL in the Meta Developer Console
