import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColorString,
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
    assert.ok(contrastRatio(lum, chosenLum) >= 4.5);
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
