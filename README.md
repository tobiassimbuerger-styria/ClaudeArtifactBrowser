# Lesezeichen

Browse, launch and share public Claude artifacts. Static site on GitHub Pages; a Cloudflare Worker
verifies Google sign-in and writes posts and votes to `data/artifacts.json` in this repo.

## Run locally

```sh
node build.mjs http://localhost:3000
npx serve dist
```

Posting and voting need the deployed worker.

## Deploy

1. **Repo and Pages.** Push to a public GitHub repo on branch `main`. In *Settings → Pages* set
   *Source* to *GitHub Actions*, and enter the custom domain there. Every push to `main` rebuilds the site.
2. **Google sign-in.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   create an *OAuth client ID* of type *Web application* and add the site URL under *Authorized
   JavaScript origins*.
3. **GitHub token.** Create a [fine-grained token](https://github.com/settings/personal-access-tokens)
   limited to this repo with *Contents: Read and write*.
4. **Worker.** Fill in `[vars]` in `worker/wrangler.toml`, then:

   ```sh
   cd worker
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put VOTER_SALT   # any long random string; changing it resets who voted
   npx wrangler secret put SESSION_KEY  # any long random string; changing it signs everyone out
   npx wrangler deploy
   ```

5. **Frontend config.** Put the worker URL (no trailing slash) and the Google client ID into
   `config.js` and push.
6. **Google search.** Add the site in [Search Console](https://search.google.com/search-console)
   and submit `<site>/sitemap.xml`.

## Moderation

Edit `data/artifacts.json` and push. Entries look like this; `id` is the last part of
`https://claude.ai/artifact/<id>` or `https://claude.ai/public/artifacts/<id>`, `voters` and `downvoters` hold salted hashes of Google account ids,
`cover` says whether `data/covers/<id>.jpg` exists.

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "title": "Pomodoro timer",
  "description": "A simple focus timer.",
  "author": "someone",
  "tags": ["tool", "productivity"],
  "created": "2026-11-25T10:00:00Z",
  "voters": [],
  "downvoters": [],
  "cover": false
}
```

## Troubleshooting

- **Post or vote does nothing:** `SITE_ORIGIN` in `wrangler.toml` must match the site origin exactly
  (scheme and host, no path, no trailing slash).
- **"Please sign in again":** `GOOGLE_CLIENT_ID` differs between `config.js` and `wrangler.toml`,
  or the one-hour Google session expired.
- **New post missing after reload:** the Pages rebuild takes about a minute.
