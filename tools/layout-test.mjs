#!/usr/bin/env node
/*
 * layout-test.mjs — 无浏览器环境下的工作台验证
 *
 * 沙箱里 Edge/Chrome 起不来（mojo 命名管道被拦），所以用最小 DOM shim
 * 解析 lvl-converter.html、按页面顺序执行脚本，再断言布局与业务行为。
 *
 * 用法：
 *   node tools/layout-test.mjs            # 宽屏 1400px
 *   $env:W=700; node tools/layout-test.mjs   # 窄屏
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIDTH = Number(process.env.W || 1400);

// ---------------------------------------------------------------- DOM shim
const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr', 'source',
  'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', nbsp: ' ', '#39': "'" };
const decodeEnt = (s) => s.replace(/&(lt|gt|amp|quot|nbsp|#39);/g, (m, n) => ENT[n]);

class ClassList {
  constructor(el) { this.el = el; this.s = new Set(); }
  _sync() { this.el._class = [...this.s].join(' '); }
  add(...n) { n.forEach((x) => this.s.add(x)); this._sync(); }
  remove(...n) { n.forEach((x) => this.s.delete(x)); this._sync(); }
  contains(n) { return this.s.has(n); }
  toggle(n, force) {
    const want = force === undefined ? !this.s.has(n) : !!force;
    if (want) this.s.add(n); else this.s.delete(n);
    this._sync();
    return want;
  }
  get value() { return [...this.s].join(' '); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this._class = '';
    this.attrs = Object.create(null);
    this._lis = Object.create(null);
    this.classList = new ClassList(this);
    this.dataset = Object.create(null);
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.type = '';
    this.files = null;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.offsetWidth = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this._class; }
  set className(v) {
    this._class = String(v == null ? '' : v);
    this.classList.s = new Set(this._class.split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v) {
    this.children.length = 0;
    this._text = v == null ? '' : String(v);
  }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(c) {
    if (c.tagName === '#FRAGMENT') {          // DocumentFragment：搬孩子
      const kids = c.children.slice();
      c.children.length = 0;
      kids.forEach((k) => this.appendChild(k));
      return c;
    }
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this._text = '';
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    const s = String(v);
    this.attrs[k] = s;
    if (k.startsWith('data-')) {
      this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = s;
    }
    if (k === 'class') this.className = s;
    if (k === 'hidden') this.hidden = true;
    if (k === 'disabled') this.disabled = true;
    if (k === 'type') this.type = s;
    if (k === 'value') this.value = s;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this._lis[t] || (this._lis[t] = [])).push(fn); }
  removeEventListener(t, fn) {
    const a = this._lis[t];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  closest(sel) {
    const c = parseCompound(sel);
    let n = this;
    while (n) {
      if (n instanceof El && matchesSel(n, c)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  blur() {}
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  click() { fire(this, 'click', {}); }
}

const ID_MAP = Object.create(null);

class Doc extends El {
  constructor() { super('#document'); this.readyState = 'complete'; this._body = null; }
  createElement(tag) {
    if (tag === 'canvas') {                 // 供 scrollEditorTo 测量文本宽度
      return { getContext: () => ({ font: '', measureText: (s) => ({ width: s.length * 7.8 }) }) };
    }
    return new El(tag);
  }
  createTextNode(t) { const e = new El('#text'); e._text = String(t); return e; }
  createDocumentFragment() { return new El('#fragment'); }
  get body() { return this._body; }
  getElementById(id) { return ID_MAP[id] || null; }
}

// ---- 选择器 ----
function parseCompound(s) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  const m = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(s);
  if (m) { out.tag = m[0].toUpperCase(); i = m[0].length; }
  while (i < s.length) {
    const c = s[i];
    if (c === '.') {
      const v = /^[^.#[]+/.exec(s.slice(i + 1));
      if (!v) break;
      out.classes.push(v[0]); i += 1 + v[0].length;
    } else if (c === '#') {
      const v = /^[^.#[]+/.exec(s.slice(i + 1));
      if (!v) break;
      out.id = v[0]; i += 1 + v[0].length;
    } else if (c === '[') {
      const end = s.indexOf(']', i);
      const body = s.slice(i + 1, end);
      const eq = body.indexOf('=');
      if (eq < 0) out.attrs.push([body.trim(), null]);
      else out.attrs.push([body.slice(0, eq).trim(), body.slice(eq + 1).replace(/^["']|["']$/g, '')]);
      i = end + 1;
    } else i++;
  }
  return out;
}

function matchesSel(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const [k, v] of c.attrs) {
    const got = el.getAttribute(k);
    if (got == null) return false;
    if (v != null && got !== v) return false;
  }
  return true;
}

function collect(node, c, out) {
  for (const ch of node.children) {
    if (matchesSel(ch, c)) out.push(ch);
    collect(ch, c, out);
  }
}

function queryAll(root, selector) {
  let cur = [root];
  for (const part of selector.trim().split(/\s+/)) {
    const c = parseCompound(part);
    const next = [];
    for (const n of cur) collect(n, c, next);
    if (!next.length) return [];
    cur = next;
  }
  return cur;
}

// ---- HTML 解析（够用就行：本页结构规整）----
function parseAttrs(s, el) {
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    const v = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    el.setAttribute(k, decodeEnt(v));
  }
}

function parseHTML(html) {
  const root = new Doc();
  const stack = [root];
  let i = 0;
  const lower = html.toLowerCase();

  const pushText = (t) => {
    if (!t) return;
    stack[stack.length - 1]._text += decodeEnt(t);
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) { i = html.indexOf('>', lt) + 1; continue; }

    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    let raw = html.slice(lt + 1, gt);
    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1).trimEnd();

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tagName.toLowerCase() === name) { stack.length = k; break; }
      }
      i = gt + 1;
      continue;
    }

    const m = /^([a-zA-Z0-9-]+)([\s\S]*)$/.exec(raw);
    if (!m) { i = gt + 1; continue; }
    const tag = m[1].toLowerCase();
    const el = new El(tag);
    parseAttrs(m[2], el);
    stack[stack.length - 1].appendChild(el);
    if (el.id) ID_MAP[el.id] = el;
    if (tag === 'body') root._body = el;
    i = gt + 1;

    if (tag === 'script' || tag === 'style') {
      const close = lower.indexOf('</' + tag, i);
      const end = close < 0 ? html.length : close;
      el._text = html.slice(i, end);
      i = close < 0 ? html.length : html.indexOf('>', close) + 1;
      continue;
    }
    if (!VOID.has(tag) && !selfClose) stack.push(el);
  }
  return root;
}

// ---------------------------------------------------------------- 环境
const doc = parseHTML(fs.readFileSync(path.join(ROOT, 'lvl-converter.html'), 'utf8'));

const winLis = Object.create(null);
const store = new Map();

Object.assign(globalThis, {
  window: globalThis,
  document: doc,
  innerWidth: WIDTH,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(t, fn) { (winLis[t] || (winLis[t] = [])).push(fn); },
  removeEventListener() {},
  getComputedStyle: () => ({ lineHeight: '20px', font: '13px monospace' }),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});

function fire(el, type, ev) {
  const e = Object.assign({
    type, target: el, preventDefault() {}, stopPropagation() {},
    ctrlKey: false, metaKey: false, shiftKey: false, key: '',
    button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0,
  }, ev || {});
  for (const fn of ((el._lis && el._lis[type]) || []).slice()) fn.call(el, e);
  return e;
}

function keydown(key, mods) {
  fire(doc, 'keydown', Object.assign({ key }, mods || {}));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 跑脚本
for (const f of ['js/extjson.js', 'js/lvl-shell.js', 'js/lvl-converter.js',
                 'js/lvl-props-v3.data.js', 'js/lvl-zombies.data.js',
                 'js/lvl-cards.js', 'js/lvl-props.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

// ---------------------------------------------------------------- 断言
const results = [];
function ok(name, cond, detail) {
  results.push({ pass: !!cond, name, detail: cond ? '' : (detail == null ? '' : String(detail)) });
}
function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ pass, name: `${name} = ${JSON.stringify(expected)}`, detail: pass ? '' : `实际 ${JSON.stringify(actual)}` });
}

const $ = (id) => doc.getElementById(id);
const Shell = window.LvlShell;
const App = window.LvlApp;
const Props = window.LvlProps;

// 与 js/lvl-shell.js 里 maxSidebar() 一致的侧边栏上限
const maxSide = (split) => Math.max(180,
  Math.min(760, Math.max(240, WIDTH - 48) - (split ? 2 * 240 : 300)));

// 可选：打印初始化后的 DOM 骨架，方便肉眼检查停靠结果
if (process.env.DUMP) {
  const skip = new Set(['A', 'P', 'SELECT', 'OPTION', 'BUTTON', 'LABEL', 'NAV', 'ASIDE', 'HEADER', 'MAIN', 'SECTION']);
  (function walk(n, d) {
    for (const c of n.children) {
      if (c.id || ['DIV', 'SECTION'].includes(c.tagName)) {
        const flags = [c.hidden ? 'hidden' : '', c.className].filter(Boolean).join(' ');
        console.log('  '.repeat(d) + c.tagName.toLowerCase() +
          (c.id ? '#' + c.id : '') + (flags ? ' [' + flags + ']' : ''));
      }
      walk(c, d + 1);
    }
  })(doc, 0);
}

// 默认策略：≥1500px 才自动并排；<560px 默认收起侧边栏
const WIDE = WIDTH >= 1500;
const DEF_OPEN = WIDTH >= 560;

// ---- 1. 结构 ----
ok('外壳已初始化', Shell && Shell.isReady());
ok('活动栏存在', !!$('activityBar'));
ok('侧边栏存在', !!$('sidebar'));
ok('分割条 3 个', queryAll(doc, '.splitter').length === 3, queryAll(doc, '.splitter').length);
eq('面板数量', queryAll(doc, '.panel[data-panel]').length, 2);
const visible0 = ['fields', 'props'].filter((id) => Shell.isVisible(id)).length;
eq('默认可见面板数', visible0, WIDE ? 2 : (DEF_OPEN ? 1 : 0));

const st0 = Shell.state();
eq('默认 属性表停靠', st0.docks.props, WIDE ? 'group2' : 'sidebar');
eq('默认 字段停靠', st0.docks.fields, 'sidebar');
eq('默认 是否并排', st0.split, WIDE);
eq('默认 侧边栏展开', !$('sidebar').hidden, DEF_OPEN);
eq('egroup2 隐藏', $('egroup2').hidden, !WIDE);
eq('分组分割条隐藏', $('spGroup').hidden, !WIDE);
eq('侧边栏宽度', $('workbench').style['--sidebar-w'],
  (DEF_OPEN ? Math.min(320, maxSide(WIDE)) : 0) + 'px');
eq('侧边栏标签数', queryAll($('sideTabs'), '.side-tab').length, WIDE ? 1 : 2);

if (WIDE) {
  ok('两侧面板都可见', Shell.isVisible('props') && Shell.isVisible('fields'));
} else if (DEF_OPEN) {
  ok('属性表可见（侧边栏）', Shell.isVisible('props'));
  ok('字段列表未激活', !Shell.isVisible('fields'));
} else {
  ok('手机 面板默认收起', !Shell.isVisible('props') && !Shell.isVisible('fields'));
}

// ---- 2. 打开真实 .lvl ----
const picker = $('picker');
picker.files = [{
  name: 'castle_5.lvl',
  arrayBuffer: async () => new Uint8Array(
    fs.readFileSync(path.join(ROOT, 'mvz2_file', '关卡文件', 'castle_5.lvl'))),
}];
fire(picker, 'change', {});
await sleep(400);

const statusText = $('status').textContent;
ok('打开成功', statusText.startsWith('已打开'), statusText);
eq('状态栏 ok 类', $('status').className, 'ok');
ok('breadcrumb 显示文件名', $('filePath').textContent.includes('castle_5.lvl'), $('filePath').textContent);
eq('breadcrumb 高亮', $('filePath').classList.contains('hasFile'), true);
ok('extjson 已索引', !!App.getExt() && App.getExt().has('1.level'));
eq('字段列表行数 > 0', queryAll($('list'), '.row').length > 0, true);

const propRows = () => queryAll($('propTable'), '.prop-row');
const propGroups = () => queryAll($('propTable'), '.prop-group');
eq('属性表按类型渲染行数', propRows().length, 34);
eq('属性表分组数', propGroups().length, 8);
eq('属性计数文案', $('propCount').textContent, '34 / 34');

// ---- 3. NumberLong ----
const data = window.LVL_PROPS_V3;
const nlDef = data.find((d) => d.type === 'numberlong' && d.id === 'levelTime');
const rowByName = (name) => propRows().find((r) => r.children[1] && r.children[1].textContent === name);

const nlRow = propRows().find((r) => r.children[1] && r.children[1].textContent === nlDef.name);
ok('找到 NumberLong 行', !!nlRow);
const nlCtrl = nlRow && nlRow.children[2];
ok('NumberLong 显示为纯数字', /^\d+$/.test(nlCtrl.value), nlCtrl && nlCtrl.value);
eq('NumberLong 类型徽章', nlRow.children[3].textContent, 'NumberLong');

nlCtrl.value = '9999';
fire(nlCtrl, 'change', {});
eq('NumberLong 写回', App.getExt().get(nlDef.path), 'NumberLong(9999)');

// ---- 3.5 定位（回归：单行 JSON 深层字段不能靠“列号×7px”估算，会滚飞）----
const diffDef = data.find((d) => d.id === 'difficulty');
const diffRow = propRows().find((r) => r.children[1] && r.children[1].textContent === diffDef.name);
const locBtn = diffRow && diffRow.children[4];
ok('难度行有定位按钮', !!locBtn);
if (locBtn) {
  const sp = App.getExt().spanOf(diffDef.path);
  fire(locBtn, 'click', {});
  eq('定位选中难度值起点', $('editor').selectionStart, sp.start);
  eq('定位选中难度值终点', $('editor').selectionEnd, sp.end);
  const before = $('editor').value.slice(0, sp.start);
  const nl = before.lastIndexOf('\n');
  const lineText = nl < 0 ? before : before.slice(nl + 1);
  eq('定位 难度横向滚动(按真实宽度)', $('editor').scrollLeft, lineText.length * 7.8);
}

// 对照：音乐在行首，横向滚动应当很小
const musicDef = data.find((d) => d.id === 'musicID');
const musicRow = propRows().find((r) => r.children[1] && r.children[1].textContent === musicDef.name);
if (musicRow) {
  const msp = App.getExt().spanOf(musicDef.path);
  fire(musicRow.children[4], 'click', {});
  ok('定位 音乐横向滚动较小', $('editor').scrollLeft < 5000, $('editor').scrollLeft);
}

// ---- 4. 布尔 ----
const boolDef = data.find((d) => d.type === 'bool');
const boolRow = propRows().find((r) => r.children[1] && r.children[1].textContent === boolDef.name);
if (boolRow) {
  const cb = boolRow.children[2];
  const before = cb.checked;
  cb.checked = !before;
  fire(cb, 'change', {});
  eq('布尔写回', App.getExt().get(boolDef.path), cb.checked ? 'true' : 'false');
} else {
  ok('布尔行存在', false, '未找到');
}

// ---- 4.5 出怪池卡片编辑器 ----
const poolDef = data.find((d) => d.type === 'cardpool' && d.id === 'enemyPool');
ok('出怪池定义存在', !!poolDef);
if (poolDef) {
  const poolPath = poolDef.path;
  const poolRow = propRows().find((r) => r.children[1] && r.children[1].textContent === poolDef.name);
  ok('出怪池行存在', !!poolRow);
  const editBtn = poolRow && poolRow.children[2];
  ok('出怪池行有编辑按钮', !!(editBtn && editBtn.classList && editBtn.classList.contains('prop-cardedit')));

  if (editBtn) {
    ok('初始无 enemyPool 键', !App.getExt().has(poolPath));

    const beforePool = App.getEditor();
    fire(editBtn, 'click', {});
    eq('卡片弹窗打开', queryAll(doc.body, '.cards-modal').length, 1);
    eq('弹窗初始出怪池为空', queryAll(doc.body, '.pitem').length, 0);
    ok('库里有僵尸卡', queryAll(doc.body, '.zcard').length > 0);

    const zcard = (id) => queryAll(doc.body, '.zcard').find((c) => c.dataset.id === id);

    const z1 = zcard('mvz2:zombie');
    ok('找到 mvz2:zombie 卡', !!z1);
    if (z1) {
      fire(z1, 'click', {});
      eq('添加后 enemyPool 键存在', App.getExt().has(poolPath), true);
      eq('添加后 _v 数组', App.getExt().getValue(poolPath + '._v'), ['mvz2:zombie']);
      eq('弹窗出怪池计数 1', queryAll(doc.body, '.pitem').length, 1);
    }

    const z2 = zcard('mvz2:skeleton');
    if (z2) fire(z2, 'click', {});
    eq('两只后 _v', App.getExt().getValue(poolPath + '._v'), ['mvz2:zombie', 'mvz2:skeleton']);

    const item0 = queryAll(doc.body, '.pitem')[0];
    if (item0) fire(item0, 'click', {});
    eq('移除后 _v', App.getExt().getValue(poolPath + '._v'), ['mvz2:skeleton']);

    const item1 = queryAll(doc.body, '.pitem')[0];
    if (item1) fire(item1, 'click', {});
    eq('清空后 enemyPool 键删除', App.getExt().has(poolPath), false);

    const closeBtn = queryAll(doc.body, '.cards-modal-close')[0];
    if (closeBtn) fire(closeBtn, 'click', {});
    eq('弹窗已关闭', queryAll(doc.body, '.cards-modal').length, 0);
    ok('出怪池编辑后文本字节级还原', App.getEditor() === beforePool);
  }
}

// ---- 5. 收藏 ----
const star = nlRow.children[0];
fire(star, 'click', {});
ok('收藏栏出现', $('favBar').hidden === false);
eq('收藏栏卡片数', queryAll($('favBar'), '.prop-row').length, 1);
ok('收藏持久化', (localStorage.getItem('mvz2.lvlFavProps') || '').includes('levelTime'),
  localStorage.getItem('mvz2.lvlFavProps'));

// ---- 6. 拆分 / 停靠 ----
// 窄屏默认不拆分，先用停靠按钮把属性表挪到编辑器组，再测收起/展开
if (!Shell.state().split) {
  fire(queryAll(doc, '[data-dock="props"]')[0], 'click', {});
}
eq('属性表在编辑器组', Shell.state().docks.props, 'group2');
eq('egroup2 可见', $('egroup2').hidden, false);

fire($('btnSplit'), 'click', {});
eq('收起后 属性表回侧边栏', Shell.state().docks.props, 'sidebar');
eq('收起后 egroup2 隐藏', $('egroup2').hidden, true);

const dockBtn = queryAll(doc, '[data-dock="props"]')[0];
ok('停靠按钮存在', !!dockBtn);
fire(dockBtn, 'click', {});
eq('停靠回编辑器组', Shell.state().docks.props, 'group2');
eq('停靠后 egroup2 可见', $('egroup2').hidden, false);
eq('右侧组标签数', queryAll($('tabsGroup2'), '.side-tab').length, 1);

// ---- 7. 输出面板 ----
Shell.setBottomOpen(true);
eq('输出面板可见', $('bottomPanel').hidden, false);
ok('输出面板有日志', $('logList').childElementCount > 0, $('logList').childElementCount);
fire($('btnCloseBottom'), 'click', {});
eq('输出面板可关闭', $('bottomPanel').hidden, true);

// ---- 8. 拖拽分割条 ----
Shell.reveal('fields');                    // 手机上侧边栏默认收起，先展开再拖
const spSide = $('spSide');
fire(spSide, 'pointerdown', { clientX: 320, clientY: 100 });
fire(spSide, 'pointermove', { clientX: 430, clientY: 100 });
fire(spSide, 'pointerup', { pointerId: 1 });
eq('拖动侧边栏宽度', $('workbench').style['--sidebar-w'],
  Math.min(430, maxSide(true)) + 'px');

const spGroup = $('spGroup');
const r0 = Shell.state().ratio;
fire(spGroup, 'pointerdown', { clientX: 700, clientY: 100 });
fire(spGroup, 'pointermove', { clientX: 640, clientY: 100 });
fire(spGroup, 'pointerup', { pointerId: 1 });
ok('拖动编辑器组比例变小', Shell.state().ratio < r0, `${r0} → ${Shell.state().ratio}`);

// ---- 9. 快捷键 ----
keydown('b', { ctrlKey: true });
eq('Ctrl+B 收起侧边栏', $('sidebar').hidden, true);
eq('收起后网格宽度为 0', $('workbench').style['--sidebar-w'], '0px');
keydown('b', { ctrlKey: true });
eq('Ctrl+B 展开侧边栏', $('sidebar').hidden, false);
keydown('j', { ctrlKey: true });
eq('Ctrl+J 打开输出', $('bottomPanel').hidden, false);
keydown('j', { ctrlKey: true });
eq('Ctrl+J 关闭输出', $('bottomPanel').hidden, true);

// ---- 10. 布局持久化 ----
ok('布局写入 localStorage', !!localStorage.getItem('mvz2.lvlLayout'),
  localStorage.getItem('mvz2.lvlLayout'));
const saved = JSON.parse(localStorage.getItem('mvz2.lvlLayout') || '{}');
eq('持久化含停靠信息', saved.docks && saved.docks.props, 'group2');

// ---- 11. 重置 ----
Shell.resetLayout();
eq('重置后侧边栏宽度', $('workbench').style['--sidebar-w'],
  (DEF_OPEN ? Math.min(320, maxSide(WIDE)) : 0) + 'px');

// ---------------------------------------------------------------- 输出
let failed = 0;
for (const r of results) {
  if (r.pass) console.log(`  ok   ${r.name}`);
  else { failed++; console.log(`  FAIL ${r.name}${r.detail ? ' — ' + r.detail : ''}`); }
}
console.log(`\n${results.length - failed}/${results.length} 通过（窗口宽度 ${WIDTH}px）`);
process.exit(failed ? 1 : 0);
