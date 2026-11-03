/* test-md.js —— 校验 Markdown 渲染器的块级 / 行内规则 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const MD = require(path.join(__dirname, '..', 'src', 'md.js'));

const cases = [];
function check(name, md, fn) { cases.push({ name, md, fn }); }

const has = (html, s) => html.indexOf(s) >= 0;
const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

check('ATX 标题', '# 一级\n## 二级 ##', (h, toc) => {
  assert.ok(has(h, '<h1 id="一级">一级</h1>'), h);
  assert.ok(has(h, '<h2 id="二级">二级</h2>'), h);
  assert.deepStrictEqual(toc.map(t => t.level), [1, 2]);
});

check('Setext 标题', '标题一\n===\n\n标题二\n---', (h) => {
  assert.ok(has(h, '<h1 id="标题一">标题一</h1>'), h);
  assert.ok(has(h, '<h2 id="标题二">标题二</h2>'), h);
});

check('段落与软换行（西文）', 'hello\nworld', (h) => {
  assert.ok(has(h, '<p>hello world</p>'), h);
});

check('段落与软换行（中文）', '第一行\n第二行', (h) => {
  assert.ok(has(h, '<p>第一行<br>第二行</p>'), h);
});

check('粗体/斜体/删除线/行内代码', '**粗** *斜* ~~删~~ `a<b`', (h) => {
  assert.ok(has(h, '<strong>粗</strong>'), h);
  assert.ok(has(h, '<em>斜</em>'), h);
  assert.ok(has(h, '<del>删</del>'), h);
  assert.ok(has(h, '<code>a&lt;b</code>'), h);
});

check('围栏代码块（语言 + 转义）', '```js\nconst a = "<b>";\n```', (h) => {
  assert.ok(has(h, 'class="code-block"'), h);
  assert.ok(has(h, 'class="language-js"'), h);
  assert.ok(has(h, 'tok-kw">const<'), h);
  assert.ok(has(h, '&lt;b&gt;'), h);
  assert.ok(!has(h, '<b>'), '不应出现未转义的 <b>');
});

check('未闭合围栏也能渲染', '```\nplain\n', (h) => {
  assert.ok(has(h, '<pre><code>'), h);
});

check('无序列表', '- a\n- b\n  - b1', (h) => {
  const flat = h.replace(/\s*\n\s*/g, '');
  assert.ok(has(flat, '<ul>'), h);
  assert.ok(has(flat, '<li>a</li>'), h);
  assert.ok(has(flat, '<li>b<ul><li>b1</li></ul></li>'), flat);
});

check('有序列表 + start', '3. c\n4. d', (h) => {
  assert.ok(has(h, '<ol start="3">'), h);
  assert.ok(has(h, '<li>c</li>'), h);
});

check('任务列表', '- [x] 完成\n- [ ] 待办', (h) => {
  assert.ok(has(h, 'type="checkbox" disabled checked'), h);
  assert.ok(has(h, 'type="checkbox" disabled>'), h);
});

check('引用块', '> 引用 **粗**\n> 第二行', (h) => {
  assert.ok(has(h, '<blockquote>'), h);
  assert.ok(has(h, '<strong>粗</strong>'), h);
});

check('表格 + 对齐', '| 左 | 中 | 右 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', (h) => {
  assert.ok(has(h, '<table>'), h);
  assert.ok(has(h, 'style="text-align:left"'), h);
  assert.ok(has(h, 'style="text-align:center"'), h);
  assert.ok(has(h, 'style="text-align:right"'), h);
  assert.ok(has(h, '<td style="text-align:right">3</td>'), h);
});

check('分隔线', 'a\n\n---\n\nb', (h) => {
  assert.ok(has(h, '<hr>'), h);
});

check('链接与图片', '[文](https://x.com) ![图](a.png)', (h) => {
  assert.ok(has(h, 'href="https://x.com"'), h);
  assert.ok(has(h, 'target="_blank"'), h);
  assert.ok(has(h, '<img src="a.png" alt="图"'), h);
});

check('自动链接', '看 <https://example.com/a>', (h) => {
  assert.ok(has(h, '<a href="https://example.com/a"'), h);
});

check('转义', '\\*不是斜体\\*', (h) => {
  assert.ok(has(h, '*不是斜体*'), h);
  assert.ok(!has(h, '<em>'), h);
});

check('缩进代码块', '    x = 1\n    y = 2', (h) => {
  const body = textOf(h);
  assert.ok(body.indexOf('x = 1\ny = 2') >= 0, body);
});

check('标题去重 id', '# A\n# A', (h, toc) => {
  assert.deepStrictEqual(toc.map(t => t.id), ['a', 'a-2']);
});

check('空输入', '', (h, toc) => {
  assert.strictEqual(h, '');
  assert.deepStrictEqual(toc, []);
});

let failed = 0;
for (const c of cases) {
  try {
    const res = MD.parse(c.md);
    c.fn(res.html, res.toc);
    console.log('  PASS  ' + c.name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + c.name + '\n        ' + err.message.split('\n').slice(0, 6).join('\n        '));
  }
}

// 用仓库内的示例文件做一次冒烟测试（真实文档，含表格、代码块、图片引用）
const fixture = path.join(__dirname, 'fixtures', 'sample.md');
if (fs.existsSync(fixture)) {
  try {
    const res = MD.parse(fs.readFileSync(fixture, 'utf8'));
    if (!res.html || res.html.length < 100) { throw new Error('输出过短'); }
    if (/<script/i.test(res.html)) { throw new Error('输出包含 <script'); }
    console.log('  PASS  示例文档冒烟测试（' + res.html.length + ' 字节 HTML，' + res.toc.length + ' 个标题）');
  } catch (err) {
    failed++;
    console.log('  FAIL  示例文档冒烟测试：' + err.message);
  }
} else {
  failed++;
  console.log('  FAIL  缺少示例文档：' + fixture);
}

console.log(failed ? ('\n共 ' + failed + ' 项失败') : ('\n全部 ' + (cases.length) + ' 项通过'));
process.exit(failed ? 1 : 0);
