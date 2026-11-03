/* build.js —— 把 index.html / style.css / md.js / app.js 打成一个可独立分发的单文件 HTML */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let html = read('index.html');
const css = read('style.css');
const mdjs = read('md.js');
const appjs = read('app.js');

const must = (needle) => {
  if (html.indexOf(needle) < 0) {
    throw new Error('index.html 中找不到占位：' + needle);
  }
};

must('<link rel="stylesheet" href="style.css">');
must('<script src="md.js"></script>');
must('<script src="app.js"></script>');

// 注意：必须用函数式替换，否则内容里的 $' / $& / $` 会被 String.replace 当作特殊模式吞掉
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');
html = html.replace('<script src="md.js"></script>', () => '<script>\n' + mdjs + '\n</script>');
html = html.replace('<script src="app.js"></script>', () => '<script>\n' + appjs + '\n</script>');

// 内联脚本里不能出现 </script 字面量
if (/<\/script/i.test(css + mdjs + appjs)) {
  throw new Error('内联内容包含 </script，需转义后再打包');
}

const out = path.join(dir, '..', 'Markdown预览器.html');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成单文件预览器：' + out + '  (' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB)');
