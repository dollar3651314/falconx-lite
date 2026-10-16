// 端到端测试用的站点（S19）：只用 Node 自带模块，不引入额外依赖。
// - 客户端构建产物（web/client/dist）在 `/`，后台（web/admin/dist）在 `/admin/`，找不到的页面路径回到各自的 index.html（浏览器路由）
// - `/api/**`（含 WebSocket）原样转发到后端（默认 http://127.0.0.1:8080），保留浏览器的 Host 头（后端的 WebSocket 只接受同源），和测试环境 Nginx 的同源方式一致
// 环境变量：E2E_PORT（默认 4173）、E2E_BACKEND（默认 http://127.0.0.1:8080）
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 4173);
const BACKEND = new URL(process.env.E2E_BACKEND || 'http://127.0.0.1:8080');
const SITES = [
  { prefix: '/admin/', dir: path.join(root, 'web/admin/dist') },
  { prefix: '/', dir: path.join(root, 'web/client/dist') },
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

for (const s of SITES) {
  if (!fs.existsSync(path.join(s.dir, 'index.html'))) {
    console.error(`缺少构建产物 ${s.dir}/index.html：先在 web/client 和 web/admin 里运行 npm run build`);
    process.exit(1);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/admin') pathname = '/admin/';
  const site = SITES.find((s) => pathname.startsWith(s.prefix));
  const rel = pathname.slice(site.prefix.length);
  let file = path.join(site.dir, rel);
  if (!file.startsWith(site.dir)) {
    res.writeHead(400).end();
    return;
  }
  if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // 带扩展名的资源不存在就是 404；页面路径回到 index.html
    if (path.extname(rel)) {
      res.writeHead(404).end();
      return;
    }
    file = path.join(site.dir, 'index.html');
  }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function proxy(req, res) {
  const up = http.request(
    { hostname: BACKEND.hostname, port: BACKEND.port, method: req.method, path: req.url, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end('{"code":"BAD_GATEWAY","message":"后端没有启动","fields":[]}');
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) proxy(req, res);
  else serveStatic(req, res);
});

// WebSocket：把升级请求原样转给后端，之后双向转发字节
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/')) {
    socket.destroy();
    return;
  }
  const up = net.connect(Number(BACKEND.port), BACKEND.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`端到端测试站点 http://127.0.0.1:${PORT}（客户端 /，后台 /admin/，/api → ${BACKEND.origin}）`);
});
