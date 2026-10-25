#!/usr/bin/env node
/*!
 * verify-blueprints-migration.mjs — 校验 blueprints.csv 瘦身是无损的
 *
 * 用 blueprints.csv.bak（原始）逐行比对：由 templates.json + 行 id 重建的 data，
 * 是否与原始 data 完全一致（JSON 深度相等）。
 *
 * 运行：node tools/verify-blueprints-migration.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dir = resolve(root, 'resources_pck', 'private', 'mvz2', 'obj_csv');

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

const origRows = parseCSV(readFileSync(resolve(dir, 'blueprints.csv.bak'), 'utf8').replace(/^\uFEFF/, ''));
const newRows = parseCSV(readFileSync(resolve(dir, 'blueprints.csv'), 'utf8').replace(/^\uFEFF/, ''));
const templates = JSON.parse(readFileSync(resolve(dir, 'blueprints.templates.json'), 'utf8'));

const col = (h, n) => h.indexOf(n);

// 原始表：keys,en,zh,zombie_data,zombie_group,group,img,nodata,data
const oh = origRows[0];
const okKeys = col(oh, 'keys'), okGroup = col(oh, 'group'), okData = col(oh, 'data');
// 新表：keys,en,zh,zombie_group,group,img,template
const nh = newRows[0];
const nkKeys = col(nh, 'keys'), nkGroup = col(nh, 'group'), nkTpl = col(nh, 'template');

const PLACEHOLDER = templates._placeholder || '<ID>';

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

function fillSeedID(obj, id) {
  // 递归把 "<ID>" 占位符替换成真实 id（只出现在 seedID 字段，但通用处理更稳）
  if (Array.isArray(obj)) return obj.map((v) => fillSeedID(v, id));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = fillSeedID(obj[k], id);
    return out;
  }
  return obj === PLACEHOLDER ? id : obj;
}

// 原始对象：id -> parsed data
const origData = new Map();
for (let r = 1; r < origRows.length; r++) {
  const row = origRows[r];
  const keys = (row[okKeys] || '').trim();
  const group = (row[okGroup] || '').trim();
  if (!keys || !group) continue;   // 跳过枚举行
  const dataStr = (row[okData] || '').trim();
  let parsed;
  try { parsed = dataStr ? JSON.parse(dataStr) : {}; } catch (e) { parsed = null; }
  origData.set(keys, parsed);
}

let checked = 0, bad = 0;
for (let r = 1; r < newRows.length; r++) {
  const row = newRows[r];
  const keys = (row[nkKeys] || '').trim();
  const group = (row[nkGroup] || '').trim();
  if (!keys || !group) continue;
  const vname = (row[nkTpl] || '').trim() || 'default';
  const tpl = (templates[group] && templates[group][vname]) || {};
  const recon = fillSeedID(deepClone(tpl), keys);
  const orig = origData.get(keys);
  checked++;
  if (JSON.stringify(orig) !== JSON.stringify(recon)) {
    bad++;
    console.log('  不一致: ' + keys + ' (group=' + group + ', template=' + vname + ')');
  }
}

console.log(`比对 ${checked} 个对象：${bad === 0 ? '全部一致，迁移无损 ✓' : bad + ' 个不一致 ✗'}`);
if (bad) process.exit(1);
