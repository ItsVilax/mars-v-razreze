import {
  R_MARS_KM, HEMI_AREA_MKM2, clamp, median, rad,
  parseGrid, parseCSV, buildRowAreas
} from './utils.js';

const BASE = 'prompt/';
const MOLA16_BYTES = 33177600;

function progress(cb, pct, label, detail = '') {
  cb?.(clamp(pct, 0, 1), label, detail);
}

async function fetchArrayBuffer(url, onBytes = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !onBytes) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onBytes(received, total);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function decodeBigEndianInt16(buffer) {
  const src = new Uint16Array(buffer);
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    out[i] = ((v & 0xff) << 8) | (v >> 8);
  }
  return out;
}

function downsample(grid, srcRows, srcCols, factor) {
  const rows = srcRows / factor;
  const cols = srcCols / factor;
  const out = new Float32Array(rows * cols);
  const inv = 1 / (factor * factor);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const sr = r * factor;
    for (let c = 0; c < cols; c++) {
      const sc = c * factor;
      let sum = 0;
      for (let dr = 0; dr < factor; dr++) {
        const off = (sr + dr) * srcCols + sc;
        for (let dc = 0; dc < factor; dc++) sum += grid[off + dc];
      }
      out[k++] = sum * inv;
    }
  }
  return out;
}

function gridMinMax(grid) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(buffer) {
  try {
    if (globalThis.crypto?.subtle) {
      return toHex(await crypto.subtle.digest('SHA-256', buffer));
    }
  } catch { /* localhost secure context is normally available */ }
  return null;
}

async function loadCraterFragment(jsonName, csvName, cratersById) {
  const [json, buffer] = await Promise.all([
    fetchText(BASE + jsonName).then(JSON.parse),
    fetchArrayBuffer(BASE + csvName),
  ]);
  const hash = await sha256(buffer);
  const text = new TextDecoder('utf-8').decode(buffer);
  const grid = parseGrid(text, json.rows, json.columns);
  const ppd = json.ppd || 128;
  const lat0 = json.first_cell_center_lat_n_deg;
  const lon0 = json.first_cell_center_lon_e_deg;
  const rec = cratersById.get(json.crater_id) || {};
  const centerLat = Number(rec.lat ?? json.catalog_record.lat_n_deg);
  const centerLon = Number(rec.lon ?? json.catalog_record.lon_e_deg);
  const D = Number(rec.diameter ?? json.catalog_record.diameter_km);
  const centerRowF = (lat0 - centerLat) * ppd;
  const centerRow = clamp(Math.round(centerRowF), 0, json.rows - 1);
  const centerCol = (centerLon - lon0) * ppd;
  const latRow = lat0 - centerRow / ppd;
  const kmPerCol = R_MARS_KM * Math.cos(rad(latRow)) * (Math.PI / 180) / ppd;
  const kmPerRow = R_MARS_KM * (Math.PI / 180) / ppd;
  return {
    name: json.name,
    id: json.crater_id,
    json,
    grid,
    rows: json.rows,
    cols: json.columns,
    ppd,
    lat0,
    lon0,
    centerLat,
    centerLon,
    centerRow,
    centerCol,
    latRow,
    kmPerCol,
    kmPerRow,
    diameter: D,
    min: json.north_edge_deg ?? null,
    hash,
    hashExpected: json.csv_sha256 || null,
    hashOk: hash ? hash === json.csv_sha256 : null,
  };
}

export function computeProfile(info, row = info.centerRow) {
  const r = clamp(Math.round(row), 0, info.rows - 1);
  const lat = info.lat0 - r / info.ppd;
  const kmPerCol = R_MARS_KM * Math.cos(rad(lat)) * (Math.PI / 180) / info.ppd;
  const heights = new Float64Array(info.cols);
  const distance = new Float64Array(info.cols);
  const columns = new Float64Array(info.cols);
  for (let c = 0; c < info.cols; c++) {
    heights[c] = info.grid[r * info.cols + c];
    distance[c] = c * kmPerCol;
    columns[c] = c + 1;
  }
  return { row: r, row1: r + 1, lat, kmPerCol, heights, distance, columns, widthKm: (info.cols - 1) * kmPerCol };
}

export function autoRims(info, profile) {
  const { heights, kmPerCol } = profile;
  const n = heights.length;
  const centerCol = clamp(info.centerCol, 5, n - 6);
  const half = (info.diameter / 2) / kmPerCol;
  const win = Math.max(5, Math.round(half * 0.2));
  const searchMax = (center) => {
    const a = clamp(Math.round(center) - win, 1, n - 2);
    const b = clamp(Math.round(center) + win, 1, n - 2);
    let best = a;
    for (let i = a; i <= b; i++) if (heights[i] > heights[best]) best = i;
    return best;
  };
  let left = searchMax(centerCol - half);
  let right = searchMax(centerCol + half);
  if (left >= right) {
    left = Math.max(1, Math.floor(centerCol - half));
    right = Math.min(n - 2, Math.ceil(centerCol + half));
  }
  let floorIdx = left + 1;
  const a = Math.min(left + 3, n - 2), b = Math.max(right - 3, a + 1);
  for (let i = a; i <= b; i++) if (heights[i] < heights[floorIdx]) floorIdx = i;
  if (floorIdx <= left || floorIdx >= right) floorIdx = clamp(Math.round((left + right) / 2), left + 1, right - 1);
  return { left, right, floor: floorIdx };
}

export function measureProfile(info, profile, rims) {
  const { heights, distance } = profile;
  const { left, right, floor } = rims;
  const z1 = heights[left], z2 = heights[right], zmin = heights[floor];
  const rimMean = (z1 + z2) / 2;
  const d = rimMean - zmin;
  const ratio = d / (1000 * info.diameter);
  const defined = Number.isFinite(d) && d > 0 && left < floor && floor < right;
  return {
    z1, z2, zmin, rimMean, d, ratio, defined,
    left, right, floor,
    x1: distance[left], x2: distance[right], xf: distance[floor],
    rimSeparationKm: distance[right] - distance[left],
  };
}

function catalogGroups(craters) {
  const defs = [
    ['all', 'все ≥ 20', (d) => d >= 20],
    ['20-50', '20–50 км', (d) => d >= 20 && d < 50],
    ['50-100', '50–100 км', (d) => d >= 50 && d < 100],
    ['100+', '≥ 100 км', (d) => d >= 100],
  ];
  const groups = {};
  for (const [key, label, test] of defs) {
    const sub = craters.filter((c) => test(c.diameter));
    const n = sub.filter((c) => c.lat >= 0).length;
    const s = sub.length - n;
    groups[key] = {
      key, label, total: sub.length, north: n, south: s,
      densityNorth: n / HEMI_AREA_MKM2,
      densitySouth: s / HEMI_AREA_MKM2,
      densityTotal: sub.length / HEMI_AREA_MKM2,
    };
  }
  return groups;
}

function makeShore(points) {
  const heights = points.map((p) => p.height);
  const med = median(heights);
  return {
    points,
    heights,
    median: med,
    extentKm: points.length ? points[points.length - 1].distance : 0,
    count: points.length,
  };
}

export async function loadAtlasData(onProgress) {
  progress(onProgress, 0.02, 'Читаю MOLA 16 пикселей на градус…', 'megt90n000eb.img · 33.2 МБ');
  const mola16Buffer = await fetchArrayBuffer(BASE + 'megt90n000eb.img', (got, total) => {
    progress(onProgress, 0.02 + 0.26 * (total ? got / total : 0), 'Читаю MOLA 16 пикселей на градус…',
      `${(got / 1048576).toFixed(1)} МБ${total ? ` из ${(total / 1048576).toFixed(1)}` : ''}`);
  });
  if (mola16Buffer.byteLength !== MOLA16_BYTES) {
    throw new Error(`MOLA16: ожидалось ${MOLA16_BYTES} байт, получено ${mola16Buffer.byteLength}`);
  }
  progress(onProgress, 0.29, 'Распаковываю высоты MOLA16…', '2880 × 5760 · int16 big-endian');
  const full16 = decodeBigEndianInt16(mola16Buffer);
  const mm16 = gridMinMax(full16);

  progress(onProgress, 0.34, 'Строю сетку глобуса…', '4 и 8 пикселей на градус');
  const globe4 = downsample(full16, 2880, 5760, 4);
  const globe8 = new Int16Array(1440 * 2880);
  for (let r = 0; r < 1440; r++) {
    for (let c = 0; c < 2880; c++) {
      const sr = r * 2, sc = c * 2;
      const o = sr * 5760 + sc;
      globe8[r * 2880 + c] = Math.round((full16[o] + full16[o + 1] + full16[o + 5760] + full16[o + 5761]) / 4);
    }
  }

  progress(onProgress, 0.42, 'Читаю сетку заливки MOLA4…', '720 × 1440 · 4 px/°');
  const mola4Text = await fetchText(BASE + 'mola4_topography_m.csv');
  const mola4 = parseGrid(mola4Text, 720, 1440);
  const mm4 = gridMinMax(mola4);
  const rowAreas = buildRowAreas(720);

  progress(onProgress, 0.53, 'Считаю каталог кратеров…', 'craters20.csv');
  const craterRows = parseCSV(await fetchText(BASE + 'craters20.csv'));
  const craters = [];
  for (const r of craterRows) {
    const diameter = Number(r.diameter_km);
    if (!Number.isFinite(diameter)) continue;
    craters.push({
      id: r.crater_id,
      lat: Number(r.lat_n_deg),
      lon: Number(r.lon_e_deg),
      diameter,
      name: r.name || '',
    });
  }
  const cratersById = new Map(craters.map((c) => [c.id, c]));
  const groups = catalogGroups(craters);

  progress(onProgress, 0.63, 'Открываю подробные фрагменты кратеров…', '128 пикселей на градус');
  const [north, south] = await Promise.all([
    loadCraterFragment('crater_north_stokes_mola128.json', 'crater_north_stokes_mola128.csv', cratersById),
    loadCraterFragment('crater_south_horowitz_mola128.json', 'crater_south_horowitz_mola128.csv', cratersById),
  ]);

  progress(onProgress, 0.72, 'Сверяю профиль Стокса с первым опытом…', 'Профиль_Стокса.csv');
  let profileCheck = { equal: null, count: 0, mismatches: 0 };
  try {
    const profileRows = parseCSV(await fetchText(BASE + encodeURIComponent('Профиль_Стокса.csv')));
    const expected = north.grid.slice(north.centerRow * north.cols, (north.centerRow + 1) * north.cols);
    let mismatches = 0;
    for (let i = 0; i < profileRows.length; i++) {
      if (Number(profileRows[i].height_m) !== expected[i]) mismatches++;
    }
    profileCheck = { equal: mismatches === 0 && profileRows.length === north.cols, count: profileRows.length, mismatches };
  } catch (e) {
    profileCheck = { equal: false, count: 0, mismatches: 0, error: String(e.message || e) };
  }

  progress(onProgress, 0.8, 'Читаю береговые профили…', 'Ivanov 2017 / Sholes 2021');
  const [aRows, bRows] = await Promise.all([
    fetchText(BASE + 'shore_A.csv').then(parseCSV),
    fetchText(BASE + 'shore_B.csv').then(parseCSV),
  ]);
  const shoreA = makeShore(aRows.map((r, i) => ({
    point: Number(r.point) || i + 1,
    id: r.source_ID,
    lon: Number(r.lon_e_deg),
    lat: Number(r.lat_n_deg),
    distance: Number(r.distance_km),
    height: Number(r.height_m),
    region: r.region,
  })));
  const shoreB = makeShore(bRows.map((r, i) => ({
    point: Number(r.point) || i + 1,
    id: r.source_ID,
    lon: Number(r.lon_e_deg),
    lat: Number(r.lat_n_deg),
    distance: Number(r.distance_km),
    height: Number(r.height_m),
    region: r.region,
  })));
  shoreA.level = shoreA.median;
  const devs = shoreB.heights.map((h) => Math.abs(h - shoreA.median));
  shoreB.level = shoreA.median;
  shoreB.deviationMedian = median(devs);
  shoreB.deviationMin = Math.min(...devs);
  shoreB.deviationMax = Math.max(...devs);
  shoreB.signed = shoreB.heights.map((h) => h - shoreA.median);
  shoreB.signedMin = Math.min(...shoreB.signed);
  shoreB.signedMax = Math.max(...shoreB.signed);

  const startRow = 180, startCol = 460; // 1-based 181/461
  const hellasRow = 528, hellasCol = 280; // 42° S, 70° E

  progress(onProgress, 0.88, 'Готовлю профили и измерения…', 'Stokes · Horowitz');
  const northProfile = computeProfile(north, north.centerRow);
  const southProfile = computeProfile(south, south.centerRow);
  const northRims = autoRims(north, northProfile);
  const southRims = autoRims(south, southProfile);
  const northMeasure = measureProfile(north, northProfile, northRims);
  const southMeasure = measureProfile(south, southProfile, southRims);

  progress(onProgress, 0.94, 'Собираю контрольные значения…', 'заливка · берег · каталог');
  const data = {
    meta: {
      mola16: { rows: 2880, cols: 5760, bytes: MOLA16_BYTES, min: mm16.min, max: mm16.max },
      mola4: { rows: 720, cols: 1440, min: mm4.min, max: mm4.max },
      hemiAreaMkm2: HEMI_AREA_MKM2,
      start: { row: startRow, col: startCol, lat: 45, lon: 115, z: mola4[startRow * 1440 + startCol] },
      hellas: { row: hellasRow, col: hellasCol, lat: -42, lon: 70, z: mola4[hellasRow * 1440 + hellasCol] },
      profileCheck,
      fragmentHashOk: north.hashOk === true && south.hashOk === true,
      fragmentHashChecked: north.hashOk !== null && south.hashOk !== null,
    },
    full16,
    globe4,
    globe8,
    mola4,
    rowAreas,
    craters,
    groups,
    craterInfo: { north, south },
    craterProfiles: {
      north: { profile: northProfile, rims: northRims, measure: northMeasure },
      south: { profile: southProfile, rims: southRims, measure: southMeasure },
    },
    shore: { A: shoreA, B: shoreB },
  };
  progress(onProgress, 1, 'Готово. Добро пожаловать на Марс.', 'MOLA · PADC · USGS · Ivanov/Sholes');
  return data;
}
