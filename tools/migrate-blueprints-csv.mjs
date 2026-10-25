#!/usr/bin/env node
/*!
 * migrate-blueprints-csv.mjs — 一次性迁移：把 blueprints.csv 瘦身
 *
 * 原表 9 列：keys,en,zh,zombie_data,zombie_group,group,img,nodata,data
 *   - zombie_data / nodata 是空壳列（nodata 仅 snipenser 一行重复了它的 data），丢弃。
 *   - data 列是巨型转义 JSON，且 253 段里只有 9 种模板（只 seedID 不同），
 *     抽到 blueprints.templates.json（seedID 用占位符 "<ID>"）。
 *
 * 迁移后：
 *   - blueprints.csv        7 列：keys,en,zh,zombie_group,group,img,template
 *   - blueprints.templates.json   { group: { variant: 模板对象 } }
 *
 * 运行前务必先备份（已生成 blueprints.csv.bak）。
 * 运行：node tools/migrate-blueprints-csv.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CSV_PATH = resolve(root, 'resources_pck', 'private', 'mvz2', 'obj_csv', 'blueprints.csv');
const TPL_PATH = resolve(root, 'resources_pck', 'private', 'mvz2', 'obj_csv', 'blueprints.templates.json');

// RFC 4180 解析器
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c === '\r') { /* 忽略 CR */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function csvField(s) {
  s = String(s == null ? '' : s);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const raw = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
const rows = parseCSV(raw);
if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');

const header = rows[0];
const col = (n) => {
  const i = header.indexOf(n);
  if (i < 0) throw new Error('缺少列：' + n);
  return i;
};
const cKeys = col('keys'), cEn = col('en'), cZh = col('zh');
const cZg = col('zombie_group'), cGroup = col('group'), cImg = col('img'), cData = col('data');

const normData = (d) => (d || '').trim().replace(/"seedID"\s*:\s*"[^"]*"/g, '"seedID":"<ID>"');

function variantName(group, dataStr) {
  if (group !== 'blueprint') return 'default';
  const t = (dataStr || '').trim();
  if (!t || t === '{}') return 'empty';
  if (t.indexOf('mvz2:seed/isStartRecharge') >= 0) return 'default';
  if (t.indexOf('isStartRecharge') >= 0) return 'isStartRecharge_plain';
  return 'default';
}

const templates = Object.create(null);   // group -> variant -> normalized string
const stat = Object.create(null);        // group -> variant -> count
const outRows = [];
let enumCount = 0;

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const keys = (row[cKeys] || '').trim();
  if (!keys) continue;
  const group = (row[cGroup] || '').trim();
  const zg = (row[cZg] || '').trim();
  const en = (row[cEn] || '').trim();
  const zh = (row[cZh] || '').trim();
  const img = (row[cImg] || '').trim();

  if (!group) {
    // 枚举行（ZOMBIE_TYPE_* 等）：无模板
    outRows.push([keys, en, zh, zg, group, img, '']);
    enumCount++;
    continue;
  }

  const dataStr = (row[cData] || '').trim();
  const vname = variantName(group, dataStr);
  const norm = normData(dataStr);

  if (!templates[group]) templates[group] = Object.create(null);
  if (!(vname in templates[group])) templates[group][vname] = norm;
  if (!stat[group]) stat[group] = Object.create(null);
  stat[group][vname] = (stat[group][vname] || 0) + 1;

  outRows.push([keys, en, zh, zg, group, img, vname]);
}

// ---- 写瘦身后的 CSV ----
const csvLines = ['keys,en,zh,zombie_group,group,img,template',
  ...outRows.map((r) => r.map(csvField).join(','))];
writeFileSync(CSV_PATH, csvLines.join('\n') + '\n', 'utf8');

// ---- 写 templates.json（把规范化字符串还原成真实 JSON 对象）----
const tplOut = Object.create(null);
for (const g of Object.keys(templates)) {
  tplOut[g] = Object.create(null);
  for (const v of Object.keys(templates[g])) {
    const s = templates[g][v];
    let parsed;
    try { parsed = s ? JSON.parse(s) : {}; } catch (e) { parsed = null; }
    tplOut[g][v] = parsed;
  }
}
const banner = { _placeholder: '<ID>', _note: '模板里的 "seedID": "<ID>" 表示填入对象自身的 keys。' };
const out = Object.assign(banner, tplOut);
writeFileSync(TPL_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

// ---- 报告 ----
let objTotal = 0, tplTotal = 0;
for (const g of Object.keys(stat)) {
  let gsum = 0;
  for (const v of Object.keys(stat[g])) {
    gsum += stat[g][v];
    tplTotal++;
  }
  objTotal += gsum;
  console.log(`  ${g} (${gsum} 行): ${JSON.stringify(stat[g])}`);
}
console.log(`对象 ${objTotal} 行 + 枚举 ${enumCount} 行 = ${objTotal + enumCount} 行；模板共 ${tplTotal} 种。`);
console.log('已写：' + CSV_PATH);
console.log('已写：' + TPL_PATH);
