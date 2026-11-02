# Rocket landing page — content & design brief

This is a marketing landing page for **Rocket**, a Postman/Insomnia-like desktop API client. This repo is already scaffolded (Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn + lucide-react + Fontsource variable fonts) and builds cleanly (`bun run build`). Do not re-scaffold or replace the stack — build on top of it.

## What's already in place — use it, don't rebuild it

- `src/index.css` — full light/dark color token system already copied from RocketVault's web frontend (same product family, brand-consistent). Deep teal `--primary`. Use semantic Tailwind classes only: `bg-background`, `text-foreground`, `bg-primary text-primary-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-success`/`bg-warning` for status, etc. **Do not hardcode hex colors or invent new CSS variables.**
- `--font-sans` = Noto Sans Variable (body), `--font-heading` = JetBrains Mono Variable (headings, stat numbers, nav) — already loaded via `@fontsource-variable/*` imports in `index.css`. Use `font-heading` for section headings and big numbers to give it a developer-tool feel (monospace headings is a deliberate, distinctive choice here — lean into it).
- Dark mode: toggling the `dark` class on `<html>` switches the whole palette (already wired via `@custom-variant dark`). Build a theme toggle (sun/moon icon button, lucide-react `Sun`/`Moon`) that defaults to system preference (`prefers-color-scheme`) and persists the user's override in `localStorage`.
- `public/rocket.png` — the official app logo/icon (512×512 PNG, a stylized cartoon rocket, coral/silver/blue). Use it in the nav and hero. Don't redesign the logo.
- `src/components/illustrations/*.tsx` — a full library of ~20 brand-consistent SVG illustrations already used elsewhere in the Rocket app (`RocketLaunch`, `RocketSpeed`, `RocketLock`, `RocketOrbit`, `RocketGroup`, `RocketPlanet`, `RocketCelebrate`, `RocketPlug`, `RocketSearch`, `RocketFolder`, `RocketBook`, `RocketCloud`, etc. — see `index.ts` for the full list). They use semantic Tailwind fill classes (`fill-primary`, `fill-muted-foreground`, etc.), so they already match the color system with zero extra work. **Use these instead of generic stock icons/art wherever a section needs a visual and a real screenshot isn't available yet.** Suggested mapping:
  - Hero / final CTA: `RocketLaunch` or `RocketLiftOff`
  - Performance/benchmarks section: `RocketSpeed`
  - Security & compliance section: `RocketLock`
  - Flow (workflow builder) section: `RocketOrbit` or `RocketPlanet`
  - AI Assistant section: `RocketSearch` or `RocketGroup` (collaboration framing)
  - Git integration: `RocketFolder` or `RocketBook`
  - "No cloud, local-first" section: `RocketCloud` (crossed out / grounded framing) or `RocketLock`
- `public/screenshots/` — currently empty. **The user will provide real app screenshots shortly** (main request/response editor, the Flow canvas, the AI Assistant panel, the Git panel, the Load Testing dashboard). Build a reusable `<ScreenshotFrame>` component (a styled browser/app window chrome — rounded corners, a fake title bar with traffic-light dots, subtle shadow/border using `bg-card`/`border-border`) that takes an optional `src` prop:
  - If no real image exists yet, render a tasteful placeholder inside the frame (a relevant illustration component + a muted label like "Screenshot coming soon"), so the page still looks complete and intentional.
  - Reference the expected final filenames directly so dropping in real files is a one-line change: `public/screenshots/main-editor.png`, `flow-builder.png`, `ai-assistant.png`, `git-panel.png`, `load-testing.png`. Try loading each `src`; fall back to the placeholder on error (`onError` swap, or a simple existence check pattern — your call, keep it simple).

## Tone & positioning (from real competitor research — see Notes section below)

Rocket's honest, differentiated story: it's dramatically lighter than Electron-based competitors (real measured numbers below — lead with these, they're a rare, credible, concrete proof point most dev tools can't claim), it's local-first with no cloud/account requirement (like Bruno), AND it has two things neither Postman nor Bruno has at this depth: a built-in AI assistant that can safely act on your workspace (propose-then-approve, never blind writes) and a visual workflow builder (Flow) for chaining requests. Tone: confident, technical, developer-to-developer — not hypey. Use real numbers and specific mechanisms, not vague superlatives. The existing README's own benchmark write-up is unusually honest (it admits Rocket's startup time is the slowest of the three) — preserve that credibility; don't oversell at the expense of honesty if you reference benchmarks.

## Verified feature content (confirmed in the actual code and docs — use this, not guesses)

### Core / protocols
- HTTP, GraphQL (schema introspection + subscriptions), gRPC (via the `tonic`/`prost` Rust crates — confirmed real, not UI-only), and WebSocket (via `tokio-tungstenite`) requests in one collection tree.
- File-based collections stored as OpenCollection YAML on disk — human-readable, diffable, git-friendly.
- Multi-workspace support, embedded and external collections.
- Import from Postman, Bruno, or WSDL, with auto-detection.

### Git integration
- Full git via `libgit2` (the `git2` Rust crate) — staging, commits, branches, merges, push/pull/fetch (force-with-lease), stash, remote management, SSH key discovery, real per-file conflict resolution. **No shelling out to the `git` CLI** — it's a real embedded implementation, not a wrapper.
- **Example masking at commit time**: saved response examples (which can contain real tokens/cookies/JWTs from live API calls) are automatically redacted the moment they're committed — secret-shaped values, auth headers, cookies all get masked in the commit itself, not just at rest. This is a genuinely distinctive safety feature — most API clients don't think about secrets leaking through committed example data.

### AI Assistant (the headline differentiator)
- A workspace chat panel connecting to an agent over ACP (Agent Client Protocol) — supports Claude, Gemini, or a generic ACP-compatible agent. You bring your own agent/model, not locked to one vendor.
- The agent reads your workspace through an MCP (Model Context Protocol) tool server Rocket exposes — it can see your requests, collections, environments, history, and test results.
- **Nothing is written until you approve it.** The agent proposes changes (new requests/folders, script edits, renames, moves, environment variables, folder settings) as a reviewable card — never a blind write. Three modes: Ask (read-only) → Edit (can propose changes) → Agent (can also run requests), each strictly more permissive than the last.
- Conversations are stored per workspace with secrets masked. Agent credentials come from RocketVault, an environment variable, or the OS keychain — never hardcoded.
- A collection trust gate shows exactly what elevated capabilities a collection is asking for (developer-mode script access, extra script folders, letting the agent run requests, host environment variable access) and what you've actually allowed, per-computer.

### Flow — visual workflow builder
- A canvas for wiring saved requests together with Input, If, Switch, Transform, Auth, Wait-for-callback, and Output nodes.
- Run a whole flow or just part of it; review per-step traces and saved run history.
- Flows are plain YAML files inside the collection — git-diffable like everything else, not a proprietary opaque format.
- Flows track the requests they reference: a move/rename inside a collection automatically rewrites every flow that pointed at it; a cross-collection move or a delete is reported (never silently broken) so nothing dangles invisibly.
- A live variable preview in the flow editor resolves `{{variable}}` across every scope (dynamic, process, global, collection, vault, active environment) right in the editor, with secrets shown masked.

### Scripting & testing
- Pre-request/post-response/test scripts in Monaco with real TypeScript IntelliSense for the `rok.*` scripting API.
- `rok.*` is built for near-complete parity with Bruno's own JS API (sync state, async `sendRequest`/`runRequest`/`sleep`, cookies/jar) — scripts written for Bruno port over with minimal changes.
- Shared `.js` script files loadable via a local `require()` — sandboxed: resolution is restricted to the collection directory (or explicitly approved extra roots in Developer mode), with path canonicalization so `..` traversal and symlink escapes are blocked by construction, not just checked.
- A visual, no-code assertions builder for people who don't want to write test scripts at all.
- A Collection Runner executes a whole collection or folder sequentially with live streamed progress; history entries carry a run-source badge (manual, runner, load test, flow, agent) so you can filter by how a request actually ran.

### Environments & secrets
- `{{variable}}` templating with secret masking everywhere: the Console (HTTP log) shows masked values by default with a per-row reveal toggle that never persists the unmasked value to disk.
- External secret manager integration: RocketVault and Azure Key Vault, for pulling real secret values from a vault instead of storing them in the collection.
- Authentication: Basic, Bearer, API Key, Digest, NTLM, WSSE, OAuth 1.0, OAuth 2.0 (client credentials, password, authorization code + PKCE, implicit), AWS SigV4, plus mTLS client certificates and proxy support. Requests/folders inherit auth from their parent.

### Load testing
- Phase-based (ramp-up/hold/ramp-down) or fixed-concurrency/RPS runs.
- A live dashboard: latency/throughput/error-rate/concurrency charts, percentile stats.
- Export to HTML/CSV/JSON/PDF.

### Contract Lock & compliance
- Attach SLA/API contracts to collections or folders, track drift with a changelog, preview PDFs natively, export contracts as OpenAPI YAML.
- A tamper-evident, hash-chained security/compliance audit trail with configurable compliance profiles and evidence export — appeals directly to security-conscious teams and regulated industries.

### Collection export
- Export any collection as a Bruno ZIP or a Postman Collection v2.1 file (with environments bundled) — migrating *away* from Rocket is just as frictionless as migrating *to* it. Literal credentials are always blanked on export, no option to include them.

### Performance — the real, measured numbers (README + docs/engineering/benchmarks.md, measured 2026-10-21, Rocket 2.1.1 vs Bruno 4.2.0 vs Postman 11.71.7 on the same Linux machine)

| Metric | Rocket | Bruno | Postman |
|---|---|---|---|
| Install size (unpacked) | **146 MB** | 527 MB | 653 MB |
| Download size | **48.4 MB** (.deb) | not measured | 174 MB (snap) |
| Idle memory (PSS) | **~262 MB** (3 processes) | ~566 MB (7 processes) | ~516 MB (7 processes) |
| Idle private memory | **151 MB** | 480 MB | 311 MB |
| Idle CPU | ~1% | ~0% | ~7% (likely background sync, signed in) |
| Startup → UI drawn | ~10.4 s (weak spot) | ~4.2 s | ~2.2 s |

Why: Rocket uses the OS's own WebView (WebKitGTK/WKWebView/WebView2) instead of bundling Chromium like Electron apps do, and the backend is Rust (no GC, no JVM, no Node runtime) with no background cloud polling. **Be honest about the one place Rocket loses**: startup time is clearly the slowest of the three — don't hide this, the surrounding honesty is part of the credibility. Link/reference that the full methodology is published (don't fabricate a link — just mention "full methodology published alongside the benchmark").

### Cross-platform, no cloud
- Native desktop app for Linux, macOS, and Windows.
- No cloud, no account required — all data stays on the user's machine. (Note: Postman requires an account; Rocket and Bruno both work fully offline — a real, verified differentiator, not spin.)
- MIT licensed, open source.

## Structure (sections, roughly in this order)

1. **Nav** — logo + "Rocket" wordmark, links to Features / AI Assistant / Flow / Benchmarks / Security, a GitHub icon-link, theme toggle, a primary "Download" or "Get Started" button.
2. **Hero** — headline + subhead + two CTAs (Download, View on GitHub) + a `<ScreenshotFrame>` for the main editor view (slot: `main-editor.png`). Headline should lead with the core promise (fast/native/local-first + AI-native), not a generic "the best API client" claim.
3. **Proof strip** — a slim, high-contrast stat bar right under the hero with 3-4 of the benchmark numbers above (install size, idle memory, the multiplier vs. Postman/Bruno). This is Rocket's single strongest, most concrete asset — don't bury it below the fold.
4. **Feature grid** — cards for the core feature set (multi-protocol, git integration, scripting/rok.* API, environments & secrets, auth types, collection runner, load testing, contract lock, audit trail). Use illustrations or lucide icons per card, not screenshots here (too many for individual screenshots).
5. **AI Assistant spotlight** — its own full-width section: explain the ACP+MCP architecture in plain developer language (bring your own agent, propose-then-approve safety model, the 3 modes), with a `<ScreenshotFrame>` slot (`ai-assistant.png`).
6. **Flow spotlight** — its own section: the visual canvas, node types, that flows are plain git-diffable YAML, with a `<ScreenshotFrame>` slot (`flow-builder.png`).
7. **Benchmark comparison table** — the full table from above, Rocket column visually emphasized, with the honest startup-time caveat included (don't cherry-pick only the wins).
8. **Security & compliance section** — trust gate, console masking, example masking at commit, audit trail — framed for security-conscious teams, with `<ScreenshotFrame>` slot (`git-panel.png`) or a `RocketLock` illustration.
9. **Load testing section** (can be folded into the feature grid or given a small spotlight with `load-testing.png` slot — your call based on visual balance).
10. **"No cloud, your data stays yours"** — short, punchy section on local-first/offline/no-account, contrasted briefly with cloud-based competitors.
11. **Final CTA** — download links for Linux/macOS/Windows, GitHub link, MIT license mention.
12. **Footer** — links (Docs, GitHub, License), copyright.

## Technical requirements

- Fully responsive (mobile, tablet, desktop) — no horizontal scroll at any width.
- Accessible: real `<h1>`/`<h2>` hierarchy, alt text on images, keyboard-navigable nav and theme toggle, sufficient contrast in both themes (the token system already handles contrast — just don't override with raw colors).
- Smooth-scroll anchor navigation from the nav links to each section (`scroll-behavior: smooth` is already set globally in `index.css`).
- Keep it a single-page app — no router needed, this is one scrollable page with anchor nav.
- lucide-react for any generic icons (download, github, sun/moon, check, arrow, etc.) — never inline raw SVG for those (the Rocket app's own convention, worth keeping here too for consistency, though this is a separate repo so it's a style choice not a hard rule).
- Verify before finishing: `bun run build` (runs `tsc -b && vite build`) must pass clean, no TypeScript errors, no console warnings about missing keys/accessibility in dev mode.
- Write a short `README.md` for this repo explaining how to run it (`bun install`, `bun run dev`, `bun run build`) — this is a separate project from the main Rocket app, so document it standalone.
- Commit your work with git when done, staging explicit paths only (e.g. `git add src/ public/ README.md ...`) — **never `git add -A` or `git add .`**, a repo-wide hook on this machine blocks it. Use a normal conventional-commit style message. Do not push anywhere.

## What NOT to do

- Don't invent features that aren't listed above — everything above was verified against the actual source and docs, not guessed.
- Don't claim things are "coming soon" or "in beta" for features confirmed shipped above — they're real and on main.
- Don't touch the color tokens in `index.css` beyond what's already there.
- Don't add a backend, API calls, forms that submit anywhere, or any analytics/tracking — this is a static marketing page only.
- Don't add TanStack Router/Query or any other heavy dependency not already in `package.json` — keep this lean; it's a marketing site, not an app.
