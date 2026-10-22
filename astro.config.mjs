// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { OramaSearchManager } from './src/search-engine.js';

const docsDir = path.resolve(process.cwd(), 'src/content/docs');
const searchManager = new OramaSearchManager(
  docsDir,
  path.resolve(process.cwd(), '.orama-index.json'),
);

function compressionPlugin() {
  return {
    name: 'starlight-compression-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const acceptEncoding = req.headers['accept-encoding'] || '';
        if (!acceptEncoding.includes('gzip')) {
          return next();
        }

        const rawWriteHead = res.writeHead;
        const rawWrite = res.write;
        const rawEnd = res.end;
        let chunks = [];
        let statusCode = 200;
        let statusMessage;

        res.writeHead = function (code, reason, headers) {
          statusCode = code;
          if (typeof reason === 'string') {
            statusMessage = reason;
          } else if (headers === undefined && typeof reason === 'object') {
            headers = reason;
          }
          if (headers) {
            for (const [k, v] of Object.entries(headers)) {
              res.setHeader(k, v);
            }
          }
          return res;
        };

        res.write = function (chunk, encoding, callback) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
          if (typeof encoding === 'function') encoding();
          if (typeof callback === 'function') callback();
          return true;
        };

        res.end = function (chunk, encoding, callback) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
          if (typeof encoding === 'function') callback = encoding;

          const buffer = Buffer.concat(chunks);
          const contentType = String(res.getHeader('content-type') || '');
          const isCompressible = /text|javascript|json|xml|svg|html/i.test(contentType);

          // 还原原生函数
          res.writeHead = rawWriteHead;
          res.write = rawWrite;
          res.end = rawEnd;

          if (buffer.length < 1024 || !isCompressible || res.getHeader('content-encoding')) {
            if (statusCode) rawWriteHead.call(res, statusCode, statusMessage);
            return rawEnd.call(res, buffer, callback);
          }

          zlib.gzip(buffer, { level: 6 }, (err, compressed) => {
            if (err) {
              if (statusCode) rawWriteHead.call(res, statusCode, statusMessage);
              return rawEnd.call(res, buffer, callback);
            }
            res.setHeader('Content-Encoding', 'gzip');
            res.removeHeader('Content-Length');
            res.setHeader('Content-Length', compressed.length);
            if (statusCode) rawWriteHead.call(res, statusCode, statusMessage);
            rawEnd.call(res, compressed, callback);
          });
        };

        next();
      });
    },
  };
}

function oramaSearchPlugin() {
  return {
    name: 'starlight-orama-search-plugin',
    configureServer(server) {
      searchManager.init();

      let reloadTimer = null;
      const configFile = path.resolve(process.cwd(), 'astro.config.mjs');

      const invalidateStarlightSidebar = () => {
        try {
          const graphs = [
            server.moduleGraph,
            server.environments?.ssr?.moduleGraph,
            server.environments?.client?.moduleGraph,
          ].filter(Boolean);

          let invalidatedCount = 0;
          for (const graph of graphs) {
            if (!graph.idToModuleMap) continue;
            for (const [id, mod] of graph.idToModuleMap.entries()) {
              if (!id) continue;
              if (
                id.includes('@astrojs/starlight') ||
                id.includes('virtual:starlight') ||
                id.includes('astro:content')
              ) {
                graph.invalidateModule(mod);
                invalidatedCount++;
              }
            }
          }
          server.ws.send({ type: 'full-reload' });
          console.log(`⚡ [Starlight] 内存快速刷新侧边栏与路由 (使 ${invalidatedCount} 个模块失效，零重启)`);
        } catch (e) {
          console.error('⚠️ [Starlight] 内存刷新侧边栏失败:', e);
        }
      };

      // 仅索引内容目录（软链前 + realpath 后）下的 .md，防仓库根 README 等杂物入索引
      const docsReal = (() => { try { return fs.realpathSync(docsDir); } catch { return docsDir; } })();
      const isDocsFile = (p) => {
        const n = path.resolve(p);
        return n.endsWith('.md') && (
          n === docsDir || n.startsWith(docsDir + path.sep) ||
          n === docsReal || n.startsWith(docsReal + path.sep)
        );
      };

      const triggerSidebarReload = () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          invalidateStarlightSidebar();
        }, 300);
      };

      let dirReloadTimer = null;
      server.watcher.on('addDir', (dirPath) => {
        const parent = path.dirname(dirPath);
        if (parent === docsDir) {
          console.log('📁 [Starlight] 检测到顶级分类目录变动：先内存刷新，再防抖重载配置');
          triggerSidebarReload();
          if (dirReloadTimer) clearTimeout(dirReloadTimer);
          dirReloadTimer = setTimeout(() => {
            try {
              const now = new Date();
              fs.utimesSync(configFile, now, now);
            } catch {}
          }, 1200);
        }
      });

      // 批量同步笔记时 watcher 事件风暴防抖：200ms 静默窗口合并 upsert/remove
      let pendingSearchOps = new Map();
      let searchFlushTimer = null;
      const flushSearchOps = () => {
        if (pendingSearchOps.size === 0) return;
        const ops = [...pendingSearchOps.values()];
        pendingSearchOps.clear();
        for (const { filePath, op } of ops) {
          if (op === 'remove') searchManager.removeFile(filePath);
          else searchManager.upsertFile(filePath);
        }
      };
      const scheduleSearchFlush = () => {
        if (searchFlushTimer) clearTimeout(searchFlushTimer);
        searchFlushTimer = setTimeout(flushSearchOps, 200);
      };

      server.watcher.on('add', (filePath) => {
        if (isDocsFile(filePath)) {
          pendingSearchOps.set(filePath, { filePath, op: 'upsert' });
          scheduleSearchFlush();
          triggerSidebarReload();
        }
      });

      server.watcher.on('change', (filePath) => {
        if (isDocsFile(filePath)) {
          pendingSearchOps.set(filePath, { filePath, op: 'upsert' });
          scheduleSearchFlush();
        }
      });

      server.watcher.on('unlink', (filePath) => {
        if (isDocsFile(filePath)) {
          pendingSearchOps.set(filePath, { filePath, op: 'remove' });
          scheduleSearchFlush();
          triggerSidebarReload();
        }
      });

      server.middlewares.use('/api/search', async (req, res) => {
        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const term = url.searchParams.get('q') || '';
          const results = await searchManager.query(term);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(results));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

const siteTitle = process.env.SITE_TITLE || 'Knowledge Base (Starlight Viewer)';

const envExcludes = (process.env.EXCLUDE_DIRS || 'Private')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function getDynamicSidebar() {
  const sidebar = [
    {
      label: '📖 知识库概览',
      link: '/readme',
    },
  ];

  if (!fs.existsSync(docsDir)) return sidebar;

  const labelsMap = {
    Dev: '💻 开发与架构 (Dev)',
    PL: '🦀 编程语言 (PL)',
    CS: '🧠 计算机科学 (CS)',
    Pro: '🔬 项目研究 (Pro)',
    心法: '💡 心法与方法论',
    WIP: '🚧 在研进行中 (WIP)',
    Math: '📐 数学与算法 (Math)',
    OpenSource: '🌐 开源项目 (OpenSource)',
    Articles: '📚 文章精选 (Articles)',
    Other: '🗂️ 综合杂项 (Other)',
  };

  // 空目录（如历史遗留的百分号编码目录骨架）不进侧边栏
  const hasMarkdown = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (hasMarkdown(path.join(dir, e.name))) return true;
      } else if (e.name.endsWith('.md')) {
        return true;
      }
    }
    return false;
  };

  const entries = fs.readdirSync(docsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      if (envExcludes.includes(entry.name.toLowerCase())) {
        continue;
      }
      if (!hasMarkdown(path.join(docsDir, entry.name))) {
        continue;
      }
      const label = labelsMap[entry.name] || `📁 ${entry.name}`;
      sidebar.push({
        label,
        collapsed: entry.name !== 'WIP',
        // collapsed: true → 子组默认折叠；当前页所在链路由 Starlight 自动展开（sidebarGroupHasCurrent）
        items: [{ autogenerate: { directory: entry.name, collapsed: true } }],
      });
    }
  }

  // 本地预览区：仅当 public/preview 存在时显示，避免把预览产物写进内容库
  const previewDir = path.join(process.cwd(), 'public', 'preview', 'multica-sandbox');
  if (fs.existsSync(previewDir)) {
    sidebar.push({
      label: '🖼️ 本地预览',
      collapsed: true,
      items: [
        { label: 'Multica 沙箱 · 单实例架构', link: '/sbx-preview/single' },
        { label: 'Multica 沙箱 · 多实例拓扑', link: '/sbx-preview/multi' },
      ],
    });
  }

  return sidebar;
}

// https://astro.build/config
export default defineConfig({
  redirects: {
    '/': '/readme',
  },
  vite: {
    plugins: [compressionPlugin(), oramaSearchPlugin()],
  },
  integrations: [
    starlight({
      title: siteTitle,
      customCss: ['./src/styles/custom.css'],
      head: [{ tag: 'script', attrs: { src: '/kb-reading.js', defer: true } }],
      // 围栏语言别名：仅映射到 shiki 真实存在的目标，无语法的降级 txt（免告警免加载）
      expressiveCode: {
        shiki: {
          langAlias: {
            Go: 'go',
            Rust: 'rust',
            Makefile: 'make',
            cc: 'cpp',
            h: 'c',
            conf: 'ini',
            sshconfig: 'ssh-config',
            react: 'jsx',
            swig: 'cpp',
            gdb: 'txt',
            msg: 'txt',
            sudoers: 'txt',
          },
        },
      },
      components: {
        Search: './src/components/Search.astro',
      },
      defaultLocale: 'root',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      sidebar: getDynamicSidebar(),
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/CNCSMonster',
        },
      ],
    }),
  ],
});
