// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { OramaSearchManager } from './src/search-engine.js';

const docsDir = path.resolve(process.cwd(), 'src/content/docs');
const searchManager = new OramaSearchManager(docsDir);

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
      let isReloading = false;
      const configFile = path.resolve(process.cwd(), 'astro.config.mjs');

      const triggerSidebarReload = () => {
        if (isReloading) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          isReloading = true;
          try {
            const now = new Date();
            fs.utimesSync(configFile, now, now);
            console.log('🔄 [Starlight] 检测到笔记增删/移动，已平滑重载侧边栏配置');
          } catch (e) {
            console.error('⚠️ [Starlight] 重载侧边栏触碰配置失败:', e);
          } finally {
            setTimeout(() => {
              isReloading = false;
            }, 3000);
          }
        }, 1500);
      };

      server.watcher.on('add', (filePath) => {
        if (filePath.endsWith('.md')) {
          searchManager.upsertFile(filePath);
          triggerSidebarReload();
        }
      });

      server.watcher.on('change', (filePath) => {
        if (filePath.endsWith('.md')) {
          searchManager.upsertFile(filePath);
        }
      });

      server.watcher.on('unlink', (filePath) => {
        if (filePath.endsWith('.md')) {
          searchManager.removeFile(filePath);
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

  const entries = fs.readdirSync(docsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      if (envExcludes.includes(entry.name.toLowerCase())) {
        continue;
      }
      const label = labelsMap[entry.name] || `📁 ${entry.name}`;
      sidebar.push({
        label,
        collapsed: entry.name !== 'WIP',
        items: [{ autogenerate: { directory: entry.name } }],
      });
    }
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
