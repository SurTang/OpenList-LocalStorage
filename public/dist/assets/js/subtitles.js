/* 视频内嵌字幕提取：解析 MP4/MOV 的 subtitle text track，全程通过 Range 按需读取。 */
(function () {
  'use strict';
  const utf8 = new TextDecoder('utf-8');
  const BLOCK = 64 * 1024;

  function u16(d, o) { return (d[o] << 8) | d[o + 1]; }
  function u32(d, o) { return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0; }
  function u64(d, o) { return u32(d, o) * 0x100000000 + u32(d, o + 4); }
  function fourcc(d, o) { return String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]); }

  class RangeReader {
    constructor(url, size) {
      this.url = url;
      this.size = size;
      this.blocks = new Map();
    }
    async block(index) {
      if (this.blocks.has(index)) return this.blocks.get(index);
      const start = index * BLOCK;
      const end = Math.min(this.size - 1, start + BLOCK - 1);
      const res = await fetch(this.url, { headers: { Range: 'bytes=' + start + '-' + end } });
      if (res.status !== 206) throw new Error('视频存储不支持 Range，无法提取内嵌字幕');
      const data = new Uint8Array(await res.arrayBuffer());
      if (this.blocks.size > 256) this.blocks.clear();
      this.blocks.set(index, data);
      return data;
    }
    async read(start, length) {
      const out = new Uint8Array(length);
      let pos = 0;
      while (pos < length) {
        const abs = start + pos;
        const idx = Math.floor(abs / BLOCK);
        const off = abs - idx * BLOCK;
        const block = await this.block(idx);
        const n = Math.min(block.length - off, length - pos);
        if (n <= 0) break;
        out.set(block.subarray(off, off + n), pos);
        pos += n;
      }
      return pos === length ? out : out.subarray(0, pos);
    }
  }

  function boxes(data, start, end) {
    const out = [];
    let o = start;
    while (o + 8 <= end) {
      let size = u32(data, o);
      const type = fourcc(data, o + 4);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        size = u64(data, o + 8);
        header = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < header || o + size > end) break;
      out.push({ type, start: o, body: o + header, end: o + size, size });
      o += size;
    }
    return out;
  }
  function child(list, type) { return list.find((b) => b.type === type); }

  async function readTopBox(reader, offset) {
    const head = await reader.read(offset, Math.min(32, reader.size - offset));
    if (head.length < 8) return null;
    let size = u32(head, 0);
    let header = 8;
    if (size === 1) { if (head.length < 16) return null; size = u64(head, 8); header = 16; }
    else if (size === 0) size = reader.size - offset;
    if (size < header) return null;
    return { type: fourcc(head, 4), start: offset, body: offset + header, end: offset + size, size, header };
  }

  function buildSampleTable(moovData) {
    const moov = boxes(moovData, 0, moovData.length);
    for (const trak of moov.filter((b) => b.type === 'trak')) {
      const mdia = child(boxes(moovData, trak.body, trak.end), 'mdia');
      if (!mdia) continue;
      const mdiaBoxes = boxes(moovData, mdia.body, mdia.end);
      const hdlr = child(mdiaBoxes, 'hdlr');
      if (!hdlr || hdlr.body + 12 > hdlr.end) continue;
      const handler = fourcc(moovData, hdlr.body + 8);
      if (!['sbtl', 'text', 'subt'].includes(handler)) continue;
      const mdhd = child(mdiaBoxes, 'mdhd');
      if (!mdhd) continue;
      const version = moovData[mdhd.body];
      const timescale = version === 1 ? u32(moovData, mdhd.body + 20) : u32(moovData, mdhd.body + 12);
      const minf = child(mdiaBoxes, 'minf');
      if (!minf || !timescale) continue;
      const stbl = child(boxes(moovData, minf.body, minf.end), 'stbl');
      if (!stbl) continue;
      const stblBoxes = boxes(moovData, stbl.body, stbl.end);
      const stsd = child(stblBoxes, 'stsd');
      if (!stsd || stsd.body + 16 > stsd.end) continue;
      const entryStart = stsd.body + 8;
      const subtype = fourcc(moovData, entryStart + 4);
      const stts = child(stblBoxes, 'stts');
      const stsc = child(stblBoxes, 'stsc');
      const stsz = child(stblBoxes, 'stsz');
      const stco = child(stblBoxes, 'stco') || child(stblBoxes, 'co64');
      if (!stts || !stsc || !stsz || !stco) continue;
      const sampleCount = u32(moovData, stsz.body + 8);
      if (!sampleCount || sampleCount > 10000) continue;
      const uniform = u32(moovData, stsz.body + 4);
      const sizes = [];
      for (let i = 0; i < sampleCount; i++) sizes.push(uniform || u32(moovData, stsz.body + 12 + i * 4));
      const timeEntries = u32(moovData, stts.body + 4);
      const times = [];
      let t = 0;
      for (let i = 0; i < timeEntries && times.length < sampleCount; i++) {
        const count = u32(moovData, stts.body + 8 + i * 8);
        const delta = u32(moovData, stts.body + 12 + i * 8);
        for (let j = 0; j < count && times.length < sampleCount; j++) { times.push({ start: t, dur: delta }); t += delta; }
      }
      const chunkCount = u32(moovData, stco.body + 4);
      const chunkOffsets = [];
      for (let i = 0; i < chunkCount; i++) {
        chunkOffsets.push(stco.type === 'co64' ? u64(moovData, stco.body + 8 + i * 8) : u32(moovData, stco.body + 8 + i * 4));
      }
      const runCount = u32(moovData, stsc.body + 4);
      const runs = [];
      for (let i = 0; i < runCount; i++) {
        runs.push({
          first: u32(moovData, stsc.body + 8 + i * 12),
          perChunk: u32(moovData, stsc.body + 12 + i * 12),
        });
      }
      const offsets = new Array(sampleCount);
      let sample = 0;
      for (let chunk = 1; chunk <= chunkCount && sample < sampleCount; chunk++) {
        let run = runs[0];
        for (const r of runs) if (r.first <= chunk) run = r;
        let off = chunkOffsets[chunk - 1];
        for (let j = 0; j < run.perChunk && sample < sampleCount; j++) {
          offsets[sample] = off;
          off += sizes[sample];
          sample++;
        }
      }
      return { subtype, timescale, sizes, times, offsets, handler };
    }
    return null;
  }

  function parseTx3g(data) {
    if (data.length < 2) return '';
    const len = u16(data, 0);
    return utf8.decode(data.subarray(2, Math.min(data.length, 2 + len)));
  }
  function parseWvtt(data) {
    const list = boxes(data, 0, data.length);
    const findPayl = (arr) => {
      for (const b of arr) {
        if (b.type === 'payl') return utf8.decode(data.subarray(b.body, b.end));
        const nested = findPayl(boxes(data, b.body, b.end));
        if (nested) return nested;
      }
      return '';
    };
    return findPayl(list) || utf8.decode(data);
  }
  function clean(s) {
    return String(s || '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0E-\x1F]/g, '').trim();
  }

  async function extractMp4(url, size) {
    if (!size || size < 1024) return [];
    const reader = new RangeReader(url, size);
    let offset = 0, moov = null;
    for (let guard = 0; guard < 64 && offset + 8 <= size; guard++) {
      const box = await readTopBox(reader, offset);
      if (!box) break;
      if (box.type === 'moov') { moov = box; break; }
      offset = box.end;
    }
    if (!moov) return [];
    if (moov.size > 64 * 1024 * 1024) throw new Error('视频索引过大，无法提取内嵌字幕');
    const moovData = await reader.read(moov.body, moov.size);
    const table = buildSampleTable(moovData);
    if (!table) return [];
    const cues = [];
    for (let i = 0; i < table.times.length && cues.length < 1500; i++) {
      const sampleSize = table.sizes[i];
      if (!sampleSize || sampleSize > 1024 * 1024 || table.offsets[i] == null) continue;
      let text = '';
      try {
        const sample = await reader.read(table.offsets[i], sampleSize);
        if (table.subtype === 'tx3g') text = parseTx3g(sample);
        else if (table.subtype === 'wvtt') text = parseWvtt(sample);
        else text = utf8.decode(sample.subarray(0, Math.min(sample.length, 2 + u16(sample, 0))));
      } catch (_) { continue; }
      text = clean(text);
      const time = table.times[i];
      if (!text || !time) continue;
      cues.push({ start: time.start / table.timescale, end: (time.start + time.dur) / table.timescale, text });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  window.EmbeddedSubtitles = { extractMp4 };
})();
