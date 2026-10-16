#!/usr/bin/env node
/**
 * AC-13 压测程序（测试报告/v1-压测报告-AC13.md）。由 e2e/load/run-ac13.sh 启动，只用 Node 自带模块。
 *
 * 做什么：
 * 1. 注册 LOAD_USERS 个客户（发验证码 → 替身取验证码 → 注册），每人用替身注入一笔 TRC20 充值并出块到账。
 * 2. LOAD_WS 个客户各开一条行情推送 /api/ws/market 和交易推送 /api/ws/trading（经 Nginx），模拟有人在看；统计推送里出现过的品种。
 * 3. 循环（一轮约 15 秒，共 LOAD_DURATION_S 秒），对每个"现在能开仓"的品种：
 *    - 布单：多单止盈、空单止损（向上触发）；多单止损、空单止盈、高杠杆多单（向下触发强平）；卖出限价、买入限价（各带止盈，成交后下一步再触发）。
 *    - 用替身"推动报价"把所有品种同时推上去（+LOAD_UP）→ 推下来（−LOAD_DOWN）→ 推回原价：每一步都是几十个品种同时触发几百条（集中触发的最坏情况）。
 *      模拟报价源的随机游走一直在跑（每 500 毫秒 50 个品种各一条）。
 * 4. 结束后把客户端看到的统计写到 LOAD_OUT（JSON）。撮合耗时由 analyze.mjs 从后端日志统计（AC-13 的口径）。
 *
 * 环境变量：LOAD_BASE（经 Nginx 的客户端地址，例如 https://test-app.e2e.test:18443）、LOAD_STUB（替身接口，后端 http://127.0.0.1:18080）、
 * LOAD_CA（自签名证书）、LOAD_OUT；可调：LOAD_USERS(30)、LOAD_WS(20)、LOAD_DURATION_S(600)、LOAD_TRIGGER(0.0025)、LOAD_UP(0.006)、
 * LOAD_DOWN(0.012)、LOAD_NOTIONAL_USD(2000)、LOAD_CONCURRENCY(12)。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const env = (k, d) => process.env[k] ?? d;
const BASE = new URL(env('LOAD_BASE', 'https://test-app.e2e.test:18443'));
const STUB = new URL(env('LOAD_STUB', 'http://127.0.0.1:18080'));
const CA = env('LOAD_CA') ? fs.readFileSync(env('LOAD_CA')) : undefined;
const OUT = env('LOAD_OUT', '');
const USERS = Number(env('LOAD_USERS', 30));
const WS_CLIENTS = Number(env('LOAD_WS', 20));
const DURATION_S = Number(env('LOAD_DURATION_S', 600));
const TRIGGER = Number(env('LOAD_TRIGGER', 0.0025));
const UP = Number(env('LOAD_UP', 0.006));
const DOWN = Number(env('LOAD_DOWN', 0.012));
const NOTIONAL_USD = Number(env('LOAD_NOTIONAL_USD', 2000));
const CONCURRENCY = Number(env('LOAD_CONCURRENCY', 12));
/** 客户密码：8–64 位、字母加数字（约定 17）。一次性压测值，不是任何环境的密码 */
const PASSWORD = 'loadTest2026';
const RUN = Date.now().toString(36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------- HTTP ----------
// 假域名只在这里解析到 127.0.0.1（不改 /etc/hosts）；证书是本次临时生成的自签名证书
const lookup = (host, opts, cb) => (opts && opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, ca: CA, lookup });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function request(base, method, path, { body, cookie } = {}) {
  const isHttps = base.protocol === 'https:';
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { accept: 'application/json' };
  if (data) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = data.length;
  }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      { protocol: base.protocol, hostname: base.hostname, port: base.port, path, method, headers, agent: isHttps ? httpsAgent : httpAgent, timeout: 30_000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} 超时`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const api = (method, path, opts) => request(BASE, method, path, opts);
const stub = (method, path, body) => request(STUB, method, path, { body });

async function must(p, what) {
  const r = await p;
  if (r.status < 200 || r.status >= 300) throw new Error(`${what} 返回 ${r.status}：${r.text.slice(0, 300)}`);
  return r.json;
}

/** 有限并发地跑完一组任务 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// ---------- 客户 ----------
// 发验证码一个一个发：不同邮箱同时发验证码时后端会死锁报 500（压测报告"发现的问题"LT-1），注册不是这次压测的对象
let codeLock = Promise.resolve();
function sendCodeSerially(email) {
  const p = codeLock.then(() => must(api('POST', '/api/auth/email-code', { body: { email, purpose: 'REGISTER' } }), '发验证码'));
  codeLock = p.catch(() => undefined);
  return p;
}

async function registerUser(i) {
  const email = `load-${RUN}-${i}@load.test`;
  await sendCodeSerially(email);
  let code = '';
  for (let k = 0; k < 60 && !code; k++) {
    const r = await stub('GET', `/api/e2e/mail/code?email=${encodeURIComponent(email)}`);
    if (r.status === 200) code = r.json.code;
    else await sleep(500);
  }
  if (!code) throw new Error(`${email} 30 秒内没收到验证码`);
  const r = await api('POST', '/api/auth/register', {
    body: { email, code, password: PASSWORD, firstName: '压测', lastName: `客户${i}`, birthDate: '1990-01-01', nationality: 'CN' },
  });
  if (r.status !== 200) throw new Error(`注册 ${email} 返回 ${r.status}：${r.text}`);
  const set = [].concat(r.headers['set-cookie'] || []);
  const c = set.map((s) => s.split(';')[0]).find((s) => s.startsWith('fx_session='));
  if (!c) throw new Error('注册后没有 fx_session');
  const addrs = await must(api('GET', '/api/wallet/addresses', { cookie: c }), '充值地址');
  const trc = addrs.find((a) => a.network === 'TRC20');
  return { i, email, cookie: c, address: trc.address };
}

// ---------- WebSocket（最小实现：经 Nginx 的 TLS 连接，只收不发，回应 ping） ----------
function wsConnect(path, cookie, onText) {
  const st = { path, open: false, messages: 0, error: null, closed: false };
  const sock = tls.connect({ host: '127.0.0.1', port: Number(BASE.port || 443), servername: BASE.hostname, ca: CA, ALPNProtocols: ['http/1.1'] });
  const key = crypto.randomBytes(16).toString('base64');
  sock.on('secureConnect', () => {
    // 不带 Origin：非浏览器客户端（带了会按同源检查，假域名的端口和 Nginx 传给后端的 Host 对不上）
    sock.write(`GET ${path} HTTP/1.1\r\nHost: ${BASE.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`);
  });
  let buf = Buffer.alloc(0);
  let frags = [];
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!st.open) {
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const head = buf.subarray(0, i).toString();
      if (!/^HTTP\/1\.1 101/.test(head)) {
        st.error = head.split('\r\n')[0];
        sock.destroy();
        return;
      }
      st.open = true;
      buf = buf.subarray(i + 4);
    }
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (buf.length < off + len) return;
      const payload = buf.subarray(off, off + len);
      buf = buf.subarray(off + len);
      if (op === 0x9) {
        // ping → pong（客户端发的帧要加掩码）
        const mask = crypto.randomBytes(4);
        const p = Buffer.from(payload.map((b, k) => b ^ mask[k % 4]));
        sock.write(Buffer.concat([Buffer.from([0x8a, 0x80 | p.length]), mask, p]));
      } else if (op === 0x8) {
        st.closed = true;
        sock.end();
      } else if (op === 0x1 || op === 0x0) {
        frags.push(Buffer.from(payload));
        if (fin) {
          st.messages++;
          const text = Buffer.concat(frags).toString('utf8');
          frags = [];
          try {
            onText?.(text);
          } catch {
            /* 不影响压测 */
          }
        }
      }
    }
  });
  sock.on('error', (e) => {
    st.error = st.error || e.message;
  });
  sock.on('close', () => {
    st.closed = true;
  });
  st.close = () => sock.destroy();
  return st;
}

// ---------- 价格和下单 ----------
function fmt(x, digits) {
  return x.toFixed(digits);
}
function lotsFor(spec, price, usdRate) {
  const step = Number(spec.lotStep);
  const per = price * Number(spec.contractSize) * usdRate;
  let lots = Math.round(NOTIONAL_USD / per / step) * step;
  lots = Math.min(Math.max(lots, Number(spec.minLots)), Number(spec.maxLots));
  const dec = (spec.lotStep.split('.')[1] || '').length;
  return lots.toFixed(dec);
}

const placed = { ok: 0, byKind: {}, errors: {} };
async function place(user, o) {
  const body = { ...o.body, clientOrderId: crypto.randomUUID() };
  try {
    const r = await api('POST', '/api/trading/orders', { body, cookie: user.cookie });
    if (r.status === 200) {
      placed.ok++;
      placed.byKind[o.kind] = (placed.byKind[o.kind] || 0) + 1;
    } else {
      const code = `${o.kind}:${r.json?.code || r.status}`;
      placed.errors[code] = (placed.errors[code] || 0) + 1;
    }
  } catch (e) {
    const code = `${o.kind}:${e.message.slice(0, 60)}`;
    placed.errors[code] = (placed.errors[code] || 0) + 1;
  }
}

/** 一个品种这一轮要布的单（价格都相对当前报价） */
function ordersFor(spec, q) {
  const d = spec.digits;
  const bid = Number(q.bid);
  const ask = Number(q.ask);
  const rate = Number(q.quoteToUsd);
  const lots = lotsFor(spec, ask, rate);
  const lev = Math.min(20, spec.maxLeverage);
  const m = (side, extra) => ({ symbol: spec.code, type: 'market', side, lots, leverage: lev, ...extra });
  const sellLimit = bid * (1 + TRIGGER);
  const buyLimit = ask * (1 - TRIGGER);
  return [
    // 向上推时触发
    { kind: 'long-tp', body: m('buy', { takeProfit: fmt(bid * (1 + TRIGGER), d) }) },
    { kind: 'short-sl', body: m('sell', { stopLoss: fmt(ask * (1 + TRIGGER), d) }) },
    { kind: 'sell-limit', body: { symbol: spec.code, type: 'limit', side: 'sell', lots, leverage: lev, limitPrice: fmt(sellLimit, d), takeProfit: fmt(sellLimit * 0.999, d) } },
    // 向下推时触发
    { kind: 'long-sl', body: m('buy', { stopLoss: fmt(bid * (1 - TRIGGER), d) }) },
    { kind: 'short-tp', body: m('sell', { takeProfit: fmt(ask * (1 - TRIGGER), d) }) },
    { kind: 'buy-limit', body: { symbol: spec.code, type: 'limit', side: 'buy', lots, leverage: lev, limitPrice: fmt(buyLimit, d), takeProfit: fmt(buyLimit * 1.001, d) } },
    // 最高杠杆的多单：向下推时强平
    { kind: 'long-liq', body: { symbol: spec.code, type: 'market', side: 'buy', lots, leverage: spec.maxLeverage } },
  ];
}

async function moveAll(symbols, factorOf) {
  const t = Date.now();
  const rs = await Promise.all(symbols.map((s) => stub('POST', '/api/e2e/market/move', { symbol: s.code, bid: factorOf(s).toFixed(8) })));
  const bad = rs.filter((r) => r.status !== 200).length;
  return { ms: Date.now() - t, bad };
}

// ---------- 主流程 ----------
async function main() {
  log(`注册 ${USERS} 个客户、充值`);
  const users = await pool(
    Array.from({ length: USERS }, (_, i) => i),
    6,
    registerUser,
  );
  for (const u of users) await must(stub('POST', '/api/e2e/wallet/deposit', { chain: 'TRC20', address: u.address, amount: '100000' }), '注入充值');
  await must(stub('POST', '/api/e2e/wallet/mine', { chain: 'TRC20', blocks: 25 }), '出块');
  for (const u of users) {
    for (let k = 0; ; k++) {
      const a = await must(api('GET', '/api/trading/account', { cookie: u.cookie }), '账户');
      if (Number(a.balance) >= 100000) break;
      if (k > 60) throw new Error(`${u.email} 充值 30 秒内没到账`);
      await sleep(500);
    }
  }
  log('充值全部到账');

  const specs = await must(api('GET', '/api/market/symbols', { cookie: users[0].cookie }), '品种');
  const quotes0 = await must(api('GET', '/api/market/quotes', { cookie: users[0].cookie }), '报价');
  const now = Date.now();
  const fresh = quotes0.filter((q) => now - Date.parse(q.time) < 3000);
  log(`品种 ${specs.length} 个；/api/market/quotes 有 ${quotes0.length} 个报价，其中 3 秒内更新的 ${fresh.length} 个`);
  const tradable = specs.filter((s) => s.tradingOpen && !s.openPaused);
  const notTradable = specs.filter((s) => !(s.tradingOpen && !s.openPaused)).map((s) => `${s.code}(${!s.tradingOpen ? '休市' : '暂停开仓'})`);
  log(`现在能开仓的品种 ${tradable.length} 个；不能的：${notTradable.join(' ') || '无'}`);

  // 行情和交易推送：模拟有人在看
  const wsSymbols = new Map();
  const ws = [];
  for (let k = 0; k < Math.min(WS_CLIENTS, users.length); k++) {
    ws.push(
      wsConnect('/api/ws/market', users[k].cookie, (text) => {
        const m = JSON.parse(text);
        if (m.type === 'quotes') for (const q of m.data) wsSymbols.set(q.symbol, (wsSymbols.get(q.symbol) || 0) + 1);
      }),
    );
    ws.push(wsConnect('/api/ws/trading', users[k].cookie));
  }
  await sleep(2000);
  log(`WebSocket：${ws.filter((w) => w.open).length}/${ws.length} 条已连上`);

  const rounds = [];
  let ui = 0;
  // 持续时间从开始布单算起（不含注册和充值）
  const loadStart = Date.now();
  const end = loadStart + DURATION_S * 1000;
  while (Date.now() < end) {
    const r = { no: rounds.length + 1, start: new Date().toISOString() };
    const qs = await must(api('GET', '/api/market/quotes', { cookie: users[0].cookie }), '报价');
    const qmap = new Map(qs.map((q) => [q.symbol, q]));
    const live = tradable.filter((s) => qmap.get(s.code)?.quoteToUsd);
    const base = new Map(live.map((s) => [s.code, Number(qmap.get(s.code).bid)]));
    const jobs = [];
    for (const s of live) for (const o of ordersFor(s, qmap.get(s.code))) jobs.push({ user: users[ui++ % users.length], o });
    const before = placed.ok;
    let t = Date.now();
    await pool(jobs, CONCURRENCY, (j) => place(j.user, j.o));
    r.placeMs = Date.now() - t;
    r.orders = placed.ok - before;
    r.symbols = live.length;
    await sleep(500);
    // 同时推上去 → 推下来 → 推回原价
    r.up = await moveAll(live, (s) => base.get(s.code) * (1 + UP));
    await sleep(3000);
    r.down = await moveAll(live, (s) => base.get(s.code) * (1 - DOWN));
    await sleep(3500);
    r.back = await moveAll(live, (s) => base.get(s.code));
    await sleep(2500);
    rounds.push(r);
    log(`第 ${r.no} 轮：${r.symbols} 个品种，下单 ${r.orders} 条（${r.placeMs}ms），推动报价 ${r.up.ms}/${r.down.ms}/${r.back.ms}ms，失败 ${r.up.bad + r.down.bad + r.back.bad}`);
  }
  // 等最后一轮的撮合写完
  await sleep(5000);
  const wsSummary = {
    connections: ws.length,
    opened: ws.filter((w) => w.open).length,
    errors: ws.filter((w) => w.error).map((w) => `${w.path}: ${w.error}`),
    closedEarly: ws.filter((w) => w.closed).length,
    messages: ws.reduce((a, w) => a + w.messages, 0),
    marketSymbolsSeen: wsSymbols.size,
    marketSymbolUpdates: Object.fromEntries([...wsSymbols.entries()].sort()),
  };
  for (const w of ws) w.close();
  const out = {
    run: RUN,
    startedAt: new Date(t0).toISOString(),
    loadStartedAt: new Date(loadStart).toISOString(),
    endedAt: new Date().toISOString(),
    params: { USERS, WS_CLIENTS, DURATION_S, TRIGGER, UP, DOWN, NOTIONAL_USD, CONCURRENCY },
    users: users.length,
    symbols: specs.length,
    quotesListed: quotes0.length,
    quotesFresh: fresh.length,
    tradable: tradable.map((s) => s.code),
    notTradable,
    rounds,
    placed,
    ws: wsSummary,
  };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`完成：${rounds.length} 轮，下单成功 ${placed.ok} 条，失败 ${JSON.stringify(placed.errors)}；行情推送里出现过 ${wsSymbols.size} 个品种`);
  httpsAgent.destroy();
  httpAgent.destroy();
}

main().catch((e) => {
  console.error('压测失败：', e);
  process.exit(1);
});
