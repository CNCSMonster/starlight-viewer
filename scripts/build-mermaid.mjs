/**
 * mermaid 渲染器打包脚本
 *
 * esbuild --bundle --format=esm --minify → public/mermaid-render.js（约 3.4MB）
 * 产物不入库（见 .gitignore）：由 astro.config.mjs 在 dev/build 启动时按 mtime 增量重建，
 * 源文件或依赖锁未变则直接跳过，故不额外引入构建链。
 *
 * 手动执行：pnpm build:mermaid
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src', 'scripts');
const ENTRY = path.join(SRC_DIR, 'mermaid-render.js');
const OUT = path.join(ROOT, 'public', 'mermaid-render.js');
const LOCKFILE = path.join(ROOT, 'pnpm-lock.yaml');

const mtimeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0);

/** 源目录内任一文件、入口或依赖锁比产物新 → 需要重建 */
export function mermaidBundleStale() {
  if (!fs.existsSync(OUT)) return true;
  const outTime = mtimeOf(OUT);
  if (mtimeOf(ENTRY) > outTime || mtimeOf(LOCKFILE) > outTime) return true;
  return fs
    .readdirSync(SRC_DIR)
    .some((name) => mtimeOf(path.join(SRC_DIR, name)) > outTime);
}

/** 需要时重建渲染器；返回是否真的重建了 */
export async function ensureMermaidBundle({ force = false } = {}) {
  if (!force && !mermaidBundleStale()) return false;
  await build({
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    banner: {
      js: '/* 由 scripts/build-mermaid.mjs 生成，勿手改；源文件 src/scripts/mermaid-render.js */',
    },
  });
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await ensureMermaidBundle({ force: process.argv.includes('--force') });
  const size = fs.existsSync(OUT) ? (fs.statSync(OUT).size / 1048576).toFixed(2) : '0';
  console.log(
    built ? `✅ mermaid 渲染器已打包：public/mermaid-render.js (${size} MB)` : 'ℹ️  mermaid 渲染器已是最新，跳过打包',
  );
}
