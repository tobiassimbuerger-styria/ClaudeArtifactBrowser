# Artifact Browser

A community directory of public Claude artifacts: browse by tag, launch with one click, vote, and post
your own.

**Site: https://tobiassimbuerger-styria.github.io/ClaudeArtifactBrowser/**

Unofficial community project, not affiliated with Anthropic.

## Use the site

- **Browse:** no account needed. Sort by *Hyped*, *New* or *Top*, filter by tag, or search.
- **Post:** sign in with Google, click *Post artifact* and paste a link of the form
  `https://claude.ai/artifact/…` or `https://claude.ai/public/artifacts/…`. The artifact must be
  shared publicly in Claude, otherwise visitors cannot open it. A screenshot is optional.
- **Vote:** thumbs up or down, one vote per account. Clicking the same thumb again takes the vote back.
- **Delete:** your own posts have a *Delete* button.
- **Report:** every card has a *Report* link that opens an issue in this repository.

What is stored about you is described on the site's
[privacy page](https://tobiassimbuerger-styria.github.io/ClaudeArtifactBrowser/privacy.html).

## Contribute

Bug reports and ideas are welcome as [issues](../../issues), code changes as pull requests.
To try a change locally:

```sh
node build.mjs http://localhost:3000
npx serve dist
```

Browsing works locally; signing in, posting and voting need a deployed worker (see below).

The link check that keeps anything but Claude artifact links out has its own test, which also runs
before every deployment:

```sh
node --test worker/artifact-url.test.mjs
```

## Host your own copy

The site is static and runs on GitHub Pages. A Cloudflare Worker checks the Google sign-in and stores
posts and votes in `data/artifacts.json` of the repository. All of it fits into the free tiers.

1. **Repository and Pages.** Fork this repository. In *Settings → Pages* set *Source* to
   *GitHub Actions*. Every push to `main` rebuilds the site. Start with an empty list: replace the
   content of `data/artifacts.json` with `[]`.
2. **Google sign-in.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   create an *OAuth client ID* of type *Web application* and add your site origin under *Authorized
   JavaScript origins*. Publish the app on the *Audience* page so that anyone can sign in.
3. **GitHub token.** Create a [fine-grained token](https://github.com/settings/personal-access-tokens)
   limited to your repository with *Contents: Read and write*.
4. **Worker.** Set your repository, site origin and Google client ID in `[vars]` in
   `worker/wrangler.toml`, then:

   ```sh
   cd worker
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put VOTER_SALT   # any long random string; changing it resets who voted
   npx wrangler secret put SESSION_KEY  # any long random string; changing it signs everyone out
   npx wrangler deploy
   ```

5. **Site config.** Put the worker URL (no trailing slash) and the Google client ID into `config.js`.
   Replace the repository address in `app.js`, `index.html` and `privacy.html`, and push.
6. **Search engines.** Add the site in [Search Console](https://search.google.com/search-console),
   replace the verification tag in `index.html` with your own and submit `<site>/sitemap.xml`.

## Moderate

Remove an entry from `data/artifacts.json`, delete its picture `data/covers/<id>.jpg` if there is one,
and push. An entry looks like this:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "title": "Pomodoro timer",
  "description": "A simple focus timer.",
  "author": "someone",
  "owner": null,
  "tags": ["tool", "productivity"],
  "created": "2026-11-25T10:00:00Z",
  "voters": [],
  "downvoters": [],
  "cover": false
}
```

`id` is the last part of the artifact link. `owner`, `voters` and `downvoters` hold salted hashes of
Google account ids, never the ids themselves.

## Troubleshooting

- **Sign-in, post or vote does nothing:** `SITE_ORIGIN` in `wrangler.toml` must match the site origin
  exactly (scheme and host, no path, no trailing slash).
- **"Please sign in again" right after signing in:** `GOOGLE_CLIENT_ID` differs between `config.js`
  and `wrangler.toml`.
- **"Something went wrong":** the worker cannot reach the repository. Check that `GITHUB_TOKEN` is
  valid and not expired; `npx wrangler tail` in `worker/` shows the cause.
- **Site does not update after a push:** look at the *Actions* tab for a failed *Deploy site* run.
