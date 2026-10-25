/*!
 * lvl-props.js — V3 关卡属性表 + 收藏栏
 * 依赖：window.LVL_PROPS_V3（由 js/lvl-props-v3.data.js 提供，数据源 data/level_props_v3.csv）
 *        window.LvlApp（由 js/lvl-converter.js 提供桥接）、window.ExtJson
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var favBar = $('favBar'), propTable = $('propTable');
  var propSearch = $('propSearch'), btnFavOnly = $('btnFavOnly'), propCount = $('propCount');

  var STORE_KEY = 'mvz2.lvlFavProps';
  var favIds = loadFavs();
  var favOnly = false;
  var searchTimer = 0;

  function loadFavs() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveFavs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(favIds)); } catch (e) { /* 忽略 */ }
  }
  function isFav(id) { return favIds.indexOf(id) >= 0; }
  function toggleFav(id) {
    var i = favIds.indexOf(id);
    if (i >= 0) favIds.splice(i, 1); else favIds.push(id);
    saveFavs();
    renderAll();
  }

  function getData() { return window.LVL_PROPS_V3 || []; }
  function getExt() { return window.LvlApp && window.LvlApp.getExt ? window.LvlApp.getExt() : null; }

  function isV3() {
    var ext = getExt();
    return !!(ext && ext.has && ext.has('1.level'));
  }

  // 读取当前值 → { found, text, checked }；cardpool 额外带 count
  function readValue(def) {
    var ext = getExt();
    if (!ext) return { found: false, text: '', checked: false };
    if (def.type === 'cardpool') {
      var pool = (window.LvlCards && window.LvlCards.readPool) ? window.LvlCards.readPool(ext, def.path) : [];
      return { found: !!ext.has(def.path), count: pool.length, text: pool.length + ' 项', checked: false };
    }
    if (!ext.has(def.path)) return { found: false, text: '', checked: false };
    try {
      if (def.type === 'numberlong') {
        var v = ext.getValue(def.path);
        if (v && v.__type__ === 'NumberLong') return { found: true, text: String(v.value), checked: false };
        return { found: true, text: v == null ? '' : String(v), checked: false };
      }
      if (def.type === 'bool') {
        var b = ext.getValue(def.path);
        return { found: true, text: b ? 'true' : 'false', checked: !!b };
      }
      if (def.type === 'json') {
        return { found: true, text: ext.get(def.path), checked: false };
      }
      var gv = ext.getValue(def.path);
      return {
        found: true,
        text: gv == null ? 'null' : (typeof gv === 'string' ? gv : String(gv)),
        checked: false
      };
    } catch (e) {
      return { found: false, text: '', checked: false };
    }
  }

  // 把用户输入转成可写回原文的 JSON 字面量
  function buildLiteral(def, raw) {
    var t = String(raw == null ? '' : raw).trim();
    if (def.type === 'numberlong') {
      if (!/^-?\d+$/.test(t)) throw new Error(def.name + ' 需要是整数');
      return 'NumberLong(' + t + ')';
    }
    if (def.type === 'int') {
      if (!/^-?\d+$/.test(t)) throw new Error(def.name + ' 需要是整数');
      return t;
    }
    if (def.type === 'float') {
      if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) throw new Error(def.name + ' 需要是数字');
      return t;
    }
    if (def.type === 'string') return JSON.stringify(raw == null ? '' : raw);
    if (def.type === 'json') return t; // ExtJson.set 内部校验（含 NumberLong）
    throw new Error('未知类型：' + def.type);
  }

  function applyEdit(def, value) {
    var ext = getExt();
    if (!ext || !ext.has(def.path)) {
      window.LvlApp.setStatus('无法修改：字段不存在（' + def.path + '）', 'warn');
      return;
    }
    var lit;
    try {
      lit = def.type === 'bool' ? (value ? 'true' : 'false') : buildLiteral(def, value);
      if (ext.get(def.path) === lit) return; // 值没变，不重写
      var newText = window.ExtJson.set(window.LvlApp.getEditor(), def.path, lit);
      window.LvlApp.setEditor(newText);
      window.LvlApp.refreshAll();
      renderAll();
      window.LvlApp.setStatus('已修改 ' + def.name + ' → ' + lit, 'ok');
    } catch (e) {
      window.LvlApp.setStatus('修改 ' + def.name + ' 失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  function typeBadge(def) {
    var map = {
      string: '字符串', int: '整数', float: '小数',
      bool: '布尔', numberlong: 'NumberLong', json: 'JSON', cardpool: '卡片'
    };
    return map[def.type] || def.type;
  }

  function makeControl(def, state, compact) {
    if (def.type === 'cardpool') {
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'prop-cardedit';
      editBtn.textContent = '编辑（' + (state.count || 0) + '）';
      editBtn.title = (def.desc || def.name) + '\n点击用卡片编辑：' + def.path;
      editBtn.disabled = !isV3() || def.readonly;
      editBtn.addEventListener('click', function () {
        if (window.LvlCards && window.LvlCards.open) window.LvlCards.open(def);
      });
      return editBtn;
    }

    if (def.type === 'bool') {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!state.checked;
      cb.disabled = !state.found || def.readonly;
      cb.title = def.desc || def.name;
      cb.addEventListener('change', function () { applyEdit(def, cb.checked); });
      return cb;
    }

    if (def.options && def.options.length && (def.type === 'string' || def.type === 'int')) {
      var sel = document.createElement('select');
      var cur = state.text;
      var hasCur = false;
      def.options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === cur) hasCur = true;
        sel.appendChild(opt);
      });
      if (!hasCur && state.found) {
        var extra = document.createElement('option');
        extra.value = cur;
        extra.textContent = cur;
        sel.appendChild(extra);
      }
      sel.value = cur;
      sel.disabled = !state.found || def.readonly;
      sel.title = def.desc || def.name;
      sel.addEventListener('change', function () { applyEdit(def, sel.value); });
      return sel;
    }

    var inp = document.createElement('input');
    if (def.type === 'int' || def.type === 'float') inp.type = 'number';
    else { inp.type = 'text'; }
    if (def.type === 'numberlong') inp.inputMode = 'numeric';
    inp.value = state.found ? state.text : '';
    inp.placeholder = state.found ? '' : '未设置';
    inp.disabled = !state.found || def.readonly;
    inp.title = def.desc || def.name;
    inp.addEventListener('change', function () {
      if (inp.value !== state.text) applyEdit(def, inp.value);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
    return inp;
  }

  function renderRow(def, compact) {
    var state = readValue(def);
    var row = document.createElement('div');
    row.className = 'prop-row' + (compact ? ' compact' : '') + (state.found ? '' : ' missing');

    var star = document.createElement('button');
    star.type = 'button';
    star.className = 'prop-star' + (isFav(def.id) ? ' on' : '');
    star.textContent = isFav(def.id) ? '★' : '☆';
    star.title = isFav(def.id) ? '取消收藏' : '收藏';
    star.addEventListener('click', function () { toggleFav(def.id); });
    row.appendChild(star);

    var nameEl = document.createElement('div');
    nameEl.className = 'prop-name';
    nameEl.textContent = def.name;
    nameEl.title = def.desc || def.path;
    row.appendChild(nameEl);

    row.appendChild(makeControl(def, state, compact));

    var badge = document.createElement('span');
    badge.className = 'prop-badge b-' + def.type;
    badge.textContent = typeBadge(def);
    row.appendChild(badge);

    if (!compact) {
      var loc = document.createElement('button');
      loc.type = 'button';
      loc.className = 'prop-locate';
      loc.textContent = '定位';
      loc.title = '在 JSON 里定位：' + def.path;
      loc.disabled = !state.found;
      loc.addEventListener('click', function () {
        if (window.LvlApp && window.LvlApp.scrollTo) window.LvlApp.scrollTo(def.path);
      });
      row.appendChild(loc);
    }

    return row;
  }

  function msg(text) {
    var d = document.createElement('div');
    d.className = 'prop-msg';
    d.textContent = text;
    return d;
  }

  function renderFavBar() {
    favBar.textContent = '';
    var favs = getData().filter(function (d) { return isFav(d.id); });
    if (!favs.length) { favBar.hidden = true; return; }
    favBar.hidden = false;

    var head = document.createElement('div');
    head.className = 'fav-bar-title';
    head.textContent = '⭐ 收藏栏';
    favBar.appendChild(head);

    favs.forEach(function (def) { favBar.appendChild(renderRow(def, true)); });
  }

  function renderTable() {
    propTable.textContent = '';
    var data = getData();
    if (!data.length) {
      propTable.appendChild(msg('未加载属性表数据（js/lvl-props-v3.data.js）。'));
      if (propCount) propCount.textContent = '';
      return;
    }
    if (!isV3()) {
      propTable.appendChild(msg('打开 V3 关卡文件（双 JSON 结构）后显示属性表。'));
      if (propCount) propCount.textContent = '';
      return;
    }

    var q = (propSearch.value || '').trim().toLowerCase();
    var groups = Object.create(null);
    var order = [];
    data.forEach(function (def) {
      var match = !q ||
        def.name.toLowerCase().indexOf(q) >= 0 ||
        def.id.toLowerCase().indexOf(q) >= 0 ||
        def.path.toLowerCase().indexOf(q) >= 0;
      if (favOnly && !isFav(def.id)) match = false;
      if (!match) return;
      if (!groups[def.group]) { groups[def.group] = []; order.push(def.group); }
      groups[def.group].push(def);
    });

    var shown = 0;
    order.forEach(function (g) {
      var gh = document.createElement('div');
      gh.className = 'prop-group';
      gh.textContent = g;
      propTable.appendChild(gh);
      groups[g].forEach(function (def) {
        propTable.appendChild(renderRow(def, false));
        shown++;
      });
    });

    if (!shown) propTable.appendChild(msg('没有匹配的属性。'));
    if (propCount) propCount.textContent = shown + ' / ' + data.length;
  }

  function renderAll() {
    renderFavBar();
    renderTable();
  }

  propSearch.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTable, 120);
  });
  btnFavOnly.addEventListener('click', function () {
    favOnly = !favOnly;
    btnFavOnly.classList.toggle('on', favOnly);
    btnFavOnly.textContent = favOnly ? '只看收藏 ★' : '只看收藏';
    renderTable();
  });

  window.LvlProps = {
    renderAll: renderAll,
    isV3: isV3,
    getFavIds: function () { return favIds.slice(); }
  };

  renderAll();
})();
