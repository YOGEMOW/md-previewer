/*! md.js —— 零依赖 Markdown → HTML 渲染器（GFM 常用子集）
 *  支持：ATX/Setext 标题、段落、粗体/斜体/删除线、行内代码、围栏代码块（带简易高亮）、
 *        有序/无序/嵌套列表、任务列表、引用、表格、分隔线、链接、图片、自动链接、转义。
 *  用法：MD.parse(src) -> { html, toc:[{level,text,id}] }；浏览器下挂到 window.MD。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MD = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 基础工具 ---------- */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function pad(str) { var n = 0; while (n < str.length && str.charCodeAt(n) === 32) { n++; } return n; }
  function dirOf(p) { return String(p || '').replace(/[^/\\]*$/, ''); }
  function baseName(p) { return String(p || '').replace(/^.*[\\/]/, ''); }

  var CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
  var RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/;
  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`~]*)$/;
  var RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}[ \t]*$/;
  var RE_ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  var RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
  var RE_BQ = /^ {0,3}>/;
  var RE_BQ_STRIP = /^ {0,3}>[ ]?/;

  /* ---------- 代码高亮（轻量，够看即可） ---------- */

  var KW = {
    js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield null undefined true false',
    ts: 'abstract any as async await break case catch class const continue declare default delete do else enum export extends finally for from function if implements import in instanceof interface let new of private protected public readonly return static super switch this throw try type typeof var void while yield null undefined true false',
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self',
    bash: 'if then else elif fi for while do done case esac function in local return exit export echo cd source alias set unset readonly',
    json: 'true false null',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false null',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while true false NULL'
  };
  var LANG_ALIAS = {
    js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
    ts: 'ts', typescript: 'ts', tsx: 'ts',
    py: 'py', python: 'py',
    sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', powershell: 'bash', ps1: 'bash',
    json: 'json', jsonc: 'json', go: 'go', golang: 'go', rust: 'rust', rs: 'rust',
    java: 'java', kotlin: 'java', kt: 'java', scala: 'java', cs: 'java', csharp: 'java', 'c#': 'java',
    c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', hpp: 'c', objc: 'c',
    sql: 'sql', mysql: 'sql', pgsql: 'sql'
  };
  var HASH_COMMENT_LANG = { bash: 1, py: 1 };

  function highlight(code, lang) {
    var key = LANG_ALIAS[String(lang || '').toLowerCase()] || '';
    var h = escapeHtml(code);
    var store = [];
    function tok(html) { store.push(html); return '\u0000' + (store.length - 1) + '\u0000'; }

    h = h.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, function (m) {
      return tok('<span class="tok-str">' + m + '</span>');
    });

    var commentRe = HASH_COMMENT_LANG[key]
      ? /(#[^\n]*|\/\*[\s\S]*?\*\/)/
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)/;
    h = h.replace(commentRe, function (m) { return tok('<span class="tok-com">' + m + '</span>'); });

    h = h.replace(/\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, function (m) {
      return tok('<span class="tok-num">' + m + '</span>');
    });

    var kws = KW[key];
    if (kws) {
      var re = new RegExp('\\b(' + kws.split(' ').join('|') + ')\\b', 'g');
      h = h.replace(re, function (m) { return tok('<span class="tok-kw">' + m + '</span>'); });
    }

    var guard = 0;
    while (h.indexOf('\u0000') >= 0 && guard++ < 300) {
      h = h.replace(/\u0000(\d+)\u0000/g, function (m, n) {
        var v = store[+n];
        return v == null ? m : v;
      });
    }
    return h;
  }

  /* ---------- 行内渲染 ---------- */

  function inline(text) {
    if (text == null) return '';
    var store = [];
    function tok(html) { store.push(html); return '\u0000' + (store.length - 1) + '\u0000'; }

    var s = String(text);

    // 反斜杠转义
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, function (m, ch) { return tok(escapeHtml(ch)); });

    // 行内代码
    s = s.replace(/(`+)([\s\S]*?)\1/g, function (m, ticks, code) {
      var c = code;
      if (c.length > 2 && c.charCodeAt(0) === 32 && c.charCodeAt(c.length - 1) === 32 && c.trim() !== '') {
        c = c.slice(1, -1);
      }
      return tok('<code>' + escapeHtml(c) + '</code>');
    });

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, function (m, alt, src, title) {
      return tok('<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '"' +
        (title ? ' title="' + escapeHtml(title) + '"' : '') + ' loading="lazy">');
    });

    // 链接
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, function (m, txt, href, title) {
      var ext = /^https?:|^mailto:/i.test(href);
      return tok('<a href="' + escapeHtml(href) + '"' +
        (title ? ' title="' + escapeHtml(title) + '"' : '') +
        (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inline(txt) + '</a>');
    });

    // 自动链接 <https://...>
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, function (m, url) {
      return tok('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>');
    });

    // 其余文本做 HTML 转义（token 中的 \u0000 不受影响）
    s = escapeHtml(s);

    // 强调
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1<em>$2</em>');

    // 硬换行（行尾两个空格 或 反斜杠）
    s = s.replace(/ {2,}\n/g, '<br>');
    s = s.replace(/\\\n/g, '<br>');

    // 软换行：中文按换行显示，西文按空格合并
    s = s.replace(/([\s\S])\n([\s\S])/g, function (m, prev, next) {
      if (CJK_RE.test(prev) || CJK_RE.test(next)) { return prev + '<br>' + next; }
      return prev + ' ' + next;
    });

    // 还原 token
    var guard = 0;
    while (s.indexOf('\u0000') >= 0 && guard++ < 300) {
      s = s.replace(/\u0000(\d+)\u0000/g, function (m, n) {
        var v = store[+n];
        return v == null ? m : v;
      });
    }
    return s;
  }

  /* ---------- 块级渲染 ---------- */

  function slugify(text, seen) {
    var base = String(text).toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 64);
    if (!base) { base = 'section'; }
    var id = base, n = 1;
    while (seen[id]) { id = base + '-' + (++n); }
    seen[id] = 1;
    return id;
  }

  function heading(level, text, ctx) {
    var plain = String(text)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim();
    var id = slugify(plain, ctx.slugs);
    ctx.toc.push({ level: level, text: plain, id: id });
    return '<h' + level + ' id="' + escapeHtml(id) + '">' + inline(text) + '</h' + level + '>';
  }

  function codeBlock(code, lang) {
    var label = lang ? String(lang) : 'text';
    return '<div class="code-block">' +
      '<div class="code-head"><span class="code-lang">' + escapeHtml(label) + '</span>' +
      '<button class="code-copy" type="button" title="复制代码">复制</button></div>' +
      '<pre><code' + (lang ? ' class="language-' + escapeHtml(String(lang).toLowerCase()) + '"' : '') + '>' +
      highlight(code, lang) + '</code></pre></div>';
  }

  function isTableSep(line) {
    if (line.indexOf('-') < 0) return false;
    return /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line);
  }

  function splitRow(line) {
    var s = String(line).trim();
    if (s.charAt(0) === '|') { s = s.slice(1); }
    if (s.charAt(s.length - 1) === '|') { s = s.slice(0, -1); }
    var cells = [], cur = '', esc = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (esc) { cur += ch; esc = false; continue; }
      if (ch === '\\') { cur += ch; esc = true; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function tableBlock(lines, start, out) {
    var head = splitRow(lines[start]);
    var sep = splitRow(lines[start + 1]);
    var aligns = sep.map(function (c) {
      var left = /^:/.test(c), right = /:$/.test(c);
      return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
    });
    var i = start + 2, body = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && lines[i].indexOf('|') >= 0) {
      body.push(splitRow(lines[i]));
      i++;
    }
    var html = '<div class="table-wrap"><table><thead><tr>';
    head.forEach(function (c, k) {
      var a = aligns[k] || '';
      html += '<th' + (a ? ' style="text-align:' + a + '"' : '') + '>' + inline(c) + '</th>';
    });
    html += '</tr></thead><tbody>';
    body.forEach(function (row) {
      html += '<tr>';
      for (var k = 0; k < head.length; k++) {
        var a = aligns[k] || '';
        html += '<td' + (a ? ' style="text-align:' + a + '"' : '') + '>' + inline(row[k] || '') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    out.push(html);
    return i;
  }

  function isBlockStart(line) {
    return RE_ATX.test(line) || RE_FENCE.test(line) || RE_HR.test(line) || RE_BQ.test(line) ||
      /^ {0,3}([-*_])[ \t]*(\1[ \t]*){2,}/.test(line);
  }

  /* 列表：先按基准缩进切分同级项，再把每一项的内容递归渲染 */
  function listBlock(lines, start, ctx, out) {
    var first = RE_LIST.exec(lines[start]);
    var base = pad(first[1]);
    var ordered = /\d/.test(first[2]);
    var startNo = ordered ? parseInt(first[2], 10) : 0;
    var items = [];
    var loose = false;
    var i = start;

    while (i < lines.length) {
      var m = RE_LIST.exec(lines[i]);
      if (!m || pad(m[1]) !== base || /\d/.test(m[2]) !== ordered) { break; }
      var contentIndent = base + m[2].length + m[3].length;
      var itemLines = [m[4]];
      i++;

      while (i < lines.length) {
        var l = lines[i];
        if (/^\s*$/.test(l)) {
          var j = i;
          while (j < lines.length && /^\s*$/.test(lines[j])) { j++; }
          if (j >= lines.length) { i = j; break; }
          var nm = RE_LIST.exec(lines[j]);
          if (nm && pad(nm[1]) === base) {
            // 同级项：类型相同才算松散；类型不同（ul 接 ol）说明当前列表结束
            if (/\d/.test(nm[2]) === ordered) { loose = true; }
            i = j;
            break;
          }
          if (pad(lines[j]) >= contentIndent || (nm && pad(nm[1]) > base)) {     // 项内空行块
            for (var b = i; b < j; b++) { itemLines.push(''); }
            loose = true; i = j; continue;
          }
          i = j; break;
        }
        var ind = pad(l);
        var lm = RE_LIST.exec(l);
        if (ind >= contentIndent) { itemLines.push(l.slice(contentIndent)); i++; continue; }
        if (ind > base && !lm && !isBlockStart(l)) { itemLines.push(l.slice(Math.min(ind, contentIndent))); i++; continue; }
        break;
      }
      items.push(itemLines);
    }

    var tag = ordered ? 'ol' : 'ul';
    var startAttr = ordered && startNo > 1 ? ' start="' + startNo + '"' : '';
    var html = '<' + tag + startAttr + (loose ? ' class="loose"' : '') + '>';
    items.forEach(function (ils) {
      var firstLine = ils[0] || '';
      var task = /^\[([ xX])\][ \t]+/.exec(firstLine);
      var inner;
      var liClass = '';
      if (task) {
        ils[0] = firstLine.slice(task[0].length);
        inner = renderBlocks(ils, ctx);
        inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        inner = '<label class="task"><input type="checkbox" disabled' +
          (task[1].toLowerCase() === 'x' ? ' checked' : '') + '><span>' + inner + '</span></label>';
        liClass = ' class="task-item"';
      } else {
        inner = renderBlocks(ils, ctx);
        if (!loose) { inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1'); }
      }
      html += '<li' + liClass + '>' + inner + '</li>';
    });
    html += '</' + tag + '>';
    out.push(html);
    return i;
  }

  function renderBlocks(lines, ctx) {
    var out = [];
    var para = [];
    var i = 0;

    function flush() {
      if (!para.length) { return; }
      out.push('<p>' + inline(para.join('\n')) + '</p>');
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { flush(); i++; continue; }

      // 围栏代码块
      var fm = RE_FENCE.exec(line);
      if (fm) {
        flush();
        var fenceChar = fm[1].charAt(0);
        var fenceLen = fm[1].length;
        var lang = String(fm[2] || '').trim().split(/\s+/)[0];
        var closeRe = new RegExp('^ {0,3}' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}[ \\t]*$');
        var buf = [];
        i++;
        while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i < lines.length) { i++; }
        out.push(codeBlock(buf.join('\n'), lang));
        continue;
      }

      // ATX 标题
      var hm = RE_ATX.exec(line);
      if (hm && hm[2].trim() !== '') {
        flush();
        out.push(heading(hm[1].length, hm[2].trim(), ctx));
        i++;
        continue;
      }

      // Setext 标题（前一段累积成标题）
      if (para.length && RE_SETEXT.test(line)) {
        var lvl = line.trim().charAt(0) === '=' ? 1 : 2;
        var title = para.join(' ');
        para = [];
        out.push(heading(lvl, title, ctx));
        i++;
        continue;
      }

      // 分隔线
      if (RE_HR.test(line)) { flush(); out.push('<hr>'); i++; continue; }

      // 引用
      if (RE_BQ.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && RE_BQ.test(lines[i])) {
          q.push(lines[i].replace(RE_BQ_STRIP, ''));
          i++;
        }
        out.push('<blockquote>' + renderBlocks(q, ctx) + '</blockquote>');
        continue;
      }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flush();
        i = tableBlock(lines, i, out);
        continue;
      }

      // 列表
      if (RE_LIST.test(line)) {
        flush();
        i = listBlock(lines, i, ctx, out);
        continue;
      }

      // 缩进代码块
      if (/^ {4,}/.test(line)) {
        flush();
        var code = [];
        while (i < lines.length) {
          if (/^ {4,}/.test(lines[i])) { code.push(lines[i].slice(4)); i++; continue; }
          if (/^\s*$/.test(lines[i])) {
            var k = i;
            while (k < lines.length && /^\s*$/.test(lines[k])) { k++; }
            if (k < lines.length && /^ {4,}/.test(lines[k])) {
              for (var b = i; b < k; b++) { code.push(''); }
              i = k;
              continue;
            }
          }
          break;
        }
        while (code.length && code[code.length - 1].trim() === '') { code.pop(); }
        out.push(codeBlock(code.join('\n'), ''));
        continue;
      }

      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  /* ---------- 对外接口 ---------- */

  function parse(src) {
    var text = String(src == null ? '' : src)
      .replace(/\r\n?/g, '\n')
      .replace(/^\uFEFF/, '')
      .replace(/\t/g, '    ');
    var ctx = { toc: [], slugs: Object.create(null) };
    var html = renderBlocks(text.split('\n'), ctx);
    return { html: html, toc: ctx.toc };
  }

  return { parse: parse, escapeHtml: escapeHtml, dirOf: dirOf, baseName: baseName };
}));
