import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageZoomShortcut } from '../src/scripts/browser-zoom.js';

test('识别 Ctrl/⌘ + +/-/0 页面缩放快捷键', () => {
  assert.equal(isPageZoomShortcut({ ctrlKey: true, key: '+' }), true);
  assert.equal(isPageZoomShortcut({ ctrlKey: true, key: '=' }), true);
  assert.equal(isPageZoomShortcut({ metaKey: true, key: '-' }), true);
  assert.equal(isPageZoomShortcut({ ctrlKey: true, key: '_' }), true);
  assert.equal(isPageZoomShortcut({ ctrlKey: true, key: '0' }), true);
});

test('普通按键不误判为页面缩放', () => {
  assert.equal(isPageZoomShortcut({ key: '+' }), false);
  assert.equal(isPageZoomShortcut({ ctrlKey: true, key: 'a' }), false);
  assert.equal(isPageZoomShortcut(null), false);
});
