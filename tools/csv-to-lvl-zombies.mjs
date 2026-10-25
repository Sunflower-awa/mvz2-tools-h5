#!/usr/bin/env node
/*!
 * csv-to-lvl-zombies.mjs — 把 blueprints.csv 里的僵尸条目编译成 js/lvl-zombies.data.js
 *
 * 数据源：resources_pck/private/mvz2/obj_csv/blueprints.csv
 *   CSV 列：keys,en,zh,zombie_data,zombie_group,group,img,nodata,data
 *   只取 group=zombie 的条目（出怪池里的僵尸 id）。
 *
 * 运行：node tools/csv-to-lvl-zombies.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CSV_PATH = resolve(root, 'resources_pck', 'private', 'mvz2', 'obj_csv', 'blueprints.csv');
const OUT_PATH = resolve(root, 'js', 'lvl-zombies.data.js');

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

const raw = readFileSync(CSV_PATH, 'utf8');
const rows = parseCSV(raw.replace(/^\uFEFF/, ''));
if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');

const header = rows[0];
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error('缺少列：' + name);
  return i;
};
const kKeys = col('keys'), kEn = col('en'), kZh = col('zh');
const kGroup = col('group'), kImg = col('img'), kZg = col('zombie_group');

const zombies = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if ((row[kGroup] || '').trim() !== 'zombie') continue;
  const id = (row[kKeys] || '').trim();
  if (!id) continue;
  zombies.push({
    id,
    zh: (row[kZh] || '').trim(),
    en: (row[kEn] || '').trim(),
    img: (row[kImg] || '').trim(),
    groups: (row[kZg] || '').split(';').map((s) => s.trim()).filter(Boolean),
  });
}

const banner = `/*!
 * lvl-zombies.data.js — 自动生成，请勿手动编辑。
 * 数据源：resources_pck/private/mvz2/obj_csv/blueprints.csv（group=zombie）
 * 重新生成：node tools/csv-to-lvl-zombies.mjs
 */`;
const out = banner + '\nwindow.LVL_ZOMBIES = ' + JSON.stringify(zombies, null, 1) + ';\n';
writeFileSync(OUT_PATH, out, 'utf8');

console.log('已生成 ' + OUT_PATH + '，共 ' + zombies.length + ' 只僵尸。');
