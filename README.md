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
