#!/usr/bin/env node
/* md-open.js —— 双击 .md 时的入口：把 Markdown 内容预载进预览器页面，再用应用窗口打开
 * 由 md-open.vbs（隐藏窗口）调用，参数：<markdown 文件路径>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const MAX_IMG_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 60;
const KEEP_PREVIEWS = 40;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon'
};

function notifyError(message) {
  try {
    const esc = String(message).replace(/'/g, "''");
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "[System.Windows.Forms.MessageBox]::Show('" + esc + "','MD 预览器')"], { stdio: 'ignore', windowsHide: true });
  } catch (e) { /* 出错时至少写日志 */ }
  try {
    const dir = path.join(os.tmpdir(), 'md-preview');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'error.log'),
      '[' + new Date().toISOString() + '] ' + message + '\n', 'utf8');
  } catch (e) { /* ignore */ }
}

/* 全局兜底：双击后如果出事，至少弹个提示 + 写日志，而不是毫无反应 */
process.on('uncaughtException', (err) => {
  notifyError('打开失败：\n' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  notifyError('打开失败：\n' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});

/* 把正文里相对路径引用的本地图片转成 data URI，保证双击打开的文档也能看到图 */
function inlineImages(text, mdDir) {
  let count = 0;
  return text.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (whole, alt, rel) => {
    if (count >= MAX_IMAGES) { return whole; }
    if (/^(https?:|data:|blob:)/i.test(rel)) { return whole; }
    let clean = rel.replace(/^file:\/\//i, '').replace(/^\.\//, '');
    try { clean = decodeURIComponent(clean); } catch (e) { /* 保留原样 */ }
    const abs = path.resolve(mdDir, clean);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_IMG_BYTES) { return whole; }
      const ext = path.extname(abs).toLowerCase().replace('.', '');
      const mime = MIME[ext];
      if (!mime) { return whole; }
      const b64 = fs.readFileSync(abs).toString('base64');
      count++;
      return '![' + alt + '](data:' + mime + ';base64,' + b64 + ')';
    } catch (e) {
      return whole;
    }
  });
}

function cleanupOld(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^preview-.*\.html$/i.test(f))
      .map((f) => {
        const p = path.join(dir, f);
        return { p, t: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.t - a.t);
    files.slice(KEEP_PREVIEWS).forEach((item) => {
      try { fs.unlinkSync(item.p); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}

function findEdge() {
  const roots = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft')
  ].filter(Boolean);
  for (const root of roots) {
    const p = root.toLowerCase().indexOf('microsoft') >= 0
      ? path.join(root, 'Edge', 'Application', 'msedge.exe')
      : path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) { return p; }
  }
  return '';
}

function openPreview(href) {
  // 调试/自检用：只生成不弹窗
  if (process.env.MD_PREVIEW_NO_OPEN === '1') {
    console.log(href);
    return;
  }
  const edge = findEdge();
  if (edge) {
    // 应用窗口：没有地址栏和标签页，双击文档就像打开一个小阅读器
    spawn(edge, ['--app=' + href, '--window-size=1120,880'], {
      detached: true, stdio: 'ignore', windowsHide: false
    }).unref();
    return;
  }
  spawn('cmd', ['/c', 'start', '', href], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function main() {
  const arg = process.argv[2];
  if (!arg) { process.exit(0); }

  const mdPath = path.resolve(arg);
  let stat;
  try {
    stat = fs.statSync(mdPath);
  } catch (e) {
    notifyError('找不到文件：\n' + mdPath);
    process.exit(1);
  }
  if (!stat.isFile()) {
    notifyError('这不是一个文件：\n' + mdPath);
    process.exit(1);
  }

  const mdDir = path.dirname(mdPath);
  const name = path.basename(mdPath);
  let text;
  try {
    text = fs.readFileSync(mdPath, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    notifyError('读取文件失败：\n' + mdPath + '\n' + e.message);
    process.exit(1);
  }
  text = inlineImages(text, mdDir);

  const viewerPath = path.join(__dirname, '..', 'Markdown预览器.html');
  if (!fs.existsSync(viewerPath)) {
    notifyError('找不到预览器文件：\n' + viewerPath + '\n\n请确认 md-viewer 目录与 Markdown预览器.html 都没有被移动；\n移动后重新运行 md-viewer\\bin\\安装关联.cmd 即可。');
    process.exit(1);
  }

  let html = fs.readFileSync(viewerPath, 'utf8');
  const payload = JSON.stringify({ name: name, text: text }).replace(/</g, '\\u003c');
  const init = '<script>(function(){var d=' + payload + ';' +
    'function go(){var i=document.getElementById("file-input");if(!i)return;' +
    'var f=new File([d.text],d.name,{type:"text/markdown"});' +
    'Object.defineProperty(i,"files",{value:[f],configurable:true});' +
    'i.dispatchEvent(new Event("change"));}' +
    'if(document.readyState==="complete"){go();}else{window.addEventListener("load",go);}})();' + '</script>';

  // 用函数式替换：正文里可能出现 $' $& 之类的替换模式字符
  html = html.indexOf('</body>') >= 0
    ? html.replace('</body>', () => init + '\n</body>')
    : html + init;

  const outDir = path.join(os.tmpdir(), 'md-preview');
  fs.mkdirSync(outDir, { recursive: true });
  const safe = path.basename(name, path.extname(name))
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 48) || 'doc';
  const outFile = path.join(outDir, 'preview-' + Date.now() + '-' + safe + '.html');
  fs.writeFileSync(outFile, html, 'utf8');
  cleanupOld(outDir);

  openPreview(pathToFileURL(outFile).href);
}

main();
