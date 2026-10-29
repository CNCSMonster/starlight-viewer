(function () {
  var D = document.documentElement;
  var L = 'data-kb-hide-left';
  var R = 'data-kb-hide-right';

  function read(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
  function save(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} }
  function setSidebar(attr, on) { if (on) D.setAttribute(attr, ''); else D.removeAttribute(attr); save(attr, on); sync(); }

  if (read(L)) D.setAttribute(L, '');
  if (read(R)) D.setAttribute(R, '');

  function sync() {
    var lb = document.getElementById('kb-toggle-left');
    var rb = document.getElementById('kb-toggle-right');
    if (lb) lb.setAttribute('aria-pressed', D.hasAttribute(L) ? 'true' : 'false');
    if (rb) rb.setAttribute('aria-pressed', D.hasAttribute(R) ? 'true' : 'false');
  }

  function icon(side) {
    return side === 'left'
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>';
  }

  function makeToggle(id, side, label, key) {
    var b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'kb-toggle';
    b.title = label + '（快捷键 ' + key + '）';
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(side);
    b.addEventListener('click', function () {
      var attr = side === 'left' ? L : R;
      setSidebar(attr, !D.hasAttribute(attr));
    });
    return b;
  }

  function mountToggles() {
    var group = document.querySelector('.right-group');
    if (!group || document.getElementById('kb-toggle-left')) return;
    var box = document.createElement('div');
    box.className = 'kb-toggle-group';
    box.appendChild(makeToggle('kb-toggle-left', 'left', '收起/展开左侧目录', '['));
    box.appendChild(makeToggle('kb-toggle-right', 'right', '收起/展开右侧本页目录', ']'));
    group.insertBefore(box, group.firstChild);
    sync();
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === '[') { setSidebar(L, !D.hasAttribute(L)); }
    else if (e.key === ']') { setSidebar(R, !D.hasAttribute(R)); }
  });

  /* ── 图片 / 表格 / 代码查看器 ───────────────────────── */

  var V = null;
  var MIN_Z = 0.1;
  var MAX_Z = 8;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function ensureViewer() {
    if (V) return V;

    var dlg = document.createElement('dialog');
    dlg.className = 'kb-zoom';
    dlg.setAttribute('aria-label', '内容查看器');
    dlg.innerHTML =
      '<button type="button" class="kb-zoom-close" aria-label="关闭">×</button>' +
      '<div class="kb-zoom-label"></div>' +
      '<div class="kb-zoom-stage"><div class="kb-zoom-canvas"></div></div>' +
      '<div class="kb-zoom-panel"></div>' +
      '<div class="kb-zoom-bar">' +
        '<button type="button" data-act="out" aria-label="缩小" title="缩小（-）">−</button>' +
        '<span class="kb-zoom-pct">100%</span>' +
        '<button type="button" data-act="in" aria-label="放大" title="放大（+）">+</button>' +
        '<button type="button" data-act="fit" title="适应窗口（0）">适应</button>' +
        '<button type="button" data-act="one" title="原始尺寸（1）">1:1</button>' +
      '</div>' +
      '<div class="kb-zoom-tip"></div>';
    document.body.appendChild(dlg);

    var v = {
      dlg: dlg,
      stage: dlg.querySelector('.kb-zoom-stage'),
      canvas: dlg.querySelector('.kb-zoom-canvas'),
      panel: dlg.querySelector('.kb-zoom-panel'),
      bar: dlg.querySelector('.kb-zoom-bar'),
      pct: dlg.querySelector('.kb-zoom-pct'),
      label: dlg.querySelector('.kb-zoom-label'),
      tip: dlg.querySelector('.kb-zoom-tip'),
      mode: 'media',
      kind: 'svg',
      z: 1, tx: 0, ty: 0,
      natW: 1, natH: 1,
      fitScale: 1,
      pointers: new Map(),
      drag: null,
      pinchDist: 0,
      moved: false,
      opener: null
    };
    V = v;

    dlg.querySelector('.kb-zoom-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeViewer();
    });

    // 关闭时只清内容，保留查看器外壳，避免引用失效
    dlg.addEventListener('close', function () {
      v.canvas.innerHTML = '';
      v.panel.innerHTML = '';
      v.label.textContent = '';
      v.pointers.clear();
      v.drag = null;
      D.classList.remove('kb-zoom-open');
      if (v.opener && v.opener.focus) { try { v.opener.focus(); } catch (e) {} }
    });

    // 工具栏
    v.bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'in') zoomAt(0, 0, 1.25);
      else if (act === 'out') zoomAt(0, 0, 0.8);
      else if (act === 'fit') fit();
      else if (act === 'one') { v.z = 1; v.tx = 0; v.ty = 0; clampPan(); apply(); }
    });

    // 滚轮缩放（以光标为锚点）
    v.stage.addEventListener('wheel', function (e) {
      if (v.mode !== 'media') return;
      e.preventDefault();
      var r = v.stage.getBoundingClientRect();
      var cx = e.clientX - (r.left + r.width / 2);
      var cy = e.clientY - (r.top + r.height / 2);
      zoomAt(cx, cy, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    // 拖拽平移 / 双指缩放
    v.stage.addEventListener('pointerdown', function (e) {
      if (v.mode !== 'media') return;
      if (e.target.closest && e.target.closest('.kb-zoom-bar, .kb-zoom-close')) return;
      try { v.stage.setPointerCapture(e.pointerId); } catch (err) {}
      v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (v.pointers.size === 1) {
        v.drag = { x: e.clientX, y: e.clientY };
        v.moved = false;
      } else if (v.pointers.size === 2) {
        v.drag = null;
        v.pinchDist = pointerDistance();
      }
      v.stage.classList.add('kb-dragging');
    });

    v.stage.addEventListener('pointermove', function (e) {
      if (!v.pointers.has(e.pointerId)) return;
      v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (v.pointers.size >= 2) {
        var dist = pointerDistance();
        if (v.pinchDist > 0 && dist > 0) {
          var mid = pointerMidpoint();
          var r = v.stage.getBoundingClientRect();
          zoomAt(
            mid.x - (r.left + r.width / 2),
            mid.y - (r.top + r.height / 2),
            dist / v.pinchDist
          );
        }
        v.pinchDist = dist;
        return;
      }

      if (v.drag) {
        var dx = e.clientX - v.drag.x;
        var dy = e.clientY - v.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) v.moved = true;
        v.tx += dx;
        v.ty += dy;
        v.drag = { x: e.clientX, y: e.clientY };
        clampPan();
        apply();
      }
    });

    function endPointer(e) {
      v.pointers.delete(e.pointerId);
      v.pinchDist = 0;
      if (v.pointers.size === 0) {
        v.drag = null;
        v.stage.classList.remove('kb-dragging');
        setTimeout(function () { v.moved = false; }, 0);
      } else if (v.pointers.size === 1) {
        var only = v.pointers.values().next().value;
        v.drag = { x: only.x, y: only.y };
      }
    }
    v.stage.addEventListener('pointerup', endPointer);
    v.stage.addEventListener('pointercancel', endPointer);

    // 空白处点击关闭（拖拽结束不误关）
    v.stage.addEventListener('click', function (e) {
      if (v.mode !== 'media') return;
      if (e.target === v.stage && !v.moved) closeViewer();
    });

    // 双击：适应 ↔ 200%（或原始尺寸）
    v.stage.addEventListener('dblclick', function (e) {
      if (v.mode !== 'media') return;
      var r = v.stage.getBoundingClientRect();
      var cx = e.clientX - (r.left + r.width / 2);
      var cy = e.clientY - (r.top + r.height / 2);
      var target = v.z > v.fitScale * 1.2 ? v.fitScale : Math.max(1, v.fitScale * 2);
      zoomAt(cx, cy, target / v.z);
    });

    // 面板模式下点空白关闭
    v.dlg.addEventListener('click', function (e) {
      if (v.mode === 'panel' && e.target === v.dlg) closeViewer();
    });

    return v;
  }

  function pointerDistance() {
    var pts = Array.from(V.pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function pointerMidpoint() {
    var pts = Array.from(V.pointers.values());
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  function apply() {
    var v = V;
    v.canvas.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.z + ')';
    v.pct.textContent = Math.round(v.z * 100) + '%';
    // 放大后收起操作提示，避免压在图上
    v.tip.style.visibility = v.z > v.fitScale * 1.05 ? 'hidden' : '';
  }

  function fit() {
    var v = V;
    var r = v.stage.getBoundingClientRect();
    var pad = r.width < 600 ? 24 : 56;
    var s = Math.min((r.width - pad) / v.natW, (r.height - pad) / v.natH);
    if (v.kind === 'img') s = Math.min(s, 1);
    v.fitScale = Math.max(MIN_Z, s);
    v.z = v.fitScale;
    v.tx = 0;
    v.ty = 0;
    apply();
  }

  function clampPan() {
    var v = V;
    var r = v.stage.getBoundingClientRect();
    var w = v.natW * v.z;
    var h = v.natH * v.z;

    if (w <= r.width && h <= r.height) {
      v.tx = 0;
      v.ty = 0;
      return;
    }
    var limX = Math.max(0, (w + r.width) / 2 - 80);
    var limY = Math.max(0, (h + r.height) / 2 - 80);
    v.tx = clamp(v.tx, -limX, limX);
    v.ty = clamp(v.ty, -limY, limY);
  }

  function zoomAt(cx, cy, factor) {
    var v = V;
    var nz = clamp(v.z * factor, MIN_Z, MAX_Z);
    if (Math.abs(nz - v.z) < 0.0001) return;
    var u = (cx - v.tx) / v.z;
    var w = (cy - v.ty) / v.z;
    v.tx = cx - u * nz;
    v.ty = cy - w * nz;
    v.z = nz;
    clampPan();
    apply();
  }

  function closeViewer() {
    if (V && V.dlg.open) V.dlg.close();
  }

  function openMedia(kind, node) {
    var v = ensureViewer();
    v.mode = 'media';
    v.kind = kind;
    v.dlg.setAttribute('data-mode', 'media');
    v.opener = document.activeElement;
    v.canvas.innerHTML = '';
    v.panel.innerHTML = '';
    v.z = 1;
    v.tx = 0;
    v.ty = 0;

    var el;
    var label = '';

    if (kind === 'img') {
      el = document.createElement('img');
      el.alt = node.alt || '';
      el.src = node.currentSrc || node.src;
      v.natW = node.naturalWidth || 900;
      v.natH = node.naturalHeight || 600;
      label = node.alt || '';
      el.style.width = v.natW + 'px';
      el.style.height = v.natH + 'px';
      el.addEventListener('load', function () {
        if (!v.dlg.open || v.canvas.firstChild !== el) return;
        v.natW = el.naturalWidth || v.natW;
        v.natH = el.naturalHeight || v.natH;
        el.style.width = v.natW + 'px';
        el.style.height = v.natH + 'px';
        fit();
      });
    } else {
      var c = node.cloneNode(true);
      c.removeAttribute('style');
      c.removeAttribute('width');
      c.removeAttribute('height');

      var vb = c.getAttribute('viewBox');
      if (vb) {
        var parts = vb.trim().split(/[\s,]+/).map(Number);
        v.natW = parts[2] || 900;
        v.natH = parts[3] || 600;
      } else {
        v.natW = parseFloat(node.getAttribute('width')) || 900;
        v.natH = parseFloat(node.getAttribute('height')) || 600;
        c.setAttribute('viewBox', '0 0 ' + v.natW + ' ' + v.natH);
      }
      c.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      c.style.width = v.natW + 'px';
      c.style.height = v.natH + 'px';
      c.style.display = 'block';
      el = c;

      var title = node.querySelector('title');
      label = title && title.textContent.trim() ? title.textContent.trim() : '';
    }

    v.canvas.appendChild(el);
    v.label.textContent = label;
    v.tip.textContent = window.matchMedia('(pointer: coarse)').matches
      ? '双指缩放 · 拖拽平移 · 双击切换'
      : '滚轮缩放 · 拖拽平移 · 双击切换 · Esc 关闭';

    v.dlg.showModal();
    D.classList.add('kb-zoom-open');
    requestAnimationFrame(function () {
      if (v.dlg.open) fit();
    });
  }

  function openPanel(kind, node) {
    var v = ensureViewer();
    v.mode = 'panel';
    v.dlg.setAttribute('data-mode', 'panel');
    v.opener = document.activeElement;
    v.canvas.innerHTML = '';
    v.panel.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'kb-zoom-inner kb-zoom-' + kind;

    if (kind === 'table') {
      wrap.appendChild(node.cloneNode(true));
      v.label.textContent = '表格';
    } else {
      var frame = (node.closest && node.closest('figure.frame')) || node;
      var copy = frame.cloneNode(true);
      copy.querySelectorAll('.copy, .kb-zoom-btn').forEach(function (n) { n.remove(); });

      var ctx = document.createElement('div');
      ctx.className = 'expressive-code';
      if (copy.tagName.toLowerCase() === 'pre') {
        var fig = document.createElement('figure');
        fig.className = 'frame not-content';
        fig.appendChild(copy);
        ctx.appendChild(fig);
      } else {
        ctx.appendChild(copy);
      }
      wrap.appendChild(ctx);
      v.label.textContent = '代码';
    }

    v.panel.appendChild(wrap);
    v.tip.style.visibility = '';
    v.tip.textContent = '点击空白处或按 Esc 关闭';
    v.dlg.showModal();
    D.classList.add('kb-zoom-open');
  }

  /* ── 表格 / 代码块放大按钮 ───────────────────────── */

  var ZOOM_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M15 21h6v-6M9 21H3v-6"/></svg>';

  function addZoomButton(host, kind, target, label) {
    if (!host || host.querySelector(':scope > .kb-zoom-btn')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'kb-zoom-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = ZOOM_ICON;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel(kind, target);
    });
    host.appendChild(b);
  }

  function enhanceZoomables() {
    var content = document.querySelector('.sl-markdown-content');
    if (!content) return;

    content.querySelectorAll('table').forEach(function (t) {
      var p = t.parentElement;
      if (p && p.classList.contains('kb-zoom-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'kb-zoom-wrap';
      p.insertBefore(wrap, t);
      wrap.appendChild(t);
      addZoomButton(wrap, 'table', t, '放大查看这张表');
    });

    content.querySelectorAll('figure.frame').forEach(function (f) {
      // mermaid 代码块由懒加载渲染器接管（自带缩放平移），不挂「放大代码」按钮
      if (f.querySelector('pre[data-language="mermaid"]')) return;
      addZoomButton(f, 'code', f, '放大查看这段代码');
    });

    content.querySelectorAll('pre').forEach(function (p) {
      if (p.closest('figure.frame')) return;
      var host = p.parentElement;
      if (!host || host.classList.contains('kb-zoom-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'kb-zoom-wrap';
      host.insertBefore(wrap, p);
      wrap.appendChild(p);
      addZoomButton(wrap, 'code', p, '放大查看这段代码');
    });
  }

  function boot() {
    mountToggles();
    enhanceZoomables();
  }

  document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('astro:page-load', boot);

  // 图（SVG / img）点击进入查看器；表格和代码用右上角按钮，避免抢走选中复制
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a,.kb-zoom-btn,button')) return;
    // mermaid 图自带内联缩放平移，点击交给它处理，不再弹出全屏查看器
    if (e.target.closest && e.target.closest('.kb-mermaid')) return;
    var t = e.target.closest && e.target.closest('.sl-markdown-content svg, .sl-markdown-content img');
    if (!t) return;
    e.preventDefault();
    openMedia(t.tagName.toLowerCase() === 'img' ? 'img' : 'svg', t);
  });

  // 查看器快捷键
  document.addEventListener('keydown', function (e) {
    if (!V || !V.dlg.open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeViewer(); return; }
    if (V.mode !== 'media') return;
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(0, 0, 1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(0, 0, 0.8); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === '1') { e.preventDefault(); V.z = 1; V.tx = 0; V.ty = 0; clampPan(); apply(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); V.tx += 60; clampPan(); apply(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); V.tx -= 60; clampPan(); apply(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); V.ty += 60; clampPan(); apply(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); V.ty -= 60; clampPan(); apply(); }
  });
})();
