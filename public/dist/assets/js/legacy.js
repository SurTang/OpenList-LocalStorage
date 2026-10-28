/* 旧版 Office 本地解析：OLE 复合文档 + PowerPoint 97-2003 文本记录。 */
(function () {
  'use strict';
  const FREE = 0xFFFFFFFF;
  const END_CHAIN = 0xFFFFFFFA;
  const utf16 = new TextDecoder('utf-16le');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const utf8Loose = new TextDecoder('utf-8');
  const gbk = (() => { try { return new TextDecoder('gbk'); } catch (_) { return null; } })();

  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  function u64(d, o) { return u32(d, o) + u32(d, o + 4) * 0x100000000; }
  function nameOf(bytes) {
    let end = 0;
    while (end + 1 < bytes.length && (bytes[end] || bytes[end + 1])) end += 2;
    return utf16.decode(bytes.subarray(0, end));
  }

  class OleFile {
    constructor(buf) {
      this.buf = buf;
      this.u8 = new Uint8Array(buf);
      this.dv = new DataView(buf);
      this.streams = new Map();
    }
    static async open(buf) {
      const ole = new OleFile(buf);
      ole.parse();
      return ole;
    }
    sector(sid) {
      const off = (sid + 1) * this.sectorSize;
      if (off < 0 || off + this.sectorSize > this.u8.length) throw new Error('OLE 扇区越界');
      return this.u8.subarray(off, off + this.sectorSize);
    }
    chain(start, table, limit) {
      const out = [];
      const seen = new Set();
      let sid = start;
      while (sid < END_CHAIN && sid !== FREE && out.length < (limit || 200000) && !seen.has(sid)) {
        seen.add(sid);
        out.push(sid);
        sid = table[sid] === undefined ? FREE : table[sid];
      }
      return out;
    }
    readNormal(start, size) {
      const ids = this.chain(start, this.fat);
      size = Math.min(size, ids.length * this.sectorSize);
      const out = new Uint8Array(Math.max(0, size));
      let pos = 0;
      for (const sid of ids) {
        const s = this.sector(sid);
        const n = Math.min(s.length, size - pos);
        if (n <= 0) break;
        out.set(s.subarray(0, n), pos);
        pos += n;
      }
      if (pos < size) return out.subarray(0, pos);
      return out;
    }
    readChainAll(start) {
      const ids = this.chain(start, this.fat);
      const out = new Uint8Array(ids.length * this.sectorSize);
      ids.forEach((sid, i) => out.set(this.sector(sid), i * this.sectorSize));
      return out;
    }
    parse() {
      const u8 = this.u8;
      if (u8.length < 512 || u32(u8, 0) !== 0xE011CFD0 || u32(u8, 4) !== 0xE11AB1A1) throw new Error('不是 OLE 复合文档');
      this.sectorSize = 1 << u16(u8, 30);
      this.miniSize = 1 << u16(u8, 32);
      const fatCount = u32(u8, 44);
      const dirStart = u32(u8, 48);
      this.miniCutoff = u32(u8, 56);
      const miniFatStart = u32(u8, 60);
      const miniFatCount = u32(u8, 64);
      const difatStart = u32(u8, 68);
      const difatCount = u32(u8, 72);
      const fatSectors = [];
      for (let i = 0; i < 109; i++) {
        const sid = u32(u8, 76 + i * 4);
        if (sid !== FREE && sid !== END_CHAIN) fatSectors.push(sid);
      }
      let difat = difatStart;
      for (let n = 0; n < difatCount && difat < END_CHAIN; n++) {
        const sec = this.sector(difat);
        const entries = Math.floor(this.sectorSize / 4);
        for (let i = 0; i < entries - 1; i++) {
          const sid = u32(sec, i * 4);
          if (sid !== FREE && sid !== END_CHAIN) fatSectors.push(sid);
        }
        difat = u32(sec, (entries - 1) * 4);
      }
      this.fat = [];
      for (let i = 0; i < fatCount && i < fatSectors.length; i++) {
        const sec = this.sector(fatSectors[i]);
        for (let o = 0; o < sec.length; o += 4) this.fat.push(u32(sec, o));
      }
      const miniFatBytes = miniFatCount ? this.readNormal(miniFatStart, miniFatCount * this.sectorSize) : new Uint8Array(0);
      this.miniFat = [];
      for (let o = 0; o + 4 <= miniFatBytes.length; o += 4) this.miniFat.push(u32(miniFatBytes, o));
      const dirBytes = this.readChainAll(dirStart);
      const entries = [];
      for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
        const type = dirBytes[o + 66];
        if (type === 0) continue;
        entries.push({
          name: nameOf(dirBytes.subarray(o, o + 64)),
          type,
          start: u32(dirBytes, o + 116),
          size: u64(dirBytes, o + 120),
        });
      }
      const root = entries.find((e) => e.type === 5);
      this.miniStream = root ? this.readNormal(root.start, root.size) : new Uint8Array(0);
      entries.filter((e) => e.type === 2).forEach((e) => this.streams.set(e.name.toLowerCase(), e));
    }
    readStream(name) {
      const e = this.streams.get(String(name).toLowerCase());
      if (!e) return null;
      if (e.size < this.miniCutoff) {
        const ids = this.chain(e.start, this.miniFat);
        const size = Math.min(e.size, ids.length * this.miniSize);
        const out = new Uint8Array(size);
        let pos = 0;
        for (const sid of ids) {
          const off = sid * this.miniSize;
          const n = Math.min(this.miniSize, size - pos);
          if (n <= 0 || off >= this.miniStream.length) break;
          out.set(this.miniStream.subarray(off, off + n), pos);
          pos += n;
        }
        return out.subarray(0, pos);
      }
      return this.readNormal(e.start, e.size);
    }
  }

  function records(data, start, end) {
    const out = [];
    let o = start;
    while (o + 8 <= end) {
      const verInst = u16(data, o);
      const type = u16(data, o + 2);
      const len = u32(data, o + 4);
      if (len > end - o - 8) break;
      out.push({ type, instance: verInst >> 4, start: o, body: o + 8, end: o + 8 + len, len });
      o += 8 + len;
    }
    return out;
  }
  function walkDeep(data, list, fn, depth) {
    for (const r of list) {
      fn(r);
      if (depth > 0 && r.len >= 8) {
        const children = records(data, r.body, r.end);
        if (children.length) walkDeep(data, children, fn, depth - 1);
      }
    }
  }

  function decodeBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    try { return utf8.decode(bytes); } catch (_) { /* 非 UTF-8 */ }
    if (gbk) return gbk.decode(bytes);
    return utf8Loose.decode(bytes);
  }
  function decodeTextAtom(data, r) {
    const bytes = data.subarray(r.body, r.end);
    if (r.type === 0x0FA0) return utf16.decode(bytes);
    if (r.type === 0x0FA8) return decodeBytes(bytes);
    if (r.type === 0x0FBA) return decodeBytes(bytes);
    return '';
  }
  function cleanText(s) {
    return String(s || '')
      .replace(/\r\x00?/g, '\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function slidesFromPersist(data) {
    const all = records(data, 0, data.length);
    const lists = [];
    walkDeep(data, all, (r) => {
      if (r.type === 0x0FF0 && r.instance === 0) lists.push(r);
    });
    const slides = [];
    lists.forEach((list) => {
      let current = null;
      records(data, list.body, list.end).forEach((r) => {
        if (r.type === 0x03F3) {
          current = { paragraphs: [] };
          slides.push(current);
          return;
        }
        const text = cleanText(decodeTextAtom(data, r));
        if (!text) return;
        if (!current) { current = { paragraphs: [] }; slides.push(current); }
        text.split('\n').map((x) => x.trim()).filter(Boolean).forEach((p) => current.paragraphs.push(p));
      });
    });
    return slides.filter((s) => s.paragraphs.length);
  }

  function collectParagraphs(data, root) {
    const paragraphs = [];
    walkDeep(data, records(data, root.body, root.end), (x) => {
      if (x.type === 0x0FA0 || x.type === 0x0FA8 || x.type === 0x0FBA) {
        cleanText(decodeTextAtom(data, x)).split('\n').map((v) => v.trim()).filter(Boolean).forEach((p) => paragraphs.push(p));
      }
    }, 12);
    return paragraphs;
  }

  function slidesFromContainers(data) {
    const all = records(data, 0, data.length);
    const slideRecords = [];
    let documentRecord = null;
    walkDeep(data, all, (r) => {
      if (r.type === 0x03EE) slideRecords.push(r);
      if (r.type === 0x03E8 && !documentRecord) documentRecord = r;
    });
    const slides = [];
    const roots = slideRecords.length ? slideRecords : (documentRecord ? [documentRecord] : []);
    roots.forEach((r) => {
      const paragraphs = collectParagraphs(data, r);
      if (paragraphs.length) slides.push({ paragraphs });
    });
    return slides;
  }

  function isNoise(p) {
    return /^_{2,}PPT\d*$/i.test(p) || /^_+$/.test(p) || /^PowerPoint Presentation$/i.test(p);
  }

  async function readPpt(buf) {
    const ole = await OleFile.open(buf);
    const stream = ole.readStream('PowerPoint Document') || ole.readStream('PP40');
    if (!stream) throw new Error('PowerPoint 文件缺少演示文稿流');
    let slides = slidesFromPersist(stream);
    if (!slides.length) slides = slidesFromContainers(stream);
    const cleaned = slides.map((s) => ({ paragraphs: s.paragraphs.filter((p) => !isNoise(p)) })).filter((s) => s.paragraphs.length);
    if (!cleaned.length) throw new Error('未能从旧版 PPT 中提取文字（可能已加密或使用了不支持的编码）');
    return cleaned.slice(0, 300).map((s, i) => ({
      index: i + 1,
      title: s.paragraphs[0] || '',
      paragraphs: s.paragraphs.slice(1),
      all: s.paragraphs,
    }));
  }

  window.LegacyOffice = { OleFile, readPpt };
})();
