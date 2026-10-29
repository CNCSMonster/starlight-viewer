/**
 * 浏览器页面缩放（Ctrl/⌘ + +/-/0、菜单缩放）检测。
 *
 * 页面缩放会改变 CSS 视口尺寸并触发 ResizeObserver；viewer 不能把它当成容器布局变化
 * 再重新 fit，否则“按 Ctrl++ 放大页面”会同时把图重新缩小。这里把浏览器 quirk
 * 从查看器主逻辑里隔离出来：
 * - devicePixelRatio / visualViewport.scale 变化 → 菜单或快捷键缩放；
 * - keydown 捕获 Ctrl/⌘ + +/-/0，覆盖 Safari 等 DPR 不变化的实现。
 */

const hasWindow = typeof window !== 'undefined';

export function isPageZoomShortcut(event) {
  return !!(
    event &&
    (event.ctrlKey || event.metaKey) &&
    ['+', '=', '-', '_', '0'].includes(event.key)
  );
}

let lastDpr = hasWindow ? window.devicePixelRatio || 1 : 1;
let lastVvScale =
  hasWindow && window.visualViewport ? window.visualViewport.scale : 1;
let pageZoomUntil = 0;
let watched = false;

/** 本次尺寸变化是否来自浏览器页面缩放；返回 true 时调用方应跳过重新 fit。 */
export function browserZoomBusy() {
  if (!hasWindow) return false;
  const dpr = window.devicePixelRatio || 1;
  const vvScale = window.visualViewport ? window.visualViewport.scale : 1;
  if (dpr !== lastDpr || vvScale !== lastVvScale) {
    lastDpr = dpr;
    lastVvScale = vvScale;
    pageZoomUntil = Date.now() + 600;
    return true;
  }
  return Date.now() < pageZoomUntil;
}

/** 模块级只注册一次；随整页生命周期存在，不随单个图实例销毁。 */
export function watchBrowserZoom() {
  if (!hasWindow || watched) return;
  watched = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (isPageZoomShortcut(event)) pageZoomUntil = Date.now() + 800;
    },
    true,
  );
}
