import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  clamp, formatMeters, formatInt, formatNumber, heightColor,
  downloadCanvas, downloadText, rad
} from './utils.js';
import { Chart } from './charts.js';

class LocalTerrain {
  constructor(canvas, info, profile, measure, callbacks) {
    this.canvas = canvas;
    this.info = info;
    this.profile = profile;
    this.measure = measure;
    this.callbacks = callbacks;
    this.exaggeration = 6;
    this.meanY = 0;
    this.destroyed = false;
    this._init();
  }

  _init() {
    const c = this.canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 3000);
    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(0x05090f, 0);

    const w = (this.info.cols - 1) * this.info.kmPerCol;
    const d = (this.info.rows - 1) * this.info.kmPerRow;
    this.widthKm = w;
    this.depthKm = d;

    const positions = new Float32Array(this.info.rows * this.info.cols * 3);
    const colors = new Float32Array(this.info.rows * this.info.cols * 3);
    const color = new THREE.Color();
    let k = 0;
    for (let r = 0; r < this.info.rows; r++) {
      for (let c = 0; c < this.info.cols; c++) {
        const z = this.info.grid[r * this.info.cols + c];
        positions[k * 3] = (c - this.info.centerCol) * this.info.kmPerCol;
        positions[k * 3 + 1] = z / 1000 * this.exaggeration;
        positions[k * 3 + 2] = (r - this.info.centerRow) * this.info.kmPerRow;
        const [rr, gg, bb] = heightColor(z);
        color.setRGB(rr / 255, gg / 255, bb / 255, THREE.SRGBColorSpace);
        colors[k * 3] = color.r; colors[k * 3 + 1] = color.g; colors[k * 3 + 2] = color.b;
        k++;
      }
    }
    const indices = [];
    for (let r = 0; r < this.info.rows - 1; r++) {
      for (let c = 0; c < this.info.cols - 1; c++) {
        const a = r * this.info.cols + c;
        const b = a + 1;
        const e = a + this.info.cols;
        const f = e + 1;
        indices.push(a, e, b, b, e, f);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.geometry = geo;
    this.positionsAttr = geo.attributes.position;
    this.originalY = new Float32Array(this.info.rows * this.info.cols);
    for (let i = 0; i < this.info.rows * this.info.cols; i++) {
      this.originalY[i] = this.info.grid[i] / 1000;
    }
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.98, metalness: 0, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);

    const border = [];
    const yb = Math.min(...this.originalY) * this.exaggeration - 0.7;
    border.push(
      -w / 2, yb, -d / 2, w / 2, yb, -d / 2,
      w / 2, yb, -d / 2, w / 2, yb, d / 2,
      w / 2, yb, d / 2, -w / 2, yb, d / 2,
      -w / 2, yb, d / 2, -w / 2, yb, -d / 2,
    );
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(border, 3));
    this.border = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0x36506b, transparent: true, opacity: 0.85 }));
    this.scene.add(this.border);

    this.profileLine = this._makeProfileLine();
    this.scene.add(this.profileLine);

    this.rimMarkers = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0xff8a5c : i === 1 ? 0xffb083 : 0xffe08a,
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), mat);
      m.renderOrder = 3;
      this.rimMarkers.push(m);
      this.scene.add(m);
    }

    this.hoverGroup = new THREE.Group();
    const hoverDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.hoverDot = hoverDot;
    this.hoverGroup.add(hoverDot);
    this.hoverLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 })
    );
    this.hoverGroup.add(this.hoverLine);
    this.hoverGroup.visible = false;
    this.scene.add(this.hoverGroup);

    const amb = new THREE.AmbientLight(0xffffff, 1.1);
    this.scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff0e0, 2.8);
    sun.position.set(-60, 120, 80);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5ea1dc, 0.6);
    fill.position.set(80, -20, -60);
    this.scene.add(fill);

    this.meanY = this.info.grid.reduce((s, v) => s + v, 0) / this.info.grid.length / 1000;
    this.controls = new OrbitControls(this.camera, c);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 240;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.target.set(0, this.meanY * this.exaggeration, 0);
    this.camera.position.set(0, this.meanY * this.exaggeration + 70, 105);
    this.controls.update();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerDown = null;
    this._bind();
    this.setMeasure(this.measure);
    this.resize();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _makeProfileLine() {
    const pts = [];
    const row = this.profile.row;
    for (let c = 0; c < this.info.cols; c++) {
      const z = this.info.grid[row * this.info.cols + c];
      pts.push(new THREE.Vector3(
        (c - this.info.centerCol) * this.info.kmPerCol,
        z / 1000 * this.exaggeration + 0.35,
        0
      ));
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x9ff7ee, transparent: true, opacity: 0.9 })
    );
  }

  _updateProfileGeometry() {
    const pos = this.profileLine.geometry.attributes.position;
    const row = this.profile.row;
    for (let c = 0; c < this.info.cols; c++) {
      const z = this.info.grid[row * this.info.cols + c];
      pos.setY(c, z / 1000 * this.exaggeration + 0.35);
    }
    pos.needsUpdate = true;
    this.profileLine.geometry.computeBoundingSphere();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.pointer.set(nx, ny);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      if (!hit) {
        this.hoverGroup.visible = false;
        this.callbacks?.onHover?.(null);
        return;
      }
      const col = clamp(Math.round(hit.point.x / this.info.kmPerCol + this.info.centerCol), 0, this.info.cols - 1);
      this.setHoverCol(col);
      this.callbacks?.onHover?.(col);
    });
    c.addEventListener('pointerleave', () => {
      this.hoverGroup.visible = false;
      this.callbacks?.onHover?.(null);
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c.parentElement || c);
    }
  }

  setHoverCol(col) {
    if (col == null || col < 0) { this.hoverGroup.visible = false; return; }
    const row = this.profile.row;
    const z = this.info.grid[row * this.info.cols + col];
    const x = (col - this.info.centerCol) * this.info.kmPerCol;
    const y = z / 1000 * this.exaggeration;
    this.hoverDot.position.set(x, y, 0);
    const p = this.hoverLine.geometry.attributes.position;
    p.setXYZ(0, x, Math.min(...this.originalY) * this.exaggeration - 1, 0);
    p.setXYZ(1, x, y, 0);
    p.needsUpdate = true;
    this.hoverLine.geometry.computeBoundingSphere();
    this.hoverGroup.visible = true;
  }

  setMeasure(measure) {
    this.measure = measure;
    const { left, right, floor } = measure;
    const row = this.profile.row;
    const coords = [
      { col: left, color: 0xff8a5c },
      { col: right, color: 0xffb083 },
      { col: floor, color: 0xffe08a },
    ];
    for (let i = 0; i < 3; i++) {
      const z = this.info.grid[row * this.info.cols + coords[i].col];
      this.rimMarkers[i].position.set(
        (coords[i].col - this.info.centerCol) * this.info.kmPerCol,
        z / 1000 * this.exaggeration + 0.75,
        0
      );
    }
  }

  setExaggeration(exag) {
    const oldExag = this.exaggeration;
    this.exaggeration = exag;
    const pos = this.positionsAttr;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.originalY[i] * exag);
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this._updateProfileGeometry();
    this.setMeasure(this.measure);
    const dy = (exag - oldExag) * this.meanY;
    this.camera.position.y += dy;
    this.controls.target.y = this.meanY * exag;
    this.controls.update();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _animate() {
    if (this.destroyed) return;
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.destroyed = true;
    this.ro?.disconnect();
    this.controls?.dispose?.();
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.profileLine?.geometry?.dispose?.();
    this.profileLine?.material?.dispose?.();
    this.renderer?.dispose?.();
  }
}

export class CraterLab {
  constructor({ data, modalRoot, onToast, onOpenGlobe }) {
    this.data = data;
    this.modalRoot = modalRoot;
    this.onToast = onToast;
    this.onOpenGlobe = onOpenGlobe;
    this.currentTerrain = null;
    this.currentModal = null;
    this.currentSide = null;
    this.chart = null;
    this.compareCharts = [];
    this.state = null;
    this._keyHandler = (e) => { if (e.key === 'Escape') this.close(); };
  }

  open(side = 'north') {
    this.close();
    this.currentSide = side;
    const info = this.data.craterInfo[side];
    const base = this.data.craterProfiles[side];
    const profile = base.profile;
    let rims = { ...base.rims };
    let measure = { ...base.measure };
    const accent = side === 'north' ? '#ffa36b' : '#6fd8e8';
    const hemi = side === 'north' ? 'северное полушарие' : 'южное полушарие';

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Профиль ${info.name}">
        <div class="modal-head">
          <div>
            <div class="eyebrow">Профиль кратера · ${hemi}</div>
            <h2>${info.name} <span style="color:var(--muted-2);font-size:14px;font-family:var(--mono)">D = ${formatNumber(info.diameter, 2)} км</span></h2>
            <p>${formatNumber(info.centerLat, 3)}° ${info.centerLat >= 0 ? 'с.ш.' : 'ю.ш.'} · ${formatNumber(info.centerLon, 3)}° в.д. · строка ${profile.row1} фрагмента 128 px/°</p>
          </div>
          <button class="modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body">
          <div class="crater-grid">
            <div class="terrain-panel">
              <canvas id="crater3d-canvas"></canvas>
              <div class="terrain-hud">
                <span class="pill">3D-фрагмент MOLA · 128 px/°</span>
                <span class="pill" id="terrain-hover-readout">курсор: —</span>
              </div>
              <div class="terrain-bottom">
                <div class="scale-bar"><span id="terrain-scale-label">≈20 км</span><i></i><span>вертикальное усиление</span></div>
                <div class="compass">С</div>
              </div>
              <div class="terrain-controls">
                <label>Усиление</label>
                <input type="range" id="terrain-exag" min="1" max="16" step="1" value="6" aria-label="Вертикальное усиление локального рельефа">
                <b id="terrain-exag-val">×6</b>
                <button class="btn" type="button" id="terrain-reset">Сброс</button>
              </div>
            </div>
            <div class="profile-panel">
              <div class="measure-grid">
                <div class="measure"><span>Край W · столбец <b id="rim-left-col"></b></span><b id="rim-left">—</b></div>
                <div class="measure"><span>Край E · столбец <b id="rim-right-col"></b></span><b id="rim-right">—</b></div>
                <div class="measure"><span>Дно · столбец <b id="floor-col"></b></span><b id="floor-z">—</b></div>
                <div class="measure"><span>Средний уровень вала</span><b id="rim-mean">—</b></div>
                <div class="measure highlight"><span>Глубина d</span><b id="measure-d">—</b></div>
                <div class="measure highlight"><span>d / (1000D)</span><b id="measure-ratio">—</b></div>
              </div>
              <div class="profile-chart-wrap">
                <canvas id="profile-chart"></canvas>
              </div>
              <div class="profile-controls">
                <div class="x-toggle" id="x-toggle">
                  <button type="button" data-x="distance" class="active">расстояние, км</button>
                  <button type="button" data-x="column">столбец</button>
                </div>
                <button class="btn" type="button" id="auto-rims">Авто-края</button>
                <button class="btn" type="button" id="export-profile-png">PNG</button>
                <button class="btn" type="button" id="export-profile-csv">CSV</button>
              </div>
              <div class="measure-note" id="measure-note"></div>
            </div>
          </div>
          <div class="note accent-note" style="margin-top:16px">
            <b>Как читать профиль</b>
            <p>Расстояние считается по параллели: s = R · cos φ · Δλ. Ось высот — метры относительно ареоида; −4000 м выше, чем −5000 м. Перетаскивайте вертикальные маркеры краёв: d = (z<sub>W</sub> + z<sub>E</sub>)/2 − z<sub>min</sub>.</p>
          </div>
        </div>
      </div>`;
    this.modalRoot.appendChild(modal);
    this.currentModal = modal;
    modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
    document.addEventListener('keydown', this._keyHandler);

    const canvas = modal.querySelector('#profile-chart');
    this.chart = new Chart(canvas, {
      xLabel: 'Расстояние по поверхности, км',
      yLabel: 'Высота, м',
      xMin: 0, xMax: profile.widthKm,
      yMin: Math.floor((Math.min(...profile.heights) - 150) / 250) * 250,
      yMax: Math.ceil((Math.max(...profile.heights) + 150) / 250) * 250,
      series: [],
      onDraw: (ctx, chart) => this._drawRimOverlay(ctx, chart),
    });
    this.chart.canvas.style.height = '250px';

    this.state = {
      side, info, profile, rims, measure,
      xMode: 'distance',
      dragging: null,
      hoverCol: null,
      accent,
      maxY: this.chart.opts.yMax,
      minY: this.chart.opts.yMin,
    };
    this._refreshAll();

    const terrainCanvas = modal.querySelector('#crater3d-canvas');
    this.currentTerrain = new LocalTerrain(terrainCanvas, info, profile, measure, {
      onHover: (col) => {
        if (col == null) {
          this.state.hoverCol = null;
          this.chart.setOptions({ hoverX: null, hoverLabel: '' });
          modal.querySelector('#terrain-hover-readout').textContent = 'курсор: —';
          return;
        }
        this.state.hoverCol = col;
        const z = info.grid[profile.row * info.cols + col];
        const dist = col * profile.kmPerCol;
        modal.querySelector('#terrain-hover-readout').textContent = `столбец ${col + 1} · ${formatNumber(dist, 1)} км · ${formatMeters(z)} м`;
        this._setChartHover(col);
      }
    });

    // chart pointer interaction
    canvas.addEventListener('pointermove', (e) => this._onChartMove(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.state.dragging) return;
      this.chart.setOptions({ hoverX: null, hoverLabel: '' });
      this.currentTerrain?.setHoverCol(null);
      this.state.hoverCol = null;
      const ro = modal.querySelector('#terrain-hover-readout');
      if (ro) ro.textContent = 'курсор: —';
    });
    canvas.addEventListener('pointerdown', (e) => this._onChartDown(e));
    canvas.addEventListener('pointerup', () => { this.state.dragging = null; });
    canvas.addEventListener('pointercancel', () => { this.state.dragging = null; });

    modal.querySelector('#x-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const x of modal.querySelectorAll('#x-toggle button')) x.classList.toggle('active', x === b);
      this.state.xMode = b.dataset.x;
      this._refreshAll();
    });
    modal.querySelector('#auto-rims').addEventListener('click', () => {
      this.state.rims = { ...base.rims };
      this.state.measure = { ...base.measure };
      this._refreshAll();
      this.onToast?.('Края восстановлены по каталогу и рельефу.');
    });
    modal.querySelector('#export-profile-png').addEventListener('click', () => {
      downloadCanvas(canvas, `${info.name}-profile.png`);
      this.onToast?.('PNG профиля сохранён.');
    });
    modal.querySelector('#export-profile-csv').addEventListener('click', () => this._exportCSV());
    const exag = modal.querySelector('#terrain-exag');
    exag.addEventListener('input', () => {
      const v = Number(exag.value);
      modal.querySelector('#terrain-exag-val').textContent = `×${v}`;
      this.currentTerrain?.setExaggeration(v);
    });
    modal.querySelector('#terrain-reset').addEventListener('click', () => {
      exag.value = 6;
      modal.querySelector('#terrain-exag-val').textContent = '×6';
      this.currentTerrain?.setExaggeration(6);
    });
  }

  _refreshAll() {
    const s = this.state;
    if (!s) return;
    const { info, profile, rims, measure, xMode } = s;
    const xMin = 0;
    const xMax = xMode === 'distance' ? profile.widthKm : info.cols;
    this.chart.setOptions({
      xLabel: xMode === 'distance' ? 'Расстояние по поверхности, км' : 'Столбец сетки с запада на восток',
      xMin, xMax,
      xTickFormat: (v) => xMode === 'distance' ? formatNumber(v, 0) : String(Math.round(v)),
      series: [{
        points: Array.from(profile.heights, (h, i) => [xMode === 'distance' ? profile.distance[i] : profile.columns[i], h]),
        color: s.accent, width: 1.8, fill: true,
        fillTop: s.side === 'north' ? 'rgba(240,122,69,.22)' : 'rgba(94,224,214,.18)',
        fillBottom: 'rgba(0,0,0,0)',
      }],
      markers: [],
      points: [],
      hoverX: s.hoverCol != null ? (xMode === 'distance' ? profile.distance[s.hoverCol] : profile.columns[s.hoverCol]) : null,
      hoverLabel: s.hoverCol != null ? `${s.hoverCol + 1} · ${formatNumber(profile.distance[s.hoverCol], 2)} км · ${formatMeters(profile.heights[s.hoverCol])} м` : '',
    });
    this._updateMeasureUI();
    this.currentTerrain?.setMeasure(measure);
    this.currentTerrain?.setHoverCol(s.hoverCol);
  }

  _setChartHover(col) {
    const s = this.state;
    if (!s) return;
    s.hoverCol = clamp(col, 0, s.info.cols - 1);
    const x = s.xMode === 'distance' ? s.profile.distance[s.hoverCol] : s.profile.columns[s.hoverCol];
    this.chart.setOptions({
      hoverX: x,
      hoverLabel: `${s.hoverCol + 1} · ${formatNumber(s.profile.distance[s.hoverCol], 2)} км · ${formatMeters(s.profile.heights[s.hoverCol])} м`,
    });
    this.currentTerrain?.setHoverCol(s.hoverCol);
  }

  _onChartMove(e) {
    const s = this.state;
    if (!s) return;
    const { x } = this.chart.pixelFromEvent(e);
    const chartX = this.chart.pxToX(x);
    const col = s.xMode === 'distance'
      ? Math.round(chartX / s.profile.kmPerCol)
      : Math.round(chartX) - 1;
    if (s.dragging) {
      const c = clamp(col, 1, s.info.cols - 2);
      if (s.dragging === 'left') s.rims.left = Math.min(c, s.rims.floor - 2);
      if (s.dragging === 'right') s.rims.right = Math.max(c, s.rims.floor + 2);
      s.measure = this._recomputeMeasure();
      this._refreshAll();
      return;
    }
    if (col >= 0 && col < s.info.cols) this._setChartHover(col);
  }

  _onChartDown(e) {
    const s = this.state;
    if (!s) return;
    const { x, y } = this.chart.pixelFromEvent(e);
    const xl = this.chart.xToPx(s.xMode === 'distance' ? s.profile.distance[s.rims.left] : s.profile.columns[s.rims.left]);
    const xr = this.chart.xToPx(s.xMode === 'distance' ? s.profile.distance[s.rims.right] : s.profile.columns[s.rims.right]);
    if (Math.abs(x - xl) < 14 && y < this.chart.plotBox().y + 30) {
      s.dragging = 'left';
      this.chart.canvas.setPointerCapture?.(e.pointerId);
    } else if (Math.abs(x - xr) < 14 && y < this.chart.plotBox().y + 30) {
      s.dragging = 'right';
      this.chart.canvas.setPointerCapture?.(e.pointerId);
    }
  }

  _recomputeMeasure() {
    const s = this.state;
    const { heights, distance } = s.profile;
    const { left, right, floor } = s.rims;
    const z1 = heights[left], z2 = heights[right], zmin = heights[floor];
    const d = (z1 + z2) / 2 - zmin;
    const ratio = d / (1000 * s.info.diameter);
    return {
      ...s.measure, left, right, floor, z1, z2, zmin,
      rimMean: (z1 + z2) / 2, d, ratio,
      defined: d > 0 && left < floor && floor < right,
      x1: distance[left], x2: distance[right], xf: distance[floor],
      rimSeparationKm: distance[right] - distance[left],
    };
  }

  _drawRimOverlay(ctx, chart) {
    const s = this.state;
    if (!s) return;
    const { profile, rims, measure, xMode } = s;
    const b = chart.plotBox();
    const xTo = (idx) => chart.xToPx(xMode === 'distance' ? profile.distance[idx] : profile.columns[idx]);
    const xl = xTo(rims.left), xr = xTo(rims.right), xf = xTo(rims.floor);
    const yRim = chart.yToPx(measure.rimMean), yFloor = chart.yToPx(measure.zmin);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.38)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    for (const x of [xl, xr]) {
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke();
    }
    ctx.setLineDash([]);
    // mean rim horizontal line
    ctx.strokeStyle = 'rgba(240,122,69,.7)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(xl, yRim); ctx.lineTo(xr, yRim); ctx.stroke();
    ctx.setLineDash([]);
    // depth bracket
    const xb = (xl + xr) / 2;
    if (Number.isFinite(yRim) && Number.isFinite(yFloor)) {
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.beginPath(); ctx.moveTo(xb, yRim); ctx.lineTo(xb, yFloor); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xb - 4, yRim); ctx.lineTo(xb + 4, yRim); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xb - 4, yFloor); ctx.lineTo(xb + 4, yFloor); ctx.stroke();
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`d = ${formatInt(measure.d)} м`, xb + 7, (yRim + yFloor) / 2);
    }
    // floor point
    ctx.beginPath(); ctx.arc(xf, yFloor, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe08a'; ctx.fill();
    ctx.strokeStyle = 'rgba(5,10,16,.9)'; ctx.lineWidth = 2; ctx.stroke();
    // handles
    for (const [x, label, col] of [[xl, 'W', xl], [xr, 'E', xr]]) {
      ctx.beginPath(); ctx.arc(x, b.y + 9, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,122,69,.9)'; ctx.fill();
      ctx.strokeStyle = '#ffe3d5'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '8px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label, x, b.y + 17);
    }
    // labels
    ctx.font = '8.5px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('дно', xf, yFloor - 6);
    ctx.restore();
  }

  _updateMeasureUI() {
    const s = this.state;
    if (!s) return;
    const m = s.measure;
    const root = this.currentModal;
    root.querySelector('#rim-left').textContent = formatMeters(m.z1);
    root.querySelector('#rim-right').textContent = formatMeters(m.z2);
    root.querySelector('#floor-z').textContent = formatMeters(m.zmin);
    root.querySelector('#rim-left-col').textContent = m.left + 1;
    root.querySelector('#rim-right-col').textContent = m.right + 1;
    root.querySelector('#floor-col').textContent = m.floor + 1;
    root.querySelector('#rim-mean').textContent = formatMeters(m.rimMean);
    root.querySelector('#measure-d').textContent = m.defined ? `${formatInt(m.d)} м` : 'не определено';
    root.querySelector('#measure-ratio').textContent = m.defined ? formatNumber(m.ratio, 4) : '—';
    const note = root.querySelector('#measure-note');
    if (!m.defined) {
      note.innerHTML = '<b>Измерение не определено.</b> Края или дно неразличимы на выбранной строке. Вернитесь к авто-краям или выберите другую строку.';
    } else {
      note.innerHTML = `<b>d = (${formatMeters(m.z1)} + ${formatMeters(m.z2)}) / 2 − (${formatMeters(m.zmin)}) = ${formatInt(m.d)} м.</b> ` +
        `Диаметр по каталогу D = ${formatNumber(s.info.diameter, 2)} км; d / (1000D) = ${formatNumber(m.ratio, 4)}. ` +
        `Расстояние между выбранными краями — ${formatNumber(m.rimSeparationKm, 1)} км.`;
    }
  }

  _exportCSV() {
    const s = this.state;
    if (!s) return;
    const rows = ['column,distance_km,height_m,role'];
    for (let i = 0; i < s.profile.heights.length; i++) {
      let role = '';
      if (i === s.rims.left) role = 'rim_W';
      if (i === s.rims.right) role = 'rim_E';
      if (i === s.rims.floor) role = 'floor';
      rows.push(`${i + 1},${s.profile.distance[i].toFixed(4)},${s.profile.heights[i]},${role}`);
    }
    downloadText(rows.join('\n'), `${s.info.name}-profile.csv`, 'text/csv;charset=utf-8');
    this.onToast?.('CSV профиля сохранён.');
  }

  openCompare() {
    this.close();
    const north = this.data.craterProfiles.north;
    const south = this.data.craterProfiles.south;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Сравнение кратеров">
        <div class="modal-head">
          <div>
            <div class="eyebrow">Сравнение полушарий · один масштаб</div>
            <h2>Stokes и Horowitz</h2>
            <p>D = 62.49 км и 63.10 км · одинаковые оси X и Y · абсолютные высоты</p>
          </div>
          <button class="modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body">
          <div class="compare-grid">
            <div class="compare-chart"><h3>Stokes <span>север · 55.621° с.ш.</span></h3><canvas id="compare-north"></canvas></div>
            <div class="compare-chart"><h3>Horowitz <span>юг · 32.063° ю.ш.</span></h3><canvas id="compare-south"></canvas></div>
          </div>
          <div class="compare-table">
            <table>
              <thead><tr><th>Величина</th><th>Stokes</th><th>Horowitz</th></tr></thead>
              <tbody>
                <tr><td>Диаметр D, км</td><td>${formatNumber(this.data.craterInfo.north.diameter, 2)}</td><td>${formatNumber(this.data.craterInfo.south.diameter, 2)}</td></tr>
                <tr><td>Край W / E, м</td><td>${formatMeters(north.measure.z1)} / ${formatMeters(north.measure.z2)}</td><td>${formatMeters(south.measure.z1)} / ${formatMeters(south.measure.z2)}</td></tr>
                <tr><td>Дно, м</td><td>${formatMeters(north.measure.zmin)}</td><td>${formatMeters(south.measure.zmin)}</td></tr>
                <tr><td>Средний вал, м</td><td>${formatMeters(north.measure.rimMean)}</td><td>${formatMeters(south.measure.rimMean)}</td></tr>
                <tr><td>Глубина d, м</td><td>${formatInt(north.measure.d)}</td><td>${formatInt(south.measure.d)}</td></tr>
                <tr><td>d / (1000D)</td><td>${formatNumber(north.measure.ratio, 4)}</td><td>${formatNumber(south.measure.ratio, 4)}</td></tr>
                <tr><td>Ширина профиля, км</td><td>${formatNumber(north.profile.widthKm, 1)}</td><td>${formatNumber(south.profile.widthKm, 1)}</td></tr>
                <tr><td>Между выбранными краями, км</td><td>${formatNumber(north.measure.rimSeparationKm, 1)}</td><td>${formatNumber(south.measure.rimSeparationKm, 1)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="note compare-insight">
            <b>Что видно на одном масштабе</b>
            <p>Абсолютные высоты различаются примерно на 5.5 км: дно Stokes лежит на ${formatMeters(north.measure.zmin)} м, дно Horowitz — на ${formatMeters(south.measure.zmin)} м. При этом относительная глубина сравнима: ${formatInt(north.measure.d)} м и ${formatInt(south.measure.d)} м, d/(1000D) — ${formatNumber(north.measure.ratio, 4)} и ${formatNumber(south.measure.ratio, 4)}. Одна пара не характеризует полушария; выводы о возрасте и заполнении требуют каталога и геологической карты.</p>
          </div>
          <div class="mini-actions" style="margin-top:14px">
            <button class="btn" type="button" id="cmp-open-north">Открыть Stokes</button>
            <button class="btn" type="button" id="cmp-open-south">Открыть Horowitz</button>
          </div>
        </div>
      </div>`;
    this.modalRoot.appendChild(modal);
    this.currentModal = modal;
    this.compareCharts = [];
    modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
    document.addEventListener('keydown', this._keyHandler);
    const yMin = -6500, yMax = 2500, xMax = 90;
    const make = (id, side, sideData, color) => {
      const canvas = modal.querySelector(id);
      canvas.style.height = '300px';
      const prof = sideData.profile;
      const measure = sideData.measure;
      const chart = new Chart(canvas, {
        xLabel: 'Расстояние по поверхности, км',
        yLabel: 'Высота, м',
        xMin: 0, xMax, yMin, yMax,
        yTickFormat: (v) => v === 0 ? '0' : `${formatNumber(v / 1000, 1)} тыс.`,
        series: [{
          points: Array.from(prof.heights, (h, i) => [prof.distance[i], h]),
          color, width: 1.8, fill: true,
          fillTop: side === 'north' ? 'rgba(240,122,69,.2)' : 'rgba(94,224,214,.17)',
          fillBottom: 'rgba(0,0,0,0)',
        }],
        markers: [
          { y: measure.rimMean, color: 'rgba(255,255,255,.35)', dash: [4, 4], label: 'вал' },
          { y: measure.zmin, color: 'rgba(255,255,255,.25)', dash: [2, 4], label: 'дно' },
        ],
        points: [
          { x: measure.x1, y: measure.z1, color: '#ff8a5c', r: 3 },
          { x: measure.x2, y: measure.z2, color: '#ffb083', r: 3 },
          { x: measure.xf, y: measure.zmin, color: '#ffe08a', r: 3 },
        ],
      });
      requestAnimationFrame(() => chart.resize());
      setTimeout(() => chart.resize(), 90);
      this.compareCharts.push(chart);
      return chart;
    };
    make('#compare-north', 'north', north, '#f07a45');
    make('#compare-south', 'south', south, '#5ee0d6');
    modal.querySelector('#cmp-open-north').addEventListener('click', () => this.open('north'));
    modal.querySelector('#cmp-open-south').addEventListener('click', () => this.open('south'));
  }

  close() {
    if (this.currentTerrain) { this.currentTerrain.destroy(); this.currentTerrain = null; }
    if (this.currentModal) {
      this.currentModal.remove();
      this.currentModal = null;
    }
    this.chart?.destroy?.();
    this.chart = null;
    for (const chart of this.compareCharts || []) chart.destroy?.();
    this.compareCharts = [];
    this.state = null;
    document.removeEventListener('keydown', this._keyHandler);
  }
}
