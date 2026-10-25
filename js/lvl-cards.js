/*!
 * lvl-cards.js — 卡片式数组编辑器（当前支持出怪池 enemyPool）
 *
 * 依赖：window.ExtJson、window.LvlApp（js/lvl-converter.js）、
 *       window.LVL_ZOMBIES（js/lvl-zombies.data.js）
 *
 * 出怪池在文件里的真实结构：
 *   1.level.properties["mvz2:level/enemyPool"] = {
 *     "_t": "PVZEngine.NamespaceID[], PVZEngine.Base",
 *     "_v": ["mvz2:zombie", ...]          // NamespaceID 字符串数组
 *   }
 * 没有这个 key = 空池（继承默认）；删空后把整个 key 移除。
 */
(function () {
  'use strict';

  var ExtJson = window.ExtJson;
  var IMG_BASE = 'resources_pck/shared/img/blueprints/';
  var WRAPPER_T = 'PVZEngine.NamespaceID[], PVZEngine.Base';

  // ---------------- 纯函数（无 DOM，便于回归测试） ----------------

  // 把「完整路径」拆成 { parent, key }：1.level.properties["mvz2:level/enemyPool"]
  function splitLast(path) {
    var m = /\[("(?:\\.|[^"\\])*")\]\s*$/.exec(path);
    if (m) return { parent: path.slice(0, m.index), key: JSON.parse(m[1]) };
    var dot = path.lastIndexOf('.');
    if (dot < 0) return null;
    return { parent: path.slice(0, dot), key: path.slice(dot + 1) };
  }

  // 读取出怪池：返回 NamespaceID 字符串数组（键缺失或 _v 缺失都视为空）
  function readPool(ext, path) {
    if (!ext || !ext.has(path)) return [];
    try {
      var v = ext.getValue(path + '._v');
      if (Array.isArray(v)) return v.map(function (x) { return String(x); });
    } catch (e) { /* 忽略 */ }
    return [];
  }

  // 在对象文本里插入一个新成员，不动其它字节（含末尾空白），保证 add→del 能原样还原
  function insertObjectMember(text, ext, parentPath, key, valueLiteral) {
    var span = ext.spanOf(parentPath);
    var start = span.start, end = span.end;
    var inner = text.slice(start + 1, end - 1);       // 去掉最外层的 { }
    var member = JSON.stringify(key) + ' : ' + valueLiteral;
    if (!inner.trim()) {
      return text.slice(0, start) + '{ ' + member + ' }' + text.slice(end);
    }
    var tailLen = inner.length - inner.trimEnd().length;   // 末尾空白
    var core = inner.slice(0, inner.length - tailLen);
    var tail = inner.slice(inner.length - tailLen);
    return text.slice(0, start) + '{' + core + ',' + member + tail + '}' + text.slice(end);
  }

  // 写回出怪池：arr 为空时若键存在则删除；键缺失且 arr 非空则新建整个包装对象
  function writePool(text, ext, path, arr) {
    var arrLit = JSON.stringify(arr);
    if (!ext.has(path)) {
      if (arr.length === 0) return text;
      var parts = splitLast(path);
      if (!parts) throw new Error('无法解析容器路径：' + path);
      if (!ext.has(parts.parent)) throw new Error('容器不存在：' + parts.parent);
      var wrapper = '{"_t":' + JSON.stringify(WRAPPER_T) + ',"_v":' + arrLit + '}';
      return insertObjectMember(text, ext, parts.parent, parts.key, wrapper);
    }
    if (arr.length === 0) return ExtJson.del(text, path);
    return ExtJson.set(text, path + '._v', arrLit);
  }

  // ---------------- 库 ----
  function zombies() { return window.LVL_ZOMBIES || []; }
  function lookup(id) {
    var list = zombies();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function nameOf(id) { var z = lookup(id); return z ? (z.zh || z.en || id) : id; }
  function imgOf(id) { var z = lookup(id); return z && z.img ? IMG_BASE + z.img : ''; }

  // ---------------- 弹窗状态 ----
  var def = null, current = [], modalEl = null;
  var libEl = null, poolEl = null, countEl = null, searchEl = null;

  function makeIcon(id) {
    var img = document.createElement('img');
    img.className = 'zcard-ico';
    img.alt = '';
    var src = imgOf(id);
    if (src) img.src = src;
    img.onerror = function () { img.style.display = 'none'; };
    return img;
  }

  function commit(next) {
    var app = window.LvlApp;
    var ext = app.getExt();
    if (!ext) { app.setStatus('尚未打开 V3 文件', 'warn'); return false; }
    try {
      var text = writePool(app.getEditor(), ext, def.path, next);
      app.setEditor(text);
      app.refreshAll();
      if (window.LvlProps && window.LvlProps.renderAll) window.LvlProps.renderAll();
      return true;
    } catch (e) {
      app.setStatus('修改出怪池失败：' + (e && e.message ? e.message : e), 'err');
      return false;
    }
  }

  function addTo(id) {
    var next = current.concat([id]);
    if (commit(next)) { current = next; renderPool(); }
  }
  function removeAt(i) {
    if (i < 0 || i >= current.length) return;
    var next = current.slice(); next.splice(i, 1);
    if (commit(next)) { current = next; renderPool(); }
  }
  function clearAll() {
    if (!current.length) return;
    if (commit([])) { current = []; renderPool(); }
  }
  function copyIds() {
    var text = current.join(',');
    try { if (window.navigator && window.navigator.clipboard) window.navigator.clipboard.writeText(text); } catch (e) { /* 忽略 */ }
    window.LvlApp.setStatus('已复制出怪池 ID（' + current.length + ' 项）', 'ok');
  }

  function renderPool() {
    poolEl.textContent = '';
    countEl.textContent = String(current.length);
    current.forEach(function (id, i) {
      var item = document.createElement('div');
      item.className = 'pitem';
      item.appendChild(makeIcon(id));
      var nm = document.createElement('span');
      nm.className = 'pitem-name';
      nm.textContent = nameOf(id);
      item.appendChild(nm);
      var idEl = document.createElement('span');
      idEl.className = 'pitem-id';
      idEl.textContent = id;
      item.appendChild(idEl);
      var del = document.createElement('span');
      del.className = 'pitem-del';
      del.textContent = '×';
      item.appendChild(del);
      item.title = '点击移除 ' + id;
      item.addEventListener('click', function () { removeAt(i); });
      poolEl.appendChild(item);
    });
    if (!current.length) {
      var empty = document.createElement('div');
      empty.className = 'pitem-empty';
      empty.textContent = '出怪池为空（未显式设置，游戏使用默认）';
      poolEl.appendChild(empty);
    }
  }

  function renderLib() {
    libEl.textContent = '';
    var q = (searchEl.value || '').trim().toLowerCase();
    var frag = document.createDocumentFragment();
    zombies().forEach(function (z) {
      if (q && (z.id + ' ' + (z.zh || '') + ' ' + (z.en || '')).toLowerCase().indexOf(q) < 0) return;
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'zcard';
      card.dataset.id = z.id;
      card.appendChild(makeIcon(z.id));
      var nm = document.createElement('span');
      nm.className = 'zcard-name';
      nm.textContent = z.zh || z.en || z.id;
      card.appendChild(nm);
      var idEl = document.createElement('span');
      idEl.className = 'zcard-id';
      idEl.textContent = z.id;
      card.appendChild(idEl);
      card.title = z.id;
      card.addEventListener('click', function () { addTo(z.id); });
      frag.appendChild(card);
    });
    libEl.appendChild(frag);
  }

  function close() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  function open(d) {
    def = d;
    var ext = window.LvlApp.getExt();
    current = ext ? readPool(ext, d.path) : [];

    modalEl = document.createElement('div');
    modalEl.className = 'cards-modal';

    var card = document.createElement('div');
    card.className = 'cards-modal-card';

    var head = document.createElement('div');
    head.className = 'cards-modal-head';
    var title = document.createElement('span');
    title.className = 'cards-modal-title';
    title.textContent = (d.name || '卡片编辑') + ' · ' + (d.path || '');
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cards-modal-close';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'cards-modal-body';

    // 左：卡片库
    var lib = document.createElement('div');
    lib.className = 'cards-lib';
    var libHead = document.createElement('div');
    libHead.className = 'cards-subhead';
    var libTitle = document.createElement('span');
    libTitle.className = 'cards-subtitle';
    libTitle.textContent = '卡片库（点击添加）';
    searchEl = document.createElement('input');
    searchEl.type = 'search';
    searchEl.className = 'cards-search';
    searchEl.placeholder = '搜索名称 / ID…';
    searchEl.autocomplete = 'off';
    libHead.appendChild(libTitle);
    libHead.appendChild(searchEl);
    libEl = document.createElement('div');
    libEl.className = 'cards-grid';
    lib.appendChild(libHead);
    lib.appendChild(libEl);

    // 右：当前出怪池
    var pool = document.createElement('div');
    pool.className = 'cards-pool';
    var poolHead = document.createElement('div');
    poolHead.className = 'cards-subhead';
    var poolTitle = document.createElement('span');
    poolTitle.className = 'cards-subtitle';
    poolTitle.textContent = '出怪池';
    countEl = document.createElement('span');
    countEl.className = 'cards-count';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cards-mini';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', clearAll);
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cards-mini';
    copyBtn.textContent = '复制 ID';
    copyBtn.addEventListener('click', copyIds);
    poolHead.appendChild(poolTitle);
    poolHead.appendChild(countEl);
    poolHead.appendChild(clearBtn);
    poolHead.appendChild(copyBtn);
    poolEl = document.createElement('div');
    poolEl.className = 'cards-pool-list';
    pool.appendChild(poolHead);
    pool.appendChild(poolEl);

    body.appendChild(lib);
    body.appendChild(pool);
    card.appendChild(head);
    card.appendChild(body);
    modalEl.appendChild(card);
    document.body.appendChild(modalEl);

    // 点空白处关闭
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) close(); });

    searchEl.addEventListener('input', renderLib);
    renderLib();
    renderPool();
  }

  window.LvlCards = {
    open: open,
    close: close,
    readPool: readPool,
    writePool: writePool,
    zombies: zombies
  };
})();
