/*!
 * lvl-converter.js — MVZ2 关卡文件转换器页面逻辑
 * 依赖：js/extjson.js（提供全局 ExtJson）
 */

(function () {
  'use strict';

  // .lvl / .dat / .gz 都是 gzip 包着拓展 JSON；.json 是裸文本
  var FORMATS = {
    lvl:  { ext: '.lvl',  gz: true  },
    dat:  { ext: '.dat',  gz: true  },
    gz:   { ext: '.gz',   gz: true  },
    json: { ext: '.json', gz: false }
  };
  var KNOWN_EXT = /\.(lvl|dat|gz|json)$/i;
  var NUMBER_LONG = /NumberLong\(\d+\)/g;
  var RENDER_CAP = 300;              // 列表最多渲染多少行
  var SEARCH_CAP = 300;              // 搜索状态下少渲染一些，保证输入跟手

  var $ = function (id) { return document.getElementById(id); };
  var btnOpen = $('btnOpen'), btnSave = $('btnSave');
  var fmtSel = $('fmt'), nameInput = $('fileName'), pathInput = $('filePath');
  var statusEl = $('status'), editor = $('editor'), picker = $('picker'), sbPos = $('sbPos');
  var listEl = $('list'), countEl = $('count');
  var qInput = $('q'), typeFilter = $('typeFilter');
  var selPathEl = $('selPath'), newValue = $('newValue'), btnApply = $('btnApply');
  var btnDelete = $('btnDelete'), fieldMsgEl = $('fieldMsg');

  var currentName = '';              // 当前打开的文件名（浏览器不提供完整路径）
  var ext = null;                    // ExtJson 会话
  var extErr = '';                   // 索引失败原因
  var selectedPath = null;
  var rowEls = [];
  var inputTimer = 0;

  // ---------------- 小工具 ----------------
  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || '';
    statusEl.title = text;
    if (window.LvlShell && window.LvlShell.log) window.LvlShell.log(text, kind);
  }
  function setFieldMsg(text, kind) {
    fieldMsgEl.textContent = text || '';
    fieldMsgEl.className = kind || '';
  }
  function setPath(text) {
    pathInput.textContent = text || '尚未打开文件';
    pathInput.classList.toggle('hasFile', !!(text && text.length));
    pathInput.classList.toggle('empty', !text);
    pathInput.title = text || '';
  }
  function updatePos() {
    if (!sbPos) return;
    var pos = editor.selectionStart || 0;
    var upto = editor.value.slice(0, pos);
    var line = upto.split('\n').length;
    var col = upto.length - (upto.lastIndexOf('\n') + 1) + 1;
    sbPos.textContent = '行 ' + line + '，列 ' + col;
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' 字节';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB（' + n + ' 字节）';
    return (n / 1048576).toFixed(2) + ' MB（' + n + ' 字节）';
  }
  function isGzip(bytes) {
    return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }
  function stripExt(name) { return String(name || '').replace(KNOWN_EXT, ''); }
  function baseName() { return stripExt(currentName) || 'level'; }
  function withExt(name, fmtKey) {
    var base = stripExt(String(name || '').trim()) || baseName();
    return base + FORMATS[fmtKey].ext;
  }

  // ---------------- gzip（零依赖，用浏览器内置流） ----------------
  async function gunzip(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持 DecompressionStream，无法解压 gzip。请用较新的 Chrome / Edge。');
    }
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      throw new Error('gzip 解压失败：' + (e && e.message ? e.message : e));
    }
  }
  async function gzip(bytes) {
    if (typeof CompressionStream !== 'function') {
      throw new Error('当前浏览器不支持 CompressionStream，无法生成 gzip。请用较新的 Chrome / Edge。');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ---------------- 打开 ----------------
  function guessFormatKey(fileName, gz) {
    var m = /\.([^.\\/]+)$/.exec(String(fileName || ''));
    var extName = m ? m[1].toLowerCase() : '';
    if (FORMATS[extName]) return extName;
    return gz ? 'gz' : 'json';
  }

  async function openFile(file) {
    if (!file) return;
    setStatus('正在读取 ' + file.name + ' …');
    try {
      var buf = new Uint8Array(await file.arrayBuffer());
      var gz = isGzip(buf);
      var payload = gz ? await gunzip(buf) : buf;

      var text = new TextDecoder('utf-8').decode(payload);
      if (text.charAt(0) === '\uFEFF') text = text.slice(1);

      currentName = file.name || 'level' + (gz ? '.lvl' : '.json');
      setPath(currentName);
      editor.value = text;
      selectedPath = null;
      newValue.value = '';

      var key = guessFormatKey(currentName, gz);
      fmtSel.value = key;
      nameInput.value = withExt(currentName, key);
      btnSave.disabled = false;

      var nLong = (text.match(NUMBER_LONG) || []).length;
      var bad = (text.match(/\uFFFD/g) || []).length;
      var info = (gz ? 'gzip 压缩 → 解压后 ' : '纯文本 ') + fmtBytes(payload.length) +
                 ' · ' + text.split('\n').length + ' 行' +
                 (nLong ? ' · NumberLong ×' + nLong : '');
      if (bad) {
        setStatus('已打开 ' + currentName + ' · ' + info + ' · ⚠ 有 ' + bad + ' 个字符无法按 UTF-8 解码', 'warn');
      } else {
        setStatus('已打开 ' + currentName + ' · ' + info, 'ok');
      }
      editor.scrollTop = 0;

      reindex();
      renderList();
      // 属性表在右侧时，顺手把侧边栏的字段列表露出来（两边各司其职）
      if (window.LvlShell && window.LvlShell.state().split) window.LvlShell.reveal('fields');
      propRefresh();
      updatePos();
    } catch (e) {
      setStatus('打开失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  // ---------------- 保存 / 导出 ----------------
  async function saveFile() {
    if (btnSave.disabled) return;
    var key = fmtSel.value;
    var def = FORMATS[key];
    if (!def) return;
    var name = withExt(nameInput.value, key);
    nameInput.value = name;

    btnSave.disabled = true;
    setStatus('正在生成 ' + name + ' …');
    try {
      var text = editor.value;
      var bytes = new TextEncoder().encode(text);
      if (def.gz) bytes = await gzip(bytes);
      var blob = new Blob([bytes], { type: def.gz ? 'application/gzip' : 'application/json' });
      await writeOut(blob, name, bytes.length, def.gz);
      currentName = name;
    } catch (e) {
      setStatus('保存失败：' + (e && e.message ? e.message : e), 'err');
    } finally {
      btnSave.disabled = false;
    }
  }

  function saveViaPlus(blob, name) {
    return new Promise(function (resolve, reject) {
      plus.io.resolveLocalFileSystemURL('_downloads/', function (root) {
        root.getFile(name, { create: true }, function (entry) {
          entry.createWriter(function (writer) {
            writer.onwrite = function () { resolve(); };
            writer.onerror = function (e) { reject(new Error('写入失败 ' + (e && e.message || ''))); };
            try { writer.truncate(0); } catch (ignored) {}
            writer.write(blob);
          }, reject);
        }, reject);
      }, reject);
    });
  }

  async function writeOut(blob, name, size, gz) {
    var what = name + ' · ' + fmtBytes(size) + (gz ? ' · gzip' : ' · 纯文本');

    // 1) 桌面 Chrome / Edge：真正的“另存为”对话框
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: name });
        var w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        setStatus('已保存 ' + what, 'ok');
        setPath(name);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { setStatus('已取消保存', 'warn'); return; }
        // 其它错误（比如不在安全上下文）就退回到下载
      }
    }

    // 2) HBuilderX 5+App 壳内：写到 _downloads/
    if (window.plus && plus.io && typeof plus.io.resolveLocalFileSystemURL === 'function') {
      try {
        await saveViaPlus(blob, name);
        setStatus('已保存到 _downloads/' + what, 'ok');
        setPath(name);
        return;
      } catch (ignored) { /* 退回到下载 */ }
    }

    // 3) 通用兜底：浏览器下载
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    setStatus('已导出 ' + what + ' → 浏览器下载目录', 'ok');
    setPath(name);
  }

  // ---------------- 字段面板 ----------------
  function propRefresh() {
    if (window.LvlProps && typeof window.LvlProps.renderAll === 'function') {
      window.LvlProps.renderAll();
    }
  }

  // 面板被切到前台时刷新（外壳负责切换，这里只知道“谁被激活了”）
  function onPanelActivate(id) {
    if (id === 'props') {
      propRefresh();
    } else if (id === 'fields') {
      reindex();
      renderList();
    }
  }

  function reindex() {
    ext = null;
    extErr = '';
    if (typeof ExtJson === 'undefined') {
      extErr = '未加载 js/extjson.js（和本文件放在同一目录下）';
      return;
    }
    var text = editor.value;
    if (!text.trim()) { extErr = '内容为空'; return; }
    try {
      ext = ExtJson.open(text);
    } catch (e) {
      extErr = '内容不是合法的拓展 JSON：' + (e && e.message ? e.message : e);
    }
  }

  function typeClass(t) {
    if (t === 'string') return 's';
    if (t === 'number') return 'n';
    if (t === 'numberlong') return 'l';
    if (t === 'object' || t === 'array') return 'o';
    return '';
  }

  function listMessage(text) {
    var div = document.createElement('div');
    div.className = 'list-msg';
    div.textContent = text;
    listEl.appendChild(div);
  }

  // 模糊匹配：按键顺序命中的子序列，分段起点 / 连续命中加分，命中位置用于高亮
  function fuzzy(q, t) {
    var qi = 0, score = 0, pos = [], last = -2;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t.charAt(i) !== q.charAt(qi)) continue;
      var prev = i ? t.charAt(i - 1) : '';
      var hit = 10;
      if (i === 0 || prev === '.' || prev === '[' || prev === ']' || prev === '_' || prev === '#') hit += 8;
      if (i === last + 1) hit += 6;
      else if (last >= 0) hit -= Math.min(3, i - last - 1);
      score += hit;
      pos.push(i);
      last = i;
      qi++;
    }
    if (qi < q.length) return null;
    return { score: score - t.length * 0.1, pos: pos };
  }

  function pathSpan(path, hits) {
    var span = document.createElement('span');
    span.className = 'p';
    if (!hits || !hits.length) { span.textContent = path; return span; }
    var set = Object.create(null);
    for (var k = 0; k < hits.length; k++) set[hits[k]] = 1;

    var buf = '', on = null;
    function flush() {
      if (!buf) return;
      if (on) {
        var b = document.createElement('b');
        b.className = 'hit';
        b.textContent = buf;
        span.appendChild(b);
      } else {
        span.appendChild(document.createTextNode(buf));
      }
      buf = '';
    }
    for (var i = 0; i < path.length; i++) {
      var h = !!set[i];
      if (on !== null && h !== on) flush();
      on = h;
      buf += path.charAt(i);
    }
    flush();
    return span;
  }

  function renderList() {
    var query = (qInput.value || '').trim();
    var terms = query ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
    var tf = typeFilter.value || 'all';
    listEl.textContent = '';
    rowEls = [];

    if (!ext) {
      listMessage(extErr || '尚未打开文件。');
      countEl.textContent = '';
      updateEditBox();
      return;
    }

    var all = ext.paths();
    var total = 0, cand = [];
    for (var k = 0; k < all.length; k++) {
      var p = all[k];
      if (/^\d+$/.test(p)) continue;      // 文档根节点：整篇替换太危险，不列出来
      var t = ext.typeOf(p);
      if (tf !== 'all' && t !== tf) continue;
      total++;

      if (!terms.length) { cand.push({ p: p, t: t, score: 0, hits: null, raw: null }); continue; }

      var pl = p.toLowerCase(), score = 0, hits = null, ok = true, raw = null;
      for (var ti = 0; ti < terms.length; ti++) {
        var m = fuzzy(terms[ti], pl);
        if (m) {
          score += m.score;
          if (!hits) hits = [];
          for (var h = 0; h < m.pos.length; h++) hits.push(m.pos[h]);
        } else {
          if (t === 'object' || t === 'array') { ok = false; break; }   // 容器必然含子节点的值，只会是噪声
          if (raw === null) raw = ext.get(p);
          if (raw.toLowerCase().indexOf(terms[ti]) >= 0) score += 4;   // 命中值：排在路径命中之后
          else { ok = false; break; }
        }
      }
      if (ok) cand.push({ p: p, t: t, score: score, hits: hits, raw: raw });
    }

    if (terms.length) {
      cand.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (a.p.length !== b.p.length) return a.p.length - b.p.length;
        return a.p < b.p ? -1 : 1;
      });
    }

    var cap = terms.length ? SEARCH_CAP : RENDER_CAP;
    var shown = 0, frag = document.createDocumentFragment();
    for (var j = 0; j < cand.length && shown < cap; j++) {
      var c = cand[j];
      var val = c.raw !== null ? c.raw : ext.get(c.p);

      var row = document.createElement('div');
      row.className = 'row' + (c.p === selectedPath ? ' sel' : '');
      row.dataset.path = c.p;
      row.setAttribute('role', 'option');
      row.title = c.p;

      var vs = document.createElement('span');
      vs.className = 'v ' + typeClass(c.t);
      vs.textContent = val.length > 120 ? val.slice(0, 120) + '…' : val;

      row.appendChild(pathSpan(c.p, c.hits));
      row.appendChild(vs);
      frag.appendChild(row);
      rowEls.push(row);
      shown++;
    }
    listEl.appendChild(frag);

    if (!shown) listMessage(terms.length || tf !== 'all' ? '没有匹配的字段。' : '没有可编辑的字段。');

    if (terms.length) {
      countEl.textContent = cand.length + ' 条匹配' + (cand.length > shown ? '，显示前 ' + shown : '');
    } else {
      countEl.textContent = shown + (total > shown ? '+' : '') + ' / ' + total;
    }
    updateEditBox();
  }

  function selectPath(path, fillValue) {
    selectedPath = path;
    for (var k = 0; k < rowEls.length; k++) {
      rowEls[k].classList.toggle('sel', rowEls[k].dataset.path === path);
    }
    if (path && fillValue !== false && ext) {
      try { newValue.value = ext.get(path); } catch (e) { newValue.value = ''; }
      scrollEditorTo(path);
    }
    updateEditBox();
  }

  function updateEditBox() {
    var ok = !!(ext && selectedPath);
    selPathEl.textContent = selectedPath || '未选择字段';
    selPathEl.className = selectedPath ? '' : 'empty';
    btnApply.disabled = !ok;
    btnDelete.disabled = !ok;
  }

  function scrollEditorTo(path) {
    if (!ext) return;
    try {
      var span = ext.spanOf(path);
      var before = editor.value.slice(0, span.start);
      var line = before.split('\n').length - 1;
      var lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
      editor.scrollTop = Math.max(0, line * lh - editor.clientHeight / 3);
      var col = before.length - (before.lastIndexOf('\n') + 1);
      editor.scrollLeft = Math.max(0, col * 7);
    } catch (e) { /* 忽略 */ }
  }

  function applyEdit() {
    if (!ext || !selectedPath) return;
    var keep = selectedPath;
    if (/^\d+$/.test(keep)) {
      setFieldMsg('文档根节点不能整体替换，请选它下面的具体字段。', 'err');
      return;
    }
    try {
      editor.value = ExtJson.set(editor.value, keep, newValue.value);
      setStatus('已修改 ' + keep + ' → ' + newValue.value, 'ok');
      setFieldMsg('已修改 1 处（只替换这一段，其余字节未动）', 'ok');
      reindex();
      renderList();
      if (ext && ext.has(keep)) selectPath(keep, true);
      else { selectedPath = null; updateEditBox(); }
      propRefresh();
    } catch (e) {
      setFieldMsg('修改失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  function deleteField() {
    if (!ext || !selectedPath) return;
    var target = selectedPath;
    try {
      editor.value = ExtJson.del(editor.value, target);
      selectedPath = null;
      newValue.value = '';
      setStatus('已删除 ' + target, 'ok');
      setFieldMsg('已删除 1 个字段', 'ok');
      reindex();
      renderList();
      propRefresh();
    } catch (e) {
      setFieldMsg('删除失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  // ---------------- 事件绑定 ----------------
  btnOpen.addEventListener('click', function () { picker.click(); });

  picker.addEventListener('change', function () {
    var file = picker.files && picker.files[0];
    picker.value = '';
    if (file) openFile(file);
  });

  btnSave.addEventListener('click', saveFile);

  fmtSel.addEventListener('change', function () {
    nameInput.value = withExt(nameInput.value, fmtSel.value);
  });

  listEl.addEventListener('click', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('.row') : null;
    if (!row || !row.dataset.path) return;
    selectPath(row.dataset.path, true);
    setFieldMsg('');
  });

  var searchTimer = 0;
  qInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 120);
  });
  typeFilter.addEventListener('change', function () { renderList(); });

  newValue.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyEdit(); }
  });
  btnApply.addEventListener('click', applyEdit);
  btnDelete.addEventListener('click', deleteField);

  // 停止输入3秒后刷新路径
  editor.addEventListener('input', function () {
    updatePos();
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function () {
      if (window.LvlShell && !window.LvlShell.anyPanelVisible()) return;
      reindex();
      renderList();
      propRefresh();
    }, 3000);
  });
  ['keyup', 'click', 'select', 'focus'].forEach(function (ev) {
    editor.addEventListener(ev, updatePos);
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'o') { e.preventDefault(); picker.click(); }
    else if (k === 's') { e.preventDefault(); saveFile(); }
  });

  // 拖放打开
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    e.preventDefault(); dragDepth++; document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', function (e) {
    if (e.dataTransfer) e.preventDefault();
  });
  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // 给属性表（js/lvl-props.js）提供的最小桥接
  window.LvlApp = {
    getEditor: function () { return editor.value; },
    setEditor: function (text) { editor.value = text; updatePos(); },
    getExt: function () { return ext; },
    reindex: reindex,
    renderList: renderList,
    refreshAll: function () { reindex(); renderList(); },
    setStatus: setStatus,
    scrollTo: function (path) { scrollEditorTo(path); }
  };

  // 外壳切面板时回调本模块刷新
  if (window.LvlShell && window.LvlShell.onActivate) {
    window.LvlShell.onActivate(onPanelActivate);
  }

  setPath('');
  updatePos();
})();
