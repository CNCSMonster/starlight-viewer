import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFitScale,
  wheelZoomFactor,
  zoomView,
  MAX_SCALE,
  MIN_SCALE,
} from '../src/scripts/mermaid-zoom.js';

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('computeFitScale 同时受宽高约束，且不超过 1', () => {
  close(computeFitScale(800, 600, 1600, 1200), 0.5);
  close(computeFitScale(2000, 2000, 1000, 1000), 1);
  close(computeFitScale(400, 2000, 1000, 1000), 0.4);
});

test('computeFitScale 对未挂载/隐藏容器返回 1，避免除零', () => {
  close(computeFitScale(0, 600, 1000, 1000), 1);
  close(computeFitScale(800, 0, 1000, 1000), 1);
  close(computeFitScale(800, 600, 0, 1000), 1);
});

test('捏合使用连续指数因子', () => {
  close(wheelZoomFactor({ deltaY: -10, ctrlKey: true }), Math.exp(0.1));
  close(wheelZoomFactor({ deltaY: 10, ctrlKey: true }), Math.exp(-0.1));
  close(wheelZoomFactor({ deltaY: 0, ctrlKey: true }), 1);
});

test('单事件指数被上限截断，避免一格拉到 3x', () => {
  close(wheelZoomFactor({ deltaY: -1000, ctrlKey: true }), Math.exp(0.35));
  close(wheelZoomFactor({ deltaY: 1000, ctrlKey: true }), Math.exp(-0.35));
});

test('deltaMode 按行 / 页换算', () => {
  close(wheelZoomFactor({ deltaY: -1, ctrlKey: true, deltaMode: 1 }), Math.exp(0.16));
  close(wheelZoomFactor({ deltaY: -1, ctrlKey: true, deltaMode: 2, stageHeight: 500 }), Math.exp(0.35));
});

test('zoomView 保持光标下的图形坐标不变', () => {
  const next = zoomView({ k: 1, x: 0, y: 0 }, 100, 50, 2);
  close(next.k, 2);
  close(next.x, -100);
  close(next.y, -50);
  close((100 - next.x) / next.k, 100);
  close((50 - next.y) / next.k, 50);
});

test('zoomView 在上下限处仍保持锚点', () => {
  const max = zoomView({ k: 10, x: -20, y: -10 }, 100, 50, 10);
  close(max.k, MAX_SCALE);
  close((100 - max.x) / max.k, (100 - -20) / 10);

  const min = zoomView({ k: 0.06, x: 5, y: 5 }, 100, 50, 0.01);
  close(min.k, MIN_SCALE);
  close((100 - min.x) / min.k, (100 - 5) / 0.06);
});
