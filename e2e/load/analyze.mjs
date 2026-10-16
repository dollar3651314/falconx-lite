#!/usr/bin/env node
/**
 * AC-13 压测结果统计（测试报告/v1-压测报告-AC13.md）。用法：node e2e/load/analyze.mjs <结果目录>（run-ac13.sh 结束时自动调用）。
 * 读：app.log（后端日志）、stats.jsonl（docker stats 采样）、client.json（压测程序的统计）；输出 Markdown 到标准输出。
 *
 * 口径（AC-13）：后端日志里撮合引擎（trading.order.MatchingEngine）写的两种行
 *   撮合完成：<类型> id=<编号> 耗时 <毫秒>ms
 *   撮合耗时超过 1 秒：<类型> id=<编号> 耗时 <毫秒>ms
 * 耗时 = 从撮合引擎收到触发价格（MatchingEngine.onQuote）到成交记录所在的事务提交，类型是 挂单成交、TP、SL、LIQUIDATED。
 * 百分位用最近秩法（nearest-rank）：p99 = 排序后第 ceil(0.99 × n) 个。
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'e2e/logs/load';
const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');

// 两份后端日志（跟随写入的、结束时完整导出的）取匹配行多的那份
const RE = /^(\S+)\s+\w+\s.*?(撮合完成|撮合耗时超过 1 秒)：(\S+) id=(\d+) 耗时 (\d+)ms/;
function parse(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = RE.exec(line);
    if (m) rows.push({ t: m[1], kind: m[3], id: m[4], ms: Number(m[5]) });
  }
  return rows;
}
const logs = ['app.log', 'app-final.log'].map((f) => ({ f, text: read(f) })).map((x) => ({ ...x, rows: parse(x.text) }));
const best = logs.sort((a, b) => b.rows.length - a.rows.length)[0];
const rows = best.rows;

const NAMES = { 挂单成交: '挂单成交', TP: '止盈 TP', SL: '止损 SL', LIQUIDATED: '强平' };
function pct(sorted, p) {
  if (!sorted.length) return '-';
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
function line(name, xs) {
  const s = [...xs].sort((a, b) => a - b);
  const over = s.filter((x) => x > 1000).length;
  return `| ${name} | ${s.length} | ${pct(s, 0.5)} | ${pct(s, 0.9)} | ${pct(s, 0.99)} | ${s.length ? s[s.length - 1] : '-'} | ${over} | ${s.length ? ((over / s.length) * 100).toFixed(2) : '-'}% |`;
}

const out = [];
out.push(`# AC-13 压测结果（${best.f}，${rows.length} 次触发）`, '');
out.push('| 类型 | 次数 | p50 (ms) | p90 (ms) | p99 (ms) | 最大 (ms) | 超过 1 秒 | 超过 1 秒的比例 |', '|---|---|---|---|---|---|---|---|');
for (const k of Object.keys(NAMES)) out.push(line(NAMES[k], rows.filter((r) => r.kind === k).map((r) => r.ms)));
const other = rows.filter((r) => !NAMES[r.kind]);
if (other.length) out.push(line('其他', other.map((r) => r.ms)));
out.push(line('**合计**', rows.map((r) => r.ms)));
const dup = rows.length - new Set(rows.map((r) => `${r.kind === '挂单成交' ? 'o' : 'p'}${r.id}`)).size;
out.push('', `同一条订单或持仓重复执行：${dup} 次（应为 0）`);

// 集中程度：每秒触发数
const perSec = new Map();
for (const r of rows) perSec.set(r.t.slice(0, 19), (perSec.get(r.t.slice(0, 19)) || 0) + 1);
const secs = [...perSec.values()].sort((a, b) => b - a);
if (rows.length) {
  out.push(`触发最集中的一秒：${secs[0]} 次；前 5 个最集中的秒：${secs.slice(0, 5).join('、')}；有触发的秒数 ${secs.length}`);
  out.push(`第一条 ${rows[0].t}，最后一条 ${rows[rows.length - 1].t}`);
}
// 耗时分布
const buckets = [50, 100, 200, 300, 500, 700, 1000, Infinity];
const hist = buckets.map((b, i) => ({ b, n: rows.filter((r) => r.ms <= b && (i === 0 || r.ms > buckets[i - 1])).length }));
out.push('', '耗时分布：' + hist.map((h, i) => `${i === 0 ? '≤' : `${buckets[i - 1] + 1}–`}${h.b === Infinity ? '' : h.b}${h.b === Infinity ? '以上' : 'ms'} ${h.n}`).join('；'));

// 错误和警告（不含"撮合耗时超过 1 秒"）
const levels = { ERROR: new Map(), WARN: new Map() };
for (const l of best.text.split('\n')) {
  const m = /^\S+\s+(ERROR|WARN)\s+\d+\s+---\s+\[[^\]]*\]\s+\[[^\]]*\]\s+(\S+)\s*:\s*(.*)$/.exec(l);
  if (!m || l.includes('撮合耗时超过 1 秒')) continue;
  const key = `${m[2]}: ${m[3].replace(/\d+/g, 'N').slice(0, 120)}`;
  levels[m[1]].set(key, (levels[m[1]].get(key) || 0) + 1);
}
for (const lv of ['ERROR', 'WARN']) {
  const n = [...levels[lv].values()].reduce((a, b) => a + b, 0);
  out.push('', `${lv} 日志 ${n} 行（不含"撮合耗时超过 1 秒"）${n ? '：' : ''}`);
  for (const [k, v] of [...levels[lv].entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`- ${v} × ${k}`);
}

// 资源：docker stats 采样（CPU 是相对一个核的百分比，2 个核满载 = 200%）
const stats = read('stats.jsonl')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const toMiB = (s) => {
  const m = /([\d.]+)\s*([KMG]i?B)/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2].startsWith('G') ? v * 1024 : m[2].startsWith('K') ? v / 1024 : v;
};
if (stats.length) {
  out.push('', `资源占用（docker stats，每 5 秒一次，共 ${stats.length / 4} 次左右；CPU 100% = 一个核）：`, '', '| 容器 | CPU 平均 | CPU 最高 | 内存平均 (MiB) | 内存最高 (MiB) | 上限 |', '|---|---|---|---|---|---|');
  const names = [...new Set(stats.map((s) => s.name))];
  for (const n of names) {
    const xs = stats.filter((s) => s.name === n);
    const cpu = xs.map((s) => parseFloat(s.cpu)).filter((x) => !Number.isNaN(x));
    const mem = xs.map((s) => toMiB(s.mem.split('/')[0])).filter((x) => !Number.isNaN(x));
    const lim = xs[0].mem.split('/')[1]?.trim();
    const avg = (a) => (a.reduce((p, c) => p + c, 0) / a.length).toFixed(1);
    out.push(`| ${n} | ${avg(cpu)}% | ${Math.max(...cpu).toFixed(1)}% | ${avg(mem)} | ${Math.max(...mem).toFixed(1)} | ${lim} |`);
  }
  // 四个容器合计的 CPU（同一时刻）
  const byT = new Map();
  for (const s of stats) byT.set(s.t, (byT.get(s.t) || 0) + (parseFloat(s.cpu) || 0));
  const tot = [...byT.values()];
  out.push('', `四个容器合计 CPU：平均 ${(tot.reduce((a, b) => a + b, 0) / tot.length).toFixed(1)}%，最高 ${Math.max(...tot).toFixed(1)}%（2 个核的上限是 200%）`);
}

// 压测程序的统计
const client = read('client.json');
if (client) {
  const c = JSON.parse(client);
  out.push('', '压测程序：');
  out.push(`- 客户 ${c.users} 个；品种 ${c.symbols} 个，/api/market/quotes 列出 ${c.quotesListed} 个、3 秒内更新的 ${c.quotesFresh} 个；能开仓的 ${c.tradable.length} 个，不能的：${c.notTradable.join(' ') || '无'}`);
  out.push(`- 布单开始 ${c.loadStartedAt}，结束 ${c.endedAt}；${c.rounds.length} 轮；下单成功 ${c.placed.ok} 条 ${JSON.stringify(c.placed.byKind)}；失败 ${JSON.stringify(c.placed.errors)}`);
  const pm = c.rounds.map((r) => r.placeMs);
  if (pm.length) out.push(`- 每轮布单用时 ${Math.min(...pm)}–${Math.max(...pm)}ms；推动报价（同时 ${c.rounds[0].symbols} 个品种）用时：上 ${c.rounds.map((r) => r.up.ms).join('/')}ms`);
  out.push(`- WebSocket：${c.ws.opened}/${c.ws.connections} 条连上，提前断开 ${c.ws.closedEarly} 条，错误 ${c.ws.errors.length} 条，共收到 ${c.ws.messages} 条消息；行情推送里出现过 ${c.ws.marketSymbolsSeen} 个品种`);
  const ups = Object.values(c.ws.marketSymbolUpdates);
  if (ups.length) out.push(`- 每个品种在行情推送里出现的次数（所有连接合计）：最少 ${Math.min(...ups)}，最多 ${Math.max(...ups)}`);
}
console.log(out.join('\n'));
