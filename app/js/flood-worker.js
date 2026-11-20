/* MOLA4 connected flood fill. Runs off the main thread. */
import { buildWaterTexture } from './utils.js';

let rows = 720;
let cols = 1440;
let z = null;
let rowAreas = null;
let N = 0;
let startIdx = 0;
let hellasIdx = 0;
let scratch = null;
let queue = null;

function init(msg) {
  rows = msg.rows;
  cols = msg.cols;
  N = rows * cols;
  z = new Int16Array(msg.heights);
  rowAreas = new Float64Array(msg.rowAreas);
  startIdx = msg.startRow * cols + msg.startCol;
  hellasIdx = msg.hellasRow * cols + msg.hellasCol;
  scratch = new Uint8Array(N);
  queue = new Int32Array(N);
  postMessage({ type: 'ready' });
}

function bfs(level) {
  scratch.fill(0);
  let cells = 0;
  let area = 0;
  const startBelow = z[startIdx] < level;
  if (!startBelow) return { cells, area, startBelow, hellasReached: false };
  scratch[startIdx] = 1;
  queue[0] = startIdx;
  let head = 0, tail = 1;
  while (head < tail) {
    const p = queue[head++];
    const r = (p / cols) | 0;
    const c = p - r * cols;
    cells++;
    area += rowAreas[r];
    if (r > 0) {
      const q = p - cols;
      if (!scratch[q] && z[q] < level) { scratch[q] = 1; queue[tail++] = q; }
    }
    if (r + 1 < rows) {
      const q = p + cols;
      if (!scratch[q] && z[q] < level) { scratch[q] = 1; queue[tail++] = q; }
    }
    const cl = c === 0 ? cols - 1 : c - 1;
    const ql = p - c + cl;
    if (!scratch[ql] && z[ql] < level) { scratch[ql] = 1; queue[tail++] = ql; }
    const cr = c + 1 === cols ? 0 : c + 1;
    const qr = p - c + cr;
    if (!scratch[qr] && z[qr] < level) { scratch[qr] = 1; queue[tail++] = qr; }
  }
  return { cells, area, startBelow, hellasReached: scratch[hellasIdx] === 1 };
}

function allLow(level) {
  scratch.fill(0);
  let cells = 0;
  let area = 0;
  for (let r = 0; r < rows; r++) {
    const off = r * cols;
    const ar = rowAreas[r];
    for (let c = 0; c < cols; c++) {
      if (z[off + c] < level) {
        scratch[off + c] = 1;
        cells++;
        area += ar;
      }
    }
  }
  return { cells, area, startBelow: z[startIdx] < level, hellasReached: z[hellasIdx] < level };
}

self.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') { init(msg); return; }
    if (!z) throw new Error('worker not initialized');
    if (msg.type === 'flood') {
      const res = bfs(msg.level);
      const out = new Uint8Array(N);
      out.set(scratch);
      const texture = buildWaterTexture(out, z, msg.level, cols, rows);
      postMessage({
        type: 'floodResult', id: msg.id, level: msg.level,
        cells: res.cells, areaKm2: res.area, startBelow: res.startBelow,
        hellasReached: res.hellasReached, mask: out.buffer, texture,
      }, [out.buffer, texture.buffer]);
      return;
    }
    if (msg.type === 'allLow') {
      const res = allLow(msg.level);
      const out = new Uint8Array(N);
      out.set(scratch);
      const texture = buildWaterTexture(out, z, msg.level, cols, rows);
      postMessage({
        type: 'allLowResult', id: msg.id, level: msg.level,
        cells: res.cells, areaKm2: res.area, startBelow: res.startBelow,
        hellasReached: res.hellasReached, mask: out.buffer, texture,
      }, [out.buffer, texture.buffer]);
      return;
    }
    if (msg.type === 'curve') {
      const levels = Array.from(new Set(msg.levels)).sort((a, b) => a - b);
      const cells = [], areas = [], hellas = [];
      let maxArea = 0;
      for (const level of levels) {
        const res = bfs(level);
        cells.push(res.cells);
        areas.push(res.area / 1e6);
        hellas.push(res.hellasReached ? 1 : 0);
        if (res.area > maxArea) maxArea = res.area;
      }
      postMessage({ type: 'curveResult', levels, cells, areas, hellas, maxArea });
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', id: msg.id || null, message: String(err && err.message || err) });
  }
};
