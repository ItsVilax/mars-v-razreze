import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  R_MARS_M, clamp, lerp, rad, deg,
  HEIGHT_LUT, heightLutIndex, densityColorAt, buildWaterTexture,
  latLonToVec3, vec3ToLatLon, bilerpGrid, isMobileLayout
} from './utils.js';

const TEX_W = 2880;
const TEX_H = 1440;
const MASK_W = 1440;
const MASK_H = 720;

function replaceSphereUV(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lat = Math.asin(clamp(y, -1, 1));
    const lon = Math.atan2(z, x);
    uv.setXY(i, ((lon + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2), 0.5 - lat / Math.PI);
  }
  uv.needsUpdate = true;
}

function makeColorTexture(globe8, lowRes = false) {
  const w = lowRes ? TEX_W / 2 : TEX_W;
  const h = lowRes ? TEX_H / 2 : TEX_H;
  const step = lowRes ? 2 : 1;
  const data = new Uint8Array(w * h * 4);
  let k = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const z = globe8[(r * step) * TEX_W + c * step];
      const ci = heightLutIndex(z) * 3;
      data[k] = HEIGHT_LUT[ci];
      data[k + 1] = HEIGHT_LUT[ci + 1];
      data[k + 2] = HEIGHT_LUT[ci + 2];
      data[k + 3] = 255;
      k += 4;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function makeDensityTexture(grid, max, baseGrid, step = 5) {
  // 2 px/° display overlay: the 5° density grid is smooth already, and the
  // relief below is subdued, so half resolution is visually identical while
  // being four times cheaper to build than the old 4 px/° texture.
  const W = 720, H = 360;
  const data = new Uint8Array(W * H * 4);
  const binCols = Math.round(360 / step);
  const binRows = Math.round(180 / step);
  const densityRgb = new Uint8Array(3);
  let k = 0;
  for (let r = 0; r < H; r++) {
    const lat = 90 - (r + 0.5) * (180 / H);
    const gy = (90 - lat) / step - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const ry0 = clamp(y0, 0, binRows - 1);
    const ry1 = clamp(y0 + 1, 0, binRows - 1);
    for (let c = 0; c < W; c++) {
      const lon = (c + 0.5) * (360 / W);
      const gx = lon / step - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const cx0 = ((x0 % binCols) + binCols) % binCols;
      const cx1 = (cx0 + 1) % binCols;
      const d00 = grid[ry0 * binCols + cx0];
      const d10 = grid[ry0 * binCols + cx1];
      const d01 = grid[ry1 * binCols + cx0];
      const d11 = grid[ry1 * binCols + cx1];
      const d = (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
      const z = baseGrid[(r * 4) * 2880 + c * 4];
      const hi = heightLutIndex(z) * 3;
      const hr = HEIGHT_LUT[hi], hg = HEIGHT_LUT[hi + 1], hb = HEIGHT_LUT[hi + 2];
      if (d > 0) {
        densityColorAt(Math.sqrt(clamp(d / (max || 1), 0, 1)), densityRgb, 0);
        const a = 0.70;
        data[k] = Math.round(hr * (1 - a) + densityRgb[0] * a);
        data[k + 1] = Math.round(hg * (1 - a) + densityRgb[1] * a);
        data[k + 2] = Math.round(hb * (1 - a) + densityRgb[2] * a);
      } else {
        data[k] = Math.round(hr * 0.40);
        data[k + 1] = Math.round(hg * 0.40);
        data[k + 2] = Math.round(hb * 0.40);
      }
      data[k + 3] = 255;
      k += 4;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export class MarsGlobe {
  constructor({ canvas, labelsEl, data, onHover, onMarker, onPick, onStatus }) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.data = data;
    this.onHover = onHover;
    this.onMarker = onMarker;
    this.onPick = onPick;
    this.onStatus = onStatus;
    this.exaggeration = 20;
    this.densityMode = false;
    this.autoRotate = true;
    this.waterUserVisible = true;
    this.waterLevel = null;
    this.waterMask = null;
    this.markers = [];
    this.flight = null;
    this.pointerDown = null;
    this.lastHover = 0;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.isMobile = isMobileLayout();
    this.screenActive = true;
    this.pageVisible = !document.hidden;
    this.overlayOpen = false;
    this._raf = 0;
    this._normalsTimer = 0;
    this._labelRect = { width: 1, height: 1 };

    this._initScene();
    this._buildGlobe();
    this._buildWater();
    this._buildMarkers();
    this._buildShoreLines();
    this._buildCraters();
    this._buildGraticule();
    this._buildStars();
    this._updateMarkerPositions();
    this._bindEvents();
    this._resize();
    this._last = performance.now();
    this._animate = this._animate.bind(this);
    document.addEventListener('visibilitychange', () => this.setPageVisible(!document.hidden));
    this._syncLoop();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.camera.position.set(2.15, 0.95, 2.3);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x03060b, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.14;
    this.controls.maxDistance = 7.2;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.85;
    this.autoRotate = !this.isMobile;
    this.controls.autoRotate = this.autoRotate;
    this.controls.autoRotateSpeed = 0.28;

    const amb = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff1e2, 2.0);
    sun.position.set(5.2, 2.6, 4.8);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6a9de0, 0.42);
    fill.position.set(-4.5, -1.4, -3.5);
    this.scene.add(fill);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._pickPoint = new THREE.Vector3();
    this._pickPoint2 = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._labelVec = new THREE.Vector3();
    this._worldVec = new THREE.Vector3();
  }

  _buildGlobe() {
    const geo = new THREE.SphereGeometry(1, this.isMobile ? 480 : 720, this.isMobile ? 240 : 360);
    replaceSphereUV(geo);
    const pos = geo.attributes.position;
    const count = pos.count;
    this.baseDirs = new Float32Array(pos.array.length);
    this.baseDirs.set(pos.array);
    const heights = new Float32Array(count);
    const data = this.data;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const { lat, lon } = vec3ToLatLon(x, y, z);
      // Geometry is a 4 px/° display reduction of the original MOLA16 grid.
      heights[i] = bilerpGrid(data.globe4, 720, 1440, lat, lon);
    }
    this.baseHeights = heights;
    this.geometry = geo;
    this._applyHeight(this.exaggeration, true);

    this.colorTexture = makeColorTexture(data.globe8, this.isMobile);
    this.densityTexture = null;
    this.baseMaterial = new THREE.MeshLambertMaterial({
      map: this.colorTexture,
      color: 0xffffff,
    });
    this.densityMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.material = this.baseMaterial;
    this.globeMesh = new THREE.Mesh(geo, this.baseMaterial);
    this.scene.add(this.globeMesh);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.065, 72, 36),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vN;
          void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vN;
          void main(){ float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0, 0.0, 1.0))), 3.2);
          gl_FragColor = vec4(0.24, 0.52, 1.0, 1.0) * i * 0.9; }`,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(atmo);
  }

  _applyHeight(exag, immediateNormals = false) {
    const pos = this.geometry.attributes.position;
    const arr = pos.array;
    const dirs = this.baseDirs;
    const heights = this.baseHeights;
    for (let i = 0, j = 0; i < heights.length; i++, j += 3) {
      const r = 1 + (heights[i] / R_MARS_M) * exag;
      arr[j] = dirs[j] * r;
      arr[j + 1] = dirs[j + 1] * r;
      arr[j + 2] = dirs[j + 2] * r;
    }
    pos.needsUpdate = true;
    if (immediateNormals) {
      this.geometry.computeVertexNormals();
      this.geometry.computeBoundingSphere();
    } else {
      this._scheduleNormals();
    }
  }

  _scheduleNormals() {
    if (this._normalsTimer) return;
    this._normalsTimer = setTimeout(() => {
      this._normalsTimer = 0;
      this.geometry.computeVertexNormals();
      this.geometry.computeBoundingSphere();
    }, 120);
  }

  _buildWater() {
    // The water mask is a 4 px/° texture; a much coarser sphere is enough for
    // the smooth surface and saves a lot of vertex/fill work.
    const geo = new THREE.SphereGeometry(1, this.isMobile ? 240 : 360, this.isMobile ? 120 : 180);
    replaceSphereUV(geo);
    this.waterTexture = new THREE.DataTexture(
      new Uint8Array(MASK_W * MASK_H * 4), MASK_W, MASK_H, THREE.RGBAFormat, THREE.UnsignedByteType
    );
    this.waterTexture.wrapS = THREE.RepeatWrapping;
    this.waterTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.waterTexture.minFilter = THREE.LinearFilter;
    this.waterTexture.magFilter = THREE.LinearFilter;
    this.waterTexture.needsUpdate = true;

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.waterTexture },
        uOpacity: { value: 0.88 },
      },
      vertexShader: `varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D uMask;
        uniform float uOpacity;
        varying vec2 vUv;
        void main(){
          vec4 m = texture2D(uMask, vUv);
          if (m.a < 0.5) discard;
          float depth = m.g;
          vec3 shallow = vec3(0.24, 0.68, 0.84);
          vec3 deep = vec3(0.008, 0.055, 0.25);
          vec3 col = mix(shallow, deep, pow(depth, 0.62));
          if (m.b > 0.5) col = mix(col, vec3(0.72, 0.98, 1.0), 0.9);
          gl_FragColor = vec4(col, uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.waterMesh = new THREE.Mesh(geo, this.waterMaterial);
    this.waterMesh.visible = false;
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);
  }

  _surfaceRadius(lat, lon, extra = 0) {
    const z = bilerpGrid(this.data.globe4, 720, 1440, lat, lon);
    return 1 + (z / R_MARS_M) * this.exaggeration + extra;
  }

  _markerDefinition() {
    return [
      { id: 'stokes', label: 'Stokes', lat: 55.621, lon: 171.287, color: 0xffa36b, cls: 'north primary' },
      { id: 'horowitz', label: 'Horowitz', lat: -32.063, lon: 140.760, color: 0x6fd8e8, cls: 'south primary' },
      { id: 'utopia', label: 'Утопия · старт', lat: 45, lon: 115, color: 0x79e2a5, cls: 'utopia' },
      { id: 'hellas', label: 'Эллада', lat: -42, lon: 70, color: 0x6bb8ff, cls: 'hellas' },
      { id: 'shoreA', label: 'Берег A', lat: 47.616, lon: 21.838, color: 0xf0d36a, cls: 'shore' },
      { id: 'shoreB', label: 'Берег B', lat: 24.207, lon: 94.094, color: 0xf0d36a, cls: 'shore' },
    ];
  }

  _buildMarkers() {
    this.markerLayer = new THREE.Group();
    this.scene.add(this.markerLayer);
    this.markerHitMeshes = [];
    this._up = new THREE.Vector3(0, 0, 1);
    const defs = this._markerDefinition();
    for (const def of defs) {
      const group = new THREE.Group();
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.0105, 16, 12),
        new THREE.MeshBasicMaterial({ color: def.color })
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.016, 0.023, 36),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
      );
      group.add(dot, ring);
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
      );
      hit.userData.markerId = def.id;
      group.add(hit);
      this.markerHitMeshes.push(hit);
      this.markerLayer.add(group);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = `globe-label ${def.cls}`;
      el.style.left = '0';
      el.style.top = '0';
      el.innerHTML = `<i></i><span>${def.label}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onMarker?.(def.id); });
      this.labelsEl.appendChild(el);

      const dir = latLonToVec3(def.lat, def.lon, 1);
      const dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]);
      group.quaternion.setFromUnitVectors(this._up, dirVec);
      this.markers.push({
        ...def, group, dot, ring, hit, el, visible: true, contextVisible: true,
        dir, dirVec, surfaceZ: bilerpGrid(this.data.globe4, 720, 1440, def.lat, def.lon),
      });
    }
    this._updateMarkerPositions();
  }

  _buildShoreLines() {
    const defs = [
      { key: 'A', color: 0xffc45e },
      { key: 'B', color: 0x6fe7ff },
    ];
    this.shoreLines = [];
    for (const def of defs) {
      const pts = this.data.shore[def.key].points;
      const n = pts.length;
      const dirs = new Float32Array(n * 3);
      const surfaceZ = new Float32Array(n);
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const d = latLonToVec3(p.lat, p.lon, 1);
        dirs[i * 3] = d[0]; dirs[i * 3 + 1] = d[1]; dirs[i * 3 + 2] = d[2];
        surfaceZ[i] = bilerpGrid(this.data.globe4, 720, 1440, p.lat, p.lon);
        const r = 1 + (surfaceZ[i] / R_MARS_M) * this.exaggeration + 0.0045;
        positions[i * 3] = d[0] * r; positions[i * 3 + 1] = d[1] * r; positions[i * 3 + 2] = d[2] * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: def.color, transparent: true, opacity: 0.95, depthWrite: false,
      }));
      line.renderOrder = 1;
      this.scene.add(line);
      this.shoreLines.push({ line, points: pts, dirs, surfaceZ });
    }
  }

  _updateMarkerPositions() {
    for (const m of this.markers) {
      const r = 1 + (m.surfaceZ / R_MARS_M) * this.exaggeration + 0.007;
      m.group.position.set(m.dir[0] * r, m.dir[1] * r, m.dir[2] * r);
    }
    this.markerLayer?.updateMatrixWorld(true);
    if (this.shoreLines) {
      for (const entry of this.shoreLines) {
        const arr = entry.line.geometry.attributes.position.array;
        const dirs = entry.dirs;
        const z = entry.surfaceZ;
        for (let i = 0, j = 0; i < z.length; i++, j += 3) {
          const r = 1 + (z[i] / R_MARS_M) * this.exaggeration + 0.0045;
          arr[j] = dirs[j] * r;
          arr[j + 1] = dirs[j + 1] * r;
          arr[j + 2] = dirs[j + 2] * r;
        }
        entry.line.geometry.attributes.position.needsUpdate = true;
        entry.line.geometry.computeBoundingSphere();
      }
    }
    if (this.craterPoints) this._updateCraterPoints();
    this._updateWaterRadius();
  }

  _updateCraterPoints() {
    const pos = this.craterPoints.geometry.attributes.position;
    const arr = pos.array;
    const dirs = this.craterDirs;
    const z = this.craterBaseZ;
    for (let i = 0, j = 0; i < z.length; i++, j += 3) {
      const r = 1.006 + (z[i] / R_MARS_M) * this.exaggeration;
      arr[j] = dirs[j] * r;
      arr[j + 1] = dirs[j + 1] * r;
      arr[j + 2] = dirs[j + 2] * r;
    }
    pos.needsUpdate = true;
    this.craterPoints.geometry.computeBoundingSphere();
  }

  _buildCraters() {
    const craters = this.data.craters;
    const n = craters.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.craterDirs = new Float32Array(n * 3);
    this.craterBaseZ = new Float32Array(n);
    const cN = new THREE.Color(0xffa36b);
    const cS = new THREE.Color(0x6fd8e8);
    this.craterMeta = craters;
    for (let i = 0; i < n; i++) {
      const c = craters[i];
      const [x, y, z] = latLonToVec3(c.lat, c.lon, 1);
      this.craterDirs[i * 3] = x;
      this.craterDirs[i * 3 + 1] = y;
      this.craterDirs[i * 3 + 2] = z;
      this.craterBaseZ[i] = bilerpGrid(this.data.globe4, 720, 1440, c.lat, c.lon);
      const r = 1.006;
      pos[i * 3] = x * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = z * r;
      const color = c.lat >= 0 ? cN : cS;
      col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.0065, vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    });
    this.craterPoints = new THREE.Points(geo, mat);
    this.craterPoints.visible = false;
    this.scene.add(this.craterPoints);
  }

  _buildGraticule() {
    const positions = [];
    const radius = 1.003;
    const push = (lat1, lon1, lat2, lon2) => {
      positions.push(...latLonToVec3(lat1, lon1, radius));
      positions.push(...latLonToVec3(lat2, lon2, radius));
    };
    for (let lon = 0; lon < 360; lon += 30) {
      for (let lat = -88; lat < 88; lat += 4) push(lat, lon, Math.min(88, lat + 4), lon);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = 0; lon < 360; lon += 4) push(lat, lon, lat, Math.min(360, lon + 4));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x7fa2c8, transparent: true, opacity: 0.15, depthWrite: false });
    this.graticule = new THREE.LineSegments(geo, mat);
    this.scene.add(this.graticule);
  }

  _buildStars() {
    const n = this.isMobile ? 900 : 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 28 + Math.random() * 50;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xa9c2df, size: 0.055, transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  _bindEvents() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
      this.controls.autoRotate = false;
    });
    canvas.addEventListener('pointerup', (e) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const hit = this._pick(e.clientX, e.clientY);
      if (!hit) return;
      if (hit.marker) this.onMarker?.(hit.marker);
      else this.onPick?.(hit);
    });
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - this.lastHover < 28) return;
      this.lastHover = now;
      const hit = this._pick(e.clientX, e.clientY);
      if (hit?.marker) {
        canvas.style.cursor = 'pointer';
        this.onHover?.(null);
        return;
      }
      canvas.style.cursor = 'grab';
      if (hit) this.onHover?.(hit);
      else this.onHover?.(null);
    });
    canvas.addEventListener('pointerleave', () => this.onHover?.(null));
    canvas.addEventListener('pointerdown', () => { canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointerup', () => { canvas.style.cursor = 'grab'; });

    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.flight = null;
      this.onStatus?.('manual');
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this._resize());
      this.resizeObserver.observe(canvas.parentElement || canvas);
    }
    window.addEventListener('resize', () => this._resize());
  }

  _pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Marker hit-spheres only; the globe itself is intersected analytically.
    const markerHits = this.raycaster.intersectObjects(this.markerHitMeshes, false);
    if (markerHits.length) return { marker: markerHits[0].object.userData.markerId };

    const ray = this.raycaster.ray;
    const maxR = 1 + (21000 / R_MARS_M) * this.exaggeration + 0.01;
    const p = this._intersectSphere(ray, maxR, this._pickPoint);
    if (!p) return null;
    let { lat, lon } = vec3ToLatLon(p.x, p.y, p.z);
    // Three fixed-point refinements land on the displaced surface; near the
    // limb the residual is still sub-pixel.
    for (let i = 0; i < 3; i++) {
      const r = this._surfaceRadius(lat, lon);
      const q = this._intersectSphere(ray, r, this._pickPoint2);
      if (!q) return null;
      const ll = vec3ToLatLon(q.x, q.y, q.z);
      lat = ll.lat; lon = ll.lon;
    }
    const z = bilerpGrid(this.data.mola4, 720, 1440, lat, lon);
    return { lat, lon, z };
  }

  _intersectSphere(ray, radius, out) {
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
    const b = ox * dx + oy * dy + oz * dz;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    out.set(ox + dx * t, oy + dy * t, oz + dz * t);
    return out;
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this._labelRect.width = w;
    this._labelRect.height = h;
  }

  _syncLoop() {
    const shouldRun = this.screenActive && this.pageVisible && !this.overlayOpen;
    if (shouldRun && !this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._animate);
    } else if (!shouldRun && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  setScreenActive(on) {
    this.screenActive = !!on;
    this._syncLoop();
  }

  setPageVisible(on) {
    this.pageVisible = !!on;
    this._syncLoop();
  }

  setOverlayOpen(on) {
    this.overlayOpen = !!on;
    if (on && this.flight) this._finishFlight();
    this._syncLoop();
  }

  _finishFlight() {
    const f = this.flight;
    if (!f) return;
    this.camera.position.copy(f.targetDir).multiplyScalar(f.targetDist);
    this.camera.lookAt(0, 0, 0);
    this.flight = null;
    this.controls.enabled = true;
  }

  setLabelContext(tab) {
    if (!this.isMobile) {
      for (const m of this.markers) m.contextVisible = true;
      return;
    }
    const map = {
      globe: new Set(['stokes', 'horowitz', 'utopia', 'hellas']),
      ocean: new Set(['utopia', 'hellas']),
      shore: new Set(['shoreA', 'shoreB']),
    };
    const allowed = map[tab] || null;
    for (const m of this.markers) {
      m.contextVisible = !allowed || allowed.has(m.id);
    }
  }

  _animate(now) {
    if (!this.screenActive || !this.pageVisible || this.overlayOpen) {
      this._raf = 0;
      return;
    }
    this._raf = requestAnimationFrame(this._animate);
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    if (this.flight) {
      const f = this.flight;
      const t = clamp((now - f.start) / f.duration, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const q = new THREE.Quaternion().setFromUnitVectors(f.startDir, f.targetDir);
      const rot = new THREE.Quaternion().slerp(q, e);
      const dir = f.startDir.clone().applyQuaternion(rot);
      const dist = lerp(f.startDist, f.targetDist, e);
      this.camera.position.copy(dir.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      if (t >= 1) { this.flight = null; this.controls.enabled = true; }
    } else {
      this.controls.update();
    }
    this._updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  _updateLabels() {
    const rect = this._labelRect;
    const cam = this._camDir.copy(this.camera.position).normalize();
    const v = this._labelVec;
    const world = this._worldVec;
    for (const m of this.markers) {
      v.copy(m.group.position).project(this.camera);
      world.copy(m.group.position).normalize();
      const front = world.dot(cam) > 0.02;
      const inView = v.z < 1 && v.x > -1.08 && v.x < 1.08 && v.y > -1.08 && v.y < 1.08;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      // Do not let a label slide under the stage buttons / coordinates HUD.
      const safe = !(sy < 72 && sx > rect.width - 185) && !(sy < 92 && sx < 225);
      const visible = front && inView && safe && m.contextVisible !== false;
      m.el.classList.toggle('visible', visible);
      if (visible) {
        m.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%)`;
      }
    }
  }

  flyTo(lat, lon, distance = 2.35, duration = 950) {
    const targetDir = new THREE.Vector3(...latLonToVec3(lat, lon, 1)).normalize();
    const startDir = this.camera.position.clone().normalize();
    this.flight = {
      start: performance.now(), duration: this.reducedMotion ? 1 : duration,
      startDir, targetDir, startDist: this.camera.position.length(), targetDist: distance,
    };
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    this.controls.autoRotate = on;
    this.flight = null;
  }

  setExaggeration(value) {
    this.exaggeration = value;
    this._applyHeight(value);
    this._updateMarkerPositions();
  }

  setWaterMask(mask, level, texture = null) {
    if (!mask || mask.length !== MASK_W * MASK_H) return;
    this.waterMask = mask;
    this.waterLevel = level;
    const image = this.waterTexture.image;
    if (texture && texture.length === MASK_W * MASK_H * 4) {
      image.data = texture;
    } else {
      image.data = buildWaterTexture(mask, this.data.mola4, level, MASK_W, MASK_H);
    }
    this.waterTexture.needsUpdate = true;
    this._updateWaterRadius();
    this.waterMesh.visible = this.waterUserVisible && !this.densityMode;
  }

  _updateWaterRadius() {
    if (!this.waterMesh) return;
    if (this.waterLevel == null) { this.waterMesh.visible = false; return; }
    const r = 1 + (this.waterLevel / R_MARS_M) * this.exaggeration + 0.0007;
    this.waterMesh.scale.setScalar(r);
  }

  clearWater() {
    this.waterLevel = null;
    this.waterMask = null;
    this.waterMesh.visible = false;
  }

  setWaterVisible(visible) {
    this.waterUserVisible = visible;
    this.waterMesh.visible = visible && this.waterLevel != null && !this.densityMode;
  }

  setDensityData(grid, max, step = 5) {
    if (this.densityTexture) this.densityTexture.dispose();
    this.densityTexture = makeDensityTexture(grid, max, this.data.globe8, step);
    this.densityMaterial.map = this.densityTexture;
    this.densityMaterial.needsUpdate = true;
    if (this.densityMode) {
      this.globeMesh.material = this.densityMaterial;
    }
  }

  setDensityMode(on) {
    this.densityMode = on;
    this.globeMesh.material = on ? this.densityMaterial : this.baseMaterial;
    this.material = this.globeMesh.material;
    this.waterMesh.visible = !on && this.waterUserVisible && this.waterLevel != null;
  }

  setPointsVisible(on) { this.craterPoints.visible = on; }
  setGraticuleVisible(on) { this.graticule.visible = on; }

  focusMarker(id) {
    const m = this.markers.find((x) => x.id === id);
    if (m) this.flyTo(m.lat, m.lon, id === 'stokes' || id === 'horowitz' ? 1.85 : 2.35);
  }

  getCursorElevation(lat, lon) {
    return bilerpGrid(this.data.mola4, 720, 1440, lat, lon);
  }
}

