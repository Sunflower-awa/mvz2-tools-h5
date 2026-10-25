/*!
 * extjson.js — MVZ2 关卡「拓展 JSON」按路径读写工具（零依赖，浏览器 + Node 通用）
 *
 * 核心思路：不做 parse → stringify 的整篇往返，而是用文本级 tokenizer 给每个值
 * 记录它在原文里的 [start, end) 字符区间；修改时只 splice 那一段，
 * 其余字节（浮点原样、空格、换行、键顺序）一个都不动。
 *
 * 路径格式：<文档序号>.<键>[<下标>].<键>...
 *   0              → 第 1 篇文档（header）
 *   1.rng.x        → 第 2 篇文档的 rng.x
 *   1.sections[3].plants[1].id
 * 同一对象里出现重复键时，第 1 个用原名，第 2 个起加 #1、#2。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExtJson = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NL = /NumberLong\((-?\d+)\)/y;
  var IDENT = /^[A-Za-z_$][\w$]*$/;

  // 空白字符？
  function isWs(c) { return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\uFEFF'; }

  function joinKey(prefix, key, seen) {
    var suffix = seen ? '#' + seen : '';
    if (IDENT.test(key)) return prefix + '.' + key + suffix;
    return prefix + '[' + JSON.stringify(key) + ']' + suffix;
  }

  // ---------------- tokenizer：建立 path -> 节点（含字符区间） ----------------
  function open(text) {
    var n = text.length, i = 0, nodes = [], index = new Map();

    function err(msg) { throw new Error(msg + '（位置 ' + i + '）'); }
    function ws() { while (i < n && isWs(text[i])) i++; }

    function readStr() {                       // i 指向开头的引号
      var q = i; i++;
      while (i < n) {
        var c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '"') { i++; return q; }
        i++;
      }
      err('字符串没有闭合');
    }

    function readNum() {
      if (text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      if (text[i] === '.') { i++; while (i < n && text[i] >= '0' && text[i] <= '9') i++; }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
    }

    function parseValue(path) {
      ws();
      if (i >= n) err('意外的文件结尾');
      var start = i, c = text[i], node;

      if (c === '{') {
        node = { type: 'object', path: path, start: start, members: [] };
        i++; ws();
        if (text[i] === '}') { i++; }
        else {
          var counts = Object.create(null);
          for (;;) {
            ws();
            if (text[i] !== '"') err('对象的键必须是字符串');
            var ks = i, key = JSON.parse(text.slice(readStr(), i));
            var seen = counts[key] || 0; counts[key] = seen + 1;
            ws(); if (text[i] !== ':') err('缺少冒号'); i++;
            var child = parseValue(joinKey(path, key, seen));
            child.parent = node; child.key = key;
            node.members.push({ key: key, keyStart: ks, node: child });
            ws();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === '}') { i++; break; }
            err('对象里缺少 , 或 }');
          }
        }
      } else if (c === '[') {
        node = { type: 'array', path: path, start: start, items: [] };
        i++; ws();
        if (text[i] === ']') { i++; }
        else {
          for (;;) {
            var el = parseValue(path + '[' + node.items.length + ']');
            el.parent = node; el.index = node.items.length;
            node.items.push(el);
            ws();
            if (text[i] === ',') { i++; continue; }
            if (text[i] === ']') { i++; break; }
            err('数组里缺少 , 或 ]');
          }
        }
      } else if (c === '"') {
        readStr(); node = { type: 'string', path: path, start: start };
      } else if (c === 't' || c === 'f' || c === 'n') {
        var lit = c === 't' ? 'true' : c === 'f' ? 'false' : 'null';
        if (text.substr(i, lit.length) !== lit) err('无法识别的字面量');
        i += lit.length;
        node = { type: lit === 'null' ? 'null' : 'boolean', path: path, start: start };
      } else if (c === 'N') {
        NL.lastIndex = i;
        var m = NL.exec(text);
        if (!m) err('无法识别的 token（是 NumberLong 吗？）');
        i = NL.lastIndex;
        node = { type: 'numberlong', path: path, start: start, digits: m[1] };
      } else if (c === '-' || (c >= '0' && c <= '9')) {
        readNum(); node = { type: 'number', path: path, start: start };
      } else {
        err('无法识别的字符 ' + JSON.stringify(c));
      }

      node.end = i;
      nodes.push(node); index.set(path, node);
      return node;
    }

    var docs = [];
    ws();
    while (i < n) {
      var doc = parseValue(String(docs.length));
      doc.docIndex = docs.length;
      docs.push(doc);
      ws();
    }
    if (!docs.length) throw new Error('文件是空的');

    function nodeOf(p) {
      var nd = index.get(p);
      if (!nd) throw new Error('路径不存在：' + p);
      return nd;
    }

    function valueOf(nd) {
      var raw = text.slice(nd.start, nd.end);
      switch (nd.type) {
        case 'numberlong': return { __type__: 'NumberLong', value: nd.digits };
        case 'string': return JSON.parse(raw);
        case 'number': return Number(raw);
        case 'boolean': return raw === 'true';
        case 'null': return null;
        case 'object':
          var o = {};
          nd.members.forEach(function (m) { o[m.key] = valueOf(m.node); });
          return o;
        case 'array':
          return nd.items.map(valueOf);
      }
    }

    return {
      text: text,
      docs: docs,
      index: index,
      nodes: nodes,

      has: function (p) { return index.has(p); },
      node: nodeOf,
      /** 原文里那一段字面量（含引号/NumberLong 括号） */
      get: function (p) { var nd = nodeOf(p); return text.slice(nd.start, nd.end); },
      /** 解析成 JS 值；NumberLong 返回 { __type__: 'NumberLong', value: '11' } */
      getValue: function (p) { return valueOf(nodeOf(p)); },
      typeOf: function (p) { return nodeOf(p).type; },
      /** 该值在原文里的位置，用于自己做外科手术 */
      spanOf: function (p) { var nd = nodeOf(p); return { start: nd.start, end: nd.end }; },

      paths: function (opts) {
        opts = opts || {};
        var out = [];
        for (var k = 0; k < nodes.length; k++) {
          var nd = nodes[k];
          if (opts.type && nd.type !== opts.type) continue;
          if (opts.prefix && nd.path.lastIndexOf(opts.prefix, 0) !== 0) continue;
          out.push(nd.path);
        }
        out.sort(function (a, b) { return index.get(a).start - index.get(b).start; });
        return out;
      },

      /** 列出所有叶子（标量）及其字面量，便于人工找路径 */
      entries: function (opts) {
        var self = this;
        return self.paths(opts).filter(function (p) {
          var t = index.get(p).type;
          return t !== 'object' && t !== 'array';
        }).map(function (p) {
          return { path: p, type: index.get(p).type, raw: self.get(p) };
        });
      },

      /** 按路径或字面量做正则/子串检索，返回 { path, type, raw } */
      search: function (q) {
        var self = this;
        var re = (q instanceof RegExp) ? q
          : new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        var out = [];
        for (var k = 0; k < nodes.length; k++) {
          var nd = nodes[k];
          var raw = text.slice(nd.start, nd.end);
          if (re.test(nd.path) || re.test(raw)) out.push({ path: nd.path, type: nd.type, raw: raw });
        }
        return out;
      }
    };
  }

  // ---------------- 编辑 ----------------
  function checkLiteral(v) {
    if (typeof v !== 'string') v = String(v);
    var probe = v.replace(/NumberLong\(-?\d+\)/g, '0');
    try {
      JSON.parse(probe);                      // 非法字面量直接抛错
    } catch (e) {
      throw new Error('不是合法的 JSON 文本：' + (e && e.message ? e.message : v));
    }
    return v;
  }

  /** 一次改多处：edits = [{ path, value }]，value 必须是 JSON 文本 */
  function apply(session, edits) {
    var spans = edits.map(function (e) {
      var nd = session.node(e.path);
      return { start: nd.start, end: nd.end, value: checkLiteral(e.value), path: e.path };
    });
    spans.sort(function (a, b) { return a.start - b.start; });
    for (var k = 1; k < spans.length; k++) {
      if (spans[k].start < spans[k - 1].end) {
        throw new Error('编辑区间重叠：' + spans[k - 1].path + ' / ' + spans[k].path);
      }
    }
    var text = session.text;
    for (var j = spans.length - 1; j >= 0; j--) {
      text = text.slice(0, spans[j].start) + spans[j].value + text.slice(spans[j].end);
    }
    return text;
  }

  function cutRange(session, p) {
    var nd = session.node(p);
    var parent = nd.parent;
    if (!parent) throw new Error('不能删除整个文档：' + p);
    if (parent.type === 'object') {
      var ms = parent.members, k = 0;
      while (k < ms.length && ms[k].node !== nd) k++;
      if (k < ms.length - 1) return { start: ms[k].keyStart, end: ms[k + 1].keyStart };
      if (k > 0) return { start: ms[k - 1].node.end, end: nd.end };
      return { start: ms[k].keyStart, end: nd.end };
    }
    var items = parent.items, j = items.indexOf(nd);
    if (j < items.length - 1) return { start: nd.start, end: items[j + 1].start };
    if (j > 0) return { start: items[j - 1].end, end: nd.end };
    return { start: nd.start, end: nd.end };
  }

  /** 删掉若干路径（数组元素 / 对象成员），逗号一起处理 */
  function remove(session, paths) {
    var ranges = paths.map(function (p) { return cutRange(session, p); });
    ranges.sort(function (a, b) { return a.start - b.start; });
    for (var k = 1; k < ranges.length; k++) {
      if (ranges[k].start < ranges[k - 1].end) throw new Error('删除区间重叠');
    }
    var text = session.text;
    for (var j = ranges.length - 1; j >= 0; j--) {
      text = text.slice(0, ranges[j].start) + text.slice(ranges[j].end);
    }
    return text;
  }

  return {
    open: open,
    apply: apply,
    remove: remove,
    checkLiteral: checkLiteral,
    /** 一次性改一个值 */
    set: function (text, path, value) {
      var s = open(text);
      return apply(s, [{ path: path, value: value }]);
    },
    /** 一次性删一个值 */
    del: function (text, path) {
      return remove(open(text), [path]);
    }
  };
});
