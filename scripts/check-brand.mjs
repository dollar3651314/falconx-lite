#!/usr/bin/env node
// 品牌改名检查（v2，验收 AC2-11）：前端构建产物里不能有旧品牌名（FalconX，大小写、中间有空格都算）。
// 用法（在 web/client 或 web/admin 目录下，npm run build 之后）：node ../../scripts/check-brand.mjs [dist]
// 检查产物里所有文本文件（.js、.css、.html、.webmanifest、.json、.svg、.txt）。产物会整个发到客户的浏览器，
// 所以注释、代码里的内部名字出现在产物里也算（正常情况下构建会去掉注释，内部名字不该进前端产物）。
// 后端发给客户的文字（通知模板、代码里的固定文字）由后端测试 BrandTextTest 检查（AC2-12）。
import fs from 'node:fs';
import path from 'node:path';

const [distDir = 'dist'] = process.argv.slice(2);
const OLD_BRAND = /falcon\s*x/i;
const TEXT = /\.(js|mjs|css|html|webmanifest|json|svg|txt|map)$/i;

const root = path.resolve(distDir);
if (!fs.existsSync(root)) {
  console.error(`找不到构建产物目录 ${root}（先 npm run build）`);
  process.exit(2);
}
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : TEXT.test(p) ? [p] : [];
  });

const files = walk(root);
const hits = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const m = text.match(OLD_BRAND);
  if (m) {
    const at = m.index ?? 0;
    hits.push(`${path.relative(root, f)}：…${text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}…`);
  }
}
if (files.length === 0) {
  console.error('构建产物里没有文本文件，检查不了（目录写错了？）');
  process.exit(2);
}
if (hits.length > 0) {
  console.error(`构建产物里有旧品牌名（${hits.length} 个文件），客户看得到，改成 Quick Come：`);
  for (const h of hits.slice(0, 20)) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`通过：${files.length} 个产物文件里没有旧品牌名`);
