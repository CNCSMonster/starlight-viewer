import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDiagramType,
  detectTypeFromSource,
  buildAccessibleSummary,
  enhanceSvgAccessibility,
  countDiagramNodes,
} from '../src/scripts/mermaid-a11y.js';

test('normalizeDiagramType 规范化常见 Mermaid 图表类型', () => {
  assert.equal(normalizeDiagramType('flowchart-v2'), 'flowchart');
  assert.equal(normalizeDiagramType('graph'), 'flowchart');
  assert.equal(normalizeDiagramType('sequence'), 'sequence');
  assert.equal(normalizeDiagramType('classDiagram'), 'class');
  assert.equal(normalizeDiagramType('stateDiagram-v2'), 'state');
  assert.equal(normalizeDiagramType('erDiagram'), 'er');
  assert.equal(normalizeDiagramType('gantt'), 'gantt');
  assert.equal(normalizeDiagramType('pie'), 'pie');
  assert.equal(normalizeDiagramType('gitGraph'), 'gitGraph');
  assert.equal(normalizeDiagramType('mindmap'), 'mindmap');
  assert.equal(normalizeDiagramType(null), 'flowchart');
});

test('detectTypeFromSource 从源码首词识别类型', () => {
  assert.equal(detectTypeFromSource('flowchart TD\n  A --> B'), 'flowchart');
  assert.equal(detectTypeFromSource('graph LR\n  A --> B'), 'flowchart');
  assert.equal(detectTypeFromSource('%% 注释\nsequenceDiagram\n  Alice->>Bob: hi'), 'sequence');
  assert.equal(detectTypeFromSource('classDiagram\n  class Animal'), 'class');
  assert.equal(detectTypeFromSource('stateDiagram\n  [*] --> First'), 'state');
});

test('buildAccessibleSummary 生成标题与描述摘要', () => {
  const s1 = buildAccessibleSummary('flowchart-v2', 8);
  assert.equal(s1.title, 'Mermaid 图表');
  assert.equal(s1.desc, 'flowchart 图表，共 8 个节点');

  const s2 = buildAccessibleSummary('sequence', 3);
  assert.equal(s2.title, 'Mermaid 图表');
  assert.equal(s2.desc, 'sequence 图表，共 3 个节点');

  const s3 = buildAccessibleSummary('pie', 0);
  assert.equal(s3.title, 'Mermaid 图表');
  assert.equal(s3.desc, 'pie 图表');
});

test('enhanceSvgAccessibility 在 SVG 上注入 <title> 与 <desc> 并绑定 aria', () => {
  // 轻量级 DOM mock 验证 SVG 结构与属性
  const children = [];
  const attrs = new Map([
    ['role', 'graphics-document'],
    ['aria-roledescription', 'flowchart-v2'],
  ]);
  const mockDoc = {
    createElementNS(_ns, tag) {
      return {
        tagName: tag.toUpperCase(),
        id: '',
        textContent: '',
        nextSibling: null,
      };
    },
  };
  const mockSvg = {
    id: 'kb-mermaid-test-1',
    ownerDocument: mockDoc,
    children,
    firstChild: null,
    getAttribute(k) { return attrs.get(k) || null; },
    setAttribute(k, v) { attrs.set(k, v); },
    querySelector(sel) {
      if (sel.includes('title')) return children.find(c => c.tagName === 'TITLE') || null;
      if (sel.includes('desc')) return children.find(c => c.tagName === 'DESC') || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('g.node')) return [{}, {}, {}];
      return [];
    },
    insertBefore(node, ref) {
      const idx = children.indexOf(ref);
      if (idx >= 0) children.splice(idx, 0, node);
      else children.unshift(node);
      this.firstChild = children[0];
      node.nextSibling = children[children.indexOf(node) + 1] || null;
    },
    appendChild(node) {
      children.push(node);
      if (!this.firstChild) this.firstChild = node;
      node.nextSibling = null;
    },
  };

  const result = enhanceSvgAccessibility(mockSvg, { count: 3 });
  assert.ok(result);
  assert.equal(result.titleEl.textContent, 'Mermaid 图表');
  assert.equal(result.descEl.textContent, 'flowchart 图表，共 3 个节点');
  assert.equal(mockSvg.getAttribute('aria-labelledby'), 'kb-mermaid-test-1-title');
  assert.equal(mockSvg.getAttribute('aria-describedby'), 'kb-mermaid-test-1-desc');
  // 严格保留 graphics-document，不被覆写成 img
  assert.equal(mockSvg.getAttribute('role'), 'graphics-document');
});
