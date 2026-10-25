/*!
 * lvl-props-v3.data.js — 自动生成，请勿手动编辑。
 * 数据源：data/level_props_v3.csv
 * 重新生成：node tools/csv-to-lvl-props.mjs
 */
window.LVL_PROPS_V3 = [
 {
  "group": "基础信息",
  "id": "stageDefinitionID",
  "name": "关卡ID",
  "type": "string",
  "path": "1.level.stageDefinitionID",
  "default": "",
  "readonly": false,
  "desc": "关卡唯一标识，如 mvz2:castle_12",
  "options": [],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "areaDefinitionID",
  "name": "地图",
  "type": "string",
  "path": "1.level.areaDefinitionID",
  "default": "",
  "readonly": false,
  "desc": "区域定义 ID，如 mvz2:castle",
  "options": [],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "difficulty",
  "name": "难度",
  "type": "string",
  "path": "1.level.difficulty",
  "default": "",
  "readonly": false,
  "desc": "关卡难度",
  "options": [
   {
    "value": "mvz2:easy",
    "label": "简单"
   },
   {
    "value": "mvz2:normal",
    "label": "普通"
   },
   {
    "value": "mvz2:hard",
    "label": "困难"
   },
   {
    "value": "mvz2:lunatic",
    "label": "疯狂"
   }
  ],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "musicID",
  "name": "音乐",
  "type": "string",
  "path": "1.musicID",
  "default": "",
  "readonly": false,
  "desc": "背景音乐 ID",
  "options": [],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "isCleared",
  "name": "已通关",
  "type": "bool",
  "path": "1.level.isCleared",
  "default": "false",
  "readonly": false,
  "desc": "是否已通关",
  "options": [],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "levelTime",
  "name": "关卡时间",
  "type": "numberlong",
  "path": "1.level.levelTime",
  "default": "0",
  "readonly": false,
  "desc": "累计关卡时间（NumberLong）",
  "options": [],
  "library": ""
 },
 {
  "group": "基础信息",
  "id": "levelProgressVisible",
  "name": "显示进度",
  "type": "bool",
  "path": "1.level.levelProgressVisible",
  "default": "true",
  "readonly": false,
  "desc": "是否显示进度条",
  "options": [],
  "library": ""
 },
 {
  "group": "机械能",
  "id": "maxEnergy",
  "name": "机械能上限",
  "type": "int",
  "path": "1.level.Option.maxEnergy",
  "default": "9990",
  "readonly": false,
  "desc": "机械能上限",
  "options": [],
  "library": ""
 },
 {
  "group": "机械能",
  "id": "energy",
  "name": "当前机械能",
  "type": "float",
  "path": "1.level.energy",
  "default": "0",
  "readonly": false,
  "desc": "当前机械能",
  "options": [],
  "library": ""
 },
 {
  "group": "机械能",
  "id": "requireCards",
  "name": "需要卡片",
  "type": "bool",
  "path": "1.level.requireCards",
  "default": "true",
  "readonly": false,
  "desc": "是否需要卡片",
  "options": [],
  "library": ""
 },
 {
  "group": "机械能",
  "id": "cardSlotCount",
  "name": "卡片槽数量",
  "type": "int",
  "path": "1.level.Option.cardSlotCount",
  "default": "10",
  "readonly": false,
  "desc": "卡片槽数量",
  "options": [],
  "library": ""
 },
 {
  "group": "机械能",
  "id": "tps",
  "name": "每秒帧数",
  "type": "int",
  "path": "1.level.Option.tps",
  "default": "30",
  "readonly": false,
  "desc": "TPS（tick per second）",
  "options": [],
  "library": ""
 },
 {
  "group": "波次",
  "id": "currentWave",
  "name": "当前波",
  "type": "int",
  "path": "1.level.currentWave",
  "default": "0",
  "readonly": false,
  "desc": "当前波数",
  "options": [],
  "library": ""
 },
 {
  "group": "波次",
  "id": "currentFlag",
  "name": "当前旗帜",
  "type": "int",
  "path": "1.level.currentFlag",
  "default": "0",
  "readonly": false,
  "desc": "当前旗帜数",
  "options": [],
  "library": ""
 },
 {
  "group": "波次",
  "id": "waveState",
  "name": "波状态",
  "type": "int",
  "path": "1.level.waveState",
  "default": "0",
  "readonly": false,
  "desc": "当前波状态",
  "options": [
   {
    "value": "0",
    "label": "未开始"
   },
   {
    "value": "1",
    "label": "已开始"
   },
   {
    "value": "2",
    "label": "一大波逼近"
   },
   {
    "value": "3",
    "label": "最后一波"
   },
   {
    "value": "4",
    "label": "最后一波后"
   },
   {
    "value": "5",
    "label": "首领战"
   },
   {
    "value": "6",
    "label": "暂停出怪"
   },
   {
    "value": "100",
    "label": "首领战后"
   }
  ],
  "library": ""
 },
 {
  "group": "波次",
  "id": "highWave",
  "name": "大波",
  "type": "bool",
  "path": "1.level.properties[\"mvz2:level/wave_stage/HighWave\"]",
  "default": "false",
  "readonly": false,
  "desc": "是否为一大波",
  "options": [],
  "library": ""
 },
 {
  "group": "星之碎片",
  "id": "starshardCount",
  "name": "碎片数量",
  "type": "int",
  "path": "1.level.properties[\"mvz2:level/starshardCount\"]",
  "default": "0",
  "readonly": false,
  "desc": "星之碎片数量",
  "options": [],
  "library": ""
 },
 {
  "group": "星之碎片",
  "id": "starshardSlotCount",
  "name": "碎片卡槽",
  "type": "int",
  "path": "1.level.properties[\"mvz2:level/starshardSlotCount\"]",
  "default": "5",
  "readonly": false,
  "desc": "星之碎片卡槽数量",
  "options": [],
  "library": ""
 },
 {
  "group": "星之碎片",
  "id": "starshardActive",
  "name": "启用碎片",
  "type": "bool",
  "path": "1.starshardActive",
  "default": "true",
  "readonly": false,
  "desc": "启用星之碎片",
  "options": [],
  "library": ""
 },
 {
  "group": "全局开关",
  "id": "energyActive",
  "name": "启用机械能",
  "type": "bool",
  "path": "1.energyActive",
  "default": "true",
  "readonly": false,
  "desc": "启用机械能",
  "options": [],
  "library": ""
 },
 {
  "group": "全局开关",
  "id": "blueprintsActive",
  "name": "启用蓝图",
  "type": "bool",
  "path": "1.blueprintsActive",
  "default": "true",
  "readonly": false,
  "desc": "启用蓝图",
  "options": [],
  "library": ""
 },
 {
  "group": "全局开关",
  "id": "pickaxeActive",
  "name": "启用铁镐",
  "type": "bool",
  "path": "1.pickaxeActive",
  "default": "true",
  "readonly": false,
  "desc": "启用铁镐",
  "options": [],
  "library": ""
 },
 {
  "group": "全局开关",
  "id": "triggerActive",
  "name": "启用触发器",
  "type": "bool",
  "path": "1.triggerActive",
  "default": "true",
  "readonly": false,
  "desc": "启用触发器",
  "options": [],
  "library": ""
 },
 {
  "group": "计数器",
  "id": "currentEntityID",
  "name": "实体ID计数",
  "type": "numberlong",
  "path": "1.level.currentEntityID",
  "default": "0",
  "readonly": false,
  "desc": "下一个实体 ID（NumberLong）",
  "options": [],
  "library": ""
 },
 {
  "group": "计数器",
  "id": "currentBuffID",
  "name": "BUFF计数",
  "type": "numberlong",
  "path": "1.level.currentBuffID",
  "default": "0",
  "readonly": false,
  "desc": "下一个 BUFF ID（NumberLong）",
  "options": [],
  "library": ""
 },
 {
  "group": "计数器",
  "id": "currentSeedPackID",
  "name": "种子包计数",
  "type": "numberlong",
  "path": "1.level.currentSeedPackID",
  "default": "0",
  "readonly": false,
  "desc": "下一个种子包 ID（NumberLong）",
  "options": [],
  "library": ""
 },
 {
  "group": "计数器",
  "id": "conveyorSlotCount",
  "name": "传送带卡槽",
  "type": "int",
  "path": "1.level.conveyorSlotCount",
  "default": "10",
  "readonly": false,
  "desc": "传送带卡槽数量",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "waveMaxHealth",
  "name": "波最大生命",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/wave_stage/WaveMaxHealth\"]",
  "default": "",
  "readonly": false,
  "desc": "System.Single 包装对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "starshardChance",
  "name": "碎星掉落概率",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/starshard_drop_stage/StarshardChance\"]",
  "default": "",
  "readonly": false,
  "desc": "System.Single 包装对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "waveTimer",
  "name": "波计时器",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/wave_stage/WaveTimer\"]",
  "default": "",
  "readonly": false,
  "desc": "FrameTimer 对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "conveyorTimer",
  "name": "传送带计时器",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/conveyor/ConveyorTimer\"]",
  "default": "",
  "readonly": false,
  "desc": "FrameTimer 对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "difficultyBuff",
  "name": "难度BUFF",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/difficulty/DifficultyBuff\"]",
  "default": "",
  "readonly": false,
  "desc": "BuffReferenceLevel 对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "高级属性",
  "id": "artifactRNG",
  "name": "神器随机种子",
  "type": "json",
  "path": "1.level.properties[\"mvz2:level/artifactRNG\"]",
  "default": "",
  "readonly": false,
  "desc": "RandomGenerator 对象，原文编辑",
  "options": [],
  "library": ""
 },
 {
  "group": "出怪",
  "id": "enemyPool",
  "name": "出怪池",
  "type": "cardpool",
  "path": "1.level.properties[\"mvz2:level/enemyPool\"]",
  "default": "",
  "readonly": false,
  "desc": "出怪池（僵尸 id 数组，点“编辑”用卡片添加/移除）",
  "options": [],
  "library": "zombies"
 }
];
