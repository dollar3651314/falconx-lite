// Quick Come 官网风格方向对比图生成器（v2 官网风格调研，见 需求文档/v2-官网风格调研.md）。
// 运行：node gen.cjs → 在本目录生成 A/B/C 三个方向的 电脑版 / 手机版 HTML（共 6 个）。
// 截图：用无头浏览器打开 `xxx.html?static=1`（关闭模拟跳动，固定示例数字），电脑版 1440 宽、手机版 390 宽整页截图。
// 不带 ?static 打开时，行情每秒随机跳动并闪绿/红，用来演示效果。
// 约束：只用系统字体（数字优先用自托管的开源字体 JetBrains Mono，本机没有就退回系统等宽字体）；不引用任何外部资源（AC-29）。
// 所有行情数字都是示例值，页面上标注"示例行情"；牌照、监管、公司资质一律写"待提供"。
const fs = require('fs');
const path = require('path');

// 示例行情：代码、中文名、英文名、卖价、当日涨跌幅（%）、小数位、分类
const SYMS = [
  ['XAUUSD', '黄金', 'Gold', 4126.35, 0.62, 2, '贵金属'],
  ['XAGUSD', '白银', 'Silver', 48.625, 1.12, 3, '贵金属'],
  ['EURUSD', '欧元/美元', 'EUR/USD', 1.1642, 0.18, 5, '外汇'],
  ['GBPUSD', '英镑/美元', 'GBP/USD', 1.33185, -0.21, 5, '外汇'],
  ['USDJPY', '美元/日元', 'USD/JPY', 151.842, 0.35, 3, '外汇'],
  ['USDCNH', '美元/离岸人民币', 'USD/CNH', 7.1325, -0.06, 5, '外汇'],
  ['NAS100', '纳指 100', 'Nasdaq 100', 24812.6, 0.84, 1, '指数'],
  ['XTIUSD', '美国原油', 'US Crude', 61.82, -1.35, 2, '能源'],
  ['BTCUSD', '比特币', 'Bitcoin', 112480.5, -0.92, 1, '加密货币'],
  ['ETHUSD', '以太坊', 'Ethereum', 4086.2, -1.41, 2, '加密货币'],
];
const FLASH = { 0: 'up', 3: 'down', 8: 'down' }; // 截图里固定展示的"刚刚变动"状态

const fmt = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p) => (p >= 0 ? '+' : '') + p.toFixed(2) + '%';

// 示意走势小图（固定种子）
function spark(i, w, h, col) {
  let s = 11 + i * 7, v = 50;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts = [];
  const trend = SYMS[i][4] >= 0 ? 0.35 : -0.35;
  for (let k = 0; k < 24; k++) { v += (rnd() - 0.5) * 6 + trend; pts.push(v); }
  const max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${((k / 23) * w).toFixed(1)},${(2 + (h - 4) * (1 - (p - min) / (max - min || 1))).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
}

// 文案（中文版；英文版由 i18n 文件提供，这里只画中文）
const T = {
  brand: 'Quick Come',
  nav: ['行情', '交易品种', '平台', '资金安全', '帮助中心'],
  slogan: '快人一步，交易全球行情',
  sub: '用 USDT 交易黄金、外汇、指数、原油和加密货币差价合约。手机打开就能交易，不用下载。',
  reg: '免费注册', login: '登录',
  heroPoints: ['USDT 充值和提现', '约 50 个热门品种', '手机、电脑都能用'],
  ticker: '实时行情', sample: '示例行情', tabs: ['热门', '贵金属', '外汇', '指数', '加密货币'],
  cols: ['品种', '卖价', '今日涨跌'],
  adv: [
    ['一个 USDT 账户', '充值 USDT 就能交易全部品种，盈亏、手续费都按 USDT 结算，不用换汇。'],
    ['报价透明', '买价、卖价、点差一目了然；下单前显示保证金、手续费和预估强平价。'],
    ['手机优先', '为手机重新设计的下单流程，三次点击完成下单；可添加到主屏幕，像 App 一样打开。'],
    ['风险可控', '逐仓保证金、止盈止损、追保提醒，单笔亏损不会影响其他持仓。'],
  ],
  hot: [
    ['贵金属', 'XAUUSD 黄金 · XAGUSD 白银'],
    ['外汇', 'EURUSD · GBPUSD · USDJPY · USDCNH'],
    ['指数', 'NAS100 纳指 · US30 道指 · GER40 德指'],
    ['能源', 'XTIUSD 美国原油'],
    ['加密货币', 'BTCUSD 比特币 · ETHUSD 以太坊'],
  ],
  steps: [
    ['注册', '用邮箱注册，1 分钟完成'],
    ['充值', '向你的专属地址转入 USDT，支持 ERC20 / TRC20 / BSC，最小 1 USDT'],
    ['交易', '选品种、选手数，一键买入或卖出'],
  ],
  safe: [
    ['专属充值地址', '每个账户独立的 USDT 充值地址，到账自动入账。'],
    ['提现多重确认', '只能提到白名单地址；新地址有冷静期；每笔提现人工审核。'],
    ['身份认证', '完成身份认证（KYC）后才能提现，保护账户安全。'],
  ],
  license: '监管与牌照信息：待提供',
  faq: ['什么是差价合约（CFD）？', '支持哪些充值网络？最少充多少？', '提现需要多久？', '交易时间是什么时候？', '手机上怎么使用？'],
  faqA0: '差价合约是一种按价格涨跌结算盈亏的合约，你不持有实物资产，可以买涨也可以卖跌。杠杆会同时放大盈利和亏损。',
  risk: '风险提示：差价合约是复杂的金融产品，因杠杆作用，亏损可能迅速扩大，你可能损失全部保证金。请确认你了解其运作方式，并能承受相应风险。本网站信息不构成投资建议。',
  links: ['服务条款', '隐私政策', '风险披露'],
  company: '公司信息：待提供',
};

// 行情跳动脚本：每秒随机改 3 个品种的价格，闪绿/红 600 毫秒；?static=1 时不跳
const TICK_JS = `<script>
(function(){
  if (location.search.indexOf('static') >= 0) return;
  document.documentElement.classList.add('anim');
  document.querySelectorAll('.flash-up,.flash-down').forEach(function(e){e.classList.remove('flash-up','flash-down');});
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-sym]'));
  setInterval(function(){
    for (var k = 0; k < 3; k++) {
      var r = rows[Math.floor(Math.random() * rows.length)]; if (!r) return;
      var px = r.querySelector('[data-px]'), d = +r.getAttribute('data-d'), v = +r.getAttribute('data-v');
      var up = Math.random() > 0.5, nv = v * (1 + (up ? 1 : -1) * Math.random() * 0.0004);
      r.setAttribute('data-v', nv);
      px.textContent = nv.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
      r.classList.remove('flash-up','flash-down'); void r.offsetWidth; r.classList.add(up ? 'flash-up' : 'flash-down');
      (function(el){ setTimeout(function(){ el.classList.remove('flash-up','flash-down'); }, 600); })(r);
    }
  }, 1000);
})();
</script>`;

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans CJK SC','Hiragino Sans GB','WenQuanYi Zen Hei',sans-serif;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;line-height:1.5}
.num{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace;letter-spacing:-0.01em}
a{color:inherit;text-decoration:none}
.tag-sample{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px dashed currentColor;opacity:.9}
.tbd{border:1px dashed currentColor;border-radius:8px;padding:10px 14px;opacity:.85}
.risk-bar{font-size:12px;padding:6px 16px;text-align:center}
[data-sym]{transition:background-color .6s}
`;

function page(title, css, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}${css}</style></head>
<body>${body}${TICK_JS}</body></html>
`;
}

const logo = (mark, text) => `<a class="logo"><span class="mark">${mark}</span><span class="word">Quick Come</span></a>`;
const row = (s, i, opts = {}) => {
  const [code, zh, , v, p, d] = s;
  const fl = FLASH[i] ? ` flash-${FLASH[i]}` : '';
  const dir = p >= 0 ? 'up' : 'down';
  return `<div class="q-row${fl}" data-sym="${code}" data-v="${v}" data-d="${d}">
  <div class="q-name"><b>${code}</b><span>${zh}</span></div>
  ${opts.spark ? `<div class="q-spark">${spark(i, opts.spark[0], opts.spark[1], p >= 0 ? opts.up : opts.down)}</div>` : ''}
  <div class="q-px num" data-px>${fmt(v, d)}</div>
  <div class="q-chg num ${dir}">${opts.chip ? `<span class="chip ${dir}">${pct(p)}</span>` : pct(p)}</div>
  ${opts.btn ? `<div class="q-act"><a class="btn-mini">${opts.btn}</a></div>` : ''}
</div>`;
};

// ---------- 方向 A：与客户端风格 C 一致（CFD 终端 + 现代深色） ----------
const A_VARS = `:root{--bg:#0d1117;--s1:#131a24;--s2:#0f151e;--s3:#1b2533;--border:#222c3a;--hair:#1a2230;--text:#e6edf3;--muted:#a3b0c2;--subtle:#8b98a9;--cyan:#22d3ee;--primary:#0891b2;--up:#22c55e;--down:#f43f5e;--up-soft:rgba(34,197,94,.16);--down-soft:rgba(244,63,94,.16)}
body{background:var(--bg);color:var(--text)}
.risk-bar{background:var(--s2);color:var(--subtle);border-bottom:1px solid var(--hair)}
.logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:18px;letter-spacing:-.01em}
.mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#22d3ee,#0891b2);color:#04121a;display:grid;place-items:center;font-weight:900;font-size:15px}
.up{color:var(--up)}.down{color:var(--down)}
.chip{display:inline-block;min-width:76px;text-align:center;padding:4px 8px;border-radius:6px;font-weight:700;color:#fff}
.chip.up{background:#16a34a}.chip.down{background:#e11d48}
.flash-up{background:var(--up-soft)!important}.flash-down{background:var(--down-soft)!important}
.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 22px;border-radius:8px;font-weight:700;font-size:15px}
.btn.pri{background:var(--primary);color:#fff}.btn.sec{border:1px solid var(--border);color:var(--text);background:var(--s1)}
.btn-mini{display:inline-block;padding:4px 12px;border-radius:6px;border:1px solid var(--border);font-size:12px;color:var(--cyan)}
.card{background:var(--s1);border:1px solid var(--border);border-radius:12px}
.sec-title{font-size:26px;font-weight:800;letter-spacing:-.01em}
.sec-sub{color:var(--muted);margin-top:6px}
.tag-sample{color:#fbbf24}
`;

function A_desktop() {
  const css = A_VARS + `
.wrap{width:1200px;margin:0 auto}
header{height:64px;border-bottom:1px solid var(--hair);background:rgba(13,17,23,.92)}
header .wrap{display:flex;align-items:center;height:100%;gap:36px}
header nav{display:flex;gap:26px;color:var(--muted);font-size:14px;flex:1}
header .right{display:flex;align-items:center;gap:12px}
.lang{font-size:13px;color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:4px 8px}
.lang b{color:var(--text)}
.hero{padding:56px 0 64px;background:radial-gradient(800px 360px at 80% 20%,rgba(34,211,238,.10),transparent 60%)}
.hero .wrap{display:grid;grid-template-columns:1fr 560px;gap:56px;align-items:center}
h1{font-size:52px;line-height:1.15;font-weight:800;letter-spacing:-.02em}
h1 em{font-style:normal;color:var(--cyan)}
.hero p{color:var(--muted);font-size:17px;margin:18px 0 28px;max-width:520px}
.cta{display:flex;gap:12px}
.points{display:flex;gap:22px;margin-top:28px;color:var(--subtle);font-size:13px}
.points span::before{content:'✓ ';color:var(--up)}
.board{padding:14px 0 6px}
.board-head{display:flex;align-items:center;justify-content:space-between;padding:0 18px 10px}
.board-head h3{font-size:15px;display:flex;align-items:center;gap:8px}
.live{width:8px;height:8px;border-radius:50%;background:var(--up);box-shadow:0 0 0 4px rgba(34,197,94,.18)}
.tabs{display:flex;gap:6px;padding:0 18px 10px;font-size:13px}
.tabs span{padding:4px 10px;border-radius:6px;color:var(--muted)}.tabs span.on{background:var(--s3);color:var(--text)}
.q-head,.q-row{display:grid;grid-template-columns:1.5fr 90px 1fr 100px;align-items:center;padding:0 18px;gap:12px}
.q-head{font-size:12px;color:var(--subtle);height:30px;border-top:1px solid var(--hair)}
.q-row{height:44px;border-top:1px solid var(--hair);cursor:pointer}
.q-name b{font-size:14px}.q-name span{color:var(--subtle);font-size:12px;margin-left:8px}
.q-px{text-align:right;font-size:15px;font-weight:600}.q-chg{text-align:right}
.board-foot{display:flex;justify-content:space-between;padding:10px 18px 4px;font-size:12px;color:var(--subtle);border-top:1px solid var(--hair)}
.board-foot a{color:var(--cyan)}
section{padding:72px 0;border-top:1px solid var(--hair)}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:28px}
.grid4 .card,.grid3 .card,.grid5 .card{padding:22px}
.ico{width:36px;height:36px;border-radius:8px;background:rgba(34,211,238,.12);color:var(--cyan);display:grid;place-items:center;font-weight:800;margin-bottom:14px}
.card h4{font-size:16px;margin-bottom:6px}.card p{color:var(--muted);font-size:14px}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:28px}
.grid5 .card h4{display:flex;justify-content:space-between}.grid5 .card h4 i{font-style:normal;color:var(--cyan);font-size:13px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px;counter-reset:s}
.step{position:relative;padding:22px 22px 22px 74px}
.step::before{counter-increment:s;content:counter(s);position:absolute;left:22px;top:22px;width:36px;height:36px;border-radius:50%;border:1px solid var(--cyan);color:var(--cyan);display:grid;place-items:center;font-weight:800}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px}
.license{margin-top:16px;color:#fbbf24;font-size:14px}
.faq{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.faq .card{padding:16px 20px;display:flex;justify-content:space-between;font-weight:600}
.faq .card.open{grid-column:1/3;display:block}.faq .card.open p{font-weight:400;margin-top:8px}
.faq .card span{color:var(--subtle)}
.final{text-align:center}
footer{background:var(--s2);border-top:1px solid var(--border);padding:36px 0;color:var(--subtle);font-size:13px}
footer .links{display:flex;gap:24px;margin:16px 0;color:var(--muted)}
footer .tbd{margin-top:12px;color:#fbbf24;display:inline-block}
`;
  const body = `
<div class="risk-bar">${T.risk.slice(0, 60)}… <a style="text-decoration:underline">风险披露</a></div>
<header><div class="wrap">${logo('Q')}<nav>${T.nav.map((n) => `<a>${n}</a>`).join('')}</nav>
<div class="right"><span class="lang"><b>中</b> / EN</span><a class="btn sec" style="height:36px;padding:0 16px">${T.login}</a><a class="btn pri" style="height:36px;padding:0 16px">${T.reg}</a></div></div></header>
<div class="hero"><div class="wrap">
  <div><h1>快人一步，<br><em>交易全球行情</em></h1><p>${T.sub}</p>
  <div class="cta"><a class="btn pri" style="height:50px;padding:0 30px">${T.reg}</a><a class="btn sec" style="height:50px;padding:0 30px">${T.login}</a></div>
  <div class="points">${T.heroPoints.map((p) => `<span>${p}</span>`).join('')}</div></div>
  <div class="card board">
    <div class="board-head"><h3><i class="live"></i>${T.ticker}</h3><span class="tag-sample">${T.sample}</span></div>
    <div class="tabs">${T.tabs.map((t, i) => `<span class="${i ? '' : 'on'}">${t}</span>`).join('')}</div>
    <div class="q-head"><span>${T.cols[0]}</span><span>今日走势</span><span style="text-align:right">${T.cols[1]}</span><span style="text-align:right">${T.cols[2]}</span></div>
    ${SYMS.map((s, i) => row(s, i, { spark: [90, 22], up: '#22c55e', down: '#f43f5e', chip: true })).join('')}
    <div class="board-foot"><span>点击任一品种，注册后即可交易</span><a>查看全部 50 个品种 →</a></div>
  </div>
</div></div>
<section><div class="wrap"><div class="sec-title">为什么选择 Quick Come</div><div class="sec-sub">为 USDT 用户设计的差价合约交易平台</div>
<div class="grid4">${T.adv.map((a, i) => `<div class="card"><div class="ico">${'¥%▣⛨'[i]}</div><h4>${a[0]}</h4><p>${a[1]}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="sec-title">热门品种</div><div class="sec-sub">贵金属、外汇、指数、能源、加密货币，一个账户全部可交易</div>
<div class="grid5">${T.hot.map((h) => `<div class="card"><h4>${h[0]}<i>→</i></h4><p>${h[1]}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="sec-title">三步开始交易</div>
<div class="steps">${T.steps.map((s) => `<div class="card step"><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join('')}</div>
<div style="margin-top:24px"><a class="btn pri">${T.reg}</a></div></div></section>
<section><div class="wrap"><div class="sec-title">资金和安全</div>
<div class="grid3">${T.safe.map((s, i) => `<div class="card"><div class="ico">${'⇣✓⚑'[i]}</div><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join('')}</div>
<div class="tbd license">${T.license}（Amos 提供后填写，不编写任何牌照或监管信息）</div></div></section>
<section><div class="wrap"><div class="sec-title">常见问题</div>
<div class="faq"><div class="card open">${T.faq[0]}<p class="muted" style="color:var(--muted)">${T.faqA0}</p></div>${T.faq.slice(1).map((q) => `<div class="card">${q}<span>＋</span></div>`).join('')}</div></div></section>
<section class="final"><div class="wrap"><div class="sec-title">现在注册，开始交易</div><div class="sec-sub">注册免费，充值最小 1 USDT</div><div style="margin-top:22px"><a class="btn pri" style="height:50px;padding:0 36px">${T.reg}</a></div></div></section>
<footer><div class="wrap">${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}<a>联系我们</a></div>
<p>${T.risk}</p><div class="tbd">${T.company} · ${T.license}</div><p style="margin-top:14px">© 2026 Quick Come</p></div></footer>`;
  return page('Quick Come 官网 · 方向 A · 电脑版', css, body);
}

function A_mobile() {
  const css = A_VARS + `
body{font-size:14px}
.risk-bar{font-size:11px;padding:6px 16px;text-align:left}
header{height:54px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--hair);position:sticky;top:0;background:rgba(13,17,23,.95);z-index:5}
header .right{display:flex;align-items:center;gap:10px;font-size:13px}
.lang{color:var(--muted)}.lang b{color:var(--text)}
.menu{font-size:20px;color:var(--muted)}
.hero{padding:28px 16px 20px}
h1{font-size:30px;line-height:1.2;font-weight:800}
h1 em{font-style:normal;color:var(--cyan)}
.hero p{color:var(--muted);margin:12px 0 20px;font-size:15px}
.cta{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cta .btn{height:48px}
.board{margin:0 16px}
.board-head{display:flex;justify-content:space-between;align-items:center;padding:14px 14px 8px}
.board-head h3{font-size:15px;display:flex;align-items:center;gap:8px}
.live{width:8px;height:8px;border-radius:50%;background:var(--up);box-shadow:0 0 0 4px rgba(34,197,94,.18)}
.tabs{display:flex;gap:4px;padding:0 14px 8px;font-size:13px;overflow:hidden;white-space:nowrap}
.tabs span{padding:4px 9px;border-radius:6px;color:var(--muted)}.tabs span.on{background:var(--s3);color:var(--text)}
.q-row{display:grid;grid-template-columns:1fr auto 84px;gap:10px;align-items:center;height:54px;padding:0 14px;border-top:1px solid var(--hair)}
.q-name b{display:block;font-size:14px}.q-name span{color:var(--subtle);font-size:12px}
.q-px{font-size:15px;font-weight:600;text-align:right}.q-chg{text-align:right}
.chip{min-width:78px}
.board-foot{padding:12px 14px;text-align:center;color:var(--cyan);font-size:13px;border-top:1px solid var(--hair)}
section{padding:36px 16px 8px}
.sec-title{font-size:21px}
.list{display:grid;gap:10px;margin-top:16px}
.list .card{padding:16px;display:grid;grid-template-columns:36px 1fr;gap:12px}
.ico{width:36px;height:36px;border-radius:8px;background:rgba(34,211,238,.12);color:var(--cyan);display:grid;place-items:center;font-weight:800}
.card h4{font-size:15px}.card p{color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chips span{padding:8px 14px;border-radius:999px;background:var(--s1);border:1px solid var(--border);font-size:13px}
.steps{margin-top:16px;border-left:2px solid var(--border);margin-left:14px;padding-left:20px;display:grid;gap:18px}
.step{position:relative}.step b{position:absolute;left:-36px;top:0;width:28px;height:28px;border-radius:50%;background:var(--bg);border:1px solid var(--cyan);color:var(--cyan);display:grid;place-items:center;font-size:13px}
.license{margin-top:12px;color:#fbbf24;font-size:13px}
.faq{margin-top:14px}.faq div{padding:14px 0;border-bottom:1px solid var(--hair);display:flex;justify-content:space-between;font-weight:600}
.faq div span{color:var(--subtle)}
footer{margin-top:32px;background:var(--s2);border-top:1px solid var(--border);padding:24px 16px 96px;color:var(--subtle);font-size:12px}
footer .links{display:flex;gap:18px;margin:12px 0;color:var(--muted);font-size:13px}
footer .tbd{color:#fbbf24;margin-top:10px}
.sticky{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:rgba(13,17,23,.96);border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 2fr;gap:10px}
.sticky .btn{height:46px}
`;
  const body = `
<div class="risk-bar">差价合约风险较高，可能损失全部保证金。<a style="text-decoration:underline">风险披露</a></div>
<header>${logo('Q')}<div class="right"><span class="lang"><b>中</b>/EN</span><span class="menu">☰</span></div></header>
<div class="hero"><h1>快人一步，<br><em>交易全球行情</em></h1><p>用 USDT 交易黄金、外汇、指数和加密货币差价合约，手机打开就能交易。</p>
<div class="cta"><a class="btn pri">${T.reg}</a><a class="btn sec">${T.login}</a></div></div>
<div class="card board"><div class="board-head"><h3><i class="live"></i>${T.ticker}</h3><span class="tag-sample">${T.sample}</span></div>
<div class="tabs">${T.tabs.map((t, i) => `<span class="${i ? '' : 'on'}">${t}</span>`).join('')}</div>
${SYMS.slice(0, 8).map((s, i) => row(s, i, { chip: true })).join('')}
<div class="board-foot">查看全部品种 →</div></div>
<section><div class="sec-title">为什么选择 Quick Come</div><div class="list">${T.adv.map((a, i) => `<div class="card"><div class="ico">${'¥%▣⛨'[i]}</div><div><h4>${a[0]}</h4><p>${a[1]}</p></div></div>`).join('')}</div></section>
<section><div class="sec-title">热门品种</div><div class="chips">${T.hot.map((h) => `<span>${h[0]}</span>`).join('')}</div></section>
<section><div class="sec-title">三步开始交易</div><div class="steps">${T.steps.map((s, i) => `<div class="step"><b>${i + 1}</b><h4>${s[0]}</h4><p style="color:var(--muted);font-size:13px">${s[1]}</p></div>`).join('')}</div></section>
<section><div class="sec-title">资金和安全</div><div class="list">${T.safe.map((s, i) => `<div class="card"><div class="ico">${'⇣✓⚑'[i]}</div><div><h4>${s[0]}</h4><p>${s[1]}</p></div></div>`).join('')}</div><div class="tbd license">${T.license}</div></section>
<section><div class="sec-title">常见问题</div><div class="faq">${T.faq.map((q) => `<div>${q}<span>＋</span></div>`).join('')}</div></section>
<footer>${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}</div><p>${T.risk}</p><div class="tbd">${T.company} · ${T.license}</div><p style="margin-top:10px">© 2026 Quick Come</p></footer>
<div class="sticky"><a class="btn sec">${T.login}</a><a class="btn pri">${T.reg}</a></div>`;
  return page('Quick Come 官网 · 方向 A · 手机版', css, body);
}

// ---------- 方向 B：加密交易所营销风（纯黑 + 荧光强调色 + 滚动行情带） ----------
const B_VARS = `:root{--bg:#050505;--s1:#111113;--s2:#18181b;--border:#26262b;--text:#fafafa;--muted:#a1a1aa;--accent:#c6f135;--up:#2ee67a;--down:#ff4d6a;--up-soft:rgba(46,230,122,.18);--down-soft:rgba(255,77,106,.18)}
body{background:var(--bg);color:var(--text)}
.risk-bar{background:#000;color:#71717a;border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:8px;font-weight:900;font-size:19px;letter-spacing:-.02em}
.mark{width:28px;height:28px;border-radius:50%;background:var(--accent);color:#000;display:grid;place-items:center;font-weight:900;font-size:15px}
.up{color:var(--up)}.down{color:var(--down)}
.flash-up{background:var(--up-soft)!important}.flash-down{background:var(--down-soft)!important}
.btn{display:inline-flex;align-items:center;justify-content:center;height:46px;padding:0 26px;border-radius:999px;font-weight:800;font-size:15px}
.btn.pri{background:var(--accent);color:#000}.btn.sec{border:1px solid #3f3f46;color:var(--text)}
.tag-sample{color:var(--accent)}
.band{border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:#0b0b0c;overflow:hidden;white-space:nowrap}
.band .track{display:inline-flex}
html.anim .band .track{animation:marquee 40s linear infinite}
@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.band .q-row{display:inline-flex;align-items:baseline;gap:10px;padding:14px 26px;border-right:1px solid var(--border)}
.band .q-name b{font-size:14px}.band .q-name span{display:none}
.band .q-px{font-weight:700}
.card{background:var(--s1);border:1px solid var(--border);border-radius:20px}
`;

function B_desktop() {
  const css = B_VARS + `
.wrap{width:1200px;margin:0 auto}
header{height:68px}header .wrap{display:flex;align-items:center;height:100%;gap:36px}
header nav{display:flex;gap:28px;color:var(--muted);font-size:14px;flex:1}
header .right{display:flex;gap:14px;align-items:center;font-size:14px}
.hero{text-align:center;padding:84px 0 70px;background:radial-gradient(700px 380px at 50% 0%,rgba(198,241,53,.16),transparent 70%)}
h1{font-size:76px;line-height:1.08;font-weight:900;letter-spacing:-.03em}
h1 em{font-style:normal;color:var(--accent)}
.hero p{color:var(--muted);font-size:19px;margin:22px auto 34px;max-width:640px}
.cta{display:flex;gap:14px;justify-content:center}
.band-wrap{position:relative}.band-wrap .tag-sample{position:absolute;right:16px;top:-30px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);margin-top:0}
.stats div{padding:46px 0;text-align:center;border-right:1px solid var(--border)}
.stats b{display:block;font-size:44px;font-weight:900;letter-spacing:-.02em}.stats span{color:var(--muted)}
section{padding:90px 0}
.sec-title{font-size:44px;font-weight:900;letter-spacing:-.02em;text-align:center}
.sec-sub{text-align:center;color:var(--muted);margin-top:10px;font-size:17px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:44px}
.grid4 .card{padding:30px;min-height:230px}.card h4{font-size:20px;margin:18px 0 10px}.card p{color:var(--muted)}
.big{font-size:40px;font-weight:900;color:var(--accent)}
.hot{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-top:44px}
.hot .card{padding:28px}
.q-tab .q-row{display:grid;grid-template-columns:1.6fr 1fr 110px;padding:14px 4px;border-top:1px solid var(--border)}
.q-tab .q-name span{color:var(--muted);margin-left:8px;font-size:13px}.q-tab .q-px,.q-tab .q-chg{text-align:right;font-weight:700}
.cats{display:grid;gap:12px}.cats div{padding:18px 22px;border-radius:14px;background:var(--s2);display:flex;justify-content:space-between}
.cats i{font-style:normal;color:var(--muted);font-size:13px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:44px}
.steps .card{padding:30px}.steps .n{font-size:64px;font-weight:900;color:var(--accent);line-height:1}
.safe{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:44px}.safe .card{padding:30px}
.tbd{color:var(--accent);margin:22px auto 0;width:fit-content}
.faq{width:820px;margin:40px auto 0}.faq div{padding:22px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-size:18px;font-weight:700}
.final{text-align:center;padding:100px 0;background:radial-gradient(600px 300px at 50% 100%,rgba(198,241,53,.14),transparent 70%)}
footer{border-top:1px solid var(--border);padding:44px 0;color:#71717a;font-size:13px}
footer .links{display:flex;gap:26px;margin:18px 0;color:var(--muted)}
`;
  const ticks = SYMS.map((s, i) => row(s, i)).join('') + SYMS.map((s, i) => row(s, i + 100)).join('');
  const body = `
<div class="risk-bar">${T.risk.slice(0, 60)}… <a style="text-decoration:underline">风险披露</a></div>
<header><div class="wrap">${logo('Q')}<nav>${T.nav.map((n) => `<a>${n}</a>`).join('')}</nav><div class="right"><span>中 / EN</span><a>${T.login}</a><a class="btn pri" style="height:38px;padding:0 20px">${T.reg}</a></div></div></header>
<div class="hero"><h1>快人一步<br>交易<em>全球行情</em></h1><p>${T.sub}</p><div class="cta"><a class="btn pri" style="height:54px;padding:0 40px">${T.reg}</a><a class="btn sec" style="height:54px;padding:0 40px">${T.login}</a></div></div>
<div class="band-wrap"><span class="tag-sample">${T.sample}</span><div class="band"><div class="track">${ticks}</div></div></div>
<div class="wrap"><div class="stats"><div><b>~50</b><span>热门品种</span></div><div><b>3 条链</b><span>ERC20 · TRC20 · BSC</span></div><div><b>1 USDT</b><span>最小充值</span></div><div style="border-right:0"><b>中 / EN</b><span>双语界面</span></div></div></div>
<section><div class="wrap"><div class="sec-title">为交易而生</div><div class="sec-sub">一个 USDT 账户，交易全球热门品种</div>
<div class="grid4">${T.adv.map((a, i) => `<div class="card"><div class="big">0${i + 1}</div><h4>${a[0]}</h4><p>${a[1]}</p></div>`).join('')}</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-title">热门品种</div>
<div class="hot"><div class="card q-tab"><div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>涨跌榜</b><span class="tag-sample">${T.sample}</span></div>${SYMS.slice(0, 6).map((s, i) => row(s, i)).join('')}</div>
<div class="card cats">${T.hot.map((h) => `<div><b>${h[0]}</b><i>${h[1]}</i></div>`).join('')}</div></div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-title">三步开始</div><div class="steps">${T.steps.map((s, i) => `<div class="card"><div class="n">${i + 1}</div><h4 style="font-size:22px;margin:16px 0 8px">${s[0]}</h4><p style="color:var(--muted)">${s[1]}</p></div>`).join('')}</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-title">资金和安全</div><div class="safe">${T.safe.map((s) => `<div class="card"><h4 style="font-size:20px;margin-bottom:10px">${s[0]}</h4><p style="color:var(--muted)">${s[1]}</p></div>`).join('')}</div><div class="tbd">${T.license}</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-title">常见问题</div><div class="faq">${T.faq.map((q) => `<div>${q}<span>＋</span></div>`).join('')}</div></div></section>
<div class="final"><div class="sec-title">准备好了吗？</div><div style="margin-top:28px"><a class="btn pri" style="height:56px;padding:0 48px">${T.reg}</a></div></div>
<footer><div class="wrap">${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}</div><p>${T.risk}</p><p class="tbd" style="margin:12px 0 0">${T.company}</p><p style="margin-top:12px">© 2026 Quick Come</p></div></footer>`;
  return page('Quick Come 官网 · 方向 B · 电脑版', css, body);
}

function B_mobile() {
  const css = B_VARS + `
.risk-bar{font-size:11px;text-align:left}
header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px}
header .right{display:flex;gap:12px;align-items:center;font-size:13px}
.hero{text-align:center;padding:40px 16px 34px;background:radial-gradient(360px 260px at 50% 0%,rgba(198,241,53,.18),transparent 70%)}
h1{font-size:40px;line-height:1.12;font-weight:900;letter-spacing:-.02em}h1 em{font-style:normal;color:var(--accent)}
.hero p{color:var(--muted);margin:16px 0 26px;font-size:15px}
.cta{display:grid;gap:10px}.cta .btn{height:52px}
.band .q-row{padding:12px 18px}
.band-head{display:flex;justify-content:space-between;padding:0 16px 8px;font-size:13px;color:var(--muted)}
.stats{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border)}
.stats div{padding:22px 16px;border-right:1px solid var(--border);border-top:1px solid var(--border)}.stats div:nth-child(2n){border-right:0}
.stats b{display:block;font-size:26px;font-weight:900}.stats span{color:var(--muted);font-size:12px}
section{padding:44px 16px 0}
.sec-title{font-size:28px;font-weight:900;text-align:center}
.cards{display:grid;gap:12px;margin-top:22px}.cards .card{padding:20px}
.big{font-size:28px;font-weight:900;color:var(--accent)}.card h4{font-size:17px;margin:8px 0 4px}.card p{color:var(--muted);font-size:13px}
.q-tab{padding:12px 16px}.q-tab .q-row{display:grid;grid-template-columns:1fr auto 74px;gap:10px;padding:12px 0;border-top:1px solid var(--border)}
.q-tab .q-row:first-of-type{border-top:0}.q-tab .q-name span{display:block;color:var(--muted);font-size:12px}
.q-tab .q-px,.q-tab .q-chg{text-align:right;font-weight:700}
.tbd{color:var(--accent);margin-top:14px;font-size:13px;text-align:center}
.faq div{padding:16px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-weight:700}
footer{margin-top:40px;border-top:1px solid var(--border);padding:26px 16px 100px;color:#71717a;font-size:12px}
footer .links{display:flex;gap:18px;margin:12px 0;color:var(--muted);font-size:13px}
.sticky{position:fixed;left:16px;right:16px;bottom:14px}.sticky .btn{width:100%;height:52px;box-shadow:0 8px 24px rgba(198,241,53,.25)}
`;
  const body = `
<div class="risk-bar">差价合约风险较高，可能损失全部保证金。<a style="text-decoration:underline">风险披露</a></div>
<header>${logo('Q')}<div class="right"><span>中/EN</span><a>${T.login}</a><span style="font-size:20px;color:var(--muted)">☰</span></div></header>
<div class="hero"><h1>快人一步<br>交易<em>全球行情</em></h1><p>用 USDT 交易黄金、外汇、指数和加密货币差价合约。</p><div class="cta"><a class="btn pri">${T.reg}</a><a class="btn sec">${T.login}</a></div></div>
<div class="band-head"><span>${T.ticker}</span><span class="tag-sample">${T.sample}</span></div>
<div class="band"><div class="track">${SYMS.map((s, i) => row(s, i)).join('')}${SYMS.map((s, i) => row(s, i + 100)).join('')}</div></div>
<div class="stats"><div><b>~50</b><span>热门品种</span></div><div><b>3 条链</b><span>ERC20·TRC20·BSC</span></div><div><b>1 USDT</b><span>最小充值</span></div><div><b>中/EN</b><span>双语界面</span></div></div>
<section><div class="sec-title">热门品种</div><div class="card q-tab" style="margin-top:20px">${SYMS.slice(0, 6).map((s, i) => row(s, i)).join('')}</div></section>
<section><div class="sec-title">为交易而生</div><div class="cards">${T.adv.map((a, i) => `<div class="card"><div class="big">0${i + 1}</div><h4>${a[0]}</h4><p>${a[1]}</p></div>`).join('')}</div></section>
<section><div class="sec-title">三步开始</div><div class="cards">${T.steps.map((s, i) => `<div class="card" style="display:grid;grid-template-columns:44px 1fr;gap:10px"><div class="big" style="font-size:36px">${i + 1}</div><div><h4 style="margin-top:0">${s[0]}</h4><p>${s[1]}</p></div></div>`).join('')}</div></section>
<section><div class="sec-title">资金和安全</div><div class="cards">${T.safe.map((s) => `<div class="card"><h4 style="margin-top:0">${s[0]}</h4><p>${s[1]}</p></div>`).join('')}</div><div class="tbd">${T.license}</div></section>
<section><div class="sec-title">常见问题</div><div class="faq" style="margin-top:14px">${T.faq.map((q) => `<div>${q}<span>＋</span></div>`).join('')}</div></section>
<footer>${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}</div><p>${T.risk}</p><p style="color:var(--accent);margin-top:10px">${T.company}</p><p style="margin-top:10px">© 2026 Quick Come</p></footer>
<div class="sticky"><a class="btn pri">${T.reg}</a></div>`;
  return page('Quick Come 官网 · 方向 B · 手机版', css, body);
}

// ---------- 方向 C：券商明亮风（白底 + 品牌蓝 + 行情表卡片） ----------
const C_VARS = `:root{--bg:#ffffff;--s1:#ffffff;--s2:#f5f7fb;--border:#e3e8ef;--text:#0b1b33;--muted:#4b5b72;--subtle:#6b7a90;--blue:#1652f0;--blue-soft:#eaf0ff;--up:#0f9d58;--down:#d93025;--up-soft:rgba(15,157,88,.12);--down-soft:rgba(217,48,37,.10)}
body{background:var(--bg);color:var(--text)}
.risk-bar{background:#0b1b33;color:#c9d3e1}
.logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:19px}
.mark{width:30px;height:30px;border-radius:9px;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:900}
.up{color:var(--up)}.down{color:var(--down)}
.flash-up{background:var(--up-soft)!important}.flash-down{background:var(--down-soft)!important}
.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 24px;border-radius:8px;font-weight:700;font-size:15px}
.btn.pri{background:var(--blue);color:#fff}.btn.sec{border:1px solid var(--blue);color:var(--blue)}
.btn-mini{display:inline-block;padding:5px 14px;border-radius:6px;background:var(--blue-soft);color:var(--blue);font-size:13px;font-weight:600}
.card{background:var(--s1);border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 24px rgba(11,27,51,.06)}
.tag-sample{color:#b45309}
.tbd{color:#b45309}
`;

function phone(w, h) { // 产品截图位：手机里的行情列表（示意）
  return `<div style="width:${w}px;height:${h}px;border-radius:36px;background:#0d1117;border:8px solid #1f2a3a;box-shadow:0 30px 60px rgba(11,27,51,.25);padding:18px 12px;color:#e6edf3;font-size:11px;overflow:hidden">
  <div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:10px"><span>行情</span><span style="color:#22d3ee">Quick Come</span></div>
  ${SYMS.slice(0, 8).map((s) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-top:1px solid #1a2230"><span><b>${s[0]}</b><br><span style="color:#8b98a9">${s[1]}</span></span><span class="num" style="background:${s[4] >= 0 ? '#16a34a' : '#e11d48'};padding:3px 6px;border-radius:5px;font-weight:700">${fmt(s[3], s[5])}</span></div>`).join('')}
  </div>`;
}

function C_desktop() {
  const css = C_VARS + `
.wrap{width:1200px;margin:0 auto}
header{height:70px;border-bottom:1px solid var(--border)}header .wrap{display:flex;align-items:center;height:100%;gap:36px}
header nav{display:flex;gap:28px;color:var(--muted);font-size:15px;flex:1}
header .right{display:flex;gap:12px;align-items:center}
.hero{background:linear-gradient(180deg,#f2f6ff,#fff);padding:64px 0 40px}
.hero .wrap{display:grid;grid-template-columns:1fr 420px;gap:40px;align-items:center}
h1{font-size:54px;line-height:1.15;font-weight:800;letter-spacing:-.02em}h1 em{font-style:normal;color:var(--blue)}
.hero p{font-size:18px;color:var(--muted);margin:18px 0 30px;max-width:560px}
.cta{display:flex;gap:12px}
.trust{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.trust div{padding:20px 0;text-align:center;color:var(--muted);font-size:15px}.trust b{color:var(--text)}
section{padding:72px 0}
.sec-title{font-size:34px;font-weight:800;text-align:center}.sec-sub{text-align:center;color:var(--muted);margin-top:8px}
.qcard{margin-top:32px;padding:10px 24px 18px}
.qtop{display:flex;justify-content:space-between;align-items:center;padding:12px 0}
.tabs{display:flex;gap:8px}.tabs span{padding:7px 16px;border-radius:999px;background:var(--s2);color:var(--muted);font-size:14px}.tabs span.on{background:var(--blue);color:#fff}
.q-head,.q-row{display:grid;grid-template-columns:1.6fr 1fr 1fr 140px 120px;align-items:center;gap:12px;padding:0 10px}
.q-head{height:40px;color:var(--subtle);font-size:13px;border-bottom:1px solid var(--border)}
.q-row{height:56px;border-bottom:1px solid var(--border);border-radius:6px}
.q-name b{font-size:15px}.q-name span{color:var(--subtle);margin-left:8px;font-size:13px}
.q-px{text-align:right;font-weight:700;font-size:15px}.q-chg{text-align:right;font-weight:600}.q-act{text-align:right}
.note{font-size:12px;color:var(--subtle);margin-top:12px}
.bg2{background:var(--s2)}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:36px}.grid4 .card{padding:26px}
.ico{width:44px;height:44px;border-radius:12px;background:var(--blue-soft);color:var(--blue);display:grid;place-items:center;font-weight:800;font-size:18px;margin-bottom:16px}
.card h4{font-size:17px;margin-bottom:8px}.card p{color:var(--muted);font-size:14px}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:36px}.grid5 .card{padding:22px;text-align:center}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:36px}.steps .card{padding:28px;text-align:center}
.steps .n{width:48px;height:48px;border-radius:50%;background:var(--blue);color:#fff;display:grid;place-items:center;margin:0 auto 14px;font-weight:800;font-size:20px}
.safe{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:36px}.safe .card{padding:26px}
.lic{margin:22px auto 0;width:fit-content;border:1px dashed #d97706;border-radius:8px;padding:10px 16px}
.faq{width:860px;margin:30px auto 0}.faq .card{padding:18px 22px;margin-bottom:10px;display:flex;justify-content:space-between;font-weight:600;box-shadow:none}
.faq .card.open{display:block}.faq .card.open p{font-weight:400;color:var(--muted);margin-top:8px}
.final{background:var(--blue);color:#fff;text-align:center;padding:64px 0}.final .btn{background:#fff;color:var(--blue)}
footer{background:#0b1b33;color:#9fb0c7;padding:44px 0;font-size:13px}
footer .logo{color:#fff}footer .links{display:flex;gap:24px;margin:16px 0;color:#c9d3e1}
footer .tbd{color:#fbbf24;margin-top:10px}
`;
  const body = `
<div class="risk-bar">${T.risk.slice(0, 60)}… <a style="text-decoration:underline">风险披露</a></div>
<header><div class="wrap">${logo('Q')}<nav>${T.nav.map((n) => `<a>${n}</a>`).join('')}</nav><div class="right"><span style="color:var(--muted)">中 / EN</span><a class="btn sec" style="height:38px">${T.login}</a><a class="btn pri" style="height:38px">${T.reg}</a></div></div></header>
<div class="hero"><div class="wrap"><div><h1>快人一步，<br><em>交易全球行情</em></h1><p>${T.sub}</p><div class="cta"><a class="btn pri" style="height:52px;padding:0 34px">${T.reg}</a><a class="btn sec" style="height:52px;padding:0 34px">${T.login}</a></div></div>
<div style="display:flex;justify-content:center">${phone(300, 560)}</div></div></div>
<div class="wrap trust"><div><b>USDT</b> 充值和提现</div><div><b>约 50 个</b> 热门品种</div><div><b>3 条链</b> 充值网络</div><div><b>中 / EN</b> 双语界面</div></div>
<section><div class="wrap"><div class="sec-title">${T.ticker}</div><div class="sec-sub">热门品种的卖价和今日涨跌，每秒更新</div>
<div class="card qcard"><div class="qtop"><div class="tabs">${T.tabs.map((t, i) => `<span class="${i ? '' : 'on'}">${t}</span>`).join('')}</div><span class="tag-sample">${T.sample}</span></div>
<div class="q-head"><span>品种</span><span>今日走势</span><span style="text-align:right">卖价</span><span style="text-align:right">今日涨跌</span><span></span></div>
${SYMS.slice(0, 8).map((s, i) => row(s, i, { spark: [120, 26], up: '#0f9d58', down: '#d93025', btn: '交易' })).join('')}
<div class="note">测试环境为模拟行情，仅供演示；正式环境的行情可能有延迟，以交易页面报价为准。</div></div></div></section>
<section class="bg2"><div class="wrap"><div class="sec-title">为什么选择 Quick Come</div><div class="grid4">${T.adv.map((a, i) => `<div class="card"><div class="ico">${'¥%▣⛨'[i]}</div><h4>${a[0]}</h4><p>${a[1]}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="sec-title">热门品种</div><div class="grid5">${T.hot.map((h, i) => `<div class="card"><div class="ico" style="margin:0 auto 12px">${'◆$▲●₿'[i]}</div><h4>${h[0]}</h4><p>${h[1]}</p></div>`).join('')}</div></div></section>
<section class="bg2"><div class="wrap"><div class="sec-title">三步开始交易</div><div class="steps">${T.steps.map((s, i) => `<div class="card"><div class="n">${i + 1}</div><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="sec-title">资金和安全</div><div class="safe">${T.safe.map((s, i) => `<div class="card"><div class="ico">${'⇣✓⚑'[i]}</div><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join('')}</div><div class="lic tbd">${T.license}</div></div></section>
<section class="bg2"><div class="wrap"><div class="sec-title">常见问题</div><div class="faq"><div class="card open">${T.faq[0]}<p>${T.faqA0}</p></div>${T.faq.slice(1).map((q) => `<div class="card">${q}<span>＋</span></div>`).join('')}</div></div></section>
<div class="final"><div class="sec-title" style="color:#fff">现在注册，开始交易</div><div style="margin-top:22px"><a class="btn" style="height:52px;padding:0 40px">${T.reg}</a></div></div>
<footer><div class="wrap">${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}</div><p>${T.risk}</p><p class="tbd">${T.company} · ${T.license}</p><p style="margin-top:12px">© 2026 Quick Come</p></div></footer>`;
  return page('Quick Come 官网 · 方向 C · 电脑版', css, body);
}

function C_mobile() {
  const css = C_VARS + `
.risk-bar{font-size:11px;text-align:left;padding:6px 16px}
header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--border)}
header .right{display:flex;gap:10px;align-items:center;font-size:13px;color:var(--muted)}
.hero{background:linear-gradient(180deg,#f2f6ff,#fff);padding:30px 16px 24px;text-align:center}
h1{font-size:32px;line-height:1.2;font-weight:800}h1 em{font-style:normal;color:var(--blue)}
.hero p{color:var(--muted);margin:12px 0 22px;font-size:15px}
.cta{display:grid;gap:10px}.cta .btn{height:50px}
.trust{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.trust div{background:#fff;padding:14px;text-align:center;font-size:13px;color:var(--muted)}.trust b{color:var(--text)}
section{padding:32px 16px 0}
.sec-title{font-size:23px;font-weight:800;text-align:center}
.qcard{margin-top:16px;padding:8px 14px 12px}
.qtop{display:flex;justify-content:space-between;align-items:center;padding:6px 0 8px}
.tabs{display:flex;gap:6px;overflow:hidden}.tabs span{padding:5px 11px;border-radius:999px;background:var(--s2);color:var(--muted);font-size:13px;white-space:nowrap}.tabs span.on{background:var(--blue);color:#fff}
.q-row{display:grid;grid-template-columns:1fr auto 70px;gap:10px;align-items:center;height:54px;border-top:1px solid var(--border)}
.q-name b{display:block;font-size:14px}.q-name span{color:var(--subtle);font-size:12px}
.q-px{text-align:right;font-weight:700}.q-chg{text-align:right;font-weight:600}
.note{font-size:11px;color:var(--subtle);margin-top:8px}
.cards{display:grid;gap:10px;margin-top:16px}.cards .card{padding:16px;display:grid;grid-template-columns:40px 1fr;gap:12px;box-shadow:none}
.ico{width:40px;height:40px;border-radius:10px;background:var(--blue-soft);color:var(--blue);display:grid;place-items:center;font-weight:800}
.card h4{font-size:15px}.card p{font-size:13px;color:var(--muted)}
.hot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.hot div{padding:14px;border-radius:12px;background:var(--s2);font-weight:700}
.hot div span{display:block;font-weight:400;color:var(--muted);font-size:12px;margin-top:2px}
.steps{display:grid;gap:10px;margin-top:16px}.steps div{display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:start}
.steps b{width:32px;height:32px;border-radius:50%;background:var(--blue);color:#fff;display:grid;place-items:center}
.lic{margin-top:12px;border:1px dashed #d97706;border-radius:8px;padding:10px;font-size:13px;text-align:center}
.faq div{padding:15px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-weight:600}
footer{margin-top:36px;background:#0b1b33;color:#9fb0c7;padding:24px 16px 96px;font-size:12px}
footer .logo{color:#fff}footer .links{display:flex;gap:18px;margin:12px 0;color:#c9d3e1;font-size:13px}
.sticky{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--border);padding:10px 16px;display:grid;grid-template-columns:1fr 2fr;gap:10px}.sticky .btn{height:46px}
`;
  const body = `
<div class="risk-bar">差价合约风险较高，可能损失全部保证金。<a style="text-decoration:underline">风险披露</a></div>
<header>${logo('Q')}<div class="right"><span>中/EN</span><span style="font-size:20px">☰</span></div></header>
<div class="hero"><h1>快人一步，<br><em>交易全球行情</em></h1><p>用 USDT 交易黄金、外汇、指数和加密货币差价合约，手机打开就能交易。</p><div class="cta"><a class="btn pri">${T.reg}</a><a class="btn sec">${T.login}</a></div></div>
<div class="trust"><div><b>USDT</b> 充值提现</div><div><b>约 50 个</b> 品种</div><div><b>3 条链</b> 充值</div><div><b>中/EN</b> 双语</div></div>
<section><div class="sec-title">${T.ticker}</div><div class="card qcard"><div class="qtop"><div class="tabs">${T.tabs.slice(0, 4).map((t, i) => `<span class="${i ? '' : 'on'}">${t}</span>`).join('')}</div><span class="tag-sample">${T.sample}</span></div>
${SYMS.slice(0, 6).map((s, i) => row(s, i)).join('')}<div class="note">测试环境为模拟行情，仅供演示。</div></div></section>
<section><div class="sec-title">为什么选择 Quick Come</div><div class="cards">${T.adv.map((a, i) => `<div class="card"><div class="ico">${'¥%▣⛨'[i]}</div><div><h4>${a[0]}</h4><p>${a[1]}</p></div></div>`).join('')}</div></section>
<section><div class="sec-title">热门品种</div><div class="hot">${T.hot.map((h) => `<div>${h[0]}<span>${h[1].split(' · ')[0]}</span></div>`).join('')}<div style="background:var(--blue-soft);color:var(--blue)">全部品种 →</div></div></section>
<section><div class="sec-title">三步开始交易</div><div class="steps">${T.steps.map((s, i) => `<div><b>${i + 1}</b><span><h4>${s[0]}</h4><p style="color:var(--muted);font-size:13px">${s[1]}</p></span></div>`).join('')}</div></section>
<section><div class="sec-title">资金和安全</div><div class="cards">${T.safe.map((s, i) => `<div class="card"><div class="ico">${'⇣✓⚑'[i]}</div><div><h4>${s[0]}</h4><p>${s[1]}</p></div></div>`).join('')}</div><div class="lic tbd">${T.license}</div></section>
<section><div class="sec-title">常见问题</div><div class="faq" style="margin-top:10px">${T.faq.map((q) => `<div>${q}<span>＋</span></div>`).join('')}</div></section>
<footer>${logo('Q')}<div class="links">${T.links.map((l) => `<a>${l}</a>`).join('')}</div><p>${T.risk}</p><p style="color:#fbbf24;margin-top:10px">${T.company}</p><p style="margin-top:10px">© 2026 Quick Come</p></footer>
<div class="sticky"><a class="btn sec">${T.login}</a><a class="btn pri">${T.reg}</a></div>`;
  return page('Quick Come 官网 · 方向 C · 手机版', css, body);
}

const out = {
  'A-电脑.html': A_desktop(), 'A-手机.html': A_mobile(),
  'B-电脑.html': B_desktop(), 'B-手机.html': B_mobile(),
  'C-电脑.html': C_desktop(), 'C-手机.html': C_mobile(),
};
for (const [f, html] of Object.entries(out)) fs.writeFileSync(path.join(__dirname, f), html);
console.log('生成：' + Object.keys(out).join('、'));
