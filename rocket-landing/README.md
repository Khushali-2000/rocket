# Rocket landing page

The marketing site for **Rocket**, the native desktop API client. One scrollable
page, no router, no backend, no analytics.

This is a standalone repository. The Rocket application itself lives elsewhere —
nothing here imports from it, and nothing here needs it running.

## Run it

```bash
bun install     # once
bun run dev     # http://localhost:5173, with hot reload
bun run build   # tsc -b && vite build, output in dist/
bun run preview # serve the production build
bun run lint    # oxlint
```

`bun run build` is the gate: it must finish with no TypeScript errors, and
`bun run lint` must finish with no warnings.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4 (through `@tailwindcss/vite`, so
there is no `tailwind.config.js`) · lucide-react · Fontsource variable fonts.

## Where things are

| Path | What it holds |
|---|---|
| `src/App.tsx` | Section order for the whole page |
| `src/components/` | One file per section, plus the shared pieces |
| `src/components/illustrations/` | The brand SVG set, shared with the Rocket app |
| `src/components/ui/` | Button styling, split so anchors can borrow it |
| `src/lib/site.ts` | Outbound links, anchor ids, benchmark metadata |
| `src/index.css` | Colour tokens, fonts, and the scroll-reveal utilities |
| `public/screenshots/` | Real app screenshots — see below |

### Colour and type

`src/index.css` holds the full light and dark token set, shared with RocketVault.
Style with the semantic classes — `bg-background`, `text-muted-foreground`,
`bg-card`, `border-border`, `bg-primary text-primary-foreground`, `bg-success`,
`bg-warning` — and the dark theme follows for free. Do not hardcode colours.

`font-sans` is Noto Sans (body) and `font-heading` is JetBrains Mono (headings,
numbers, labels). The monospace headings are deliberate.

### Theme

An inline script in `index.html` sets the `dark` class on `<html>` before the
first paint, reading `localStorage['rocket-theme']` and falling back to
`prefers-color-scheme`. `ThemeToggle` writes the same key.

### Adding screenshots

`public/screenshots/` is empty. Every `<ScreenshotFrame>` already points at its
final filename and renders a brand illustration placeholder until the file
exists, so dropping a PNG in is the whole change:

| File | Appears in |
|---|---|
| `main-editor.png` | Hero |
| `ai-assistant.png` | AI Assistant section |
| `flow-builder.png` | Flow section |
| `git-panel.png` | Security section |
| `load-testing.png` | Load testing section |

### Links

Download and GitHub URLs are placeholders in `src/lib/site.ts`. Change them
there once the public repository and release URLs are final; every button on the
page reads from that one file.

## Content

Every feature claim and every benchmark number on the page comes from the Rocket
source and its published docs. The benchmark table is reproduced in full,
including the startup-time row where Rocket is the slowest of the three clients
measured — keep it that way if you edit the copy.
