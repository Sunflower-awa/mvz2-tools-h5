/*!
 * lvl-shell.js — 工作台外壳（布局层，不含业务逻辑）
 *
 * 结构：活动栏 | 侧边栏 | 可拖分割 | 主区域（编辑器组 1 + 编辑器组 2）｜输出面板
 * 面板用 <section class="panel" data-panel="id" data-title="标题"> 声明，
 * 可在「侧边栏」和「编辑器组 2」之间停靠（DOM 挪位置，不复制节点）。
 *
 * 依赖：无。业务脚本通过 window.LvlShell 控制布局。
 */
(function () {
  'use strict';

  var STORE = 'mvz2.lvlLayout';
  var MAX_LOG = 500;
  var LIMIT = {
    side: [180, 760],
    bottom: [80, 900],
    ratio: [0.2, 0.8]
  };

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

  var workbench, activityBar, side, sideHost, sideTabs, spSide;
  var editorArea, eg1, eg2, tabs2, host2, spGroup, btnSplit;
  var mainArea, bottomPanel, spBottom, logList, btnOutput;

  var panels = Object.create(null);   // id -> { id, el, title, dock }
  var state = null;
  var actCbs = [];
  var ready = false;

  // ---------------- 默认值 ----------------
  // 只有够宽才自动并排（否则三栏会把编辑器挤窄，反而更难受）
  var WIDE = 1500;

  function defaults() {
    var w = window.innerWidth || 900;
    var wide = w >= WIDE;
    return {
      sidebarW: 320,
      sidebarOpen: w >= 560,        // 手机竖屏默认收起侧边栏，别把编辑器挤没
      bottomH: 160,
      bottomOpen: false,
      ratio: 0.5,
      split: false,
      docks: { fields: 'sidebar', props: wide ? 'group2' : 'sidebar' },
      active: { sidebar: wide ? 'fields' : 'props', group2: 'props' }
    };
  }

  // ---------------- 持久化 ----------------
  function save() {
    var docks = Object.create(null);
    Object.keys(panels).forEach(function (id) { docks[id] = panels[id].dock; });
    state.docks = docks;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* 忽略 */ }
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return false; }
    if (!raw || typeof raw !== 'object') return false;

    if (isNum(raw.sidebarW)) state.sidebarW = raw.sidebarW;
    if (typeof raw.sidebarOpen === 'boolean') state.sidebarOpen = raw.sidebarOpen;
    if (isNum(raw.bottomH)) state.bottomH = raw.bottomH;
    if (typeof raw.bottomOpen === 'boolean') state.bottomOpen = raw.bottomOpen;
    if (isNum(raw.ratio)) state.ratio = clamp(raw.ratio, LIMIT.ratio[0], LIMIT.ratio[1]);

    if (raw.docks && typeof raw.docks === 'object') {
      Object.keys(panels).forEach(function (id) {
        state.docks[id] = raw.docks[id] === 'group2' ? 'group2' : 'sidebar';
      });
    }
    if (raw.active && typeof raw.active === 'object') {
      if (typeof raw.active.sidebar === 'string') state.active.sidebar = raw.active.sidebar;
      if (typeof raw.active.group2 === 'string') state.active.group2 = raw.active.group2;
    }
    return true;
  }

  // ---------------- 面板登记 ----------------
  function registerPanels() {
    var nodes = document.querySelectorAll('.panel[data-panel]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute('data-panel');
      panels[id] = {
        id: id,
        el: el,
        title: el.getAttribute('data-title') || id,
        dock: 'sidebar'
      };
    }
  }

  function placePanel(p) {
    var host = p.dock === 'group2' ? host2 : sideHost;
    if (p.el.parentNode !== host) host.appendChild(p.el);
  }

  function dockIds(where) {
    return Object.keys(panels).filter(function (id) { return panels[id].dock === where; });
  }

  // ---------------- 布局计算 ----------------
  function metrics() {
    var w = workbench.clientWidth || window.innerWidth || 1000;
    var act = activityBar.offsetWidth || 48;
    return { total: w, act: act, avail: Math.max(240, w - act) };
  }

  function maxSidebar() {
    var m = metrics();
    var reserve = state.split ? 2 * 240 : 300;
    return Math.max(LIMIT.side[0], Math.min(LIMIT.side[1], m.avail - reserve));
  }

  function sidebarShown() {
    return state.sidebarOpen && dockIds('sidebar').length > 0;
  }

  function dockVisible(where) {
    if (where === 'group2') return state.split;
    return sidebarShown();
  }

  function applyLayout() {
    if (!ready) return;
    var shown = sidebarShown();
    state.sidebarW = clamp(state.sidebarW, LIMIT.side[0], maxSidebar());

    workbench.style.setProperty('--sidebar-w', (shown ? Math.round(state.sidebarW) : 0) + 'px');
    workbench.style.setProperty('--split-w', shown ? '1px' : '0px');
    side.hidden = !shown;
    spSide.hidden = !shown;

    var maxBottom = Math.max(LIMIT.bottom[0], (mainArea.clientHeight || 600) - 120);
    state.bottomH = clamp(state.bottomH, LIMIT.bottom[0], maxBottom);
    workbench.style.setProperty('--bottom-h', Math.round(state.bottomH) + 'px');
    bottomPanel.hidden = !state.bottomOpen;
    spBottom.hidden = !state.bottomOpen;
    btnOutput.classList.toggle('on', state.bottomOpen);
    btnOutput.setAttribute('aria-pressed', state.bottomOpen ? 'true' : 'false');
  }

  function applyGroupRatio() {
    var r = state.split ? clamp(state.ratio, LIMIT.ratio[0], LIMIT.ratio[1]) : 1;
    workbench.style.setProperty('--g1', String(r));
    workbench.style.setProperty('--g2', String(state.split ? 1 - r : 1));
  }

  function syncSplitFlag() {
    state.split = dockIds('group2').length > 0;
    eg2.hidden = !state.split;
    spGroup.hidden = !state.split;
    btnSplit.setAttribute('aria-pressed', state.split ? 'true' : 'false');
    btnSplit.title = state.split ? '收起右侧编辑器组' : '拆分编辑器组（把当前面板移到右侧）';
    applyGroupRatio();
  }

  // ---------------- 激活 / 标签 ----------------
  function activeOf(where) {
    var id = state.active[where];
    if (id && panels[id] && panels[id].dock === where) return id;
    var first = dockIds(where)[0] || null;
    state.active[where] = first;
    return first;
  }

  function applyVisibility() {
    Object.keys(panels).forEach(function (id) {
      panels[id].el.hidden = state.active[panels[id].dock] !== id;
    });
  }

  function syncActivity() {
    var btns = document.querySelectorAll('#activityBar [data-act]');
    for (var i = 0; i < btns.length; i++) {
      var id = btns[i].getAttribute('data-act');
      var p = panels[id];
      var on = !!(p && state.active[p.dock] === id && dockVisible(p.dock));
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function fireActivate(id) {
    for (var i = 0; i < actCbs.length; i++) {
      try { actCbs[i](id); } catch (e) { /* 忽略 */ }
    }
  }

  function renderTabBar(bar, where, closable) {
    bar.textContent = '';
    var ids = dockIds(where);

    if (!ids.length) {
      if (where === 'sidebar') {
        var note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = '无面板 · 从左侧活动栏打开';
        bar.appendChild(note);
      }
      return;
    }

    ids.forEach(function (id) {
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'side-tab' + (state.active[where] === id ? ' on' : '');
      t.textContent = panels[id].title;
      t.title = panels[id].title;
      t.setAttribute('aria-selected', state.active[where] === id ? 'true' : 'false');
      t.addEventListener('click', function () { activate(id); });
      bar.appendChild(t);
    });

    if (closable) {
      var sp = document.createElement('div');
      sp.className = 'g-spacer';
      bar.appendChild(sp);
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'g-act';
      x.textContent = '×';
      x.title = '收起右侧编辑器组（面板移回侧边栏）';
      x.addEventListener('click', toggleSplit);
      bar.appendChild(x);
    }
  }

  function renderTabs() {
    renderTabBar(sideTabs, 'sidebar', false);
    renderTabBar(tabs2, 'group2', true);
  }

  function activate(id) {
    var p = panels[id];
    if (!p) return;
    state.active[p.dock] = id;
    applyVisibility();
    renderTabs();
    syncActivity();
    save();
    if (dockVisible(p.dock)) fireActivate(id);
  }

  // ---------------- 停靠 ----------------
  function dockPanel(id, where) {
    var p = panels[id];
    if (!p) return;
    var target = where === 'group2' ? 'group2' : 'sidebar';
    if (p.dock === target) return;

    p.dock = target;
    placePanel(p);
    state.active[target] = id;
    if (target === 'sidebar') state.sidebarOpen = true;

    syncSplitFlag();
    activeOf('sidebar');
    activeOf('group2');
    applyLayout();
    applyVisibility();
    renderTabs();
    syncActivity();
    save();
    fireActivate(id);
  }

  function toggleSplit() {
    var id = state.active.group2;
    if (state.split) {
      // 收起：把右侧面板全部搬回侧边栏
      dockIds('group2').forEach(function (pid) {
        panels[pid].dock = 'sidebar';
        placePanel(panels[pid]);
        id = pid;
      });
      if (id) state.active.sidebar = id;
      state.sidebarOpen = true;
    } else {
      // 展开：把侧边栏当前面板移到右侧
      id = activeOf('sidebar') || Object.keys(panels)[0] || null;
      if (!id) return;
      panels[id].dock = 'group2';
      placePanel(panels[id]);
      state.active.group2 = id;
    }

    syncSplitFlag();
    activeOf('sidebar');
    activeOf('group2');
    applyLayout();
    applyVisibility();
    renderTabs();
    syncActivity();
    save();
    if (id) fireActivate(id);
  }

  function reveal(id) {
    var p = panels[id];
    if (!p) return;
    if (p.dock === 'sidebar') state.sidebarOpen = true;
    applyLayout();
    activate(id);
  }

  function toggleSidebar() {
    if (sidebarShown()) {
      state.sidebarOpen = false;
    } else {
      state.sidebarOpen = true;
      if (!dockIds('sidebar').length) {
        // 侧边栏空了，把某个面板挪回来，否则打开也是空白
        var back = state.active.group2 || Object.keys(panels)[0];
        if (back && panels[back]) {
          panels[back].dock = 'sidebar';
          placePanel(panels[back]);
          state.active.sidebar = back;
          syncSplitFlag();
          activeOf('group2');
        }
      }
    }
    applyLayout();
    applyVisibility();
    renderTabs();
    syncActivity();
    save();
  }

  function setBottomOpen(on) {
    state.bottomOpen = !!on;
    applyLayout();
    save();
  }
  function toggleBottom() { setBottomOpen(!state.bottomOpen); }

  function resetLayout() {
    var d = defaults();
    state.sidebarW = d.sidebarW;
    state.sidebarOpen = d.sidebarOpen;
    state.bottomH = d.bottomH;
    state.bottomOpen = d.bottomOpen;
    state.ratio = d.ratio;
    Object.keys(panels).forEach(function (id) {
      panels[id].dock = d.docks[id] === 'group2' ? 'group2' : 'sidebar';
      placePanel(panels[id]);
    });
    state.active = d.active;
    syncSplitFlag();
    activeOf('sidebar');
    activeOf('group2');
    applyLayout();
    applyVisibility();
    renderTabs();
    syncActivity();
    save();
    log('布局已重置', 'ok');
    var cur = state.active.sidebar || state.active.group2;
    if (cur) fireActivate(cur);
  }

  // ---------------- 分割条拖动 ----------------
  function bindSplitter(el, axis, snapshot, move, reset) {
    var drag = null;

    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, snap: snapshot() };
      el.classList.add('dragging');
      document.body.classList.add(axis === 'x' ? 'resizing-v' : 'resizing-h');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      move(e.clientX - drag.x, e.clientY - drag.y, drag.snap);
    });

    function end(e) {
      if (!drag) return;
      drag = null;
      el.classList.remove('dragging');
      document.body.classList.remove('resizing-v', 'resizing-h');
      if (e && e.pointerId != null) {
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
      save();
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', function () { end(null); });

    el.addEventListener('dblclick', function () {
      reset();
      applyLayout();
      save();
    });
  }

  function bindSplitters() {
    bindSplitter(spSide, 'x',
      function () { return { w: state.sidebarW }; },
      function (dx, dy, s) {
        state.sidebarW = clamp(s.w + dx, LIMIT.side[0], maxSidebar());
        applyLayout();
      },
      function () { state.sidebarW = defaults().sidebarW; }
    );

    bindSplitter(spGroup, 'x',
      function () { return { r: state.ratio, w: editorArea.clientWidth || 1 }; },
      function (dx, dy, s) {
        var r = s.r + dx / Math.max(1, s.w);
        state.ratio = clamp(r, LIMIT.ratio[0], LIMIT.ratio[1]);
        applyGroupRatio();
        save();
      },
      function () { state.ratio = defaults().ratio; applyGroupRatio(); }
    );

    bindSplitter(spBottom, 'y',
      function () {
        return { h: state.bottomH, max: Math.max(LIMIT.bottom[0], (mainArea.clientHeight || 600) - 120) };
      },
      function (dx, dy, s) {
        state.bottomH = clamp(s.h - dy, LIMIT.bottom[0], s.max);
        applyLayout();
      },
      function () { state.bottomH = defaults().bottomH; }
    );
  }

  // ---------------- 按钮 / 快捷键 ----------------
  function bindButtons() {
    var acts = document.querySelectorAll('#activityBar [data-act]');
    for (var i = 0; i < acts.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { reveal(btn.getAttribute('data-act')); });
      })(acts[i]);
    }

    var toggles = document.querySelectorAll('#activityBar [data-act-toggle]');
    for (var j = 0; j < toggles.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var what = btn.getAttribute('data-act-toggle');
          if (what === 'sidebar') toggleSidebar();
          else if (what === 'bottom') toggleBottom();
        });
      })(toggles[j]);
    }

    // 面板头部的「停靠」按钮
    var docks = document.querySelectorAll('[data-dock]');
    for (var k = 0; k < docks.length; k++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-dock');
          var p = panels[id];
          if (!p) return;
          dockPanel(id, p.dock === 'group2' ? 'sidebar' : 'group2');
        });
      })(docks[k]);
    }

    var r = $('btnLayoutReset');
    if (r) r.addEventListener('click', resetLayout);
    if (btnSplit) btnSplit.addEventListener('click', toggleSplit);

    var cb = $('btnCloseBottom');
    if (cb) cb.addEventListener('click', function () { setBottomOpen(false); });
    if (btnOutput) btnOutput.addEventListener('click', toggleBottom);
    var cl = $('btnClearLog');
    if (cl) cl.addEventListener('click', function () { logList.textContent = ''; });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = (e.key || '').toLowerCase();
      if (e.shiftKey) {
        if (k === 'e') { e.preventDefault(); reveal('fields'); }
        else if (k === 'p') { e.preventDefault(); reveal('props'); }
        return;
      }
      if (k === 'b') { e.preventDefault(); toggleSidebar(); }
      else if (k === 'j') { e.preventDefault(); toggleBottom(); }
    });
  }

  // ---------------- 窄面板自适应 ----------------
  function observePanels() {
    if (typeof ResizeObserver !== 'function') return;
    var ro = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i].target;
        var w = entries[i].contentRect ? entries[i].contentRect.width : 0;
        if (!w) continue;                       // 隐藏时宽度为 0，保留上次状态
        el.classList.toggle('narrow', w < 400);
        el.classList.toggle('tiny', w < 300);
      }
    });
    Object.keys(panels).forEach(function (id) { ro.observe(panels[id].el); });
  }

  // ---------------- 输出日志 ----------------
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function log(text, kind) {
    if (!logList || !kind) return;             // 只记录有分类的结果，避免进度噪声
    var row = document.createElement('div');
    row.className = 'log-row ' + kind;
    var d = new Date();
    row.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
                      '  ' + text;
    logList.appendChild(row);
    while (logList.childElementCount > MAX_LOG) logList.removeChild(logList.firstElementChild);
    logList.scrollTop = logList.scrollHeight;
  }

  // ---------------- 对外接口 ----------------
  function isVisible(id) {
    var p = panels[id];
    return !!(p && !p.el.hidden && dockVisible(p.dock));
  }
  function anyPanelVisible() {
    return Object.keys(panels).some(function (id) { return isVisible(id); });
  }

  window.LvlShell = {
    reveal: reveal,
    dockPanel: dockPanel,
    toggleSplit: toggleSplit,
    toggleSidebar: toggleSidebar,
    setBottomOpen: setBottomOpen,
    toggleBottom: toggleBottom,
    resetLayout: resetLayout,
    log: log,
    isVisible: isVisible,
    anyPanelVisible: anyPanelVisible,
    onActivate: function (cb) { if (typeof cb === 'function') actCbs.push(cb); },
    activeOf: activeOf,
    isReady: function () { return ready; },
    state: function () { return JSON.parse(JSON.stringify(state)); }
  };

  // ---------------- 启动 ----------------
  function init() {
    workbench = $('workbench');
    activityBar = $('activityBar');
    side = $('sidebar');
    sideHost = $('sideHost');
    sideTabs = $('sideTabs');
    spSide = $('spSide');
    editorArea = $('editorArea');
    eg1 = $('egroup1');
    eg2 = $('egroup2');
    tabs2 = $('tabsGroup2');
    host2 = $('group2Host');
    spGroup = $('spGroup');
    btnSplit = $('btnSplit');
    mainArea = $('mainArea');
    bottomPanel = $('bottomPanel');
    spBottom = $('spBottom');
    logList = $('logList');
    btnOutput = $('btnOutput');

    if (!workbench) return;

    state = defaults();
    registerPanels();

    load();
    Object.keys(panels).forEach(function (id) {
      // state.docks 已经合并了默认值或上次保存的布局
      panels[id].dock = state.docks[id] === 'group2' ? 'group2' : 'sidebar';
      placePanel(panels[id]);
    });

    syncSplitFlag();
    activeOf('sidebar');
    activeOf('group2');
    applyVisibility();
    renderTabs();

    ready = true;
    applyLayout();
    syncActivity();

    bindSplitters();
    bindButtons();
    bindKeys();
    observePanels();

    window.addEventListener('resize', function () { applyLayout(); });

    save();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
