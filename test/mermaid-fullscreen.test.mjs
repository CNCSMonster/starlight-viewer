import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreenManager } from '../src/scripts/mermaid-fullscreen.js';

function createMockEnvironment() {
  const attrs = new Set();
  let requestFullscreenCount = 0;
  let exitFullscreenCount = 0;
  let shouldRejectRequest = false;

  const body = {
    style: { overflow: '' },
  };

  const doc = {
    body,
    fullscreenElement: null,
    exitFullscreen: async function () {
      exitFullscreenCount++;
      doc.fullscreenElement = null;
    },
  };

  const el = {
    toggleAttribute: (attr, on) => {
      if (on) attrs.add(attr);
      else attrs.delete(attr);
    },
    hasAttribute: (attr) => attrs.has(attr),
    requestFullscreen: async function () {
      requestFullscreenCount++;
      if (shouldRejectRequest) {
        throw new Error('NotAllowedError: Simulation of API rejection');
      }
      doc.fullscreenElement = el;
    },
  };

  const btnAttrs = {};
  const fullscreenBtn = {
    setAttribute: (k, v) => { btnAttrs[k] = v; },
    getAttribute: (k) => btnAttrs[k],
  };

  return {
    el,
    doc,
    fullscreenBtn,
    attrs,
    body,
    getRequestFullscreenCount: () => requestFullscreenCount,
    getExitFullscreenCount: () => exitFullscreenCount,
    setShouldRejectRequest: (val) => { shouldRejectRequest = val; },
  };
}

test('全屏交互回归：原生请求失败 → fallback → 原生能力恢复 → 点击退出', async () => {
  const env = createMockEnvironment();
  let refitCount = 0;
  let hintCount = 0;

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
    onRefit: () => { refitCount++; },
    updateHint: () => { hintCount++; },
  });

  // 初始状态
  assert.equal(mgr.isFullscreen(), false);
  assert.equal(mgr.isFallback(), false);
  assert.equal(env.body.style.overflow, '');

  // 1. 原生请求失败（模拟权限被拒或 iOS Safari）
  env.setShouldRejectRequest(true);
  await mgr.toggleFullscreen();

  // 验证降级到伪全屏
  assert.equal(mgr.isFallback(), true, '应该进入伪全屏 fallback');
  assert.equal(mgr.isFullscreen(), true, 'isFullscreen 应为 true');
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), true);
  assert.equal(env.body.style.overflow, 'hidden', '进入伪全屏必须锁定 body 滚动');
  assert.equal(env.getRequestFullscreenCount(), 1);

  // 2. 原生能力恢复（比如用户重新授权，或后续环境可调用 requestFullscreen）
  env.setShouldRejectRequest(false);

  // 3. 此时点击退出全屏
  await mgr.toggleFullscreen();

  // 关键验证：直接退出伪全屏，绝不再次调用 requestFullscreen，不残留滚动锁
  assert.equal(mgr.isFallback(), false, '应该已退出伪全屏');
  assert.equal(mgr.isFullscreen(), false, 'isFullscreen 应为 false');
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), false, 'data-kb-fullscreen 应该已移除');
  assert.equal(env.body.style.overflow, '', '退出后必须恢复进入前的 body overflow');
  assert.equal(env.getRequestFullscreenCount(), 1, '退出时不应再次调用原生 requestFullscreen');
});

test('全屏交互回归：Esc 键退出伪全屏并恢复 body overflow', async () => {
  const env = createMockEnvironment();
  env.setShouldRejectRequest(true);
  env.body.style.overflow = 'visible'; // 初始原有值

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
  });

  await mgr.toggleFullscreen();
  assert.equal(mgr.isFallback(), true);
  assert.equal(env.body.style.overflow, 'hidden');

  // 派发 Escape 键盘事件
  mgr.handleKeydown({ key: 'Escape', preventDefault() {} });

  assert.equal(mgr.isFallback(), false);
  assert.equal(env.body.style.overflow, 'visible', '必须恢复原本的 overflow 值');
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), false);
});

test('全屏交互回归：destroy 清理路径恢复滚动锁', async () => {
  const env = createMockEnvironment();
  env.setShouldRejectRequest(true);
  env.body.style.overflow = 'auto';

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
  });

  await mgr.toggleFullscreen();
  assert.equal(mgr.isFallback(), true);
  assert.equal(env.body.style.overflow, 'hidden');

  // 模拟组件销毁（如路由切换、DOM 移除）
  mgr.destroy();

  assert.equal(mgr.isFallback(), false);
  assert.equal(env.body.style.overflow, 'auto', '销毁必须归还 body 滚动');
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), false);
});

test('全屏交互回归：destroy 后异步请求即使失败也不再锁定滚动', async () => {
  const env = createMockEnvironment();
  env.setShouldRejectRequest(true);
  env.body.style.overflow = '';

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
  });

  // 模拟：异步请求发出中，但组件被提前销毁
  mgr.destroy();
  await mgr.toggleFullscreen();

  assert.equal(mgr.isFallback(), false, '已销毁状态不应进入 fallback');
  assert.equal(env.body.style.overflow, '', '已销毁状态绝不能锁住 body 滚动');
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), false);
});

test('全屏交互回归：伪全屏状态下其他元素的原生全屏变化不应破坏本图', async () => {
  const env = createMockEnvironment();
  env.setShouldRejectRequest(true);

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
  });

  await mgr.toggleFullscreen();
  assert.equal(mgr.isFallback(), true);
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), true);

  // 模拟其他元素（如 video）触发了 document 全屏变化
  env.doc.fullscreenElement = {}; // 其他元素
  mgr.syncNativeFullscreen();

  // 关键验证：伪全屏状态应保持，不被其他元素覆盖
  assert.equal(mgr.isFallback(), true);
  assert.equal(env.el.hasAttribute('data-kb-fullscreen'), true);
  assert.equal(env.fullscreenBtn.getAttribute('title'), '退出全屏（Esc）');
});

test('全屏交互回归：正常原生全屏进入与退出', async () => {
  const env = createMockEnvironment();
  env.setShouldRejectRequest(false);

  const mgr = createFullscreenManager({
    el: env.el,
    doc: env.doc,
    fullscreenBtn: env.fullscreenBtn,
  });

  await mgr.toggleFullscreen();
  assert.equal(mgr.isFallback(), false, '原生成功时不走 fallback');
  assert.equal(env.doc.fullscreenElement, env.el);
  assert.equal(mgr.isFullscreen(), true);
  assert.equal(env.body.style.overflow, '', '原生全屏不篡改 body overflow');

  // 再次点击退出
  await mgr.toggleFullscreen();
  assert.equal(env.getExitFullscreenCount(), 1, '应调用原生 exitFullscreen');
  assert.equal(env.doc.fullscreenElement, null);
  assert.equal(mgr.isFullscreen(), false);
});
