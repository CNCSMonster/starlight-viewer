import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColorString,
  isUnresolvableColor,
  domParseColor,
  postProcessMermaidSvg,
  relativeLuminance,
  contrastRatio,
  compositeColor,
  tintForDark,
  pickTextColor,
  TEXT_DARK,
  TEXT_LIGHT,
} from '../src/scripts/mermaid-contrast.js';

const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('WCAG 相对亮度：黑/白/示例色', () => {
  close(relativeLuminance([0, 0, 0]), 0);
  close(relativeLuminance([255, 255, 255]), 1);
  close(relativeLuminance([144, 238, 144]), 0.6909, 0.002);
});

test('原图深色主题下 #ccc 与亮色节点对比度严重不足', () => {
  const text = relativeLuminance([204, 204, 204]);
  for (const fill of [
    [144, 238, 144],
    [255, 215, 0],
    [255, 182, 193],
  ]) {
    assert.ok(contrastRatio(text, relativeLuminance(fill)) < 1.2);
  }
});

test('dark 抗眩光混合后亮度显著下降，且文字对比度达标', () => {
  const text = relativeLuminance([204, 204, 204]);
  for (const fill of [
    [144, 238, 144],
    [255, 215, 0],
    [255, 182, 193],
  ]) {
    const tinted = tintForDark(fill);
    const lum = relativeLuminance(tinted);
    assert.ok(lum < 0.25);
    const chosen = pickTextColor(lum, text);
    const chosenLum = relativeLuminance(parseColorString(chosen || '#cccccc').rgb);
    assert.ok(contrastRatio(lum, chosenLum) >= 5.0);
  }
});

test('浅色主题高亮节点保留原色时 #333 文字仍达标', () => {
  const text = relativeLuminance([51, 51, 51]);
  for (const fill of [
    [144, 238, 144],
    [255, 215, 0],
    [255, 182, 193],
  ]) {
    assert.ok(contrastRatio(text, relativeLuminance(fill)) >= 7);
    assert.equal(pickTextColor(relativeLuminance(fill), text), null);
  }
});

test('深色 fill 在浅色主题下自动切到浅色文字', () => {
  const navy = [0, 51, 102];
  const lum = relativeLuminance(navy);
  assert.equal(pickTextColor(lum, relativeLuminance([51, 51, 51])), TEXT_LIGHT);
});

test('透明 fill 先与页面底色合成', () => {
  const color = parseColorString('rgba(255, 0, 0, 0.5)');
  const composed = compositeColor(color, [0, 0, 0]);
  assert.deepEqual(composed, [128, 0, 0]);
});

test('颜色解析支持 hex / rgb / rgba', () => {
  assert.deepEqual(parseColorString('#90EE90'), { rgb: [144, 238, 144], alpha: 1 });
  assert.deepEqual(parseColorString('#fff'), { rgb: [255, 255, 255], alpha: 1 });
  assert.deepEqual(parseColorString('rgb(1, 2, 3)'), { rgb: [1, 2, 3], alpha: 1 });
  assert.deepEqual(parseColorString('rgba(1, 2, 3, .5)'), { rgb: [1, 2, 3], alpha: 0.5 });
  assert.equal(parseColorString('none'), null);
  assert.equal(parseColorString('url(#grad)'), null);
});

test('文字色候选值本身可解析', () => {
  assert.ok(parseColorString(TEXT_DARK));
  assert.ok(parseColorString(TEXT_LIGHT));
});

test('对比度余量：粉色高亮节点在 dark 压暗后文字对比度提升至 >= 5.0（约 7:1）', () => {
  const pink = [255, 182, 193];
  const tinted = tintForDark(pink);
  const lum = relativeLuminance(tinted);
  const cccLum = relativeLuminance([204, 204, 204]);
  // 原始 #ccc 文字对比度约为 4.58:1，低于 5.0 阈值
  const oldRatio = contrastRatio(lum, cccLum);
  assert.ok(oldRatio >= 4.5 && oldRatio < 5.0);

  // 经 pickTextColor 选择后切换为 TEXT_LIGHT，对比度大幅提升至 7:1
  const chosen = pickTextColor(lum, cccLum);
  assert.equal(chosen, TEXT_LIGHT);
  const chosenLum = relativeLuminance(parseColorString(chosen).rgb);
  const newRatio = contrastRatio(lum, chosenLum);
  assert.ok(newRatio >= 5.0);
  assert.ok(newRatio >= 6.7);
});

test('默认深色节点与浅色主题原色不受 MIN_TEXT_CONTRAST 提升影响', () => {
  // 默认深色节点 #1f2020 与 #ccc
  const defDarkLum = relativeLuminance([31, 32, 32]);
  const cccLum = relativeLuminance([204, 204, 204]);
  assert.equal(pickTextColor(defDarkLum, cccLum), null);

  // 浅色主题下粉色/黄色/绿色 fill 与 #333 文字
  const text333 = relativeLuminance([51, 51, 51]);
  for (const fill of [
    [144, 238, 144],
    [255, 215, 0],
    [255, 182, 193],
  ]) {
    assert.equal(pickTextColor(relativeLuminance(fill), text333), null);
  }
});

test('渐变与 pattern 引用 url(...) 不作猜测，安全跳过', () => {
  assert.equal(parseColorString('url(#linearGrad)'), null);
  assert.equal(parseColorString('url("#my-gradient")'), null);
  assert.equal(parseColorString('url(pattern-1)'), null);
});

test('isUnresolvableColor 与 domParseColor：url(...) 绝不进入 Canvas 回退解析', () => {
  assert.equal(isUnresolvableColor('url(#grad)'), true);
  assert.equal(isUnresolvableColor('url("#white-grad")'), true);
  assert.equal(isUnresolvableColor('none'), true);
  assert.equal(isUnresolvableColor('transparent'), true);
  assert.equal(isUnresolvableColor('#fff'), false);
  assert.equal(isUnresolvableColor('rgb(255, 255, 255)'), false);

  // domParseColor 遇到 url(...) 直接返回 null
  assert.equal(domParseColor('url(#myGrad)'), null);
  assert.equal(domParseColor('url("#grad-white")'), null);
});

test('postProcessMermaidSvg 全路径回归：渐变 fill 节点整条路径跳过，背景与文字样式均保持原样', () => {
  const shapeStyle = { fill: 'url(#white-gradient)' };
  const shapeSetPropertyCalls = [];
  const shape = {
    style: {
      setProperty: (prop, val, pri) => shapeSetPropertyCalls.push({ prop, val, pri }),
    },
  };

  const labelStyle = { color: 'rgb(17, 24, 39)', fill: 'rgb(17, 24, 39)' }; // 深色文字
  const labelSetPropertyCalls = [];
  const label = {
    namespaceURI: 'http://www.w3.org/2000/svg',
    style: {
      setProperty: (prop, val, pri) => labelSetPropertyCalls.push({ prop, val, pri }),
    },
  };

  const node = {
    querySelector: () => shape,
    querySelectorAll: () => [label],
  };

  const mockSvg = {
    querySelectorAll: () => [node],
  };

  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el) => (el === shape ? shapeStyle : labelStyle);

  try {
    // 在 dark 主题下执行后处理
    postProcessMermaidSvg(mockSvg, { dark: true });

    // 验证：渐变节点的背景未被修改，文字也未被错误改为浅色
    assert.equal(shapeSetPropertyCalls.length, 0, '渐变背景 shape 不应被任何样式覆盖');
    assert.equal(labelSetPropertyCalls.length, 0, '渐变背景上的 label 文字样式不应被修改');
  } finally {
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test('postProcessMermaidSvg 全路径回归：普通纯色节点在 dark 主题下正常压暗并修正对比度', () => {
  const shapeStyle = { fill: 'rgb(255, 182, 193)' }; // 粉色高亮
  const shapeSet = {};
  const shape = {
    style: {
      setProperty: (prop, val) => { shapeSet[prop] = val; },
    },
  };

  const labelStyle = { color: 'rgb(204, 204, 204)', fill: 'rgb(204, 204, 204)' }; // #ccc
  const labelSet = {};
  const label = {
    namespaceURI: 'http://www.w3.org/2000/svg',
    style: {
      setProperty: (prop, val) => { labelSet[prop] = val; },
    },
  };

  const node = {
    querySelector: () => shape,
    querySelectorAll: () => [label],
  };

  const mockSvg = {
    querySelectorAll: () => [node],
  };

  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el) => (el === shape ? shapeStyle : labelStyle);

  try {
    postProcessMermaidSvg(mockSvg, { dark: true });

    // 验证纯色高亮节点被压暗
    assert.ok(shapeSet.fill, '纯色高亮 shape fill 应被压暗更新');
    assert.ok(shapeSet.fill.startsWith('rgb('));

    // 验证文字被替换为高对比度 TEXT_LIGHT
    assert.equal(labelSet.fill, TEXT_LIGHT);
    assert.equal(labelSet.color, TEXT_LIGHT);
  } finally {
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});
