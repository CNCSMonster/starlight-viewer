import fs from 'node:fs';
import path from 'node:path';
import { create, insert, remove, search, save, load } from '@orama/orama';
import { slug as githubSlug } from 'github-slugger';

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const STOP_WORDS = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);

function tokenizeChinese(text) {
  if (!text) return [];
  const words = [];
  const segments = Array.from(segmenter.segment(text));
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.isWordLike) {
      const w = s.segment.toLowerCase();
      if (!STOP_WORDS.has(w) && w.length > 0) {
        words.push(w);
      }
      if (i + 1 < segments.length && segments[i + 1].isWordLike) {
        const bi = (w + segments[i + 1].segment).toLowerCase();
        words.push(bi);
      }
    }
  }
  return words;
}

export class OramaSearchManager {
  constructor(contentDir, indexPath) {
    this.contentDir = path.resolve(contentDir);
    this.indexPath = indexPath
      ? path.resolve(indexPath)
      : path.resolve(process.cwd(), '.orama-index.json');
    this.db = null;
    this.initialized = false;
    this.fileMTimes = {};
    this._persistTimer = null;
  }

  _createDb() {
    return create({
      schema: {
        id: 'string',
        title: 'string',
        url: 'string',
        category: 'string',
        content: 'string',
      },
      components: {
        tokenizer: {
          language: 'zh',
          normalizationCache: new Map(),
          tokenize: tokenizeChinese,
        },
      },
    });
  }

  async init() {
    if (this.initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const t0 = performance.now();

      this.db = await this._createDb();

      // 1) 尝试加载持久化索引（重启后避免全库重建）
      let restored = false;
      try {
        const raw = fs.readFileSync(this.indexPath, 'utf-8');
        const saved = JSON.parse(raw);
        if (saved && saved.db && typeof saved.manifest === 'object' && saved.manifest !== null) {
          load(this.db, saved.db);
          this.fileMTimes = saved.manifest;
          restored = true;
          console.log(`[Orama] 已加载持久化索引: ${Object.keys(this.fileMTimes).length} 篇 (${this.indexPath})`);
        }
      } catch (err) {
        console.log(`[Orama] 无可用持久化索引，执行全量构建: ${err.message}`);
      }

      // 2) 增量同步：新建/变更文件重新入索引，已删除文件从索引移除
      const files = this.scanDir(this.contentDir);
      const currentMTimes = {};
      let changed = 0;
      for (const file of files) {
        const { id } = this.getRelInfo(file);
        let mtime;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        currentMTimes[id] = mtime;
        if (!restored || this.fileMTimes[id] !== mtime) {
          await this.upsertFile(file, restored);
          changed++;
        }
      }
      if (restored) {
        for (const id of Object.keys(this.fileMTimes)) {
          if (!(id in currentMTimes)) {
            try {
              await remove(this.db, id);
            } catch {}
            delete this.fileMTimes[id];
            changed++;
          }
        }
      }
      this.fileMTimes = currentMTimes;
      this.persistNow();

      this.initialized = true;
      const total = Object.keys(this.fileMTimes).length;
      console.log(`[Orama] 就绪: 共 ${total} 篇 (本次变更 ${changed} 篇) 耗时 ${(performance.now() - t0).toFixed(1)}ms`);
    })();
    return this._initPromise;
  }

  // 立即落盘（临时文件 + 原子替换，避免写一半损坏索引）
  persistNow() {
    try {
      if (!this.db) return;
      const payload = JSON.stringify({ manifest: this.fileMTimes, db: save(this.db) });
      const tmp = this.indexPath + '.tmp';
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, this.indexPath);
    } catch (err) {
      console.error('[Orama] 索引持久化失败:', err.message);
    }
  }

  // 变更后的防抖落盘（1.5s 静默窗口合并批量更新）
  schedulePersist() {
    if (!this.initialized) return;
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persistNow();
    }, 1500);
  }

  scanDir(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // 隐私目录与敏感配置过滤（默认屏蔽 Private/ 目录，亦支持 EXCLUDE_DIRS 追加）
    const envExcludes = (process.env.EXCLUDE_DIRS || 'Private')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const isHidden = entry.name.startsWith('.');
        const isExcluded = envExcludes.includes(entry.name.toLowerCase());
        if (!isHidden && !isExcluded) {
          results.push(...this.scanDir(full));
        }
      } else if (entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
    return results;
  }

  getRelInfo(rawPath) {
    let p = path.resolve(rawPath).replace(/\\/g, '/');
    let realBase = this.contentDir.replace(/\\/g, '/');
    try {
      realBase = fs.realpathSync(this.contentDir).replace(/\\/g, '/');
    } catch {}

    const linkBase = path.resolve(process.cwd(), 'src/content/docs').replace(/\\/g, '/');

    if (p.startsWith(linkBase)) {
      p = p.slice(linkBase.length);
    } else if (p.startsWith(realBase)) {
      p = p.slice(realBase.length);
    }

    const rel = p.replace(/^\/+/, '').replace(/\.md$/, '');
    const parts = rel.split('/').filter(Boolean);
    const category = parts.length > 1 ? parts[0] : '概览';
    const slugSegments = parts.map(segment => githubSlug(segment));
    if (slugSegments[slugSegments.length - 1] === 'index') {
      slugSegments.pop();
    }
    const slug = slugSegments.join('/');
    const url = slug ? ('/' + slug + '/') : '/';
    return { id: rel, category, url };
  }

  async upsertFile(filePath, isIncremental = true) {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const titleMatch = raw.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');
      const { id, category, url: pathUrl } = this.getRelInfo(filePath);
      // frontmatter slug 覆写路由（Astro 会把页面挂到 /<slug>/），URL 以真实路由为准
      const slugMatch = raw.match(/^\+\+\+[\s\S]*?^slug\s*=\s*["']?([^"'\n]+)["']?\s*$[\s\S]*?^\+\+\+/m)
        || raw.match(/^---[\s\S]*?^slug:\s*["']?([^"'\n]+)["']?\s*$[\s\S]*?^---/m);
      const url = slugMatch ? ('/' + slugMatch[1].trim().replace(/^\/+|\/+$/g, '') + '/') : pathUrl;

      if (isIncremental && this.db) {
        try {
          await remove(this.db, id);
        } catch {}
      }

      await insert(this.db, {
        id,
        title,
        url,
        category,
        content: raw.slice(0, 15000),
      });

      // 记录 mtime 供启动时增量比对，并安排防抖落盘
      this.fileMTimes[id] = fs.statSync(filePath).mtimeMs;
      this.schedulePersist();

      if (isIncremental) {
        console.log(`[Orama] Incremental indexed: ${id}`);
      }
    } catch (err) {
      console.error(`[Orama] Error indexing ${filePath}:`, err.message);
    }
  }

  async removeFile(filePath) {
    try {
      const { id } = this.getRelInfo(filePath);
      if (this.db) {
        await remove(this.db, id);
        delete this.fileMTimes[id];
        this.schedulePersist();
        console.log(`[Orama] Removed index: ${id}`);
      }
    } catch {}
  }

  async query(term, limit = 15) {
    if (!this.initialized && this._initPromise) {
      await this._initPromise;
    }
    if (!this.db || !term || !term.trim()) return [];
    const trimmed = term.trim();

    const res = await search(this.db, {
      term: trimmed,
      limit,
      boost: {
        title: 5,
        category: 2,
        content: 1,
      },
    });

    const hits = [];

    for (const h of res.hits) {
      const doc = h.document;
      const snippet = this.extractSnippet(doc.content, trimmed);
      hits.push({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        category: doc.category,
        snippet,
        score: h.score,
      });

      if (hits.length >= limit) break;
    }

    return hits;
  }

  extractSnippet(content, term) {
    if (!content) return '';
    // 顺带消灭 HTML 特殊字符，snippet 直入 innerHTML 不会注入
    const clean = content.replace(/[#*`~\[\]\(\)><&=_-]/g, ' ').replace(/\s+/g, ' ');
    const lower = clean.toLowerCase();
    const idx = lower.indexOf(term.toLowerCase());

    if (idx === -1) {
      // 找不到完整词时，尝试找第一个分词
      const words = tokenizeChinese(term);
      for (const w of words) {
        const subIdx = lower.indexOf(w);
        if (subIdx !== -1) {
          const start = Math.max(0, subIdx - 30);
          const end = Math.min(clean.length, subIdx + 50);
          const text = clean.slice(start, end);
          const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          return (start > 0 ? '...' : '') + text.replace(regex, '<mark>$1</mark>') + (end < clean.length ? '...' : '');
        }
      }
      return clean.slice(0, 80) + '...';
    }

    const start = Math.max(0, idx - 30);
    const end = Math.min(clean.length, idx + 50);
    const text = clean.slice(start, end);
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return (start > 0 ? '...' : '') + text.replace(regex, '<mark>$1</mark>') + (end < clean.length ? '...' : '');
  }
}
