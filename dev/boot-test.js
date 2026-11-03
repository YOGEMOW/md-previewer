/* boot-test.js —— 用 jsdom 真正加载打包后的单文件预览器，验证启动与交互 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const built = path.join(root, 'Markdown预览器.html');
const html = fs.readFileSync(built, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fails.push(msg); console.log('  FAIL  ' + msg); }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const stack = (e && (e.stack || (e.detail && e.detail.stack))) || '';
    errors.push('jsdomError: ' + e.message + '\n' + String(stack).split('\n').slice(0, 6).join('\n'));
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/previewer.html',
    virtualConsole: vc,
    pretendToBeVisual: true
  });
  const { window } = dom;
  const document = window.document;

  await delay(60);

  ok(document.body.getAttribute('data-ready') === '1', '脚本启动完成（data-ready=1）');
  ok(errors.length === 0, '启动期间无 JS 错误' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));

  // 空状态
  ok(document.getElementById('empty').hidden === false, '空状态可见');
  ok(document.getElementById('viewer').hidden === true, '正文初始隐藏');
  ok(document.getElementById('file-count').textContent === '0', '文件计数为 0');

  // 模拟打开一个文件
  const f1 = new window.File(
    ['# 检查报告\n\n正文里有 **粗体** 和 `代码`。\n\n## 小节\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n'],
    'notes.md', { type: 'text/markdown' }
  );
  const f2 = new window.File(['# 第二份\n\n内容。'], 'second.md', { type: 'text/markdown' });
  const input = document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [f1, f2], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await delay(120);

  const viewer = document.getElementById('viewer');
  ok(document.getElementById('file-count').textContent === '2', '文件计数更新为 2');
  ok(document.querySelectorAll('#file-list .file-item').length === 2, '文件列表渲染 2 项');
  ok(viewer.hidden === false, '打开文件后正文可见');
  ok(document.getElementById('empty').hidden === true, '打开文件后空状态隐藏（hidden 生效）');
  ok(viewer.getAttribute('class') === 'markdown-body', '预览模式 class 正确');
  ok(/<h1[^>]*>检查报告<\/h1>/.test(viewer.innerHTML), '标题渲染正确');
  ok(/<strong>粗体<\/strong>/.test(viewer.innerHTML), '粗体渲染正确');
  ok(/<code>代码<\/code>/.test(viewer.innerHTML), '行内代码渲染正确');
  ok(/<table>/.test(viewer.innerHTML), '表格渲染正确');
  ok(/class="code-block"/.test(viewer.innerHTML), '代码块渲染正确');
  ok(/class="code-copy"/.test(viewer.innerHTML), '代码块复制按钮存在');
  ok(document.querySelectorAll('#outline .outline-item').length === 2, '大纲生成 2 个条目');
  ok(document.getElementById('doc-title').textContent === 'notes.md', '标题显示文件名');
  ok(/2 个标题/.test(document.getElementById('doc-meta').textContent), '元信息含标题数');

  // 主题切换
  const themeBtn = document.getElementById('btn-theme');
  const before = document.documentElement.getAttribute('data-theme');
  themeBtn.click();
  const after = document.documentElement.getAttribute('data-theme');
  ok(before !== after, '主题按钮切换生效（' + before + ' -> ' + after + '）');

  // 字号
  const fsBefore = document.documentElement.style.getPropertyValue('--fs');
  document.getElementById('btn-font-inc').click();
  const fsAfter = document.documentElement.style.getPropertyValue('--fs');
  ok(fsBefore !== fsAfter, '字号放大生效（' + fsBefore + ' -> ' + fsAfter + '）');

  // 源码视图
  document.getElementById('btn-source').click();
  await delay(30);
  ok(viewer.getAttribute('class') === 'source-view', '切换到源码视图');
  ok(viewer.textContent.indexOf('# 检查报告') === 0, '源码视图显示原文');
  document.getElementById('btn-source').click();
  await delay(30);
  ok(viewer.getAttribute('class') === 'markdown-body', '切回预览视图');

  // 筛选
  const filter = document.getElementById('file-filter');
  filter.value = 'second';
  filter.dispatchEvent(new window.Event('input'));
  ok(document.querySelectorAll('#file-list .file-item').length === 1, '文件名筛选生效');
  filter.value = '';
  filter.dispatchEvent(new window.Event('input'));
  ok(document.querySelectorAll('#file-list .file-item').length === 2, '清空筛选后恢复');

  // 切换文件
  document.querySelectorAll('#file-list .file-item')[1].click();
  await delay(150);
  ok(document.getElementById('doc-title').textContent === 'second.md',
    '切换文件生效（实际：' + document.getElementById('doc-title').textContent + '）');
  ok(/第二份/.test(viewer.innerHTML), '第二份文件内容渲染正确');

  // 打印：桩掉 window.print 后点击，不应报错
  window.print = () => { window.__printed = true; };
  document.getElementById('btn-print').click();
  ok(window.__printed === true, '打印按钮调用 window.print');

  ok(errors.length === 0, '交互全程无 JS 错误' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));

  // 样式类交叉校验：渲染出的 class 是否都在 CSS 里有定义
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
  const structure = document.documentElement.outerHTML
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const tokens = new Set();
  (structure.match(/class="([^"]*)"/g) || []).forEach((m) => {
    m.replace(/class="|"/g, '').split(/\s+/).forEach((t) => { if (t) { tokens.add(t); } });
  });
  const allow = new Set(['lv1']); // lv1 复用基类样式，无需单独规则
  const missing = Array.from(tokens).filter((t) => !allow.has(t) && css.indexOf('.' + t) < 0);
  ok(missing.length === 0, '渲染/结构里的 class 全部有样式定义' + (missing.length ? '：缺 ' + missing.join(', ') : ''));

  console.log('\n结果：' + pass + ' 项通过，' + fails.length + ' 项失败');
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('测试脚本异常：', err);
  process.exit(2);
});
