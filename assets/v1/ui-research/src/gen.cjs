// UI 风格方向对比图生成器：node gen.cjs 生成 src/*.html；截图由 scripts 外的本地工具完成（见 需求文档/v1-UI风格调研.md 第 6 节）。
// 所有数据为示意，不代表真实行情。三种方向统一用"绿涨红跌"，涨跌色单独讨论（调研文档第 4 节）。
const fs = require('fs');
const path = require('path');

const SYMS = [
  ['XAUUSD', '黄金', '4,126.10', '4,126.50', '40', '-0.62', '4,157.35', '4,118.20'],
  ['EURUSD', '欧元/美元', '1.16431', '1.16443', '1.2', '+0.58', '1.16702', '1.15890'],
  ['GBPUSD', '英镑/美元', '1.33178', '1.33193', '1.5', '+0.60', '1.33410', '1.32510'],
  ['USDJPY', '美元/日元', '151.845', '151.859', '1.4', '+0.60', '152.110', '150.920'],
  ['XAGUSD', '白银', '48.215', '48.245', '30', '+1.12', '48.600', '47.380'],
  ['USOIL', 'WTI 原油', '61.42', '61.47', '5', '-1.35', '62.80', '61.05'],
  ['NAS100', '纳斯达克100', '24,650.0', '24,651.5', '15', '+0.84', '24,712.0', '24,410.5'],
  ['US30', '道琼斯', '46,120.0', '46,122.0', '20', '+0.31', '46,250.0', '45,880.0'],
  ['BTCUSD', '比特币', '112,450.0', '112,480.0', '300', '-0.92', '114,020.0', '111,800.0'],
  ['ETHUSD', '以太坊', '4,105.20', '4,107.40', '220', '-1.41', '4,198.00', '4,080.10'],
  ['AUDUSD', '澳元/美元', '0.65412', '0.65426', '1.4', '-0.34', '0.65780', '0.65300'],
  ['AAPL', '苹果', '251.32', '251.40', '8', '+0.45', '252.10', '249.80'],
];

// 示意 K 线：固定种子，三种方向画同一段走势
function candles(n, w, h, up, down, grid) {
  let s = 7, p = 60;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const data = [];
  for (let i = 0; i < n; i++) {
    const o = p, c = p + (rnd() - 0.47) * 6, hi = Math.max(o, c) + rnd() * 3, lo = Math.min(o, c) - rnd() * 3;
    data.push([o, c, hi, lo]); p = c;
  }
  const max = Math.max(...data.map((d) => d[2])), min = Math.min(...data.map((d) => d[3]));
  const y = (v) => 8 + (h - 16) * (1 - (v - min) / (max - min));
  const cw = w / n;
  let g = '';
  for (let i = 1; i < 5; i++) g += `<line x1="0" x2="${w}" y1="${(h / 5) * i}" y2="${(h / 5) * i}" stroke="${grid}" stroke-width="1"/>`;
  const bars = data.map(([o, c, hi, lo], i) => {
    const col = c >= o ? up : down, x = i * cw + cw / 2;
    return `<line x1="${x}" x2="${x}" y1="${y(hi)}" y2="${y(lo)}" stroke="${col}" stroke-width="1"/>` +
      `<rect x="${x - cw * 0.32}" y="${Math.min(y(o), y(c))}" width="${cw * 0.64}" height="${Math.max(1, Math.abs(y(o) - y(c)))}" fill="${col}"/>`;
  }).join('');
  const last = y(data[n - 1][1]);
  return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${g}${bars}<line x1="0" x2="${w}" y1="${last}" y2="${last}" stroke="${up}" stroke-dasharray="3 3" stroke-width="1"/></svg>`;
}

function spark(seed, up, down, dir) {
  let s = seed, p = 10, pts = [];
  for (let i = 0; i < 24; i++) { s = (s * 9301 + 49297) % 233280; p += (s / 233280 - 0.5) * 3; pts.push(p); }
  const max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i * 80) / 23},${22 - (20 * (v - min)) / (max - min || 1)}`).join('');
  return `<svg width="80" height="24" viewBox="0 0 80 24"><path d="${d}" fill="none" stroke="${(dir ? dir === 'up' : pts[23] >= pts[0]) ? up : down}" stroke-width="1.5"/></svg>`;
}

const chg = (c) => (c.startsWith('+') ? 'up' : 'dn');

function page(title, css, body, w, h) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:${w}px;height:${h}px;overflow:hidden;font-family:-apple-system,'PingFang SC','Noto Sans CJK SC','WenQuanYi Zen Hei',sans-serif;font-size:13px}
.num{font-family:ui-monospace,'SF Mono',Menlo,'DejaVu Sans Mono',monospace;font-variant-numeric:tabular-nums}
.r{text-align:right}.row{display:flex;align-items:center}.sp{flex:1}
.phones{display:flex;gap:28px;padding:24px;height:100%}
.phone{width:390px;height:812px;border-radius:36px;overflow:hidden;position:relative;flex:none;box-shadow:0 0 0 8px #1f2937,0 12px 40px rgba(0,0,0,.25)}
.cap{position:absolute;left:0;right:0;bottom:-30px;text-align:center;font-size:13px;color:#64748b}
.tag{position:absolute;top:10px;right:14px;font-size:11px;padding:2px 8px;border-radius:10px;background:#fde68a;color:#78350f;z-index:9}
${css}</style></head><body>${body}</body></html>`;
}

/* ---------------- 方向 A：加密交易所风格（深色、高密度） ---------------- */
const A = {
  css: `body{background:#0b0e11;color:#eaecef}
.up{color:#0ecb81}.dn{color:#f6465d}.mut{color:#848e9c}
.top{height:48px;background:#181a20;display:flex;align-items:center;padding:0 16px;gap:22px;border-bottom:1px solid #2b3139}
.logo{font-weight:700;color:#f0b90b}
.tick{height:56px;background:#181a20;display:flex;align-items:center;gap:28px;padding:0 16px;border-bottom:1px solid #2b3139}
.tick b{font-size:18px}.tick .k{font-size:11px;color:#848e9c}
.grid{display:grid;grid-template-columns:1fr 260px 300px;grid-template-rows:470px 1fr;gap:1px;background:#2b3139;height:calc(100% - 104px)}
.p{background:#181a20;padding:10px 12px;overflow:hidden}
.ph{font-size:12px;color:#848e9c;margin-bottom:8px;display:flex;gap:14px}.ph .on{color:#eaecef;font-weight:600}
.qt{width:100%;font-size:12px;border-collapse:collapse}.qt td{padding:3px 0}
.inp{background:#2b3139;border-radius:4px;height:36px;display:flex;align-items:center;padding:0 10px;margin-bottom:8px;font-size:12px}
.btn{height:40px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff}
.chips{display:flex;gap:6px;margin-bottom:8px}.chips span{flex:1;text-align:center;border:1px solid #2b3139;border-radius:4px;padding:4px 0;font-size:11px;color:#848e9c}
.pos{width:100%;font-size:12px;border-collapse:collapse}.pos th{color:#848e9c;font-weight:400;text-align:left;padding:6px 8px}.pos td{padding:7px 8px;border-top:1px solid #2b3139}
.m-top{height:44px;display:flex;align-items:center;padding:0 14px;gap:10px;background:#181a20;margin-top:34px}
.m-nav{position:absolute;bottom:0;left:0;right:0;height:64px;background:#181a20;border-top:1px solid #2b3139;display:flex;justify-content:space-around;align-items:center;font-size:11px;color:#848e9c}
.m-nav .on{color:#f0b90b}`,
  desktop() {
    const quotes = Array.from({ length: 18 }, (_, i) => {
      const bid = (4126.1 + Math.sin(i) * 0.6).toFixed(2), ask = (4126.5 + Math.sin(i) * 0.6).toFixed(2);
      return `<tr><td class="num mut">14:0${(i % 6) + 1}:${String((10 + i * 3) % 60).padStart(2, '0')}</td><td class="num r dn">${bid}</td><td class="num r up">${ask}</td></tr>`;
    }).join('');
    const watch = SYMS.slice(0, 9).map((s) => `<tr><td>${s[0]}</td><td class="num r">${s[2]}</td><td class="num r ${chg(s[5])}">${s[5]}%</td></tr>`).join('');
    return `<div class="top"><span class="logo">FalconX</span><span>行情</span><span style="color:#f0b90b">交易</span><span>资产</span><span class="sp"></span><span class="mut">净值</span><b class="num">130,306.00</b><span class="btn" style="background:#f0b90b;color:#181a20;height:30px;padding:0 14px">充值</span></div>
<div class="tick"><b>XAUUSD</b><span class="mut">黄金 ▾</span><b class="num dn">4,126.10</b><div><div class="k">24h 涨跌</div><div class="num dn">-25.81 -0.62%</div></div><div><div class="k">最高</div><div class="num">4,157.35</div></div><div><div class="k">最低</div><div class="num">4,118.20</div></div><div><div class="k">点差</div><div class="num">40</div></div><div><div class="k">隔夜利息 多/空</div><div class="num">-2.1 / +0.8</div></div></div>
<div class="grid">
 <div class="p"><div class="ph"><span>1m</span><span>5m</span><span class="on">15m</span><span>1h</span><span>4h</span><span>1d</span></div><div style="height:420px">${candles(90, 900, 420, '#0ecb81', '#f6465d', '#2b3139')}</div></div>
 <div class="p"><div class="ph"><span class="on">实时报价</span><span>自选</span></div><table class="qt"><tr class="mut"><td>时间</td><td class="r">卖价</td><td class="r">买价</td></tr>${quotes}</table>
   <div class="ph" style="margin-top:10px"><span class="on">自选</span></div><table class="qt">${watch}</table></div>
 <div class="p" style="grid-row:span 2"><div class="ph"><span class="on">逐仓</span><span>50×</span></div>
   <div class="ph"><span class="on">市价</span><span>限价</span><span>止盈止损</span></div>
   <div class="inp mut">价格<span class="sp"></span>市价</div><div class="inp"><span class="mut">数量（手）</span><span class="sp"></span><span class="num">0.10</span></div>
   <div class="chips"><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
   <div class="inp mut">☐ 止盈 / 止损</div>
   <div class="row mut" style="font-size:12px;margin:4px 0">保证金<span class="sp"></span><span class="num" style="color:#eaecef">825.30</span></div>
   <div class="row mut" style="font-size:12px;margin:4px 0 10px">预估强平价<span class="sp"></span><span class="num" style="color:#eaecef">4,054.29</span></div>
   <div style="display:flex;gap:8px"><div class="btn" style="flex:1;background:#0ecb81">买入开多</div><div class="btn" style="flex:1;background:#f6465d">卖出开空</div></div>
   <div style="margin-top:22px" class="ph"><span class="on">账户</span></div>
   ${['净值|130,306.00', '可用|123,477.26', '已用保证金|6,828.74', '保证金水平|1,908.2%'].map((x) => `<div class="row" style="margin:6px 0;font-size:12px"><span class="mut">${x.split('|')[0]}</span><span class="sp"></span><span class="num">${x.split('|')[1]}</span></div>`).join('')}
 </div>
 <div class="p" style="grid-column:span 2"><div class="ph"><span class="on">持仓 (4)</span><span>当前委托 (3)</span><span>历史</span></div>
  <table class="pos"><tr><th>品种</th><th>方向</th><th>手数</th><th>开仓价</th><th>保证金</th><th>强平价</th><th>浮动盈亏</th><th>操作</th></tr>
  <tr><td>XAUUSD 50×</td><td class="up">多</td><td class="num">0.10</td><td class="num">4,120.85</td><td class="num">824.17</td><td class="num" style="color:#f0b90b">4,048.74</td><td class="num up">+52.60</td><td style="color:#f0b90b">平仓　止盈止损</td></tr>
  <tr><td>EURUSD 100×</td><td class="dn">空</td><td class="num">1.00</td><td class="num">1.16420</td><td class="num">1,164.20</td><td class="num" style="color:#f0b90b">1.17468</td><td class="num dn">-3.00</td><td style="color:#f0b90b">平仓　止盈止损</td></tr>
  <tr><td>USDJPY 200×</td><td class="up">多</td><td class="num">2.00</td><td class="num">151.230</td><td class="num">995.97</td><td class="num" style="color:#f0b90b">150.625</td><td class="num up">+794.25</td><td style="color:#f0b90b">平仓　止盈止损</td></tr></table></div>
</div>`;
  },
  mobile() {
    const quotes = Array.from({ length: 11 }, (_, i) => `<div class="row num" style="font-size:12px;padding:3px 0"><span class="dn">${(4126.1 + Math.sin(i) * 0.6).toFixed(2)}</span><span class="sp"></span><span class="up">${(4126.5 + Math.sin(i) * 0.6).toFixed(2)}</span></div>`).join('');
    const list = SYMS.slice(0, 11).map((s) => `<div class="row" style="padding:12px 16px;border-bottom:1px solid #1f242b"><div><div style="font-weight:600">${s[0]}</div><div class="mut" style="font-size:11px">${s[1]}</div></div><span class="sp"></span><span class="num" style="margin-right:14px">${s[3]}</span><span class="num" style="width:76px;text-align:center;padding:6px 0;border-radius:4px;color:#fff;background:${chg(s[5]) === 'up' ? '#0ecb81' : '#f6465d'}">${s[5]}%</span></div>`).join('');
    return `<div class="phones">
<div class="phone" style="background:#0b0e11"><span class="tag">A · 行情</span><div class="m-top"><b>行情</b><span class="sp"></span><span class="mut">🔍</span></div>
 <div class="row" style="gap:16px;padding:8px 16px;font-size:13px"><span style="color:#f0b90b">自选</span><span class="mut">外汇</span><span class="mut">贵金属</span><span class="mut">指数</span><span class="mut">加密</span></div>${list}
 <div class="m-nav"><span>首页</span><span class="on">行情</span><span>交易</span><span>资产</span><span>我的</span></div></div>
<div class="phone" style="background:#0b0e11"><span class="tag">A · 交易（下单内嵌）</span><div class="m-top"><b>XAUUSD</b><span class="num dn">-0.62%</span><span class="sp"></span><span class="mut">📈</span></div>
 <div style="display:flex;gap:10px;padding:8px 14px">
  <div style="flex:1.35"><div class="row" style="gap:6px;margin-bottom:8px"><span class="inp" style="flex:1;margin:0;color:#f0b90b">逐仓</span><span class="inp" style="flex:1;margin:0">50×</span></div>
   <div class="ph"><span class="on">市价</span><span>限价</span><span>止盈止损</span></div>
   <div class="inp mut">市价</div><div class="inp"><span class="mut">数量（手）</span><span class="sp"></span><span class="num">0.10</span></div>
   <div class="chips"><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
   <div class="inp mut" style="font-size:11px">☐ 止盈止损</div>
   <div class="row mut" style="font-size:11px;margin:6px 0">保证金<span class="sp"></span><span class="num" style="color:#eaecef">825.30</span></div>
   <div class="btn" style="background:#0ecb81;margin-bottom:8px">买入开多</div><div class="btn" style="background:#f6465d">卖出开空</div></div>
  <div style="flex:1"><div class="row mut" style="font-size:11px;margin-bottom:4px">卖价<span class="sp"></span>买价</div>${quotes}<div class="num dn" style="font-size:18px;text-align:center;margin-top:6px">4,126.10</div></div></div>
 <div class="ph" style="padding:10px 14px 0;border-top:6px solid #181a20"><span class="on">持仓 (4)</span><span>委托 (3)</span></div>
 <div style="padding:6px 14px"><div class="row"><b>XAUUSD</b>&nbsp;<span class="up" style="font-size:11px">多 50×</span><span class="sp"></span><span class="num up">+52.60</span></div>
  <div class="row mut num" style="font-size:11px;margin-top:4px">开仓 4,120.85　保证金 824.17　强平 4,048.74</div></div>
 <div class="m-nav"><span>首页</span><span>行情</span><span class="on">交易</span><span>资产</span><span>我的</span></div></div>
</div>`;
  },
};

/* ---------------- 方向 B：券商 App 风格（浅色、简洁） ---------------- */
const B = {
  css: `body{background:#f5f7fa;color:#1f2937}
.up{color:#16a34a}.dn{color:#dc2626}.mut{color:#6b7280}
.top{height:60px;background:#fff;display:flex;align-items:center;padding:0 32px;gap:28px;box-shadow:0 1px 0 #e5e7eb}
.logo{font-weight:700;color:#2563eb;font-size:18px}
.card{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.btn{height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;font-size:15px}
.m-top{height:48px;display:flex;align-items:center;padding:0 18px;gap:10px;margin-top:34px;font-size:17px}
.m-nav{position:absolute;bottom:0;left:0;right:0;height:66px;background:#fff;border-top:1px solid #e5e7eb;display:flex;justify-content:space-around;align-items:center;font-size:11px;color:#6b7280}
.m-nav .on{color:#2563eb}
.mask{position:absolute;inset:0;background:rgba(17,24,39,.45)}`,
  desktop() {
    const cards = SYMS.slice(0, 9).map((s, i) => `<div class="card" style="padding:16px 18px"><div class="row"><div><div style="font-weight:600;font-size:15px">${s[0]}</div><div class="mut" style="font-size:12px">${s[1]}</div></div><span class="sp"></span>${spark(i + 3, '#16a34a', '#dc2626', chg(s[5]))}</div>
     <div class="row" style="margin-top:12px"><span class="num" style="font-size:18px;font-weight:600">${s[3]}</span><span class="sp"></span><span class="num ${chg(s[5])}">${s[5]}%</span></div>
     <div class="row" style="gap:8px;margin-top:12px"><span class="btn" style="flex:1;height:34px;font-size:13px;background:#fee2e2;color:#b91c1c">卖 ${s[2]}</span><span class="btn" style="flex:1;height:34px;font-size:13px;background:#dcfce7;color:#15803d">买 ${s[3]}</span></div></div>`).join('');
    return `<div class="top"><span class="logo">FalconX</span><span style="color:#2563eb;font-weight:600">市场</span><span>持仓</span><span>资产</span><span class="sp"></span><span class="mut">净值</span><b class="num">130,306.00</b><span class="btn" style="background:#2563eb;height:36px;padding:0 20px;font-size:14px">充值</span></div>
<div style="padding:24px 32px;position:relative;height:calc(100% - 60px)">
 <div class="row" style="gap:10px;margin-bottom:18px"><span class="btn" style="background:#1f2937;height:32px;padding:0 16px;font-size:13px">热门</span>${['外汇', '贵金属', '原油', '指数', '加密', '股票'].map((t) => `<span class="btn" style="background:#fff;color:#374151;height:32px;padding:0 16px;font-size:13px;box-shadow:0 0 0 1px #e5e7eb">${t}</span>`).join('')}<span class="sp"></span><span class="card mut" style="padding:8px 14px;width:260px">🔍 搜索品种</span></div>
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${cards}</div>
 <div class="mask" style="position:absolute;inset:0"></div>
 <div class="card" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:440px;padding:24px">
  <div class="row"><b style="font-size:17px">买入 XAUUSD</b><span class="sp"></span><span class="mut">✕</span></div>
  <div class="mut" style="margin:6px 0 18px">买价 <span class="num up">4,126.50</span></div>
  <div class="mut" style="font-size:12px;margin-bottom:6px">投入保证金（USDT）</div>
  <div class="row card" style="box-shadow:0 0 0 1px #d1d5db;padding:12px 14px;font-size:20px"><span class="mut">－</span><span class="sp"></span><b class="num">825.30</b><span class="sp"></span><span class="mut">＋</span></div>
  <div class="mut" style="font-size:12px;margin:14px 0 6px">杠杆</div>
  <div class="row" style="gap:8px">${['10×', '20×', '50×', '100×', '200×'].map((x) => `<span class="btn" style="flex:1;height:34px;font-size:13px;${x === '50×' ? 'background:#2563eb' : 'background:#f3f4f6;color:#374151'}">${x}</span>`).join('')}</div>
  <div class="row" style="margin:16px 0 6px"><span class="mut">止损</span><span class="sp"></span><span>未设置 ›</span></div>
  <div class="row" style="margin-bottom:16px"><span class="mut">止盈</span><span class="sp"></span><span>未设置 ›</span></div>
  <div class="row mut" style="font-size:12px;margin-bottom:16px">≈ 0.10 手 · 预估强平价 <span class="num" style="color:#c2410c">&nbsp;4,054.29</span></div>
  <div class="btn" style="background:#16a34a">确认买入</div></div>
</div>`;
  },
  mobile() {
    const list = SYMS.slice(0, 9).map((s, i) => `<div class="row" style="padding:14px 18px;background:#fff;border-bottom:1px solid #f3f4f6"><div style="width:110px"><div style="font-weight:600;font-size:15px">${s[0]}</div><div class="mut" style="font-size:12px">${s[1]}</div></div>${spark(i + 3, '#16a34a', '#dc2626', chg(s[5]))}<span class="sp"></span><div class="r"><div class="num" style="font-size:15px">${s[3]}</div><div class="num ${chg(s[5])}" style="font-size:12px">${s[5]}%</div></div></div>`).join('');
    return `<div class="phones">
<div class="phone" style="background:#f5f7fa"><span class="tag">B · 市场</span><div class="m-top"><b>市场</b><span class="sp"></span><span class="mut">🔍</span></div>
 <div class="row" style="gap:8px;padding:6px 18px 12px">${['热门', '外汇', '贵金属', '加密'].map((t, i) => `<span class="btn" style="height:30px;padding:0 14px;font-size:13px;${i ? 'background:#fff;color:#374151' : 'background:#1f2937'}">${t}</span>`).join('')}</div>${list}
 <div class="m-nav"><span class="on">市场</span><span>持仓</span><span>资产</span><span>我的</span></div></div>
<div class="phone" style="background:#fff"><span class="tag">B · 全屏下单页</span><div class="m-top"><span>‹</span><b style="margin:auto">买入 XAUUSD</b><span style="width:12px"></span></div>
 <div style="padding:10px 22px">
  <div class="mut r" style="font-size:12px">买价 <span class="num up">4,126.50</span></div>
  <div style="text-align:center;margin:28px 0 6px" class="mut">投入保证金（USDT）</div>
  <div class="num" style="text-align:center;font-size:40px;font-weight:600">825.30</div>
  <div class="mut" style="text-align:center;font-size:12px;margin:6px 0 26px">≈ 0.10 手 · 可用 123,477.26</div>
  <div class="mut" style="font-size:13px;margin-bottom:8px">杠杆</div>
  <div class="row" style="gap:8px">${['10×', '20×', '50×', '100×', '200×'].map((x) => `<span class="btn" style="flex:1;height:36px;font-size:13px;${x === '50×' ? 'background:#2563eb' : 'background:#f3f4f6;color:#374151'}">${x}</span>`).join('')}</div>
  <div style="margin-top:22px;border-top:1px solid #f3f4f6">${['止损|未设置 ›', '止盈|未设置 ›', '预估强平价|4,054.29', '手续费|2.06'].map((x) => `<div class="row" style="padding:14px 0;border-bottom:1px solid #f3f4f6"><span class="mut">${x.split('|')[0]}</span><span class="sp"></span><span class="num">${x.split('|')[1]}</span></div>`).join('')}</div>
 </div>
 <div style="position:absolute;left:22px;right:22px;bottom:34px"><div class="btn" style="background:#16a34a;height:52px;border-radius:26px">滑动或点击确认买入</div></div></div>
</div>`;
  },
};

/* ---------------- 方向 C（推荐）：CFD 终端骨架 + 深色现代视觉 ---------------- */
const C = {
  css: `body{background:#0d1117;color:#e6edf3}
.up{color:#22c55e}.dn{color:#f43f5e}.mut{color:#8b98a9}
.top{height:52px;background:#131a24;display:flex;align-items:center;padding:0 18px;gap:24px;border-bottom:1px solid #222c3a}
.logo{font-weight:700;color:#22d3ee}
.on-nav{color:#22d3ee}
.p{background:#131a24;border-radius:10px;overflow:hidden}
.ph{display:flex;gap:16px;padding:10px 14px;font-size:12px;color:#8b98a9;border-bottom:1px solid #222c3a}.ph .on{color:#e6edf3;font-weight:600}
.wl{width:100%;border-collapse:collapse;font-size:12px}.wl td{white-space:nowrap;padding:7px 10px;border-bottom:1px solid #1a2230}.wl tr.sel td{background:#1b2533}
.pb{border-radius:8px;padding:6px 12px;min-width:120px}.pb .k{font-size:11px;opacity:.8}.pb .v{font-size:17px;font-weight:600}
.sell{background:rgba(244,63,94,.14);color:#fb7185;border:1px solid rgba(244,63,94,.4)}
.buy{background:rgba(34,197,94,.14);color:#4ade80;border:1px solid rgba(34,197,94,.4)}
.seg{display:flex;background:#0d1117;border-radius:8px;padding:3px}.seg span{flex:1;text-align:center;padding:7px 0;border-radius:6px;font-size:13px;color:#8b98a9}.seg .on{background:#222c3a;color:#e6edf3}
.fld{background:#0d1117;border:1px solid #222c3a;border-radius:8px;height:42px;display:flex;align-items:center;padding:0 12px}
.chip{flex:1;text-align:center;border:1px solid #222c3a;border-radius:6px;padding:6px 0;font-size:12px;color:#8b98a9}.chip.on{border-color:#22d3ee;color:#22d3ee}
.btn{height:46px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;font-size:15px}
.pos{width:100%;font-size:12px;border-collapse:collapse}.pos th{color:#8b98a9;font-weight:400;text-align:left;padding:7px 12px}.pos td{padding:8px 12px;border-top:1px solid #1a2230}
.lnk{color:#22d3ee}
.m-top{height:46px;display:flex;align-items:center;padding:0 16px;gap:10px;margin-top:34px}
.m-nav{position:absolute;bottom:0;left:0;right:0;height:66px;background:#131a24;border-top:1px solid #222c3a;display:flex;justify-content:space-around;align-items:center;font-size:11px;color:#8b98a9}
.m-nav .on{color:#22d3ee}
.mask{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.sheet{position:absolute;left:0;right:0;bottom:0;background:#131a24;border-radius:18px 18px 0 0;padding:10px 16px 26px}`,
  topbar(active) {
    return `<div class="top"><span class="logo">FalconX</span>${['行情', '交易', '资产', '我的'].map((t) => `<span class="${t === active ? 'on-nav' : ''}">${t}</span>`).join('')}<span class="sp"></span>
<span class="mut" style="font-size:12px">净值</span><b class="num">130,306.00</b><span class="mut" style="font-size:12px">可用</span><b class="num">123,477.26</b><span class="mut" style="font-size:12px">保证金水平</span><b class="num up">1,908%</b><span class="btn" style="height:32px;padding:0 16px;font-size:13px;background:#0891b2">充值</span><span class="mut">🔔</span></div>`;
  },
  desktop() {
    const wl = SYMS.slice(0, 12).map((s, i) => `<tr class="${i ? '' : 'sel'}"><td><div style="font-weight:600">${s[0]}</div><div class="mut" style="font-size:11px">${s[1]}</div></td><td class="num r dn">${s[2]}</td><td class="num r up">${s[3]}</td><td class="num r ${chg(s[5])}">${s[5]}%</td></tr>`).join('');
    return `${this.topbar('交易')}
<div style="display:grid;grid-template-columns:330px 1fr 320px;gap:8px;padding:8px;height:calc(100% - 52px)">
 <div class="p"><div style="padding:10px"><div class="fld mut" style="height:34px">🔍 搜索品种</div></div>
  <div class="ph" style="gap:12px"><span class="on">★ 自选</span><span>外汇</span><span>金属</span><span>指数</span><span>加密</span><span>更多</span></div>
  <table class="wl"><tr class="mut" style="font-size:11px"><td>品种</td><td class="r">卖价</td><td class="r">买价</td><td class="r">涨跌</td></tr>${wl}</table></div>
 <div style="display:grid;grid-template-rows:1fr 250px;gap:8px;min-height:0">
  <div class="p" style="position:relative"><div class="row" style="padding:10px 14px;gap:22px"><b style="font-size:17px">XAUUSD</b><span class="mut">黄金</span><span class="num dn">-25.81 (-0.62%)</span><span class="mut" style="font-size:12px">高 <span class="num">4,157.35</span>　低 <span class="num">4,118.20</span>　点差 <span class="num">40</span></span><span class="sp"></span><span class="mut" style="font-size:12px">1m　5m　<span class="lnk">15m</span>　1h　4h　1d</span></div>
   <div class="row" style="position:absolute;left:14px;top:50px;gap:8px;z-index:2"><div class="pb sell"><div class="k">卖出</div><div class="v num">4,126.10</div></div><div class="pb buy"><div class="k">买入</div><div class="v num">4,126.50</div></div></div>
   <div style="position:absolute;left:0;right:0;top:44px;bottom:0">${candles(90, 900, 380, '#22c55e', '#f43f5e', '#1a2230')}</div></div>
  <div class="p"><div class="ph"><span class="on">持仓 4</span><span>挂单 3</span><span>历史</span><span class="sp"></span><span>浮动盈亏 <span class="num up">+1,851.19</span></span></div>
   <table class="pos"><tr><th>品种</th><th>方向·杠杆</th><th>手数</th><th>开仓价</th><th>现价</th><th>保证金</th><th>止盈/止损</th><th>强平价</th><th>浮动盈亏</th><th></th></tr>
   <tr><td>XAUUSD</td><td class="up">买 · 50×</td><td class="num">0.10</td><td class="num">4,120.85</td><td class="num">4,126.10</td><td class="num">824.17</td><td class="num">4,180 / 4,095</td><td class="num" style="color:#fb923c">4,048.74</td><td class="num up">+52.60</td><td><span class="lnk">平仓</span>　<span class="mut">⋯</span></td></tr>
   <tr><td>EURUSD</td><td class="dn">卖 · 100×</td><td class="num">1.00</td><td class="num">1.16420</td><td class="num">1.16443</td><td class="num">1,164.20</td><td class="mut">— / 1.16900</td><td class="num" style="color:#fb923c">1.17468</td><td class="num dn">-3.00</td><td><span class="lnk">平仓</span>　<span class="mut">⋯</span></td></tr>
   <tr><td>USDJPY</td><td class="up">买 · 200×</td><td class="num">2.00</td><td class="num">151.230</td><td class="num">151.845</td><td class="num">995.97</td><td class="mut">153.000 / —</td><td class="num" style="color:#fb923c">150.625</td><td class="num up">+794.25</td><td><span class="lnk">平仓</span>　<span class="mut">⋯</span></td></tr>
   <tr><td>NAS100</td><td class="up">买 · 50×</td><td class="num">1.50</td><td class="num">24,650.0</td><td class="num">24,650.0</td><td class="num">739.50</td><td class="mut">25,200 / —</td><td class="num" style="color:#fb923c">24,280.3</td><td class="num up">+244.95</td><td><span class="lnk">平仓</span>　<span class="mut">⋯</span></td></tr></table></div></div>
 <div class="p" style="padding:14px;display:flex;flex-direction:column;gap:12px">
  <div class="row"><b>下单</b><span class="sp"></span><span class="mut" style="font-size:12px">逐仓</span></div>
  <div class="seg"><span class="on" style="background:rgba(244,63,94,.2);color:#fb7185">卖出 4,126.10</span><span>买入 4,126.50</span></div>
  <div class="seg"><span class="on">市价</span><span>限价</span></div>
  <div><div class="row mut" style="font-size:12px;margin-bottom:6px">手数<span class="sp"></span>0.01 – 20.00</div><div class="fld"><span class="mut">－</span><span class="sp"></span><b class="num">0.10</b><span class="sp"></span><span class="mut">＋</span></div></div>
  <div><div class="row mut" style="font-size:12px;margin-bottom:6px">杠杆<span class="sp"></span>上限 200×</div><div class="row" style="gap:6px">${['10×', '20×', '50×', '100×', '200×'].map((x) => `<span class="chip ${x === '50×' ? 'on' : ''}">${x}</span>`).join('')}</div></div>
  <div class="row fld" style="height:38px"><span class="mut">止盈 / 止损</span><span class="sp"></span><span class="mut">未设置 ▾</span></div>
  <div style="background:#0d1117;border-radius:8px;padding:10px 12px;font-size:12px">${['保证金|825.30', '手续费|2.06', '预估强平价|4,198.31', '可用|123,477.26'].map((x, i) => `<div class="row" style="margin:3px 0"><span class="mut">${x.split('|')[0]}</span><span class="sp"></span><span class="num" ${i === 2 ? 'style="color:#fb923c"' : ''}>${x.split('|')[1]}</span></div>`).join('')}</div>
  <span class="sp"></span><div class="btn" style="background:#e11d48">卖出 0.10 手 XAUUSD</div></div>
</div>`;
  },
  markets() {
    const rows = SYMS.map((s, i) => `<tr><td style="width:36px" class="mut">☆</td><td><b>${s[0]}</b>　<span class="mut">${s[1]}</span></td><td class="num r dn">${s[2]}</td><td class="num r up">${s[3]}</td><td class="num r mut">${s[4]}</td><td class="num r ${chg(s[5])}">${s[5]}%</td><td class="num r">${s[6]}</td><td class="num r">${s[7]}</td><td class="r">${spark(i + 3, '#22c55e', '#f43f5e', chg(s[5]))}</td><td class="r"><span class="pb sell" style="min-width:0;padding:4px 10px;font-size:12px">卖</span> <span class="pb buy" style="min-width:0;padding:4px 10px;font-size:12px">买</span></td></tr>`).join('');
    return `${this.topbar('行情')}
<div style="padding:20px 28px">
 <div class="row" style="gap:10px;margin-bottom:14px"><b style="font-size:20px;margin-right:16px">行情</b>${['★ 自选', '全部', '外汇', '贵金属', '原油', '指数', '加密', '美股'].map((t, i) => `<span class="chip ${i === 1 ? 'on' : ''}" style="flex:none;padding:6px 14px">${t}</span>`).join('')}<span class="sp"></span><div class="fld mut" style="width:280px;height:36px">🔍 搜索品种代码或名称</div></div>
 <div class="p"><table class="pos" style="font-size:13px"><tr><th></th><th>品种</th><th class="r">卖价</th><th class="r">买价</th><th class="r">点差</th><th class="r">今日涨跌</th><th class="r">最高</th><th class="r">最低</th><th class="r">24 小时走势</th><th class="r">交易</th></tr>${rows}</table></div>
 <div class="mut" style="font-size:12px;margin-top:10px">点任一行进入交易页；点"卖/买"直接打开该方向的下单面板。</div>
</div>`;
  },
  mobile() {
    const list = SYMS.slice(0, 10).map((s) => `<div class="row" style="padding:11px 16px;border-bottom:1px solid #1a2230"><div style="width:112px"><div style="font-weight:600">${s[0]}</div><div class="mut" style="font-size:11px">${s[1]}</div></div><div class="num r" style="flex:1;font-size:12px"><div class="dn">${s[2]}</div><div class="up">${s[3]}</div></div><span class="num" style="width:74px;margin-left:12px;text-align:center;padding:7px 0;border-radius:6px;color:#fff;font-size:12px;background:${chg(s[5]) === 'up' ? '#16a34a' : '#e11d48'}">${s[5]}%</span></div>`).join('');
    const detail = (inner, tag) => `<div class="phone" style="background:#0d1117"><span class="tag">${tag}</span>
 <div class="m-top"><span>‹</span><b>XAUUSD</b><span class="mut" style="font-size:12px">黄金 ▾</span><span class="sp"></span><span>☆</span></div>
 <div style="padding:0 16px"><div class="row"><b class="num dn" style="font-size:28px">4,126.10</b><span class="sp"></span><div class="r mut" style="font-size:11px">高 <span class="num">4,157.35</span><br>低 <span class="num">4,118.20</span></div></div><div class="num dn" style="font-size:12px">-25.81 (-0.62%)　<span class="mut">点差 40</span></div></div>
 <div class="row mut" style="gap:18px;padding:10px 16px;font-size:12px"><span>1m</span><span>5m</span><span class="lnk">15m</span><span>1h</span><span>4h</span><span>1d</span></div>
 <div style="height:330px">${candles(48, 390, 330, '#22c55e', '#f43f5e', '#1a2230')}</div>
 <div style="padding:12px 16px"><div class="row mut" style="font-size:12px">我的持仓 · XAUUSD<span class="sp"></span>全部 ›</div>
  <div class="row" style="margin-top:8px;font-size:13px"><span class="up">买 0.10 手 · 50×</span><span class="sp"></span><span class="num up">+52.60</span></div></div>
 <div class="row" style="position:absolute;left:0;right:0;bottom:66px;gap:10px;padding:10px 16px;background:#0d1117;border-top:1px solid #1a2230"><div class="btn" style="flex:1;background:#e11d48;flex-direction:column;line-height:1.2"><span style="font-size:12px;font-weight:400">卖出</span><span class="num">4,126.10</span></div><div class="btn" style="flex:1;background:#16a34a;flex-direction:column;line-height:1.2"><span style="font-size:12px;font-weight:400">买入</span><span class="num">4,126.50</span></div></div>
 <div class="m-nav"><span>行情</span><span class="on">交易</span><span>持仓</span><span>资产</span><span>我的</span></div>${inner}</div>`;
    const sheet = `<div class="mask"></div><div class="sheet">
  <div style="width:40px;height:4px;border-radius:2px;background:#334155;margin:0 auto 12px"></div>
  <div class="row" style="margin-bottom:12px"><b style="font-size:16px">买入 XAUUSD</b><span class="sp"></span><span class="mut" style="font-size:12px">逐仓 · 切换为卖出 ⇄</span></div>
  <div class="seg" style="margin-bottom:14px"><span class="on">市价 <span class="num">4,126.50</span></span><span>限价</span></div>
  <div class="row mut" style="font-size:12px;margin-bottom:6px">手数<span class="sp"></span>可开 ≤ 20.00</div>
  <div class="fld" style="height:48px;margin-bottom:8px"><span style="font-size:20px" class="mut">－</span><span class="sp"></span><b class="num" style="font-size:20px">0.10</b><span class="sp"></span><span style="font-size:20px" class="mut">＋</span></div>
  <div class="row" style="gap:6px;margin-bottom:14px">${['0.01', '0.10', '0.50', '1.00'].map((x) => `<span class="chip ${x === '0.10' ? 'on' : ''}">${x}</span>`).join('')}</div>
  <div class="row" style="padding:10px 0;border-top:1px solid #222c3a"><span class="mut">杠杆</span><span class="sp"></span><span class="lnk">50× ›</span></div>
  <div class="row" style="padding:10px 0;border-top:1px solid #222c3a;border-bottom:1px solid #222c3a"><span class="mut">止盈 / 止损</span><span class="sp"></span><span class="mut">未设置 ›</span></div>
  <div class="row" style="margin:12px 0 4px;font-size:13px"><span class="mut">保证金</span><span class="sp"></span><b class="num">825.30 USDT</b></div>
  <div class="row" style="margin-bottom:14px;font-size:12px"><span class="mut">预估强平价</span><span class="sp"></span><span class="num" style="color:#fb923c">4,054.29</span>　<span class="mut">明细 ▾</span></div>
  <div class="btn" style="background:#16a34a;height:50px">确认买入 0.10 手</div></div>`;
    return `<div class="phones" style="gap:40px">
<div class="phone" style="background:#0d1117"><span class="tag">C · ① 行情</span><div class="m-top"><b>行情</b><span class="sp"></span><span class="mut">🔍</span></div>
 <div class="row" style="gap:16px;padding:6px 16px 10px;font-size:13px"><span class="lnk">★ 自选</span><span class="mut">外汇</span><span class="mut">贵金属</span><span class="mut">指数</span><span class="mut">加密</span></div>
 <div class="row mut" style="font-size:11px;padding:0 16px 6px"><span style="width:112px">品种</span><span class="r" style="flex:1">卖价 / 买价</span><span style="width:86px;text-align:center">涨跌</span></div>${list}
 <div class="m-nav"><span class="on">行情</span><span>交易</span><span>持仓</span><span>资产</span><span>我的</span></div></div>
${detail('', 'C · ② 品种页')}
${detail(sheet, 'C · ③ 下单抽屉')}
</div>`;
  },
};

const out = path.join(__dirname);
const files = [
  ['A-桌面-交易页', A, A.desktop(), 1440, 860],
  ['A-手机', A, A.mobile(), 866, 860],
  ['B-桌面-行情与下单', B, B.desktop(), 1440, 860],
  ['B-手机', B, B.mobile(), 866, 860],
  ['C-桌面-交易页', C, C.desktop(), 1440, 860],
  ['C-桌面-行情页', C, C.markets(), 1440, 860],
  ['C-手机', C, C.mobile(), 1338, 860],
];
for (const [name, d, body, w, h] of files) {
  fs.writeFileSync(path.join(out, name + '.html'), page(name, d.css, body, w, h));
  console.log('wrote', name, w, h);
}
