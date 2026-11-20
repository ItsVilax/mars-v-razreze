import { formatNumber, formatMeters, formatInt } from './utils.js';
import { Chart } from './charts.js';

export class ShoreModule {
  constructor({ data, globe, modalRoot }) {
    this.data = data;
    this.globe = globe;
    this.modalRoot = modalRoot;
    this.charts = [];
    this._bind();
    this._draw();
  }

  _bind() {
    document.getElementById('shore-focus-a')?.addEventListener('click', () => this.focus('A'));
    document.getElementById('shore-focus-b')?.addEventListener('click', () => this.focus('B'));
    document.getElementById('shore-expand')?.addEventListener('click', () => this.openModal());
    const bMedian = document.getElementById('shore-b-median');
    if (bMedian) bMedian.textContent = formatMeters(this.data.shore.B.median);
    const dev = document.getElementById('shore-dev');
    if (dev) dev.textContent = `${formatInt(this.data.shore.B.deviationMedian)} м`;
    const range = document.getElementById('shore-range');
    if (range) range.textContent = `+${this.data.shore.B.signedMin} … +${this.data.shore.B.signedMax} м`;
  }

  focus(side) {
    const points = this.data.shore[side].points;
    const mid = points[Math.floor(points.length / 2)];
    this.globe.flyTo(mid.lat, mid.lon, 1.75);
  }

  _chartOptions(wide = false) {
    const A = this.data.shore.A;
    const B = this.data.shore.B;
    return {
      xLabel: 'Расстояние по линии, км',
      yLabel: 'Высота, м',
      xMin: 0, xMax: 75,
      yMin: -4100, yMax: -3400,
      yTickFormat: (v) => formatNumber(v, 0),
      xTickFormat: (v) => formatNumber(v, 0),
      series: [
        {
          points: A.points.map((p) => [p.distance, p.height]),
          color: '#ffa36b', width: wide ? 2.2 : 1.7, dots: true, dotRadius: 1.6,
        },
        {
          points: B.points.map((p) => [p.distance, p.height]),
          color: '#6fd8e8', width: wide ? 2.2 : 1.7, dots: true, dotRadius: 1.6,
        },
      ],
      markers: [
        { y: A.median, color: 'rgba(255,163,107,.75)', dash: [5, 4], label: `уровень A ${formatMeters(A.median)} м` },
      ],
      points: [
        { x: A.points[A.points.length - 1].distance, y: A.points[A.points.length - 1].height, color: '#ffa36b', r: 3, label: 'A' },
        { x: B.points[B.points.length - 1].distance, y: B.points[B.points.length - 1].height, color: '#6fd8e8', r: 3, label: 'B' },
      ],
    };
  }

  _devOptions(wide = false) {
    const A = this.data.shore.A;
    const B = this.data.shore.B;
    return {
      xLabel: 'Расстояние по B, км',
      yLabel: '|B − A|, м',
      xMin: 0, xMax: 52,
      yMin: 0, yMax: 450,
      xTickFormat: (v) => formatNumber(v, 0),
      yTickFormat: (v) => formatNumber(v, 0),
      series: [{
        points: B.points.map((p) => [p.distance, Math.abs(p.height - A.median)]),
        color: '#6fd8e8', width: wide ? 2.2 : 1.7, fill: true,
        fillTop: 'rgba(94,224,214,.2)', fillBottom: 'rgba(94,224,214,0)',
        dots: true, dotRadius: 1.5,
      }],
      markers: [
        { y: B.deviationMedian, color: 'rgba(255,255,255,.7)', dash: [5, 4], label: `медиана ${formatInt(B.deviationMedian)} м` },
      ],
      bands: [{ x1: 0, x2: 52, color: 'rgba(240,122,69,.04)' }],
    };
  }

  _draw() {
    const c1 = document.getElementById('shore-chart');
    const c2 = document.getElementById('shore-dev-chart');
    if (c1) {
      const chart = new Chart(c1, this._chartOptions());
      c1.style.height = '300px';
      this.charts.push(chart);
    }
    if (c2) {
      const chart = new Chart(c2, this._devOptions());
      c2.style.height = '200px';
      this.charts.push(chart);
    }
  }

  openModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const A = this.data.shore.A;
    const B = this.data.shore.B;
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Проверка берега">
        <div class="modal-head">
          <div><div class="eyebrow">Deuteronilus · Ivanov 2017 · Sholes 2021</div><h2>Единый уровень на двух участках</h2><p>Уровень A = ${formatMeters(A.median)} м · медиана |B − A| = ${formatInt(B.deviationMedian)} м</p></div>
          <button class="modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body">
          <div class="wide-chart" style="margin-bottom:14px"><canvas id="shore-wide-main"></canvas></div>
          <div class="legend-row"><span><i style="background:#ffa36b"></i>участок A · ${A.count} точек · ${formatNumber(A.extentKm, 1)} км</span><span><i style="background:#6fd8e8"></i>участок B · ${B.count} точек · ${formatNumber(B.extentKm, 1)} км</span><span><i style="background:rgba(255,163,107,.75)"></i>уровень A</span></div>
          <div class="wide-chart" style="margin-top:14px"><canvas id="shore-wide-dev"></canvas></div>
          <div class="note" style="margin-top:14px"><b>Расхождение</b><p>B лежит выше уровня A на ${B.signedMin}–${B.signedMax} м на всём участке ${formatNumber(B.extentKm, 1)} км. Медиана абсолютного отклонения — ${formatInt(B.deviationMedian)} м. Это проверка единого уровня на современном рельефе, а не доказательство отсутствия древнего океана.</p></div>
        </div>
      </div>`;
    this.modalRoot.appendChild(modal);
    const charts = [];
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { for (const c of charts) c.destroy?.(); modal.remove(); document.removeEventListener('keydown', onKey); };
    document.addEventListener('keydown', onKey);
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const main = new Chart(modal.querySelector('#shore-wide-main'), this._chartOptions(true));
    main.resize();
    charts.push(main);
    const dev = new Chart(modal.querySelector('#shore-wide-dev'), this._devOptions(true));
    dev.resize();
    charts.push(dev);
  }
}
