/**
 * mermaid 渲染器 + 图表缩放/平移查看器
 *
 * 由 scripts/build-mermaid.mjs 用 esbuild 打包到 public/mermaid-render.js（约 5MB，gzip 后约 1.4MB），
 * 只在页面存在 mermaid 围栏时才被 /mermaid-client.js 动态 import，
 * 因此 mermaid 庞大的解析器与布局引擎不会进入常规页面。
 */
import mermaid from 'mermaid';
import { browserZoomBusy, watchBrowserZoom } from './browser-zoom.js';
import { postProcessMermaidSvg } from './mermaid-contrast.js';
import { enhanceSvgAccessibility } from './mermaid-a11y.js';
import { createFullscreenManager } from './mermaid-fullscreen.js';
import {
  computeFitScale,
  computeFitHint,
  DEFAULT_BASE_FONT_SIZE,
  wheelZoomFactor,
  zoomView,
  MIN_SCALE,
  MAX_SCALE,
} from './mermaid-zoom.js';

// Starlight + Expressive Code 把围栏渲染成 <pre data-language="mermaid">；
// 未启用 Expressive Code 时退化为 <pre><code class="language-mermaid">
const BLOCK_SELECTOR =
  'pre[data-language="mermaid"], pre.mermaid, pre > code.language-mermaid';

const ZOOM_STEP = 1.15;

const mounted = new Set();
let seq = 0;
let themeWatched = false;
let removalObserver = null;
let rerenderQueue = Promise.resolve();

const preferDark = () => document.documentElement.dataset.theme === 'dark';

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    // 维持默认 strict：禁止图表内 HTML 标签与点击事件
    securityLevel: 'strict',
    theme: preferDark() ? 'dark' : 'default',
    // 图表底色交给页面（跟随 Starlight 明暗主题），避免深色模式下一块白板
    themeVariables: { background: 'transparent' },
  });
}

/**
 * 取出围栏源码。
 * Expressive Code 把代码按行拆成 .ec-line，行与行之间没有换行文本节点，
 * 直接 textContent 会把所有行粘成一行 → mermaid 语法解析失败，必须逐行拼接。
 */
function readSource(pre) {
  const lines = pre.querySelectorAll('.ec-line');
  if (lines.length) return Array.from(lines, (el) => el.textContent).join('\n');
  const code = pre.querySelector('code') || pre;
  return code.textContent.replace(/\s+$/, '');
}

function naturalSize(svg) {
  const vb = svg.viewBox && svg.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  const rect = svg.getBoundingClientRect();
  return { w: rect.width || 800, h: rect.height || 600 };
}

function getBaseFontSize(svg) {
  if (!svg || typeof getComputedStyle !== 'function') return DEFAULT_BASE_FONT_SIZE;
  const sample = svg.querySelector('.nodeLabel, text, tspan');
  if (sample) {
    const size = parseFloat(getComputedStyle(sample).fontSize);
    if (Number.isFinite(size) && size > 0) return size;
  }
  return DEFAULT_BASE_FONT_SIZE;
}

function createViewer(svgText, src) {
  const el = document.createElement('div');
  el.className = 'kb-mermaid';
  el.setAttribute('data-kb-mermaid', '');
  // 图标用内联 SVG：不依赖系统字体对 ＋/－/⤢ 的字形宽度与基线，避免控件错位
  const icon = (paths) =>
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    paths +
    '</svg>';
  el.innerHTML =
    '<div class="kb-mermaid__tools">' +
    '<button type="button" data-act="in" title="放大" aria-label="放大">' +
    icon('<path d="M12 5v14M5 12h14"/>') +
    '</button>' +
    '<button type="button" data-act="out" title="缩小" aria-label="缩小">' +
    icon('<path d="M5 12h14"/>') +
    '</button>' +
    '<button type="button" data-act="fit" title="适应窗口" aria-label="适应窗口">' +
    icon('<path d="M9 3H3v6M15 3h6v6M15 21h6v-6M9 21H3v-6"/>') +
    '</button>' +
    '<button type="button" data-act="fullscreen" title="全屏查看" aria-label="全屏查看">' +
    icon('<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>') +
    '</button>' +
    '</div>' +
    '<div class="kb-mermaid__stage" tabindex="0" role="region" aria-label="Mermaid 图表：方向键平移，+/- 缩放，0 复位"><div class="kb-mermaid__canvas">' +
    svgText +
    '</div></div>' +
    '<div class="kb-mermaid__hint">双指张开/并拢缩放 · 拖拽平移 · 双击复位</div>';

  const stage = el.querySelector('.kb-mermaid__stage');
  const canvas = el.querySelector('.kb-mermaid__canvas');
  const hint = el.querySelector('.kb-mermaid__hint');
  const fullscreenBtn = el.querySelector('[data-act="fullscreen"]');
  const ac = new AbortController();
  const { signal } = ac;
  const gestureSupported =
    'ongesturestart' in window || typeof GestureEvent === 'function';
  const view = { k: 1, x: 0, y: 0 };
  let natural = { w: 800, h: 600 };
  let touched = false;
  // 当前 view 所对应的容器尺寸；全屏/窗口变化后据此换算出新的相对倍率与视野中心
  let stageBase = null;

  function normalizeSvg() {
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    natural = naturalSize(svg);
    // 解除 Starlight 正文对 svg 的 max-width 限制，按 viewBox 自然尺寸摆放
    svg.style.maxWidth = 'none';
    svg.style.width = natural.w + 'px';
    svg.style.height = natural.h + 'px';
    enhanceSvgAccessibility(svg, { src });
  }

  let applyRaf = 0;
  const paint = () => {
    // translate3d 让浏览器把这层提升为合成层，双指缩放时只改 transform，不触发重排
    canvas.style.transform =
      'translate3d(' + view.x + 'px,' + view.y + 'px,0) scale(' + view.k + ')';
  };
  // 高频 wheel/pointer 事件合并到一帧，避免每个事件都写一次 transform 造成掉帧
  const apply = () => {
    if (applyRaf) return;
    applyRaf = requestAnimationFrame(() => {
      applyRaf = 0;
      paint();
    });
  };
  const paintNow = () => {
    if (applyRaf) {
      cancelAnimationFrame(applyRaf);
      applyRaf = 0;
    }
    paint();
  };

  const fitScale = (sw, sh) => computeFitScale(sw, sh, natural.w, natural.h);

  const updateHint = () => {
    if (!hint) return;
    if (touched) {
      hint.textContent = isFullscreen()
        ? '双指张开/并拢或滚轮缩放 · 拖拽平移 · 双击复位 · Esc 退出全屏'
        : '双指张开/并拢缩放 · 拖拽平移 · 双击复位';
    } else {
      const svg = canvas.querySelector('svg');
      const baseSize = getBaseFontSize(svg);
      hint.textContent = computeFitHint(view.k, {
        baseFontSize: baseSize,
        isFullscreen: isFullscreen(),
      });
    }
  };

  /** 复位：整图装进窗口并居中 */
  function fit() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    // 尚未挂载或容器被隐藏（折叠区/未插入 DOM）时不复位，等可见后由 ResizeObserver 触发
    if (!sw || !sh) return;
    view.k = fitScale(sw, sh);
    view.x = (sw - natural.w * view.k) / 2;
    view.y = natural.h * view.k <= sh ? (sh - natural.h * view.k) / 2 : 0;
    touched = false;
    stageBase = { w: sw, h: sh };
    updateHint();
    paintNow();
  }

  /**
   * 容器尺寸变化（全屏、窗口缩放）后重新计算 fit 基准。
   * 用户已手动缩放/平移时，按「相对 fit 的倍率 + 视野中心对应的图形坐标」换算，
   * 既利用新容器的空间，又不丢掉当前正在看的局部；未操作过则直接复位居中。
   */
  function refitPreservingView() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;
    const prev = stageBase;
    if (!prev || !touched || !prev.w || !prev.h) {
      fit();
      return;
    }
    // view 是当前逻辑状态（高频缩放可能还没绘制到下一帧），prev 是变化前的容器尺寸
    const zRel = view.k / fitScale(prev.w, prev.h);
    const dx = (prev.w / 2 - view.x) / view.k;
    const dy = (prev.h / 2 - view.y) / view.k;
    view.k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale(sw, sh) * zRel));
    view.x = sw / 2 - dx * view.k;
    view.y = sh / 2 - dy * view.k;
    touched = true;
    stageBase = { w: sw, h: sh };
    paintNow();
  }

  /** 以容器内坐标 (cx, cy) 为中心缩放 */
  function zoomAt(cx, cy, factor) {
    Object.assign(view, zoomView(view, cx, cy, factor));
    touched = true;
    updateHint();
    apply();
  }

  // 等浏览器完成全屏布局（含 hint 栏高度变化）后再测容器尺寸
  const refitSoon = () => requestAnimationFrame(() => requestAnimationFrame(refitPreservingView));

  const fsManager = createFullscreenManager({
    el,
    doc: typeof document !== 'undefined' ? document : null,
    fullscreenBtn,
    onRefit: refitSoon,
    updateHint: () => updateHint(),
  });
  const isFullscreen = () => fsManager.isFullscreen();

  /*
   * Safari 的触摸板双指张开/并拢只发 GestureEvent（gesturestart/change/end），
   * 不一定补发 ctrlKey 的 wheel；这里单独接管，避免 Safari 上双指缩放只缩放整页。
   * 若浏览器两种事件都发，用 gestureQuietUntil 窗口抑制 wheel，防止双倍缩放。
   */
  let gestureScale = 0;
  let gestureQuietUntil = 0;
  let pointerPinching = false;
  const gesturePoint = (e) => {
    const rect = stage.getBoundingClientRect();
    return {
      x: (Number.isFinite(e.clientX) ? e.clientX : rect.left + rect.width / 2) - rect.left,
      y: (Number.isFinite(e.clientY) ? e.clientY : rect.top + rect.height / 2) - rect.top,
    };
  };
  // 全屏时整个视口都属于本图；非全屏时按事件目标或落点判断
  const eventInViewer = (e) => {
    if (isFullscreen()) return true;
    if (e.target instanceof Node && el.contains(e.target)) return true;
    const rect = el.getBoundingClientRect();
    return (
      Number.isFinite(e.clientX) &&
      Number.isFinite(e.clientY) &&
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );
  };
  if (gestureSupported) {
    window.addEventListener(
      'gesturestart',
      (e) => {
        if (!eventInViewer(e)) return;
        e.preventDefault();
        if (pointerPinching) return;
        gestureScale = e.scale || 1;
        gestureQuietUntil = Date.now() + 250;
      },
      { capture: true, passive: false, signal },
    );
    window.addEventListener(
      'gesturechange',
      (e) => {
        if (!eventInViewer(e)) return;
        e.preventDefault();
        if (pointerPinching) return;
        const next = e.scale || 1;
        const factor = gestureScale ? next / gestureScale : 1;
        gestureScale = next;
        gestureQuietUntil = Date.now() + 250;
        if (factor !== 1) {
          const p = gesturePoint(e);
          zoomAt(p.x, p.y, factor);
        }
      },
      { capture: true, passive: false, signal },
    );
    window.addEventListener(
      'gestureend',
      (e) => {
        if (!eventInViewer(e)) return;
        e.preventDefault();
        if (pointerPinching) return;
        gestureScale = 0;
        gestureQuietUntil = Date.now() + 250;
      },
      { capture: true, passive: false, signal },
    );
  }

  /**
   * 滚轮：以光标为中心连续缩放。
   * - ctrlKey=true 是浏览器对触摸板双指张开/并拢的统一映射，增量很小 → 用大系数并禁止页面缩放；
   * - 页面内普通滚轮（含双指同向滑动）放行给页面滚动，避免图上方劫持阅读；全屏没有页面可滚，普通滚轮直接缩放。
   */
  window.addEventListener(
    'wheel',
    (e) => {
      if (!eventInViewer(e)) return;
      if (Date.now() < gestureQuietUntil) {
        e.preventDefault();
        return;
      }
      if (!e.ctrlKey && !isFullscreen()) return;
      e.preventDefault();
      const factor = wheelZoomFactor({
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
        deltaMode: e.deltaMode,
        stageHeight: stage.clientHeight,
      });
      const rect = stage.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    },
    { capture: true, passive: false, signal },
  );

  fullscreenBtn.addEventListener('click', () => fsManager.toggleFullscreen(), { signal });
  window.addEventListener('keydown', (e) => fsManager.handleKeydown(e), { signal });
  document.addEventListener('fullscreenchange', () => fsManager.syncNativeFullscreen(), { signal });
  document.addEventListener('webkitfullscreenchange', () => fsManager.syncNativeFullscreen(), { signal });

  window.addEventListener(
    'resize',
    () => {
      if (isFullscreen() && !browserZoomBusy()) refitSoon();
    },
    { signal },
  );

  /* 指针拖拽平移 + 双指张开/并拢（触摸屏；触摸板由 wheel/gesture 覆盖） */
  let drag = null;
  const pointers = new Map();
  let pinch = null;

  const startDrag = (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    stage.classList.add('is-dragging');
  };

  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    pointerPinching = true;
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
    drag = null;
    stage.classList.remove('is-dragging');
  };

  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {}
      if (pointers.size === 1) startDrag(e);
      else if (pointers.size === 2) startPinch();
    },
    { signal },
  );

  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rect = stage.getBoundingClientRect();
        // 两指整体移动 → 平移；两指间距变化 → 以中点为锚点缩放
        view.x += cx - pinch.cx;
        view.y += cy - pinch.cy;
        zoomAt(cx - rect.left, cy - rect.top, dist / pinch.dist);
        pinch.dist = dist;
        pinch.cx = cx;
        pinch.cy = cy;
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      view.x += e.clientX - drag.x;
      view.y += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      touched = true;
      apply();
    },
    { signal },
  );

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size >= 2) {
        startPinch();
      } else {
        pinch = null;
        pointerPinching = false;
        const rest = [...pointers.entries()][0];
        if (rest) startDrag({ pointerId: rest[0], clientX: rest[1].x, clientY: rest[1].y });
        else {
          drag = null;
          stage.classList.remove('is-dragging');
        }
      }
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', endPointer, { signal });
  stage.addEventListener('pointercancel', endPointer, { signal });

  // 失焦/切后台时浏览器可能不再派发 pointerup/pointercancel，清掉残留指针避免单指拖拽被误判成双指
  const resetPointers = () => {
    pointers.clear();
    drag = null;
    pinch = null;
    pointerPinching = false;
    stage.classList.remove('is-dragging');
  };
  window.addEventListener('blur', resetPointers, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) resetPointers();
    },
    { signal },
  );

  stage.addEventListener(
    'dblclick',
    (e) => {
      e.preventDefault();
      fit();
    },
    { signal },
  );

  stage.addEventListener(
    'keydown',
    (e) => {
      const step = 40;
      const cx = stage.clientWidth / 2;
      const cy = stage.clientHeight / 2;
      let pan = false;
      if (e.key === 'ArrowLeft') {
        view.x += step;
        pan = true;
      } else if (e.key === 'ArrowRight') {
        view.x -= step;
        pan = true;
      } else if (e.key === 'ArrowUp') {
        view.y += step;
        pan = true;
      } else if (e.key === 'ArrowDown') {
        view.y -= step;
        pan = true;
      } else if (e.key === '+' || e.key === '=') {
        zoomAt(cx, cy, ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        zoomAt(cx, cy, 1 / ZOOM_STEP);
      } else if (e.key === '0') {
        fit();
      } else {
        return;
      }
      e.preventDefault();
      if (pan) {
        touched = true;
        apply();
      }
    },
    { signal },
  );

  el.querySelector('[data-act="in"]').addEventListener('click', () => {
    zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, ZOOM_STEP);
  }, { signal });
  el.querySelector('[data-act="out"]').addEventListener('click', () => {
    zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / ZOOM_STEP);
  }, { signal });
  el.querySelector('[data-act="fit"]').addEventListener('click', fit, { signal });

  // 容器尺寸变化（全屏、切换左右栏、窗口缩放）：未操作过则复位，已操作过则保留视野换算
  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      // 浏览器页面缩放：保持 view.k，让页面缩放自然放大/缩小整张图，不因容器 CSS 尺寸变小而重新 fit
      if (browserZoomBusy()) {
        stageBase = { w: stage.clientWidth, h: stage.clientHeight };
        return;
      }
      if (touched) refitPreservingView();
      else fit();
    });
    resizeObserver.observe(stage);
  }

  normalizeSvg();
  fit();

  const applyContrast = () =>
    postProcessMermaidSvg(canvas.querySelector('svg'), { dark: preferDark() });

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (applyRaf) {
      cancelAnimationFrame(applyRaf);
      applyRaf = 0;
    }
    // 先清理全屏状态（恢复滚动、退出原生/伪全屏）再 abort
    fsManager.destroy();
    ac.abort();
    if (resizeObserver) resizeObserver.disconnect();
  };

  return {
    el,
    src,
    fit,
    destroy,
    applyContrast,
    /** 主题切换后换掉 svg 并复位 */
    update(nextSvgText) {
      canvas.innerHTML = nextSvgText;
      normalizeSvg();
      applyContrast();
      // 主题切换保留读者当前缩放/视野，而不是强行复位
      if (touched) refitPreservingView();
      else fit();
    },
  };
}

async function mount(pre) {
  if (pre.dataset.kbMermaid) return;
  const src = readSource(pre);
  if (!src.trim()) return;

  const target = pre.closest('figure.frame') || pre;
  const id = 'kb-mermaid-' + ++seq;
  let svgText;
  try {
    svgText = (await mermaid.render(id, src)).svg;
  } catch (err) {
    // 渲染失败：原样保留代码块，读者与作者都能看到源码排查，不白屏
    console.error('[mermaid] 渲染失败，保留原始代码块：', err);
    pre.dataset.kbMermaid = 'failed';
    target.classList.add('kb-mermaid-error');
    const orphan = document.getElementById('d' + id);
    if (orphan) orphan.remove();
    return;
  }

  // 渲染期间页面已切换（view transitions / 手动导航）：不要把 viewer 插到已断开的节点上，
  // 否则它永远不会被 removalObserver 观察到，window/document 监听会泄漏。
  if (!target.isConnected) {
    const orphan = document.getElementById('d' + id);
    if (orphan) orphan.remove();
    return;
  }

  pre.dataset.kbMermaid = 'done';
  const item = createViewer(svgText, src);
  mounted.add(item);
  target.replaceWith(item.el);
  // 必须在插入 DOM 后做颜色后处理：detached 元素上 getComputedStyle 拿不到主题/形状 fill
  item.applyContrast();
  requestAnimationFrame(() => item.fit());
}

/** 明暗主题切换后重渲染，避免深色页面上留一张浅色图 */
async function rerenderAll() {
  initMermaid();
  for (const item of mounted) {
    if (!item.el.isConnected) {
      item.destroy();
      mounted.delete(item);
      continue;
    }
    try {
      const { svg } = await mermaid.render('kb-mermaid-' + ++seq, item.src);
      item.update(svg);
    } catch (err) {
      console.warn('[mermaid] 主题切换重渲染失败，保留当前图形：', err);
    }
  }
}

function watchTheme() {
  if (themeWatched) return;
  themeWatched = true;
  let last = preferDark();
  new MutationObserver(() => {
    const now = preferDark();
    if (now === last) return;
    last = now;
    // 主题事件可能连发；串行化，避免并发 mermaid.render 的 DOM id 冲突与明暗结果倒序
    rerenderQueue = rerenderQueue
      .then(rerenderAll)
      .catch((err) => console.warn('[mermaid] 主题切换重渲染失败：', err));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** 图被从 DOM 移除（例如将来启用 view transitions）时释放 window/document 监听与 ResizeObserver */
function watchRemovals() {
  if (removalObserver || typeof MutationObserver !== 'function') return;
  removalObserver = new MutationObserver(() => {
    for (const item of mounted) {
      if (!item.el.isConnected) {
        item.destroy();
        mounted.delete(item);
      }
    }
    if (!mounted.size) {
      removalObserver.disconnect();
      removalObserver = null;
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });
}

/** 供懒加载入口调用：渲染 root 下所有尚未处理的 mermaid 围栏 */
export async function mountAll(root = document) {
  initMermaid();
  watchBrowserZoom();
  const blocks = Array.from(root.querySelectorAll(BLOCK_SELECTOR))
    .map((el) => (el.tagName === 'PRE' ? el : el.closest('pre')))
    .filter(Boolean);
  for (const pre of new Set(blocks)) await mount(pre);
  watchTheme();
  watchRemovals();
}
