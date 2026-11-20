import { clamp, formatNumber, formatInt, isMobileLayout, MOBILE_MEDIA } from './utils.js';
import { drawDensityMap, densityGridFor } from './charts.js';

const POINTS = [
  { lat: 55.621, lon: 171.287, color: '#ffa36b', r: 3.2 },
  { lat: -32.063, lon: 140.760, color: '#6fd8e8', r: 3.2 },
  { lat: 45, lon: 115, color: '#79e2a5', r: 2.6 },
  { lat: -42, lon: 70, color: '#6bb8ff', r: 2.6 },
  { lat: 47.616, lon: 21.838, color: '#f0d36a', r: 2.4 },
  { lat: 24.207, lon: 94.094, color: '#f0d36a', r: 2.4 },
];

export class CatalogModule {
  constructor({ data, globe }) {
    this.data = data;
    this.globe = globe;
    this.group = 'all';
    this.cache = new Map();
    this.mapGeom = null;
    this.densityOn = false;
    this.selected = null;
    this._bind();
    this._fillTable();
    this._update();
  }

  _bind() {
    const filter = document.getElementById('catalog-filter');
    filter?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.group = b.dataset.group;
      filter.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      const tip = document.getElementById('density-tooltip');
      if (tip) tip.hidden = true;
      this._update();
    });
    const cb = document.getElementById('density-checkbox');
    cb?.addEventListener('change', () => {
      this.setDensity(cb.checked);
      if (cb.checked && this._isMobile()) {
        window.dispatchEvent(new CustomEvent('mars-go-globe', {
          detail: { density: true, toast: 'Плотность включена на глобусе.' },
        }));
      }
    });
    const layer = document.getElementById('layer-density');
    layer?.addEventListener('change', () => this.setDensity(layer.checked));
    document.getElementById('mobile-catalog-globe')?.addEventListener('click', () => this.goGlobe());
    const canvas = document.getElementById('density-map');
    canvas?.addEventListener('pointermove', (e) => this._tooltip(e));
    canvas?.addEventListener('pointerleave', () => {
      if (this._isMobile()) return;
      const t = document.getElementById('density-tooltip');
      if (t) t.hidden = true;
    });
    canvas?.addEventListener('click', (e) => this._click(e));
    if (canvas && typeof ResizeObserver !== 'undefined') {
      this.mapObserver = new ResizeObserver(() => this._update());
      this.mapObserver.observe(canvas);
    }
    window.matchMedia?.(MOBILE_MEDIA)?.addEventListener?.('change', () => this._update());
  }

  _isMobile() {
    return isMobileLayout();
  }

  goGlobe() {
    const p = this.selected;
    const tip = document.getElementById('density-tooltip');
    if (tip) tip.hidden = true;
    window.dispatchEvent(new CustomEvent('mars-go-globe', {
      detail: p
        ? { lat: p.lat, lon: p.lon, distance: 2.5, toast: 'Ячейка на глобусе.' }
        : { toast: 'Открыт глобус.' },
    }));
  }

  _grid() {
    if (!this.cache.has(this.group)) {
      this.cache.set(this.group, densityGridFor(this.data.craters, this.group, 5));
    }
    return this.cache.get(this.group);
  }

  _fillTable() {
    const tbody = document.getElementById('catalog-table-body');
    if (!tbody) return;
    const order = ['all', '20-50', '50-100', '100+'];
    tbody.innerHTML = order.map((key) => {
      const g = this.data.groups[key];
      return `<tr data-group="${key}" class="${key === this.group ? 'active' : ''}">
        <td>${g.label}</td><td>${formatInt(g.north)}</td><td>${formatInt(g.south)}</td><td>${formatInt(g.total)}</td>
      </tr>`;
    }).join('');
  }

  _update() {
    const g = this.data.groups[this.group];
    const n = document.getElementById('density-north');
    const s = document.getElementById('density-south');
    const r = document.getElementById('density-ratio');
    if (n) n.textContent = formatNumber(g.densityNorth, 1);
    if (s) s.textContent = formatNumber(g.densitySouth, 1);
    if (r) r.textContent = `×${formatNumber(g.densitySouth / g.densityNorth, 2)}`;
    document.querySelectorAll('#catalog-table-body tr').forEach((tr) => {
      tr.classList.toggle('active', tr.dataset.group === this.group);
    });
    const dg = this._grid();
    const canvas = document.getElementById('density-map');
    if (canvas) {
      this.mapGeom = drawDensityMap(canvas, dg.raw, {
        maxDensity: dg.maxRaw, points: POINTS, step: dg.step, cols: dg.cols, rows: dg.rows,
      });
      const max = document.getElementById('density-max');
      if (max) max.textContent = `${formatNumber(dg.maxRaw, 0)}`;
    }
    this.globe.setDensityData(dg.grid, dg.max, dg.step);
    if (this.densityOn) this.globe.setDensityMode(true);
  }

  setDensity(on) {
    this.densityOn = on;
    const cb = document.getElementById('density-checkbox');
    const layer = document.getElementById('layer-density');
    if (cb) cb.checked = on;
    if (layer) layer.checked = on;
    this.globe.setDensityMode(on);
    window.dispatchEvent(new CustomEvent('mars-density', { detail: { on } }));
  }

  _tooltip(e) {
    if (!this.mapGeom) return;
    const canvas = document.getElementById('density-map');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.clientWidth / rect.width);
    const y = (e.clientY - rect.top) * (canvas.clientHeight / rect.height);
    const { pad, cw, ch, cols, rows } = this.mapGeom;
    const c = Math.floor((x - pad.l) / cw);
    const r = Math.floor((y - pad.t) / ch);
    const tip = document.getElementById('density-tooltip');
    if (!tip || c < 0 || c >= cols || r < 0 || r >= rows) { if (tip) tip.hidden = true; return; }
    const dg = this._grid();
    const count = dg.counts[r * cols + c];
    const dens = dg.raw[r * cols + c];
    const step = dg.step;
    const latN = 90 - r * step, latS = latN - step, lon = c * step;
    tip.hidden = false;
    tip.innerHTML = `<b>${formatNumber(dens, 1)}</b> кратеров / млн км²<br>${count} кратеров · ячейка ${lon}–${lon + step}° в.д.<br>${latS}–${latN}° широты`;
    const wrap = canvas.parentElement.getBoundingClientRect();
    let left = e.clientX - wrap.left + 12;
    let top = e.clientY - wrap.top + 12;
    if (left + tip.offsetWidth > wrap.width - 4) left = e.clientX - wrap.left - tip.offsetWidth - 12;
    if (top + tip.offsetHeight > wrap.height - 4) top = e.clientY - wrap.top - tip.offsetHeight - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  _click(e) {
    if (!this.mapGeom) return;
    const canvas = document.getElementById('density-map');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.clientWidth / rect.width);
    const y = (e.clientY - rect.top) * (canvas.clientHeight / rect.height);
    const { pad, cw, ch, cols, rows } = this.mapGeom;
    const c = clamp(Math.floor((x - pad.l) / cw), 0, cols - 1);
    const r = clamp(Math.floor((y - pad.t) / ch), 0, rows - 1);
    if (x < pad.l || y < pad.t || x > pad.l + cw * cols || y > pad.t + ch * rows) return;
    const step = this.mapGeom.step || 3;
    const lon = (c + 0.5) * step;
    const lat = 90 - (r + 0.5) * step;
    this.selected = { lat, lon, col: c, row: r };
    if (this._isMobile()) {
      this._tooltip(e);
      return;
    }
    this.globe.flyTo(lat, lon, 2.5);
  }
}
