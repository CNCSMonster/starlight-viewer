/**
 * Mermaid 查看器的纯数学部分：适配倍率、滚轮/捏合缩放因子、锚点缩放。
 * 不依赖 DOM，便于在 Node 里直接测试；浏览器侧只负责取事件参数和写 transform。
 */

// 触摸板捏合（ctrlKey=true 的 wheel）单事件增量很小，按指数连续缩放才跟手；
// 鼠标滚轮增量大，用更小的系数避免一格滚轮跳一大截。
export const PINCH_ZOOM_K = 0.01;
export const WHEEL_ZOOM_K = 0.002;
// 单事件指数上限：不同设备 pinch 的 deltaY 量级差很多，防止一格事件从 1x 直接跳到 3x。
export const MAX_ZOOM_EXPONENT = 0.35;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 12;

/** 整图装进容器的基准倍率；只按宽度适配会裁掉竖长图下半张，故同时受高度约束。 */
export function computeFitScale(containerW, containerH, naturalW, naturalH) {
  if (!containerW || !containerH || !naturalW || !naturalH) return 1;
  return Math.min(1, containerW / naturalW, containerH / naturalH) || 1;
}

/**
 * wheel 事件的缩放因子。
 * deltaMode：0=像素 1=行 2=页，统一换算成像素后再算指数；
 * ctrlKey=true 视为触摸板捏合，用更大的增益。
 */
export function wheelZoomFactor({ deltaY, ctrlKey, deltaMode = 0, stageHeight = 0 }) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? stageHeight || 1 : 1;
  const delta = deltaY * unit;
  const k = ctrlKey ? PINCH_ZOOM_K : WHEEL_ZOOM_K;
  const exponent = Math.max(-MAX_ZOOM_EXPONENT, Math.min(MAX_ZOOM_EXPONENT, -delta * k));
  return Math.exp(exponent);
}

/** 以容器内坐标 (cx, cy) 为锚点缩放，返回新的 view；锚点下方的图形坐标保持不变。 */
export function zoomView(view, cx, cy, factor) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.k * factor));
  const ratio = next / view.k;
  return {
    k: next,
    x: cx - (cx - view.x) * ratio,
    y: cy - (cy - view.y) * ratio,
  };
}
