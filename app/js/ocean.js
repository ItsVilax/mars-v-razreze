import { clamp, formatInt, formatNumber, formatSigned, formatMeters } from './utils.js';
import { Chart } from './charts.js';

const CONTROL = { level: -3800, cells: 223851, areaMkm2: 23.070 };
const ALL_LOW_CONTROL = { cells: 244249, areaMkm2: 26565126.62 / 1e6 };
const SPILL_LEVEL = 1304;

export class OceanModule {
  constructor({ data, globe, modalRoot, onToast }) {
    this.data = data;
    this.globe = globe;
    this.modalRoot = modalRoot;
    this.onToast = onToast;
    this.level = CONTROL.level;
    this.mode = 'connected';
    this.worker = null;
    this.workerReady = false;
    this.inFlight = false;
    this.pending = null;
    this.reqId = 0;
    this.lastResult = null;
    this.curve = null;
    this.curveRequested = false;
    this.spillLevel = null;
    this.fallback = false;
    this.controls = {};
    this._bindDom();
    this._initWorker();
    this._initChart();
    this.setLevel(CONTROL.level);
  }

  _bindDom() {
    const $ = (id) => document.getElementById(id);
    this.controls = {
      range: $('ocean-level'),
      num: $('ocean-level-num'),
      label: $('ocean-level-label'),
      cells: $('ocean-cells'),
      area: $('ocean-area'),
      startDepth: $('ocean-start-depth'),
      hellas: $('ocean-hellas'),
      check: $('ocean-control'),
      checkText: $('ocean-control-text'),
      mode: $('ocean-mode'),
      chartBadge: $('ocean-chart-badge'),
      chartStatus: $('ocean-chart-status'),
      note: $('ocean-note'),
      utopia: $('ocean-utopia-btn'),
      hellasBtn: $('ocean-hellas-btn'),
      spill: $('ocean-spill-btn'),
      reset: $('ocean-reset-btn'),
      expand: $('ocean-expand'),
    };
    this.controls.range.addEventListener('input', () => this.setLevel(Number(this.controls.range.value)));
    this.controls.num.addEventListener('change', () => this.setLevel(Number(this.controls.num.value)));
    this.controls.mode.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setMode(b.dataset.mode);
    });
    this.controls.utopia.addEventListener('click', () => this.globe.flyTo(45, 115, 1.95));
    this.controls.hellasBtn.addEventListener('click', () => this.globe.flyTo(-42, 70, 1.95));
    this.controls.spill.addEventListener('click', () => {
      this.setLevel(this.spillLevel || SPILL_LEVEL);
      this.globe.flyTo(-42, 70, 1.95);
      this.onToast?.(`Уровень ${formatSigned(this.spillLevel || SPILL_LEVEL)} м: вода впервые проходит в Элладу.`);
    });
    this.controls.reset.addEventListener('click', () => {
      this.setMode('connected');
      this.setLevel(CONTROL.level);
      this.globe.flyTo(45, 115, 1.95);
    });
    this.controls.expand.addEventListener('click', () => this.openChartModal());
  }

  _initWorker() {
    if (typeof Worker === 'undefined') { this._enableFallback('Worker недоступен'); return; }
    try {
      this.worker = new Worker(new URL('./flood-worker.js', import.meta.url));
      this.worker.onmessage = (e) => this._onWorkerMessage(e.data);
      this.worker.onerror = (e) => {
        this._enableFallback(e.message || 'ошибка worker');
      };
      this.worker.postMessage({
        type: 'init',
        rows: 720,
        cols: 1440,
        heights: this.data.mola4.slice().buffer,
        rowAreas: this.data.rowAreas.slice().buffer,
        startRow: 180,
        startCol: 460,
        hellasRow: 528,
        hellasCol: 280,
      });
    } catch (e) {
      this._enableFallback(String(e.message || e));
    }
  }

  _enableFallback(message) {
    if (this.fallback) return;
    this.fallback = true;
    this.worker?.terminate?.();
    this.worker = null;
    this.workerReady = true;
    this.controls.chartStatus && (this.controls.chartStatus.textContent = `Работаю без Web Worker: ${message}`);
    this._fallbackRequest();
    this._fallbackCurve();
    this._setStatus('fallback');
  }

  _onWorkerMessage(msg) {
    if (msg.type === 'ready') {
      this.workerReady = true;
      this._setStatus('ready');
      this._drainPending();
      if (!this.curveRequested) {
        this.curveRequested = true;
        this.worker.postMessage({ type: 'curve', levels: [...Array.from({ length: 81 }, (_, i) => -6000 + i * 100), CONTROL.level, SPILL_LEVEL] });
      }
      return;
    }
    if (msg.type === 'floodResult' || msg.type === 'allLowResult') {
      this.inFlight = false;
      msg.mode = msg.type === 'allLowResult' ? 'all' : 'connected';
      if (msg.id !== this.reqId) { this._drainPending(); return; }
      this._applyResult(msg);
      this._drainPending();
      return;
    }
    if (msg.type === 'curveResult') {
      this.curve = msg;
      this.curveRequested = true;
      const first = msg.hellas.indexOf(1);
      if (first >= 0) this.spillLevel = msg.levels[first];
      this._drawChart();
      this.controls.chartStatus.textContent = `Кривая рассчитана по всем ${msg.levels.length} уровням; порог перелива в Элладу: ${formatSigned(this.spillLevel || SPILL_LEVEL)} м.`;
      return;
    }
    if (msg.type === 'error') {
      this.inFlight = false;
      this.controls.chartStatus.textContent = `Ошибка расчёта: ${msg.message}`;
      this._drainPending();
    }
  }

  _setStatus(status) {
    if (status === 'ready') {
      this.controls.chartStatus.textContent = this.curve ? 'Кривая рассчитана.' : 'Считаю кривую уровень — площадь…';
    }
  }

  _drainPending() {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this._request(p.level, p.mode, p.id);
  }

  _request(level, mode) {
    if (this.fallback) {
      this._fallbackRequest();
      return;
    }
    if (!this.worker || !this.workerReady) {
      this.pending = { level, mode };
      return;
    }
    if (this.inFlight) {
      this.pending = { level, mode };
      return;
    }
    this.inFlight = true;
    this.reqId++;
    const id = this.reqId;
    this.worker.postMessage({
      type: mode === 'all' ? 'allLow' : 'flood',
      level,
      id,
    });
  }

  _applyResult(result) {
    this.lastResult = result;
    const mask = new Uint8Array(result.mask);
    this.globe.setWaterMask(mask, result.level);
    const areaMkm2 = result.areaKm2 / 1e6;
    const startZ = this.data.meta.start.z;
    const method = result.startBelow ? `${formatMeters(result.level - startZ)} м` : 'старт выше h';
    this.controls.cells.textContent = formatInt(result.cells);
    this.controls.area.textContent = formatNumber(areaMkm2, 3);
    this.controls.startDepth.textContent = method;
    const resultMode = result.mode || this.mode;
    if (resultMode === 'all') {
      this.controls.hellas.textContent = result.hellasReached ? 'ниже уровня' : 'выше уровня';
    } else {
      this.controls.hellas.textContent = result.hellasReached ? 'соединена' : 'не соединена';
    }
    this.controls.hellas.style.color = result.hellasReached
      ? (resultMode === 'all' ? 'var(--muted)' : 'var(--good)')
      : 'var(--text)';
    this._updateControlCheck(result, areaMkm2);
    this._updateChartMarkers(areaMkm2);
    this._updateNote(result, areaMkm2);
    this.controls.chartStatus.textContent = this.curve
      ? `Кривая рассчитана по всем ${this.curve.levels.length} уровням; зелёная точка — текущий уровень.`
      : 'Считаю кривую уровень — площадь…';
  }

  _updateControlCheck(result, areaMkm2) {
    const c = this.controls.check;
    c.classList.remove('pending', 'bad');
    if (this.mode !== 'connected' || this.level !== CONTROL.level) {
      c.classList.add('pending');
      c.querySelector('.check-icon').textContent = 'i';
      this.controls.checkText.textContent = 'Контроль доступен при h = −3800 м в режиме «от Утопии». Нажмите «Сброс −3800».';
      return;
    }
    const cellsOk = result.cells === CONTROL.cells;
    const areaOk = Math.abs(areaMkm2 - CONTROL.areaMkm2) < 0.001;
    if (cellsOk && areaOk) {
      c.querySelector('.check-icon').textContent = '✓';
      this.controls.checkText.textContent = `${formatInt(result.cells)} ячеек · ${formatNumber(areaMkm2, 3)} млн км² — совпадает с контролем.`;
    } else {
      c.classList.add('bad');
      c.querySelector('.check-icon').textContent = '!';
      this.controls.checkText.textContent = `Получено ${formatInt(result.cells)} ячеек · ${formatNumber(areaMkm2, 3)} млн км²; ожидается 223 851 · 23.070.`;
    }
  }

  _updateNote(result, areaMkm2) {
    if (this.mode === 'all') {
      this.controls.note.innerHTML = `<b>Режим «все низкие места»</b>
        <p>Закрашиваются все ячейки ниже h, даже если путь от Утопии перекрыт. Сейчас: ${formatInt(result.cells)} ячеек · ${formatNumber(areaMkm2, 3)} млн км². При −3800 м это 244 249 ячеек и 26.565 млн км² — на 20 398 ячеек больше связной модели.</p>`;
    } else {
      this.controls.note.innerHTML = `<b>Почему нельзя красить всё ниже h?</b>
        <p>При −3800 м Эллада лежит на ${formatMeters(this.data.meta.hellas.z)} м, но не соединена с Утопией: путь перекрыт высоким южным барьером. Заливка «все низкие места» даёт 244 249 ячеек и 26.565 млн км² — это другая, несвязная модель.</p>`;
    }
  }

  _updateChartMarkers(areaMkm2) {
    if (!this.chart) return;
    this.chart.setOptions({
      markers: [
        { x: CONTROL.level, color: 'rgba(255,255,255,.35)', dash: [5, 4], label: Math.abs(this.level - CONTROL.level) < 15 ? '' : '−3800' },
        { x: this.spillLevel || SPILL_LEVEL, color: 'rgba(240,122,69,.65)', dash: [3, 4], label: Math.abs(this.level - (this.spillLevel || SPILL_LEVEL)) < 15 ? '' : formatSigned(this.spillLevel || SPILL_LEVEL) },
        { x: this.level, color: 'rgba(94,224,214,.95)', width: 1.5, dash: [], label: formatSigned(this.level) + ' м' },
      ],
      points: [{ x: this.level, y: areaMkm2, color: '#5ee0d6', r: 4, label: '' }],
      hoverX: null,
    });
    this.controls.chartBadge.textContent = `${formatNumber(areaMkm2, 3)} млн км²`;
  }

  _initChart() {
    const canvas = document.getElementById('ocean-chart');
    if (!canvas) return;
    this.chart = new Chart(canvas, {
      xLabel: 'Уровень воды h, м',
      yLabel: 'Площадь, млн км²',
      xMin: -6000, xMax: 2000, yMin: 0, yMax: 120,
      xTickFormat: (v) => formatSigned(v),
      yTickFormat: (v) => formatNumber(v, 0),
      series: [],
      markers: [],
      points: [],
      onDraw: (ctx, chart) => {
        if (!this.curve) return;
        const b = chart.plotBox();
        ctx.save();
        ctx.font = '9px "Cascadia Code", Consolas, monospace';
        ctx.fillStyle = 'rgba(141,157,178,.8)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('перелив в Элладу', chart.xToPx(this.spillLevel || SPILL_LEVEL) - 5, b.y + 18);
        ctx.restore();
      },
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.curve) return;
      const { x } = this.chart.pixelFromEvent(e);
      const h = this.chart.pxToX(x);
      const levels = this.curve.levels;
      let lo = 0, hi = levels.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (levels[m] < h) lo = m + 1; else hi = m; }
      const i = clamp(lo, 0, levels.length - 1);
      const area = this.curve.areas[i];
      this.chart.setOptions({
        hoverX: levels[i],
        hoverLabel: `${formatSigned(levels[i])} м · ${formatNumber(area, 3)} млн км² · ${formatInt(this.curve.cells[i])} ячеек`,
      });
    });
    canvas.addEventListener('pointerleave', () => {
      this.chart.setOptions({ hoverX: null, hoverLabel: '' });
    });
  }

  _drawChart() {
    if (!this.chart || !this.curve) return;
    const maxArea = Math.max(120, Math.ceil(Math.max(...this.curve.areas) / 10) * 10);
    this.chart.setOptions({
      yMax: maxArea,
      series: [{
        points: this.curve.levels.map((h, i) => [h, this.curve.areas[i]]),
        color: '#f07a45', width: 2, fill: true,
        fillTop: 'rgba(240,122,69,.22)', fillBottom: 'rgba(240,122,69,0)',
      }],
    });
    this._updateChartMarkers(this.chart.opts.points[0]?.y || 0);
  }

  setLevel(value) {
    const level = clamp(Math.round(Number(value) || CONTROL.level), -6000, 2000);
    this.level = level;
    this.controls.range.value = level;
    this.controls.num.value = level;
    this.controls.label.textContent = `${formatSigned(level)} м`;
    this._updateChartMarkers(this.lastResult ? this.lastResult.areaKm2 / 1e6 : 0);
    this._request(level, this.mode);
    if (!this.fallback && this.workerReady && !this.inFlight) {
      // request submitted above
    }
    if (!this.curveRequested && this.workerReady && !this.fallback) {
      this.curveRequested = true;
      this.worker.postMessage({ type: 'curve', levels: [...Array.from({ length: 81 }, (_, i) => -6000 + i * 100), CONTROL.level, SPILL_LEVEL] });
    }
  }

  setMode(mode) {
    if (mode !== 'connected' && mode !== 'all') return;
    this.mode = mode;
    this.controls.mode.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this._request(this.level, this.mode);
  }

  _fallbackRequest() {
    if (!this.fallback) return;
    const { mola4, rowAreas } = this.data;
    const level = this.level;
    const start = 180 * 1440 + 460;
    const hellas = 528 * 1440 + 280;
    let cells = 0, area = 0;
    if (this.mode === 'all') {
      for (let r = 0; r < 720; r++) {
        for (let c = 0; c < 1440; c++) {
          if (mola4[r * 1440 + c] < level) { cells++; area += rowAreas[r]; }
        }
      }
      const mask = new Uint8Array(720 * 1440);
      for (let i = 0; i < mask.length; i++) if (mola4[i] < level) mask[i] = 1;
      this._applyResult({ level, cells, areaKm2: area, startBelow: mola4[start] < level, hellasReached: mola4[hellas] < level, mask: mask.buffer });
      return;
    }
    const mask = new Uint8Array(720 * 1440);
    const q = new Int32Array(720 * 1440);
    let head = 0, tail = 0;
    if (mola4[start] < level) {
      mask[start] = 1; q[tail++] = start;
      while (head < tail) {
        const p = q[head++]; const r = (p / 1440) | 0; const c = p - r * 1440;
        cells++; area += rowAreas[r];
        const neigh = [];
        if (r > 0) neigh.push(p - 1440);
        if (r + 1 < 720) neigh.push(p + 1440);
        neigh.push(p - c + (c === 0 ? 1439 : c - 1));
        neigh.push(p - c + (c + 1 === 1440 ? 0 : c + 1));
        for (const n of neigh) if (!mask[n] && mola4[n] < level) { mask[n] = 1; q[tail++] = n; }
      }
    }
    this._applyResult({ level, cells, areaKm2: area, startBelow: mola4[start] < level, hellasReached: mask[hellas] === 1, mask: mask.buffer });
  }

  _fallbackCurve() {
    if (!this.fallback) return;
    const levels = [...Array.from({ length: 81 }, (_, i) => -6000 + i * 100), CONTROL.level, SPILL_LEVEL];
    const { mola4, rowAreas } = this.data;
    const cells = [], areas = [];
    for (const level of levels) {
      let c = 0, a = 0;
      for (let i = 0; i < mola4.length; i++) if (mola4[i] < level) { c++; a += rowAreas[(i / 1440) | 0]; }
      cells.push(c); areas.push(a / 1e6);
    }
    this.curve = { levels, cells, areas };
    this._drawChart();
    this.controls.chartStatus.textContent = 'Кривая рассчитана (fallback без worker).';
  }

  openChartModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="График уровень — площадь">
        <div class="modal-head">
          <div><div class="eyebrow">Модель заливки · 4 px/°</div><h2>Уровень — площадь</h2><p>Связная область от Утопии · площадь по широтным ячейкам</p></div>
          <button class="modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body">
          <div class="wide-chart"><canvas id="ocean-wide-chart"></canvas></div>
          <div class="legend-row"><span><i style="background:#f07a45"></i>связная заливка</span><span><i style="background:#5ee0d6"></i>текущий уровень ${formatSigned(this.level)} м</span><span><i style="background:#e06b55"></i>перелив в Элладу +1304 м</span></div>
          <div class="note" style="margin-top:14px"><b>Контроль</b><p>При h = −3800 м залито 223 851 ячейка, 23.070 млн км². Кривая показывает, что площадь меняется нелинейно: при +1304 м вода впервые проходит в Элладу, и площадь скачком возрастает примерно до 95.5 млн км².</p></div>
        </div>
      </div>`;
    this.modalRoot.appendChild(modal);
    let wideChart = null;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { wideChart?.destroy?.(); modal.remove(); document.removeEventListener('keydown', onKey); };
    document.addEventListener('keydown', onKey);
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const canvas = modal.querySelector('#ocean-wide-chart');
    wideChart = new Chart(canvas, {
      xLabel: 'Уровень воды h, м', yLabel: 'Площадь, млн км²',
      xMin: -6000, xMax: 2000, yMin: 0, yMax: Math.max(120, Math.ceil(Math.max(...(this.curve?.areas || [120])) / 10) * 10),
      xTickFormat: (v) => formatSigned(v), yTickFormat: (v) => formatNumber(v, 0),
      series: this.curve ? [{
        points: this.curve.levels.map((h, i) => [h, this.curve.areas[i]]),
        color: '#f07a45', width: 2.2, fill: true,
        fillTop: 'rgba(240,122,69,.22)', fillBottom: 'rgba(240,122,69,0)',
      }] : [],
      markers: [
        { x: CONTROL.level, color: 'rgba(255,255,255,.35)', dash: [5, 4], label: '' },
        { x: this.spillLevel || SPILL_LEVEL, color: 'rgba(240,122,69,.65)', dash: [3, 4], label: Math.abs(this.level - (this.spillLevel || SPILL_LEVEL)) < 15 ? '' : formatSigned(this.spillLevel || SPILL_LEVEL) },
        { x: this.level, color: 'rgba(94,224,214,.95)', width: 1.5, dash: [], label: `${formatSigned(this.level)} м` },
      ],
    });
    wideChart.resize();
  }
}
