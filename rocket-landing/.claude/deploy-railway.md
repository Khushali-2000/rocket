# Deploying rocket-landing to Railway

The landing page is a static site served by Caddy from a Docker image.

## Where it lives

| Item | Value |
|---|---|
| Project | `rocket-app` (`29691ce6-0cf1-4db6-9323-7ea3e14e66d2`) |
| Service | `rocket-landing` |
| Environment | `production` |
| URL | https://web.rocket.numericlabs.io (custom domain, port 8080) |
| Railway URL | https://rocket-landing-production.up.railway.app |

## Files

- `Dockerfile`: a Node 22 plus bun build stage, then a `caddy:2-alpine` runtime stage.
  Node is needed because `build` runs `node scripts/fetch-release.mjs` and the `tsc` shim uses a `node` shebang. `oven/bun` alone fails.
- `Caddyfile`: listens on `$PORT`, caches `/assets/*` for a year, sends `index.html` with `no-cache`, and falls back to `index.html`.
- `railway.json`: Dockerfile builder, health check on `/`.
- `.dockerignore`: keeps `node_modules` and `dist` out of the build context.

## Deploy

Deploys are manual. A git push does not deploy.

```bash
cd rocket-landing
railway link -p 29691ce6-0cf1-4db6-9323-7ea3e14e66d2 -e production -s rocket-landing
railway up --service rocket-landing --environment production --ci
```

## Notes

- The build runs `scripts/fetch-release.mjs`. If GitHub is unreachable or rate limits it, the committed `src/data/release.json` is kept, so the download links may be stale but the build does not fail. Set `GITHUB_TOKEN` as a build variable to avoid the unauthenticated limit.
- The site must be served from the domain root (`/favicon.png`, `/rocket.png` are root-absolute).
- `railway.json` is deprecated by Railway (works until 2026-12-01). Migrate with `railway config migrate`.
- To redeploy with fresh release links, run the deploy command again.
