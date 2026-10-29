/**
 * Mermaid 查看器全屏模式管理：区分原生全屏与 iOS Safari 伪全屏 fallback。
 */

export function createFullscreenManager({
  el,
  doc = typeof document !== 'undefined' ? document : null,
  fullscreenBtn,
  onRefit,
  updateHint,
}) {
  let isFallbackFullscreen = false;
  let savedBodyOverflow = '';
  let destroyed = false;

  const getNativeFullscreenElement = () =>
    doc ? doc.fullscreenElement || doc.webkitFullscreenElement || null : null;

  const isFullscreen = () =>
    isFallbackFullscreen || getNativeFullscreenElement() === el;

  function setFallbackFullscreen(on) {
    if (destroyed || isFallbackFullscreen === on) return;
    isFallbackFullscreen = on;
    if (el && typeof el.toggleAttribute === 'function') {
      el.toggleAttribute('data-kb-fullscreen', on);
    }
    if (fullscreenBtn && typeof fullscreenBtn.setAttribute === 'function') {
      fullscreenBtn.setAttribute('title', on ? '退出全屏（Esc）' : '全屏查看');
      fullscreenBtn.setAttribute('aria-label', on ? '退出全屏（Esc）' : '全屏查看');
    }
    if (doc && doc.body) {
      if (on) {
        savedBodyOverflow = doc.body.style.overflow || '';
        doc.body.style.overflow = 'hidden';
      } else {
        doc.body.style.overflow = savedBodyOverflow;
      }
    }
    if (updateHint) updateHint();
    if (onRefit) onRefit();
  }

  async function toggleFullscreen() {
    if (destroyed) return;

    // 1. 若当前处于伪全屏模式：直接关闭伪全屏并返回，绝不再次尝试原生全屏请求
    if (isFallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }

    // 2. 若当前处于原生全屏模式：退出原生全屏
    if (getNativeFullscreenElement() === el) {
      if (doc) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (exit) {
          try {
            await exit.call(doc);
          } catch (err) {
            console.warn('[mermaid] 原生全屏退出失败：', err);
          }
        }
      }
      return;
    }

    // 3. 当前非全屏：优先原生请求，失败或不支持时降级至伪全屏
    const canNative = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (canNative) {
      try {
        const request = el.requestFullscreen || el.webkitRequestFullscreen;
        await request.call(el);
        return;
      } catch (err) {
        if (destroyed) return;
        console.warn('[mermaid] 原生全屏请求失败，降级到伪全屏：', err);
      }
    }
    if (destroyed) return;
    setFallbackFullscreen(true);
  }

  function handleKeydown(e) {
    if (destroyed) return;
    if (e.key === 'Escape' && isFallbackFullscreen) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      setFallbackFullscreen(false);
    }
  }

  function syncNativeFullscreen() {
    if (destroyed || isFallbackFullscreen) return;
    const on = getNativeFullscreenElement() === el;
    if (el && typeof el.toggleAttribute === 'function') {
      el.toggleAttribute('data-kb-fullscreen', on);
    }
    if (fullscreenBtn && typeof fullscreenBtn.setAttribute === 'function') {
      fullscreenBtn.setAttribute('title', on ? '退出全屏（Esc）' : '全屏查看');
      fullscreenBtn.setAttribute('aria-label', on ? '退出全屏（Esc）' : '全屏查看');
    }
    if (updateHint) updateHint();
    if (onRefit) onRefit();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (isFallbackFullscreen) {
      isFallbackFullscreen = false;
      if (el && typeof el.toggleAttribute === 'function') {
        el.toggleAttribute('data-kb-fullscreen', false);
      }
      if (doc && doc.body) {
        doc.body.style.overflow = savedBodyOverflow;
      }
    }
    if (getNativeFullscreenElement() === el && doc) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) {
        try {
          const res = exit.call(doc);
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } catch {}
      }
    }
  }

  return {
    isFullscreen,
    isFallback: () => isFallbackFullscreen,
    setFallbackFullscreen,
    toggleFullscreen,
    handleKeydown,
    syncNativeFullscreen,
    destroy,
  };
}
