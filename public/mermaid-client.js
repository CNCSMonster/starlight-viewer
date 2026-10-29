/* mermaid 懒加载入口（随 Starlight head 注入，defer）
 *
 * 只做一件事：页面里确实存在 mermaid 围栏时，才动态拉取渲染器
 * （/mermaid-render.js 约 5MB，gzip 后约 1.4MB）。没有图的页面一个字节都不下载。
 * 模块 promise 缓存在 window 上：同一页面重复事件、或将来的 view transitions 只会复用，
 * 不会重复下载；mountAll 会跳过已挂载的围栏。
 */
(function () {
  var SELECTOR =
    'pre[data-language="mermaid"], pre.mermaid, pre > code.language-mermaid';
  // 支持部署在子路径下：以本脚本自身位置为基准解析渲染器地址
  var self = document.currentScript;
  var base = self && self.src ? self.src.replace(/[^/]*$/, '') : '/';

  function run() {
    if (!document.querySelector(SELECTOR)) return;
    if (!window.__kbMermaidModulePromise) {
      window.__kbMermaidModulePromise = import(/* @vite-ignore */ base + 'mermaid-render.js');
    }
    window.__kbMermaidModulePromise
      .then(function (mod) {
        window.__kbMermaidLoaded = true;
        return mod.mountAll(document);
      })
      .catch(function (err) {
        // 失败后清空 promise，下次 page-load 可以重试
        window.__kbMermaidModulePromise = null;
        console.warn('[mermaid] 渲染器加载失败，保留原始代码块：', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  document.addEventListener('astro:page-load', run);
})();
