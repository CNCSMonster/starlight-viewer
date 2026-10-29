/**
 * Mermaid SVG 可访问性（Accessibility / a11y）后处理。
 *
 * 补全 SVG 的 <title> 与 <desc>，并绑定 aria-labelledby 与 aria-describedby：
 * - title：Mermaid 图表
 * - desc：图表类型（flowchart/sequence/class/state）+ 节点数
 * 严格保留 SVG 原始 role（如 graphics-document），不改成 role="img"，确保图形内文字仍可遍历。
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function normalizeDiagramType(rawType) {
  if (!rawType) return 'flowchart';
  const t = String(rawType).trim().toLowerCase();
  if (t.includes('flowchart') || t.startsWith('graph')) return 'flowchart';
  if (t.includes('sequence')) return 'sequence';
  if (t.includes('class')) return 'class';
  if (t.includes('state')) return 'state';
  if (t.includes('er') || t.includes('entity')) return 'er';
  if (t.includes('gantt')) return 'gantt';
  if (t.includes('pie')) return 'pie';
  if (t.includes('git')) return 'gitGraph';
  if (t.includes('mindmap')) return 'mindmap';
  return t.replace(/-v\d+$/i, '');
}

export function detectTypeFromSource(src) {
  if (!src) return 'flowchart';
  const clean = src.replace(/^%%[^\n]*\n+/gm, '').trim();
  const firstWord = clean.split(/[\s\n(]+/)[0] || '';
  return normalizeDiagramType(firstWord);
}

export function resolveDiagramType(svg, src) {
  if (svg && typeof svg.getAttribute === 'function') {
    const roleDesc = svg.getAttribute('aria-roledescription');
    if (roleDesc && roleDesc !== 'diagram') {
      return normalizeDiagramType(roleDesc);
    }
  }
  if (src) {
    return detectTypeFromSource(src);
  }
  return 'flowchart';
}

export function countDiagramNodes(svg) {
  if (!svg || typeof svg.querySelectorAll !== 'function') return 0;
  return svg.querySelectorAll('g.node, g.actor, g.actor-man, g.stateGroup, g.classGroup').length;
}

export function buildAccessibleSummary(rawType, count) {
  const type = normalizeDiagramType(rawType);
  const title = 'Mermaid 图表';
  const desc = count > 0 ? `${type} 图表，共 ${count} 个节点` : `${type} 图表`;
  return { title, desc, type };
}

export function enhanceSvgAccessibility(svg, { src, type, count } = {}) {
  if (!svg) return null;
  const doc = svg.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  const resolvedType = type || resolveDiagramType(svg, src);
  const resolvedCount = count !== undefined ? count : countDiagramNodes(svg);
  const summary = buildAccessibleSummary(resolvedType, resolvedCount);

  let titleEl = svg.querySelector(':scope > title') || svg.querySelector('title');
  const titleId = svg.id ? `${svg.id}-title` : `kb-mermaid-title-${Math.random().toString(36).slice(2, 8)}`;
  if (!titleEl) {
    titleEl = doc.createElementNS(SVG_NS, 'title');
    titleEl.id = titleId;
    titleEl.textContent = summary.title;
    svg.insertBefore(titleEl, svg.firstChild);
  } else if (!titleEl.id) {
    titleEl.id = titleId;
  }

  let descEl = svg.querySelector(':scope > desc') || svg.querySelector('desc');
  const descId = svg.id ? `${svg.id}-desc` : `kb-mermaid-desc-${Math.random().toString(36).slice(2, 8)}`;
  if (!descEl) {
    descEl = doc.createElementNS(SVG_NS, 'desc');
    descEl.id = descId;
    descEl.textContent = summary.desc;
    if (titleEl.nextSibling) {
      svg.insertBefore(descEl, titleEl.nextSibling);
    } else {
      svg.appendChild(descEl);
    }
  } else {
    if (!descEl.id) descEl.id = descId;
    if (!descEl.textContent) descEl.textContent = summary.desc;
  }

  if (!svg.getAttribute('aria-labelledby')) {
    svg.setAttribute('aria-labelledby', titleEl.id);
  }
  if (!svg.getAttribute('aria-describedby')) {
    svg.setAttribute('aria-describedby', descEl.id);
  }

  return { titleEl, descEl, summary };
}
