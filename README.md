# Starlight Pure Viewer (with Orama Realtime Search)

A high-aesthetic, zero-intrusive viewer for pure Markdown knowledge bases (Obsidian, Logseq, Foam, or standard VS Code notes).

Powered by **Astro Starlight**, **Expressive Code**, and **Orama in-memory search**.

---

## Key Highlights

1. **True SSOT & Zero Frontmatter Required**:
   Keeps your Markdown notes 100% pure. Document titles are dynamically extracted from the first `# Heading` via custom content loaders.
2. **Real-time Incremental Full-Text Search (Orama)**:
   Overcomes Starlight Pagefind's dev-server limitation. Offers instant, sub-second Chinese/English search in development mode with `Ctrl + K` modal, keyword highlighting, and hot updates.
3. **Symlink-Driven**:
   Mounts your external Markdown notes directory via a single symbolic link without touching or modifying your raw files.
4. **Privacy-First Architecture**:
   By default, private directories like `Private/` are completely excluded from indexing and sidebar rendering. Extra directories can be excluded via `EXCLUDE_DIRS=Drafts,Confidential`.
5. **Built-in Mermaid Diagrams (Lazy)**:
   ```mermaid fences render to SVG on demand — the ~5 MB renderer (~1.4 MB gzipped) is fetched only on pages that actually contain a diagram. Each diagram gets an inline zoom/pan/fullscreen viewer, so dense flowcharts stay readable on a 13" screen. Rendering failures keep the original code block for debugging.

   Interaction:

   - **Two-finger spread = zoom in; two-finger close = zoom out.** This is the primary gesture. Browsers expose the same pinch in three ways, all handled: `wheel` with `ctrlKey=true` on Chrome/Edge/Firefox trackpads, `GestureEvent.scale` on Safari, and changing pointer distance on touchscreens. The factor is continuous/exponential, so the diagram follows the fingers instead of stepping.
   - **Ctrl/⌘ + wheel** is only an explicit fallback for devices that do not deliver pinch to the page; it uses the same continuous factor.
   - **Two-finger same-direction scroll / plain wheel** is a different gesture: it scrolls the page in the inline viewer (no scroll hijacking) and never zooms the diagram. Inside fullscreen there is no page to scroll, so plain wheel also zooms.
   - **Drag** pans; **double-click** or **⤢** refits the whole diagram; **⛶** opens native fullscreen (fits the new viewport, Esc exits, and the backdrop follows the theme — white for dark SVG in light theme, dark for light SVG in dark theme). SVG stays vector, so zoomed text remains sharp.
   - **Keyboard**: focus the diagram, then use arrow keys to pan, `+`/`-` to zoom, `0` to fit.
   - **Browser page zoom** (Ctrl/⌘ + `+`/`-`/`0`) is left to the browser: it magnifies the page and the diagram instead of being mistaken for a container resize that re-fits the diagram smaller.
   - **Custom node colors in dark theme**: very bright `style fill:#...` values are blended toward Mermaid's dark node base to avoid glare, and node labels are checked against the actual background (WCAG >= 5.0:1 margin) with a dark/light fallback. Light theme keeps the author's original fills. Thresholds live in `src/scripts/mermaid-contrast.js`.
   - **Coverage & Boundaries**: Covers standard `flowchart` and `sequence` diagrams (`g.node`, `g.cluster`, `g.actor`, `g.actor-man`), as well as class and state diagram nodes. Gradient, pattern, or image fills (`url(#...)`) and non-node graphics (such as edge labels, Gantt tasks, or Pie slices) are deliberately left unadjusted without guessing to avoid breaking default styling.
   - **Accessibility (a11y)**: Automatically injects `<title>` ("Mermaid 图表") and `<desc>` (diagram type + node count) bound via `aria-labelledby` and `aria-describedby`, while preserving the `graphics-document` role so internal diagram text remains traversable.

---

## Quick Start

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/CNCSMonster/starlight-viewer.git
cd starlight-viewer
pnpm install

# 2. Link your Markdown notes
ln -s /path/to/your/markdown-notes ./src/content/docs

# 3. Start reading
pnpm dev
```

Visit `http://localhost:4321` in your browser.

### Code blocks

Code fences are rendered by **Expressive Code + Shiki** and only get token colors when the fence language has a real grammar:

- `text` / `txt` are intentionally plain (used for logs/output); `gdb`, `msg`, `sudoers` are explicitly aliased to `txt`.
- An unknown or misspelled language silently falls back to plaintext; add a `langAlias` entry or correct the fence if it should be highlighted.
- In dev, Expressive Code's base styles are **inlined** (`NODE_ENV !== production`) to avoid Vite's flaky `/_astro/ec.*.css` MIME response, which browsers reject and which makes code blocks look unstyled. `pnpm build` still emits the cacheable external `/_astro/ec.*.css`.

### Mermaid renderer bundle

`public/mermaid-render.js` (~5 MB: mermaid + viewer) is a **generated artifact, not tracked by git**. It is rebuilt automatically by `astro.config.mjs` on the first `pnpm dev` / `pnpm build` after a change, and can be forced with:

```bash
pnpm build:mermaid          # rebuild only when sources changed
pnpm build:mermaid --force  # rebuild unconditionally
```

Source of truth: `src/scripts/mermaid-render.js` (renderer + viewer), `src/scripts/mermaid-zoom.js` (pure fit/zoom math), `src/scripts/mermaid-contrast.js` (dark-theme fill dimming / WCAG label contrast), `src/scripts/browser-zoom.js` (browser page-zoom quirk isolation), and `public/mermaid-client.js` (lazy loader injected via Starlight `head`).

```bash
pnpm test                   # pure math / browser-zoom unit tests (node:test)
```
