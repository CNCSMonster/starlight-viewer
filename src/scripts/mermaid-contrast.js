/**
 * Mermaid SVG 显示层可读性后处理。
 *
 * 两个问题来自作者自定义 `style fill:#...` 与 mermaid 主题文字色的组合：
 * 1. 深色主题下高亮 fill（浅绿/黄/粉）刺眼，而 label 仍是浅灰 #ccc，对比度可低至 1.03:1；
 * 2. 浅色主题下如果作者用深色 fill，深色 label 也会失去对比度。
 *
 * 这里只做两件最小侵入的事：
 * - dark 主题下把过亮的自定义 fill 与 mermaid 深色节点底色混合，降低眩光；
 * - 检查 label 与节点实际背景的 WCAG 对比度，不达标时才替换为深/浅文字色。
 * 默认主题节点本来对比度足够，不会被动；light 主题保留作者原色。
 */

export const MIN_TEXT_CONTRAST = 5.0;
export const GLARE_LUMINANCE = 0.25;
export const DARK_FILL_ALPHA = 0.32;
export const DARK_NODE_BASE = [31, 32, 32]; // mermaid dark 默认节点底色 #1f2020
export const TEXT_DARK = '#111827';
export const TEXT_LIGHT = '#f9fafb';

const DARK_PAGE = [11, 13, 18];
const LIGHT_PAGE = [255, 255, 255];

/** sRGB 8bit 通道 → 0..1；用于 WCAG 相对亮度 */
const channel = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 相对亮度，入参为 [r,g,b]（0..255） */
export function relativeLuminance(rgb) {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 对比度；入参是相对亮度 */
export function contrastRatio(a, b) {
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

/** 解析 #rgb/#rgba/#rrggbb/#rrggbbaa 与 rgb()/rgba()；失败返回 null */
export function parseColorString(value) {
  if (!value || value === 'none' || value === 'transparent') return null;
  const text = String(value).trim();
  // 渐变/pattern/图片 fill（如 url(#...)）不做猜测，保持原样
  if (text.startsWith('url(') || text.includes('url(')) return null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, alpha };
  }
  const fn = /^rgba?\(\s*([^)]+)\)$/i.exec(text);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const rgb = parts.slice(0, 3).map((p) => {
    const n = p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    return Math.max(0, Math.min(255, Math.round(n)));
  });
  if (rgb.some((n) => !Number.isFinite(n))) return null;
  const alpha = parts[3] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(parts[3])));
  return { rgb, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

/** 透明 fill 先合成到页面底色，避免把 alpha 当不透明计算 */
export function compositeColor(color, pageRgb) {
  if (!color) return null;
  if (color.alpha >= 1) return color.rgb;
  return color.rgb.map((c, i) => Math.round(c * color.alpha + pageRgb[i] * (1 - color.alpha)));
}

/** dark 主题抗眩光：把过亮 fill 与 mermaid 深色节点底色混合，保留色相 */
export function tintForDark(rgb, alpha = DARK_FILL_ALPHA) {
  return rgb.map((c, i) => Math.round(c * alpha + DARK_NODE_BASE[i] * (1 - alpha)));
}

/**
 * 选文字色。当前颜色对比度达标则返回 null（不改）；
 * 否则返回黑/白中对比度更高者。
 */
export function pickTextColor(backgroundLuminance, currentLuminance) {
  if (
    Number.isFinite(currentLuminance) &&
    contrastRatio(backgroundLuminance, currentLuminance) >= MIN_TEXT_CONTRAST
  ) {
    return null;
  }
  const darkLum = relativeLuminance(parseColorString(TEXT_DARK).rgb);
  const lightLum = relativeLuminance(parseColorString(TEXT_LIGHT).rgb);
  return contrastRatio(backgroundLuminance, darkLum) >= contrastRatio(backgroundLuminance, lightLum)
    ? TEXT_DARK
    : TEXT_LIGHT;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let canvasCtx;

export const isUnresolvableColor = (value) => {
  if (!value || value === 'none' || value === 'transparent') return true;
  const text = String(value).trim().toLowerCase();
  return text.startsWith('url(') || text.includes('url(');
};

export const domParseColor = (value) => {
  if (isUnresolvableColor(value)) return null;
  const parsed = parseColorString(value);
  if (parsed) return parsed;
  // 命名颜色 / color() 等交给浏览器离屏 canvas 归一化
  if (typeof document === 'undefined') return null;
  if (!canvasCtx) canvasCtx = document.createElement('canvas').getContext('2d');
  if (!canvasCtx) return null;
  canvasCtx.fillStyle = '#000000';
  canvasCtx.fillStyle = value;
  if (
    canvasCtx.fillStyle === '#000000' &&
    String(value).trim().toLowerCase() !== '#000' &&
    String(value).trim().toLowerCase() !== '#000000' &&
    String(value).trim().toLowerCase() !== 'black'
  ) {
    return null;
  }
  return parseColorString(canvasCtx.fillStyle);
};

/**
 * 对一棵 mermaid SVG 做对比度/眩光后处理。
 * 只改颜色，不改几何；只处理节点/actor/cluster，不碰 edge label。
 */
export function postProcessMermaidSvg(svg, { dark = false } = {}) {
  if (!svg || typeof getComputedStyle !== 'function') return;
  const page = dark ? DARK_PAGE : LIGHT_PAGE;
  const nodes = svg.querySelectorAll('g.node, g.cluster, g.actor, g.actor-man');

  for (const node of nodes) {
    const shape = node.querySelector(
      'rect.basic.label-container, rect.label-container, rect.actor, polygon, circle, ellipse, path',
    );
    if (!shape) continue;

    const fill = getComputedStyle(shape).fill;
    if (isUnresolvableColor(fill)) continue;
    const parsed = domParseColor(fill);
    if (!parsed) continue;
    const rgb = compositeColor(parsed, page);
    if (!rgb) continue;

    let backgroundLuminance = relativeLuminance(rgb);
    if (dark && backgroundLuminance > GLARE_LUMINANCE) {
      const tinted = tintForDark(rgb);
      shape.style.setProperty('fill', `rgb(${tinted.join(', ')})`, 'important');
      backgroundLuminance = relativeLuminance(tinted);
    }

    const labels = node.querySelectorAll('.nodeLabel, .cluster-label span, text, tspan');
    for (const label of labels) {
      const isSvg = label.namespaceURI === SVG_NS;
      const computed = getComputedStyle(label);
      const current = domParseColor(isSvg ? computed.fill : computed.color) || domParseColor(computed.color);
      const currentLum = current ? relativeLuminance(compositeColor(current, rgb)) : NaN;
      const chosen = pickTextColor(backgroundLuminance, currentLum);
      if (!chosen) continue;
      label.style.setProperty('color', chosen, 'important');
      label.style.setProperty('fill', chosen, 'important');
    }
  }
}
