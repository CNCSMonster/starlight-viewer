// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import path from 'node:path';
import fs from 'node:fs';
import { OramaSearchManager } from './src/search-engine.js';

const docsDir = path.resolve(process.cwd(), 'src/content/docs');
const searchManager = new OramaSearchManager(docsDir);

function oramaSearchPlugin() {
  return {
    name: 'starlight-orama-search-plugin',
    configureServer(server) {
      searchManager.init();

      server.watcher.on('add', (filePath) => {
        if (filePath.endsWith('.md')) {
          searchManager.upsertFile(filePath);
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

// 动态侧边栏映射与隐私目录过滤
const envExcludes = (process.env.EXCLUDE_DIRS || 'Private')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// 自动探测 docs 目录下的顶级目录，建立侧边栏
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
        continue; // 隐私目录直接过滤，不进入侧边栏
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
    plugins: [oramaSearchPlugin()],
  },
  integrations: [
    starlight({
      title: siteTitle,
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
