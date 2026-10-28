/* 本地文档预览：不加载 CDN，不调用外部服务。OOXML 由浏览器直接解包解析。 */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const decoder = new TextDecoder('utf-8');
  const OFFICE_SIZE_LIMIT = 128 * 1024 * 1024;

  async function fetchBuffer(url, limit) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('读取文件失败（HTTP ' + r.status + '）');
    const len = Number(r.headers.get('Content-Length') || 0);
    if (limit && len > limit) throw new Error('文件超过本地预览大小限制（' + Math.round(limit / 1048576) + ' MB）');
    const buf = await r.arrayBuffer();
    if (limit && buf.byteLength > limit) throw new Error('文件超过本地预览大小限制');
    return buf;
  }

  async function fetchText(url, limit) {
    return decoder.decode(await fetchBuffer(url, limit || 4 * 1024 * 1024));
  }

  // 仅实现预览所需的 ZIP 中央目录读取，支持 Store 与 Deflate。
  class OOXMLZip {
    constructor(buf) { this.buf = buf; this.u8 = new Uint8Array(buf); this.dv = new DataView(buf); this.entries = new Map(); }
    static async open(buf) {
      const z = new OOXMLZip(buf);
      z.readDirectory();
      return z;
    }
    readDirectory() {
      const u8 = this.u8, dv = this.dv;
      let eocd = -1;
      const start = Math.max(0, u8.length - 65557);
      for (let i = u8.length - 22; i >= start; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('不是有效的 Office Open XML 文件');
      const count = dv.getUint16(eocd + 10, true);
      let p = dv.getUint32(eocd + 16, true);
      for (let n = 0; n < count; n++) {
        if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Office 文件目录损坏');
        const method = dv.getUint16(p + 10, true);
        const compressed = dv.getUint32(p + 20, true);
        const size = dv.getUint32(p + 24, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const offset = dv.getUint32(p + 42, true);
        const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen));
        this.entries.set(name, { method, compressed, size, offset });
        p += 46 + nameLen + extraLen + commentLen;
      }
    }
    has(name) { return this.entries.has(name); }
    names() { return Array.from(this.entries.keys()); }
    async bytes(name) {
      const e = this.entries.get(name);
      if (!e) throw new Error('Office 文件缺少部件：' + name);
      if (e.size > 64 * 1024 * 1024) throw new Error('Office 内部部件过大，已停止本地解析');
      const p = e.offset;
      if (this.dv.getUint32(p, true) !== 0x04034b50) throw new Error('Office 文件内容损坏');
      const nameLen = this.dv.getUint16(p + 26, true);
      const extraLen = this.dv.getUint16(p + 28, true);
      const from = p + 30 + nameLen + extraLen;
      const data = this.u8.slice(from, from + e.compressed);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new Error('不支持的 Office 压缩方式：' + e.method);
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持本地解压，请使用新版 Chrome 或 Edge');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async text(name) { return decoder.decode(await this.bytes(name)); }
    async xml(name) {
      const doc = new DOMParser().parseFromString(await this.text(name), 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Office XML 解析失败：' + name);
      return doc;
    }
  }

  function descendants(el, name) {
    return Array.from(el.getElementsByTagName('*')).filter((n) => n.localName === name);
  }
  function attr(el, name) {
    if (!el) return '';
    return el.getAttribute(name) || el.getAttribute('r:' + name) || el.getAttribute('w:' + name) || '';
  }
  function nodeText(el) { return descendants(el, 't').map((n) => n.textContent || '').join(''); }
  function relTarget(base, target) {
    if (/^https?:/i.test(target)) return '';
    if (target.startsWith('/')) return target.slice(1);
    const parts = (base + '/' + target).split('/');
    const out = [];
    parts.forEach((p) => { if (!p || p === '.') return; if (p === '..') out.pop(); else out.push(p); });
    return out.join('/');
  }
  async function relationships(zip, name, base) {
    const map = {};
    if (!zip.has(name)) return map;
    const xml = await zip.xml(name);
    descendants(xml, 'Relationship').forEach((r) => { map[r.getAttribute('Id')] = relTarget(base, r.getAttribute('Target') || ''); });
    return map;
  }
  async function imageUrl(zip, path) {
    if (!path || !zip.has(path)) return '';
    const blob = new Blob([await zip.bytes(path)]);
    return URL.createObjectURL(blob);
  }

  function paragraphText(p) {
    let out = '';
    Array.from(p.getElementsByTagName('*')).forEach((n) => {
      if (n.localName === 't') out += n.textContent || '';
      else if (n.localName === 'tab') out += '\t';
      else if (n.localName === 'br') out += '\n';
    });
    return out;
  }

  async function renderDocx(container, zip) {
    const doc = await zip.xml('word/document.xml');
    const body = descendants(doc, 'body')[0];
    if (!body) throw new Error('DOCX 中没有正文');
    const rels = await relationships(zip, 'word/_rels/document.xml.rels', 'word');
    const blocks = [];
    for (const el of Array.from(body.children)) {
      if (el.localName === 'p') {
        const text = paragraphText(el);
        const styleEl = descendants(el, 'pStyle')[0];
        const style = attr(styleEl, 'val');
        const level = /(?:Heading|标题)([1-6])/i.exec(style || '');
        const images = [];
        for (const b of descendants(el, 'blip')) {
          const url = await imageUrl(zip, rels[attr(b, 'embed')]);
          if (url) images.push('<img class="doc-inline-image" src="' + url + '" alt="文档图片">');
        }
        if (!text.trim() && !images.length) blocks.push('<div class="doc-space"></div>');
        else if (level) blocks.push('<h' + level[1] + '>' + esc(text) + '</h' + level[1] + '>' + images.join(''));
        else blocks.push('<p>' + esc(text).replace(/\n/g, '<br>') + '</p>' + images.join(''));
      } else if (el.localName === 'tbl') {
        const rows = Array.from(el.children).filter((n) => n.localName === 'tr').map((tr) =>
          '<tr>' + Array.from(tr.children).filter((n) => n.localName === 'tc').map((tc) =>
            '<td>' + descendants(tc, 'p').map((p) => esc(paragraphText(p))).join('<br>') + '</td>').join('') + '</tr>').join('');
        blocks.push('<div class="doc-table-wrap"><table class="doc-table">' + rows + '</table></div>');
      }
    }
    container.innerHTML = '<article class="doc-page docx-page">' + (blocks.join('') || '<p>（空文档）</p>') + '</article>';
  }

  async function renderPptx(container, zip) {
    const slideNames = zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => {
      return Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]);
    });
    if (!slideNames.length) throw new Error('PPTX 中没有幻灯片');
    const slides = [];
    for (let i = 0; i < slideNames.length; i++) {
      const name = slideNames[i];
      const xml = await zip.xml(name);
      const rels = await relationships(zip, 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', 'ppt/slides');
      const paragraphs = descendants(xml, 'p').filter((p) => p.namespaceURI && p.namespaceURI.indexOf('drawingml') >= 0).map(nodeText).filter((t) => t.trim());
      const images = [];
      for (const b of descendants(xml, 'blip')) {
        const url = await imageUrl(zip, rels[attr(b, 'embed')]);
        if (url) images.push('<img src="' + url + '" alt="幻灯片图片">');
      }
      slides.push('<section class="ppt-slide"><div class="ppt-num">' + (i + 1) + ' / ' + slideNames.length + '</div>' +
        '<div class="ppt-content">' + (images.join('') || '') +
        (paragraphs.length ? '<div class="ppt-text">' + paragraphs.map((p, idx) => idx === 0 ? '<h2>' + esc(p) + '</h2>' : '<p>' + esc(p) + '</p>').join('') + '</div>' : '') +
        ((!images.length && !paragraphs.length) ? '<p class="muted">（此页为图形或空白页）</p>' : '') + '</div></section>');
    }
    container.innerHTML = '<div class="ppt-deck">' + slides.join('') + '</div>';
  }

  function colIndex(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }
  function rowIndex(ref) { const m = /(\d+)$/.exec(ref || ''); return m ? Number(m[1]) - 1 : 0; }

  async function renderXlsx(container, zip) {
    const shared = [];
    if (zip.has('xl/sharedStrings.xml')) {
      const xml = await zip.xml('xl/sharedStrings.xml');
      descendants(xml, 'si').forEach((si) => shared.push(nodeText(si)));
    }
    const wb = await zip.xml('xl/workbook.xml');
    const rels = await relationships(zip, 'xl/_rels/workbook.xml.rels', 'xl');
    const sheets = descendants(wb, 'sheet').map((s) => ({ name: s.getAttribute('name') || '工作表', path: rels[attr(s, 'id')] })).filter((s) => s.path && zip.has(s.path));
    if (!sheets.length) throw new Error('XLSX 中没有可读取的工作表');
    const tables = [];
    for (const sheet of sheets) {
      const xml = await zip.xml(sheet.path);
      const cells = [];
      let maxRow = 0, maxCol = 0;
      descendants(xml, 'c').forEach((c) => {
        const ref = c.getAttribute('r') || '';
        const row = rowIndex(ref), col = colIndex(ref);
        if (row >= 500 || col >= 100) return;
        let value = '';
        if ((c.getAttribute('t') || '') === 'inlineStr') value = nodeText(c);
        else {
          const v = descendants(c, 'v')[0];
          value = v ? (v.textContent || '') : '';
          if (c.getAttribute('t') === 's' && value !== '') value = shared[Number(value)] || '';
          else if (c.getAttribute('t') === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        }
        cells.push({ row, col, value });
        maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
      });
      const grid = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(''));
      cells.forEach((c) => { grid[c.row][c.col] = c.value; });
      const rows = grid.map((row, i) => '<tr><th>' + (i + 1) + '</th>' + row.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('');
      tables.push('<section class="xlsx-sheet" data-sheet="' + esc(sheet.name) + '"><div class="xlsx-scroll"><table><tbody>' + rows + '</tbody></table></div>' + (maxRow >= 499 || maxCol >= 99 ? '<p class="muted">为保证流畅度，仅显示前 500 行、100 列。</p>' : '') + '</section>');
    }
    container.innerHTML = '<div class="xlsx-book"><div class="xlsx-tabs">' + sheets.map((s, i) => '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" data-i="' + i + '">' + esc(s.name) + '</button>').join('') + '</div>' + tables.join('') + '</div>';
    const sections = Array.from(container.querySelectorAll('.xlsx-sheet'));
    const show = (i) => {
      sections.forEach((s, n) => { s.hidden = n !== i; });
      container.querySelectorAll('.xlsx-tabs button').forEach((b, n) => b.classList.toggle('primary', n === i));
    };
    container.querySelectorAll('.xlsx-tabs button').forEach((b) => { b.onclick = () => show(Number(b.dataset.i)); });
    show(0);
  }

  function inlineMarkdown(text) {
    const codes = [];
    let s = String(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return ' ' + (codes.length - 1) + ' '; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '<span class="md-image-alt">[图片：$1]</span>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/ (\d+) /g, (_, i) => '<code>' + esc(codes[Number(i)]) + '</code>');
    return s;
  }

  function markdown(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inCode = false, codeLang = '', code = [], list = '', quote = [];
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = ''; } };
    const closeQuote = () => { if (quote.length) { out.push('<blockquote>' + quote.map(inlineMarkdown).join('<br>') + '</blockquote>'); quote = []; } };
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const fence = /^```\s*([\w+-]*)/.exec(line);
      if (fence) {
        closeList(); closeQuote();
        if (inCode) { out.push('<pre class="md-code"><code>' + esc(code.join('\n')) + '</code></pre>'); code = []; inCode = false; }
        else { inCode = true; codeLang = fence[1]; }
        continue;
      }
      if (inCode) { code.push(line); continue; }
      if (!line.trim()) { closeList(); closeQuote(); continue; }
      // 管道表格：表头 + 分隔行 + 数据行
      if (line.trim().startsWith('|') && lines[li + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[li + 1]) && lines[li + 1].includes('-')) {
        closeList(); closeQuote();
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inlineMarkdown(c.trim()));
        const head = cells(line);
        li += 2;
        const body = [];
        while (li < lines.length && lines[li].trim().startsWith('|')) {
          body.push('<tr>' + cells(lines[li]).map((c) => '<td>' + c + '</td>').join('') + '</tr>');
          li++;
        }
        li--;
        out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table></div>');
        continue;
      }
      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) { closeList(); closeQuote(); const n = h[1].length; out.push('<h' + n + '>' + inlineMarkdown(h[2]) + '</h' + n + '>'); continue; }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr>'); continue; }
      const q = /^>\s?(.*)$/.exec(line);
      if (q) { closeList(); quote.push(q[1]); continue; }
      closeQuote();
      const ul = /^\s*[-+*]\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (ul || ol) {
        const wanted = ul ? 'ul' : 'ol';
        if (list !== wanted) { closeList(); out.push('<' + wanted + '>'); list = wanted; }
        if (ul) out.push('<li' + (ul[1] ? ' class="md-task"' : '') + '>' + (ul[1] ? (ul[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') : '') + inlineMarkdown(ul[2]) + '</li>');
        else out.push('<li>' + inlineMarkdown(ol[1]) + '</li>');
        continue;
      }
      closeList();
      out.push('<p>' + inlineMarkdown(line) + '</p>');
    }
    if (inCode) out.push('<pre class="md-code"><code>' + esc(code.join('\n')) + '</code></pre>');
    closeList(); closeQuote();
    return '<article class="doc-page markdown-body">' + out.join('') + '</article>';
  }

  function code(text, ext) {
    const truncated = text.length > 1024 * 1024;
    const value = truncated ? text.slice(0, 1024 * 1024) : text;
    return '<div class="code-preview"><div class="code-lang">' + esc(ext || 'text') + (truncated ? ' · 仅显示前 1 MB' : '') + '</div><pre class="preview-text code-lines">' + esc(value) + '</pre></div>';
  }

  async function render(container, ext, url) {
    try {
      if (ext === 'md' || ext === 'markdown') {
        container.innerHTML = markdown(await fetchText(url));
        return;
      }
      if (['docx', 'pptx', 'xlsx'].includes(ext)) {
        const zip = await OOXMLZip.open(await fetchBuffer(url, OFFICE_SIZE_LIMIT));
        if (ext === 'docx') await renderDocx(container, zip);
        else if (ext === 'pptx') await renderPptx(container, zip);
        else await renderXlsx(container, zip);
        return;
      }
      container.innerHTML = code(await fetchText(url), ext);
    } catch (e) {
      container.innerHTML = '<div class="browser-empty"><strong>本地预览失败</strong><p>' + esc(e && e.message ? e.message : e) + '</p><p class="muted">文件仍可下载后用本机 Office 或文本编辑器打开。</p></div>';
    }
  }

  function parseLrc(text) {
    const rows = [];
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const matches = Array.from(line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g));
      const value = line.replace(/\[[^\]]+\]/g, '').trim();
      if (!matches.length) { if (value) rows.push({ time: null, text: value }); return; }
      matches.forEach((m) => rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text: value }));
    });
    return rows.sort((a, b) => (a.time == null ? Infinity : a.time) - (b.time == null ? Infinity : b.time));
  }

  function srtToVtt(text) {
    let s = String(text).replace(/\r\n?/g, '\n').trim();
    if (!/^WEBVTT/.test(s)) s = 'WEBVTT\n\n' + s.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return s;
  }

  function parseSubtitle(text) {
    const blocks = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    const cues = [];
    blocks.forEach((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      const idx = lines.findIndex((l) => l.includes('-->'));
      if (idx < 0) return;
      const m = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(lines[idx]);
      if (!m) return;
      const sec = (h, mi, s, ms) => Number(String(h || '0:').replace(':', '')) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
      cues.push({ start: sec(m[1], m[2], m[3], m[4]), end: sec(m[5], m[6], m[7], m[8]), text: lines.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '') });
    });
    return cues;
  }

  window.LocalPreview = { render, markdown, code, parseLrc, parseSubtitle, srtToVtt, fetchText };
})();
