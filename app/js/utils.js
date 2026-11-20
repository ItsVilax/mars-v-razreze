export const R_MARS_KM = 3389.5;
export const R_MARS_M = 3389500;
export const HEMI_AREA_MKM2 = 2 * Math.PI * R_MARS_KM * R_MARS_KM / 1e6;
export const TAU = Math.PI * 2;

// Portrait phones and phones turned sideways. The second clause keeps the
// fixed-screen UI on a short landscape viewport instead of a scrolling sidebar.
export const MOBILE_MEDIA = '(max-width: 760px), (max-height: 520px) and (orientation: landscape) and (max-width: 960px)';
export const isMobileLayout = () => window.matchMedia?.(MOBILE_MEDIA)?.matches || false;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (r) => r * 180 / Math.PI;
export const rad = (d) => d * Math.PI / 180;
export const sq = (x) => x * x;

export function median(values) {
  const a = Float64Array.from(values).sort();
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function quantile(values, q) {
  const a = Array.from(values).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = clamp(q, 0, 1) * (a.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lerp(a[lo], a[hi], pos - lo);
}

export function mean(values) {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function formatInt(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
}

export function formatNumber(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u00a0/g, ' ');
}

export function formatMeters(z) {
  if (!Number.isFinite(z)) return '—';
  const v = Math.round(z);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
}

export function formatSigned(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  const s = x > 0 ? '+' : x < 0 ? '−' : '';
  const abs = Math.abs(x);
  return s + (digits ? formatNumber(abs, digits) : formatInt(abs));
}

export function fmtLat(lat) {
  const v = Math.abs(lat);
  return `${formatNumber(v, 3)}° ${lat >= 0 ? 'с. ш.' : 'ю. ш.'}`;
}

export function fmtLon(lon) {
  const x = ((lon % 360) + 360) % 360;
  return `${formatNumber(x, 3)}° в. д.`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const COLOR_STOPS = [
  [-8200, [34, 20, 70]],
  [-6000, [40, 74, 136]],
  [-4000, [52, 126, 145]],
  [-2200, [124, 154, 112]],
  [-800, [190, 169, 120]],
  [0, [214, 184, 132]],
  [2200, [193, 115, 64]],
  [5200, [144, 60, 34]],
  [12000, [236, 220, 201]],
];

export function heightColor(z) {
  if (!Number.isFinite(z)) return [100, 100, 100];
  if (z <= COLOR_STOPS[0][0]) return COLOR_STOPS[0][1];
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [z1, c1] = COLOR_STOPS[i];
    if (z <= z1) {
      const [z0, c0] = COLOR_STOPS[i - 1];
      const t = (z - z0) / (z1 - z0);
      return [
        Math.round(lerp(c0[0], c1[0], t)),
        Math.round(lerp(c0[1], c1[1], t)),
        Math.round(lerp(c0[2], c1[2], t)),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

export function heightColorCss(z) {
  const [r, g, b] = heightColor(z);
  return `rgb(${r},${g},${b})`;
}

export function densityColor(t) {
  // t in [0,1]; perceptually spaced warm sequential ramp
  const stops = [
    [0.00, [19, 33, 58]],
    [0.16, [42, 107, 158]],
    [0.36, [66, 184, 180]],
    [0.58, [217, 211, 106]],
    [0.78, [240, 138, 72]],
    [1.00, [196, 22, 28]],
  ];
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (x - t0) / (t1 - t0);
      return [
        Math.round(lerp(c0[0], c1[0], f)),
        Math.round(lerp(c0[1], c1[1], f)),
        Math.round(lerp(c0[2], c1[2], f)),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export function parseGrid(text, rows, cols) {
  const out = new Int16Array(rows * cols);
  let idx = 0, num = 0, sign = 1, inNum = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 45) { sign = -1; continue; }
    if (c >= 48 && c <= 57) {
      num = num * 10 + (c - 48);
      inNum = true;
      continue;
    }
    if (inNum) {
      out[idx++] = sign * num;
      num = 0; sign = 1; inNum = false;
    }
  }
  if (inNum) out[idx++] = sign * num;
  if (idx !== rows * cols) {
    throw new Error(`Ожидалось ${rows * cols} значений, получено ${idx}`);
  }
  return out;
}

export function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

export function rowAreaKm2(rowIndex, rows = 720) {
  const phiN = 90 - rowIndex * (180 / rows);
  const phiS = 90 - (rowIndex + 1) * (180 / rows);
  return R_MARS_KM * R_MARS_KM * (Math.PI / rows) *
    (Math.sin(rad(phiN)) - Math.sin(rad(phiS)));
}

export function buildRowAreas(rows = 720) {
  const out = new Float64Array(rows);
  for (let r = 0; r < rows; r++) out[r] = rowAreaKm2(r, rows);
  return out;
}

export function latLonToVec3(lat, lon, radius = 1) {
  const phi = rad(lat);
  const lambda = rad(lon);
  const c = Math.cos(phi);
  return [c * Math.cos(lambda) * radius, Math.sin(phi) * radius, c * Math.sin(lambda) * radius];
}

export function vec3ToLatLon(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  const lat = deg(Math.asin(clamp(y / len, -1, 1)));
  const lon = ((deg(Math.atan2(z, x)) % 360) + 360) % 360;
  return { lat, lon };
}

export function bilerpGrid(grid, rows, cols, lat, lon) {
  const rf = clamp((90 - lat) / (180 / rows) - 0.5, 0, rows - 1);
  const cf = ((lon / (360 / cols)) - 0.5 + cols) % cols;
  const r0 = Math.floor(rf), r1 = Math.min(rows - 1, r0 + 1);
  const c0 = Math.floor(cf), c1 = (c0 + 1) % cols;
  const fr = rf - r0, fc = cf - c0;
  const a = grid[r0 * cols + c0], b = grid[r0 * cols + c1];
  const c = grid[r1 * cols + c0], d = grid[r1 * cols + c1];
  return lerp(lerp(a, b, fc), lerp(c, d, fc), fr);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => { if (blob) downloadBlob(blob, filename); }, 'image/png');
}

export function debounce(fn, ms = 120) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function rafThrottle(fn) {
  let queued = false, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function haversineKm(lat1, lon1, lat2, lon2, radius = R_MARS_KM) {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(clamp(a, 0, 1)));
}
