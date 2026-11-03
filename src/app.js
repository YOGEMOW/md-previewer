/* app.js —— MD 预览器的界面逻辑：打开 / 拖放 / 大纲 / 主题 / 字号 / 源码 / 打印 */
(function () {
  'use strict';

  var MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
  var IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
  var K_THEME = 'mdv.theme';
  var K_FONT = 'mdv.font';
  var K_SOURCE = 'mdv.source';

  var state = {
    docs: [],
    current: -1,
    imageMap: new Map(),
    heads: [],
    filter: '',
    theme: 'auto',
    fontSize: 16,
    showSource: false,
    loading: false
  };

  var el = {};
  var toastTimer = null;

  function $(sel) { return document.querySelector(sel); }

  /* ---------- 小工具 ---------- */

  function say(msg) {
    if (!el.toast) { return; }
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function normalizePath(p) {
    return String(p || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/{2,}/g, '/')
      .toLowerCase();
  }

  function formatSize(n) {
    if (!n && n !== 0) { return ''; }
    if (n < 1024) { return n + ' B'; }
    if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + ' KB'; }
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function dirOf(p) {
    var s = String(p || '').replace(/\\/g, '/');
    var i = s.lastIndexOf('/');
    return i > 0 ? s.slice(0, i + 1) : '';
  }

  /* ---------- 主题 / 字号 ---------- */

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (el.themeBtn) {
      var label = theme === 'auto' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色';
      el.themeBtn.title = '当前：' + label + '（点击切换）';
      el.themeBtn.textContent = theme === 'auto' ? '\u25D0' : theme === 'dark' ? '\u263E' : '\u2600';
    }
    try { localStorage.setItem(K_THEME, theme); } catch (e) {}
  }

  function applyFontSize(px) {
    state.fontSize = Math.max(12, Math.min(26, px));
    document.documentElement.style.setProperty('--fs', state.fontSize + 'px');
    try { localStorage.setItem(K_FONT, String(state.fontSize)); } catch (e) {}
  }

  /* ---------- 文件加载 ---------- */

  function registerImage(path, file) {
    var key = normalizePath(path);
    if (!key) { return; }
    state.imageMap.set(key, file);
    var base = key.split('/').pop();
    if (base) {
      var bk = '@' + base;
      if (!state.imageMap.has(bk)) { state.imageMap.set(bk, file); }
    }
  }

  function addItems(items) {
    var added = 0;
    var skipped = 0;
    items.forEach(function (item) {
      var file = item.file;
      if (!file) { return; }
      if (IMG_EXT.test(file.name)) { registerImage(item.path, file); return; }
      if (!MD_EXT.test(file.name)) { skipped++; return; }
      if (state.docs.some(function (d) { return d.path === item.path && d.size === file.size; })) { return; }
      state.docs.push({
        name: file.name,
        path: item.path || file.name,
        size: file.size,
        file: file,
        text: null
      });
      added++;
    });

    state.docs.sort(function (a, b) { return a.path.localeCompare(b.path, 'zh'); });
    renderFileList();

    if (added > 0) {
      say('已加载 ' + added + ' 个 Markdown 文件');
      var firstNew = state.docs.findIndex(function (d) { return d.text === null && d.opened !== true; });
      selectDoc(state.current >= 0 ? state.current : (firstNew >= 0 ? firstNew : 0));
    } else if (skipped > 0) {
      say('没有找到 .md 文件（已忽略 ' + skipped + ' 个其他文件）');
      updateEmptyState();
    }
  }

  function itemsFromInput(fileList) {
    return Array.prototype.map.call(fileList, function (f) {
      return { file: f, path: f.webkitRelativePath || f.name };
    });
  }

  function itemsFromDrop(dataTransfer) {
    var items = dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var tasks = [];
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry();
        if (entry) { tasks.push(walkEntry(entry, '')); }
      }
      return Promise.all(tasks).then(function (groups) {
        return [].concat.apply([], groups);
      });
    }
    return Promise.resolve(Array.prototype.map.call(dataTransfer.files, function (f) {
      return { file: f, path: f.name };
    }));
  }

  function walkEntry(entry, prefix) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (f) { resolve([{ file: f, path: prefix + f.name }]); },
          function () { resolve([]); });
        return;
      }
      if (!entry.isDirectory) { resolve([]); return; }
      var reader = entry.createReader();
      var all = [];
      function readBatch() {
        reader.readEntries(function (entries) {
          if (!entries.length) {
            var sub = all.map(function (e) { return walkEntry(e, prefix + entry.name + '/'); });
            Promise.all(sub).then(function (groups) {
              resolve([].concat.apply([], groups));
            });
            return;
          }
          all = all.concat(Array.prototype.slice.call(entries));
          readBatch();
        }, function () { resolve([]); });
      }
      readBatch();
    });
  }

  /* ---------- 文件列表 ---------- */

  function visibleDocs() {
    var q = state.filter.trim().toLowerCase();
    if (!q) { return state.docs; }
    return state.docs.filter(function (d) { return d.path.toLowerCase().indexOf(q) >= 0; });
  }

  function renderFileList() {
    var list = visibleDocs();
    el.fileCount.textContent = String(state.docs.length);
    el.fileList.textContent = '';

    if (!state.docs.length) {
      var hint = document.createElement('div');
      hint.className = 'outline-empty';
      hint.textContent = '还没有打开文件';
      el.fileList.appendChild(hint);
      return;
    }
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'outline-empty';
      none.textContent = '没有匹配的文件';
      el.fileList.appendChild(none);
      return;
    }

    list.forEach(function (doc) {
      var idx = state.docs.indexOf(doc);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'file-item' + (idx === state.current ? ' active' : '');
      btn.title = doc.path;
      var name = document.createElement('span');
      name.className = 'fname';
      name.textContent = doc.name;
      btn.appendChild(name);
      var dir = dirOf(doc.path);
      if (dir) {
        var d = document.createElement('span');
        d.className = 'fdir';
        d.textContent = dir.replace(/\/$/, '');
        btn.appendChild(d);
      }
      btn.addEventListener('click', function () { selectDoc(idx); });
      el.fileList.appendChild(btn);
    });
  }

  /* ---------- 渲染文档 ---------- */

  function selectDoc(idx) {
    if (idx < 0 || idx >= state.docs.length) { return; }
    state.current = idx;
    renderFileList();
    loadAndRender(state.docs[idx]);
  }

  function loadAndRender(doc) {
    updateEmptyState();
    if (doc.text !== null) { doRender(doc); return; }
    el.docTitle.textContent = doc.name;
    el.docMeta.textContent = '正在读取…';
    doc.file.text().then(function (text) {
      doc.text = text;
      doc.opened = true;
      if (state.docs[state.current] === doc) { doRender(doc); }
    }).catch(function (err) {
      el.docMeta.textContent = '读取失败：' + (err && err.message ? err.message : '未知错误');
      say('读取失败：' + doc.name);
    });
  }

  function doRender(doc) {
    var res = MD.parse(doc.text);
    state.heads = [];

    if (state.showSource) {
      el.viewer.className = 'source-view';
      el.viewer.textContent = doc.text;
      el.viewer.hidden = false;
      el.outline.textContent = '';
    } else {
      el.viewer.className = 'markdown-body';
      el.viewer.innerHTML = res.html;
      el.viewer.hidden = false;
      fixImages(doc);
      wireCodeCopy();
      buildOutline(res.toc);
      $$('.task input', el.viewer).forEach(function (cb) { cb.disabled = true; });
    }

    el.docTitle.textContent = doc.name;
    el.docTitle.title = doc.path;
    document.title = doc.name + ' · MD 预览器';

    var parts = [];
    var dir = dirOf(doc.path);
    if (dir) { parts.push(dir.replace(/\/$/, '')); }
    parts.push(formatSize(doc.size));
    parts.push(doc.text.length.toLocaleString('zh-CN') + ' 字符');
    parts.push(res.toc.length + ' 个标题');
    el.docMeta.textContent = parts.join(' · ');

    el.content.scrollTop = 0;
    requestAnimationFrame(updateSpy);
  }

  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fixImages(doc) {
    var baseDir = dirOf(doc.path);
    $$('img', el.viewer).forEach(function (img) {
      var raw = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:|file:|\/\/)/i.test(raw)) { return; }
      var clean = raw.replace(/[?#].*$/, '');
      try { clean = decodeURIComponent(clean); } catch (e) {}
      var key = normalizePath(baseDir + clean.replace(/^\.\//, ''));

      var file = state.imageMap.get(key);
      if (!file) {
        var parts = key.split('/');
        for (var k = 1; k < parts.length && !file; k++) {
          file = state.imageMap.get(parts.slice(k).join('/'));
        }
      }
      if (!file) {
        var base = key.split('/').pop();
        file = state.imageMap.get('@' + base);
      }
      if (file) { img.src = URL.createObjectURL(file); }
      else {
        img.title = '找不到图片：' + raw;
        img.classList.add('img-missing');
      }
    });
  }

  function wireCodeCopy() {
    $$('.code-block', el.viewer).forEach(function (block) {
      var btn = block.querySelector('.code-copy');
      var code = block.querySelector('pre code');
      if (!btn || !code) { return; }
      btn.addEventListener('click', function () {
        var text = code.innerText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { say('代码已复制'); },
            function () { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
      });
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); say('代码已复制'); } catch (e) { say('复制失败'); }
    document.body.removeChild(ta);
  }

  /* ---------- 大纲 / 滚动定位 ---------- */

  function buildOutline(toc) {
    el.outline.textContent = '';
    state.heads = [];
    if (!toc.length) {
      var none = document.createElement('div');
      none.className = 'outline-empty';
      none.textContent = '（没有标题）';
      el.outline.appendChild(none);
      return;
    }
    toc.forEach(function (h) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'outline-item lv' + h.level;
      btn.textContent = h.text || '(无标题)';
      btn.title = h.text || '';
      btn.dataset.target = h.id;
      btn.addEventListener('click', function () {
        var node = el.viewer.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(h.id) : h.id.replace(/"/g, '')) + '"]');
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActiveOutline(h.id);
        }
      });
      el.outline.appendChild(btn);
    });
    requestAnimationFrame(function () { collectHeads(toc); });
  }

  function collectHeads(toc) {
    state.heads = toc.map(function (h) {
      return el.viewer.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(h.id) : h.id.replace(/"/g, '')) + '"]');
    }).filter(Boolean);
    updateSpy();
  }

  function setActiveOutline(id) {
    $$('.outline-item', el.outline).forEach(function (b) {
      b.classList.toggle('active', b.dataset.target === id);
    });
    var active = el.outline.querySelector('.outline-item.active');
    if (active && el.outline.scrollHeight > el.outline.clientHeight) {
      var top = active.offsetTop;
      if (top < el.outline.scrollTop || top > el.outline.scrollTop + el.outline.clientHeight - 30) {
        el.outline.scrollTop = Math.max(0, top - el.outline.clientHeight / 2);
      }
    }
  }

  var spyTick = false;
  function updateSpy() {
    if (spyTick || !state.heads.length) { return; }
    spyTick = true;
    requestAnimationFrame(function () {
      spyTick = false;
      if (!state.heads.length) { return; }
      var anchor = el.content.getBoundingClientRect().top + 90;
      var currentId = state.heads[0].id;
      for (var i = 0; i < state.heads.length; i++) {
        if (state.heads[i].getBoundingClientRect().top <= anchor) { currentId = state.heads[i].id; }
        else { break; }
      }
      setActiveOutline(currentId);
    });
  }

  /* ---------- 空状态 ---------- */

  function updateEmptyState() {
    var hasDoc = state.current >= 0 && state.docs[state.current];
    el.empty.hidden = !!hasDoc;
    el.viewer.hidden = !hasDoc;
    if (!hasDoc) {
      el.docTitle.textContent = '未打开文件';
      el.docMeta.textContent = '把 .md 文件拖进来，或点击「打开文件」';
      document.title = 'MD 预览器';
    }
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    el.toast = document.createElement('div');
    el.toast.className = 'toast';
    document.body.appendChild(el.toast);

    el.btnOpen.addEventListener('click', function () { el.fileInput.click(); });
    el.btnOpen2.addEventListener('click', function () { el.fileInput.click(); });
    el.btnFolder.addEventListener('click', function () { el.dirInput.click(); });
    el.btnFolder2.addEventListener('click', function () { el.dirInput.click(); });

    el.fileInput.addEventListener('change', function () {
      addItems(itemsFromInput(this.files));
      this.value = '';
    });
    el.dirInput.addEventListener('change', function () {
      addItems(itemsFromInput(this.files));
      this.value = '';
    });

    el.fileFilter.addEventListener('input', function () {
      state.filter = this.value;
      renderFileList();
    });

    el.themeBtn.addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      applyTheme(order[(order.indexOf(state.theme) + 1) % order.length]);
      say('主题：' + (state.theme === 'auto' ? '跟随系统' : state.theme === 'dark' ? '深色' : '浅色'));
    });

    el.srcBtn.addEventListener('click', toggleSource);
    el.btnFontDec.addEventListener('click', function () { applyFontSize(state.fontSize - 1); });
    el.btnFontInc.addEventListener('click', function () { applyFontSize(state.fontSize + 1); });
    el.printBtn.addEventListener('click', function () { window.print(); });

    el.content.addEventListener('scroll', updateSpy, { passive: true });
    window.addEventListener('resize', updateSpy);

    // 拖放
    var dragDepth = 0;
    document.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      document.body.classList.add('dragging');
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) { document.body.classList.remove('dragging'); }
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('dragging');
      var dt = e.dataTransfer;
      if (!dt) { return; }
      itemsFromDrop(dt).then(function (items) {
        if (!items.length) { say('没有识别到文件'); return; }
        addItems(items);
      }).catch(function () { say('读取拖入内容失败'); });
    });

    // 快捷键
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) { return; }
      var k = e.key.toLowerCase();
      if (k === 'o' && e.shiftKey) { e.preventDefault(); el.dirInput.click(); }
      else if (k === 'o') { e.preventDefault(); el.fileInput.click(); }
      else if (k === 'e') { e.preventDefault(); toggleSource(); }
      else if (k === '=' || k === '+') { e.preventDefault(); applyFontSize(state.fontSize + 1); }
      else if (k === '-') { e.preventDefault(); applyFontSize(state.fontSize - 1); }
      else if (k === '0') { e.preventDefault(); applyFontSize(16); }
    });
  }

  function toggleSource() {
    state.showSource = !state.showSource;
    el.srcBtn.classList.toggle('active', state.showSource);
    try { localStorage.setItem(K_SOURCE, state.showSource ? '1' : '0'); } catch (e) {}
    say(state.showSource ? '源码视图' : '预览视图');
    var doc = state.docs[state.current];
    if (doc && doc.text !== null) { doRender(doc); }
  }

  /* ---------- 启动 ---------- */

  function boot() {
    el.sidebar = $('#sidebar');
    el.content = $('#content');
    el.viewer = $('#viewer');
    el.empty = $('#empty');
    el.outline = $('#outline');
    el.fileList = $('#file-list');
    el.fileCount = $('#file-count');
    el.fileFilter = $('#file-filter');
    el.docTitle = $('#doc-title');
    el.docMeta = $('#doc-meta');
    el.fileInput = $('#file-input');
    el.dirInput = $('#dir-input');
    el.btnOpen = $('#btn-open');
    el.btnOpen2 = $('#btn-open2');
    el.btnFolder = $('#btn-folder');
    el.btnFolder2 = $('#btn-folder2');
    el.themeBtn = $('#btn-theme');
    el.srcBtn = $('#btn-source');
    el.btnFontDec = $('#btn-font-dec');
    el.btnFontInc = $('#btn-font-inc');
    el.printBtn = $('#btn-print');

    var theme = 'auto', font = 16, source = false;
    try { theme = localStorage.getItem(K_THEME) || 'auto'; } catch (e) {}
    try { font = parseInt(localStorage.getItem(K_FONT), 10) || 16; } catch (e) {}
    try { source = localStorage.getItem(K_SOURCE) === '1'; } catch (e) {}

    applyTheme(theme);
    applyFontSize(font);
    state.showSource = source;
    el.srcBtn.classList.toggle('active', source);

    bind();
    renderFileList();
    updateEmptyState();
    document.body.setAttribute('data-ready', '1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
