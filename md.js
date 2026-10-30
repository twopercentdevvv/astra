(function (g) {
  'use strict';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const unent = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x200B;/gi, '').replace(/&amp;/g, '&');

  function safeUrl(u) {
    u = u.trim();
    if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return 'https://www.reddit.com' + u;
    if (/^(r|u|user)\//i.test(u)) return 'https://www.reddit.com/' + u;
    return '#';
  }
  const anchor = (url, html) => '<a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + html + '</a>';

  function inline(raw) {
    const hold = [];
    const put = (html) => '\u0000' + (hold.push(html) - 1) + '\u0000';
    let s = raw;

    s = s.replace(/`([^`\n]+)`/g, (m, c) => put('<code>' + esc(c) + '</code>'));
    s = s.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (m, t, u) => put(anchor(u, inline(t))));
    s = s.replace(/(^|[\s(>])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g, (m, pre, u) => pre + put(anchor(u, esc(u.length > 70 ? u.slice(0, 67) + '...' : u))));
    s = s.replace(/(^|[^\w/])\/?(u|user|r)\/([A-Za-z0-9_-]{2,21})\b/g, (m, pre, k, n) => {
      const kind = k === 'r' ? 'r' : 'user';
      return pre + put(anchor('https://www.reddit.com/' + kind + '/' + n, esc((k === 'r' ? 'r/' : 'u/') + n)));
    });

    s = esc(s);
    s = s.replace(/&gt;!(.+?)!&lt;/g, '<span class="spoiler" tabindex="0">$1</span>');
    s = s.replace(/\*\*\*(?=\S)(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w_])__(?=\S)(.+?)__(?=[^\w_]|$)/g, '$1<strong>$2</strong>');
    s = s.replace(/\*(?=[^\s*])(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w_])_(?=[^\s_])(.+?)_(?=[^\w_]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/\^\(([^)]+)\)/g, '<sup>$1</sup>');
    s = s.replace(/\^([^\s^]+)/g, '<sup>$1</sup>');
    s = s.replace(/ {2,}\n|\n/g, '<br>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => hold[+i]);
    return s;
  }

  const isBlank = (l) => /^\s*$/.test(l);
  const reHead = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const reHr = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const reList = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
  const reFence = /^\s*```/;
  const reTableSep = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function startsBlock(l, next) {
    return reHead.test(l) || reHr.test(l) || reFence.test(l) || (/^\s*>(?!!)/.test(l)) || reList.test(l) ||
      (l.includes('|') && next !== undefined && reTableSep.test(next));
  }

  function renderBlocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }

      if (reFence.test(l)) {
        const buf = [];
        i++;
        while (i < lines.length && !reFence.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      let m = reHead.exec(l);
      if (m) { out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
      if (reHr.test(l)) { out.push('<hr>'); i++; continue; }

      if (/^( {4}|\t)/.test(l)) {
        const buf = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || (isBlank(lines[i]) && i + 1 < lines.length && /^( {4}|\t)/.test(lines[i + 1])))) {
          buf.push(lines[i].replace(/^( {4}|\t)/, ''));
          i++;
        }
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (/^\s*>(?!!)/.test(l)) {
        const buf = [];
        while (i < lines.length && /^\s*>(?!!)/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + renderBlocks(buf) + '</blockquote>');
        continue;
      }

      if (l.includes('|') && i + 1 < lines.length && reTableSep.test(lines[i + 1])) {
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = cells(l);
        i += 2;
        const rows = [];
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(cells(lines[i++]));
        out.push('<div class="tablewrap"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }

      if (reList.test(l)) {
        const items = [];
        while (i < lines.length) {
          const mm = reList.exec(lines[i]);
          if (mm) { items.push({ indent: mm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(mm[2]), text: mm[3] }); i++; continue; }
          if (!isBlank(lines[i]) && /^\s+\S/.test(lines[i]) && items.length) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue; }
          break;
        }
        out.push(buildList(items, 0, items[0].indent).html);
        continue;
      }

      const buf = [];
      while (i < lines.length && !isBlank(lines[i]) && !(buf.length && startsBlock(lines[i], lines[i + 1]))) buf.push(lines[i++]);
      out.push('<p>' + inline(buf.join('\n')) + '</p>');
    }
    return out.join('');
  }

  function buildList(items, start, indent) {
    const tag = items[start].ordered ? 'ol' : 'ul';
    let html = '<' + tag + '>';
    let i = start;
    while (i < items.length && items[i].indent >= indent) {
      if (items[i].indent > indent) {
        const sub = buildList(items, i, items[i].indent);
        html = html.replace(/<\/li>$/, sub.html + '</li>');
        i = sub.next;
        continue;
      }
      html += '<li>' + inline(items[i].text) + '</li>';
      i++;
    }
    return { html: html + '</' + tag + '>', next: i };
  }

  function render(md) {
    if (!md) return '';
    const text = unent(md).replace(/\r\n?/g, '\n');
    return renderBlocks(text.split('\n'));
  }

  g.AstraMD = { render, inline, esc, unent };
})(typeof window !== 'undefined' ? window : globalThis);
