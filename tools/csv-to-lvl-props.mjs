#!/usr/bin/env node
/*!
 * csv-to-lvl-props.mjs — 把 data/level_props_v3.csv 编译成 js/lvl-props-v3.data.js
 *
 * CSV 列：group,id,name,type,path,default,readonly,desc,options,library
 *   path   用 ">" 分隔键段（不含文档序号，文档固定为 1 = SerializableLevelController）。
 *          例如 "level>properties>mvz2:level/starshardCount"。
 *   type   取 string|int|float|bool|numberlong|json|cardpool。
 *   options 形如 "值=标签|值=标签"，用于下拉框。
 *   library 可选：cardpool 类型指定卡片库（如 zombies）。
 *
 * 运行：node tools/csv-to-lvl-props.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CSV_PATH = resolve(root, 'data', 'level_props_v3.csv');
const OUT_PATH = resolve(root, 'js', 'lvl-props-v3.data.js');

// RFC 4180 解析器（支持引号字段、双引号转义、字段内逗号/换行）
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      // 忽略 CR（CRLF 由 \n 处理）
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function buildPath(segments) {
  let p = '1'; // 第 2 个文档 = SerializableLevelController
  for (const seg of segments) {
    p += IDENT.test(seg) ? '.' + seg : '[' + JSON.stringify(seg) + ']';
  }
  return p;
}

function parseOptions(s) {
  if (!s) return [];
  return s.split('|').filter(Boolean).map((part) => {
    const i = part.indexOf('=');
    if (i < 0) return { value: part, label: part };
    return { value: part.slice(0, i), label: part.slice(i + 1) };
  });
}

const raw = readFileSync(CSV_PATH, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) { /* BOM */ }
const rows = parseCSV(raw.replace(/^\uFEFF/, ''));
if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');

const header = rows[0];
const idx = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error('缺少列：' + name);
  return i;
};
const g = idx('group'), id = idx('id'), nm = idx('name'), ty = idx('type');
const pa = idx('path'), de = idx('default'), ro = idx('readonly'), dc = idx('desc'), op = idx('options');
const li = header.indexOf('library');   // 可选列

const props = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const idv = row[id].trim();
  if (!idv) continue;
  const segments = row[pa].split('>').map((s) => s.trim()).filter(Boolean);
  props.push({
    group: row[g].trim(),
    id: idv,
    name: row[nm].trim(),
    type: row[ty].trim(),
    path: buildPath(segments),
    default: row[de].trim(),
    readonly: row[ro].trim() === '1' || row[ro].trim() === 'true',
    desc: row[dc].trim(),
    options: parseOptions(row[op]),
    library: li >= 0 ? (row[li] || '').trim() : '',
  });
}

const banner = `/*!
 * lvl-props-v3.data.js — 自动生成，请勿手动编辑。
 * 数据源：data/level_props_v3.csv
 * 重新生成：node tools/csv-to-lvl-props.mjs
 */`;
const out = banner + '\nwindow.LVL_PROPS_V3 = ' + JSON.stringify(props, null, 1) + ';\n';
writeFileSync(OUT_PATH, out, 'utf8');

console.log('已生成 ' + OUT_PATH + '，共 ' + props.length + ' 条属性。');
