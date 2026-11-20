import { clamp, formatNumber, formatInt, densityColor } from './utils.js';

const FONT = '"Segoe UI", Inter, Arial, sans-serif';
const MONO = '"Cascadia Code", Consolas, monospace';

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class Chart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = {
      xLabel: '',
      yLabel: '',
      xMin: 0, xMax: 1, yMin: 0, yMax: 1,
      xTickFormat: (v) => formatNumber(v, 0),
      yTickFormat: (v) => formatNumber(v, 0),
      padding: { left: 56, right: 16, top: 16, bottom: 32 },
      grid: true,
      background: null,
      series: [],
      markers: [],
      bands: [],
      points: [],
      hoverX: null,
      hoverLabel: '',
      onDraw: null,
      ...opts,
    };
    this._resizeObserver = null;
    this._lastW = 0;
    this._lastH = 0;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(canvas);
    }
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
    this.draw();
  }

  setData(patch) {
    Object.assign(this.opts, patch);
    this.draw();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth || this.canvas.width || 600));
    const h = Math.max(1, Math.round(this.canvas.clientHeight || this.canvas.height || 280));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this._w = w;
    this._h = h;
    this._dpr = dpr;
    this.draw();
  }

  plotBox() {
    const { left, right, top, bottom } = this.opts.padding;
    return { x: left, y: top, w: this._w - left - right, h: this._h - top - bottom };
  }

  xToPx(x) {
    const b = this.plotBox();
    return b.x + (x - this.opts.xMin) / (this.opts.xMax - this.opts.xMin) * b.w;
  }

  yToPx(y) {
    const b = this.plotBox();
    return b.y + (this.opts.yMax - y) / (this.opts.yMax - this.opts.yMin) * b.h;
  }

  pxToX(px) {
    const b = this.plotBox();
    return this.opts.xMin + (px - b.x) / b.w * (this.opts.xMax - this.opts.xMin);
  }

  pxToY(py) {
    const b = this.plotBox();
    return this.opts.yMax - (py - b.y) / b.h * (this.opts.yMax - this.opts.yMin);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = this._dpr || 1;
    const w = this._w || 1, h = this._h || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.opts.background) {
      ctx.fillStyle = this.opts.background;
      ctx.fillRect(0, 0, w, h);
    }
    const b = this.plotBox();
    const o = this.opts;
    const spanX = o.xMax - o.xMin, spanY = o.yMax - o.yMin;
    if (!(spanX > 0) || !(spanY > 0)) return;

    // bands
    for (const band of o.bands) {
      const x1 = this.xToPx(band.x1), x2 = this.xToPx(band.x2);
      const left = Math.max(b.x, Math.min(x1, x2));
      const right = Math.min(b.x + b.w, Math.max(x1, x2));
      if (right <= left) continue;
      ctx.fillStyle = band.color || 'rgba(94,224,214,.06)';
      ctx.fillRect(left, b.y, right - left, b.h);
      if (band.label) {
        ctx.fillStyle = band.labelColor || 'rgba(141,157,178,.85)';
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(band.label, (left + right) / 2, b.y + 11);
      }
    }

    // grid
    if (o.grid) {
      ctx.strokeStyle = 'rgba(94, 126, 158, .16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const xt = niceTicks(o.xMin, o.xMax, 5);
      const yt = niceTicks(o.yMin, o.yMax, 4);
      for (const t of xt) {
        const px = this.xToPx(t);
        if (px < b.x || px > b.x + b.w) continue;
        ctx.beginPath(); ctx.moveTo(px, b.y); ctx.lineTo(px, b.y + b.h); ctx.stroke();
      }
      for (const t of yt) {
        const py = this.yToPx(t);
        if (py < b.y || py > b.y + b.h) continue;
        ctx.beginPath(); ctx.moveTo(b.x, py); ctx.lineTo(b.x + b.w, py); ctx.stroke();
      }
    }

    // axis border
    ctx.strokeStyle = 'rgba(110, 140, 168, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h);
    ctx.stroke();

    // ticks
    ctx.font = `9.5px ${MONO}`;
    ctx.fillStyle = 'rgba(141, 157, 178, .85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xt = niceTicks(o.xMin, o.xMax, 5);
    for (const t of xt) {
      const px = this.xToPx(t);
      if (px < b.x - 1 || px > b.x + b.w + 1) continue;
      ctx.strokeStyle = 'rgba(110, 140, 168, .35)';
      ctx.beginPath(); ctx.moveTo(px, b.y + b.h); ctx.lineTo(px, b.y + b.h + 3); ctx.stroke();
      ctx.fillText(o.xTickFormat(t), px, b.y + b.h + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yt = niceTicks(o.yMin, o.yMax, 4);
    for (const t of yt) {
      const py = this.yToPx(t);
      if (py < b.y - 1 || py > b.y + b.h + 1) continue;
      ctx.strokeStyle = 'rgba(110, 140, 168, .35)';
      ctx.beginPath(); ctx.moveTo(b.x - 3, py); ctx.lineTo(b.x, py); ctx.stroke();
      ctx.fillText(o.yTickFormat(t), b.x - 6, py);
    }

    // axis labels
    if (o.xLabel) {
      ctx.font = `9.5px ${FONT}`;
      ctx.fillStyle = 'rgba(141, 157, 178, .9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(o.xLabel, b.x + b.w / 2, h - 1);
    }
    if (o.yLabel) {
      ctx.font = `9.5px ${FONT}`;
      ctx.fillStyle = 'rgba(141, 157, 178, .9)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(o.yLabel, b.x, 1);
    }

    // clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();

    // series
    for (const s of o.series) {
      const pts = s.points;
      if (!pts || pts.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = this.xToPx(pts[i][0]), y = this.yToPx(pts[i][1]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (s.fill) {
        const grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
        grad.addColorStop(0, s.fillTop || 'rgba(240,122,69,.22)');
        grad.addColorStop(1, s.fillBottom || 'rgba(240,122,69,0)');
        ctx.save();
        ctx.lineTo(this.xToPx(pts[pts.length - 1][0]), b.y + b.h);
        ctx.lineTo(this.xToPx(pts[0][0]), b.y + b.h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
        // redraw path for stroke
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = this.xToPx(pts[i][0]), y = this.yToPx(pts[i][1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = s.color || '#f07a45';
      ctx.lineWidth = s.width || 1.5;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.dots) {
        ctx.fillStyle = s.color || '#f07a45';
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(this.xToPx(p[0]), this.yToPx(p[1]), s.dotRadius || 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // horizontal markers
    for (const m of o.markers) {
      if (!Number.isFinite(m.y)) continue;
      const py = this.yToPx(m.y);
      if (py < b.y - 1 || py > b.y + b.h + 1) continue;
      ctx.strokeStyle = m.color || 'rgba(255,255,255,.45)';
      ctx.lineWidth = m.width || 1;
      ctx.setLineDash(m.dash || [4, 4]);
      ctx.beginPath();
      ctx.moveTo(b.x, py); ctx.lineTo(b.x + b.w, py); ctx.stroke();
      ctx.setLineDash([]);
      if (m.label) {
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = m.labelColor || m.color || '#dfe8f2';
        ctx.fillText(m.label, b.x + b.w - 4, py - 3);
        ctx.textAlign = 'left';
      }
    }

    // vertical markers
    for (const m of o.markers) {
      if (!Number.isFinite(m.x)) continue;
      const px = this.xToPx(m.x);
      if (px < b.x - 1 || px > b.x + b.w + 1) continue;
      ctx.strokeStyle = m.color || 'rgba(255,255,255,.45)';
      ctx.lineWidth = m.width || 1;
      ctx.setLineDash(m.dash || [4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, b.y); ctx.lineTo(px, b.y + b.h); ctx.stroke();
      ctx.setLineDash([]);
      if (m.label) {
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = m.labelColor || m.color || '#dfe8f2';
        ctx.fillText(m.label, px, b.y + 3);
      }
    }

    // points
    for (const p of o.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const px = this.xToPx(p.x), py = this.yToPx(p.y);
      if (px < b.x - 4 || px > b.x + b.w + 4 || py < b.y - 4 || py > b.y + b.h + 4) continue;
      ctx.beginPath();
      ctx.arc(px, py, p.r || 4, 0, Math.PI * 2);
      ctx.fillStyle = p.color || '#f07a45';
      ctx.fill();
      if (p.ring !== false) {
        ctx.strokeStyle = 'rgba(5,10,16,.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (p.label) {
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = p.labelColor || '#eaf1fa';
        ctx.fillText(p.label, px + 7, py);
      }
    }

    // hover crosshair
    if (Number.isFinite(o.hoverX)) {
      const px = this.xToPx(o.hoverX);
      if (px >= b.x && px <= b.x + b.w) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(px, b.y); ctx.lineTo(px, b.y + b.h); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    if (typeof o.onDraw === 'function') o.onDraw(ctx, this);

    if (o.hoverLabel) {
      ctx.font = `9px ${MONO}`;
      ctx.fillStyle = 'rgba(233,238,246,.85)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(o.hoverLabel, b.x + 5, b.y + b.h - 5);
    }
  }

  pixelFromEvent(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (this._w / rect.width),
      y: (evt.clientY - rect.top) * (this._h / rect.height),
    };
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }
}

export function drawDensityMap(canvas, grid, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW, h = cssH;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const bw = w - pad.l - pad.r;
  const bh = h - pad.t - pad.b;
  const step = opts.step || 5;
  const cols = opts.cols || Math.round(360 / step);
  const rows = opts.rows || Math.round(180 / step);
  const cw = bw / cols, ch = bh / rows;
  const max = opts.maxDensity || 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c];
      if (!v) continue;
      const [rr, gg, bb] = densityColor(Math.sqrt(clamp(v / max, 0, 1)));
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(pad.l + c * cw, pad.t + r * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }
  // graticule
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 0.7;
  for (let lon = 0; lon <= 360; lon += 60) {
    const x = pad.l + lon / 360 * bw;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + bh); ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = pad.t + (90 - lat) / 180 * bh;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + bw, y); ctx.stroke();
  }
  // outline
  ctx.strokeStyle = 'rgba(141,157,178,.35)';
  ctx.strokeRect(pad.l, pad.t, bw, bh);
  // labels
  ctx.font = `8px ${MONO}`;
  ctx.fillStyle = 'rgba(141,157,178,.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const lon of [0, 90, 180, 270, 360]) {
    const x = pad.l + lon / 360 * bw;
    ctx.fillText(`${lon}°`, x, pad.t + bh + 4);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const lat of [90, 60, 30, 0, -30, -60, -90]) {
    const y = pad.t + (90 - lat) / 180 * bh;
    ctx.fillText(`${lat}°`, pad.l - 4, y);
  }
  // key points
  if (opts.points) {
    for (const p of opts.points) {
      const x = pad.l + ((p.lon % 360) + 360) % 360 / 360 * bw;
      const y = pad.t + (90 - p.lat) / 180 * bh;
      ctx.beginPath();
      ctx.arc(x, y, p.r || 2.6, 0, Math.PI * 2);
      ctx.fillStyle = p.color || '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  return { pad, bw, bh, cols, rows, cw, ch, step };
}

export function densityGridFor(craters, groupsKey = 'all', step = 5) {
  const cols = Math.round(360 / step), rows = Math.round(180 / step);
  const grid = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  const test = groupsKey === '20-50' ? (d) => d >= 20 && d < 50
    : groupsKey === '50-100' ? (d) => d >= 50 && d < 100
      : groupsKey === '100+' ? (d) => d >= 100
        : () => true;
  for (const c of craters) {
    if (!test(c.diameter)) continue;
    const r = clamp(Math.floor((90 - c.lat) / step), 0, rows - 1);
    const col = clamp(Math.floor((((c.lon % 360) + 360) % 360) / step), 0, cols - 1);
    counts[r * cols + col]++;
  }
  const R = 3389.5;
  const dLon = step * Math.PI / 180;
  for (let r = 0; r < rows; r++) {
    const latN = 90 - r * step;
    const latS = latN - step;
    const area = R * R * dLon * (Math.sin(latN * Math.PI / 180) - Math.sin(latS * Math.PI / 180));
    for (let c = 0; c < cols; c++) {
      grid[r * cols + c] = counts[r * cols + c] / area;
    }
  }
  let maxRaw = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > maxRaw) maxRaw = grid[i];
  // A light display smoothing keeps the 5° grid from looking like confetti.
  // Counts and all reported raw densities remain the per-cell values.
  const smooth = smoothGrid(grid, cols, rows, 2);
  let max = 0;
  for (let i = 0; i < smooth.length; i++) if (smooth[i] > max) max = smooth[i];
  return { grid: smooth, raw: grid, counts, max, maxRaw, cols, rows, step };
}

function smoothGrid(grid, cols, rows, passes = 1) {
  let src = grid;
  const w = [1, 2, 1];
  for (let pass = 0; pass < passes; pass++) {
    const dst = new Float64Array(grid.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0, total = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = clamp(r + dr, 0, rows - 1);
          for (let dc = -1; dc <= 1; dc++) {
            const cc = (c + dc + cols) % cols;
            const weight = w[dr + 1] * w[dc + 1];
            sum += src[rr * cols + cc] * weight;
            total += weight;
          }
        }
        dst[r * cols + c] = sum / total;
      }
    }
    src = dst;
  }
  return src;
}
