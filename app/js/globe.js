import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  R_MARS_M, clamp, lerp, rad, deg, heightColor, densityColor,
  latLonToVec3, vec3ToLatLon, bilerpGrid
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

function makeColorTexture(globe8) {
  const data = new Uint8Array(TEX_W * TEX_H * 4);
  let k = 0;
  for (let r = 0; r < TEX_H; r++) {
    for (let c = 0; c < TEX_W; c++) {
      const z = globe8[r * TEX_W + c];
      const [rr, gg, bb] = heightColor(z);
      data[k++] = rr; data[k++] = gg; data[k++] = bb; data[k++] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat, THREE.UnsignedByteType);
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
  // 4 px/° output: density colour where craters exist, subdued relief elsewhere.
  const W = 1440, H = 720;
  const data = new Uint8Array(W * H * 4);
  const binCols = Math.round(360 / step);
  const binRows = Math.round(180 / step);
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
      const z = baseGrid[(r * 2) * 2880 + c * 2];
      const [hr, hg, hb] = heightColor(z);
      let rr, gg, bb;
      if (d > 0) {
        const [dr, dg, db] = densityColor(Math.sqrt(clamp(d / (max || 1), 0, 1)));
        const a = 0.70;
        rr = Math.round(hr * (1 - a) + dr * a);
        gg = Math.round(hg * (1 - a) + dg * a);
        bb = Math.round(hb * (1 - a) + db * a);
      } else {
        rr = Math.round(hr * 0.40);
        gg = Math.round(hg * 0.40);
        bb = Math.round(hb * 0.40);
      }
      data[k++] = rr; data[k++] = gg; data[k++] = bb; data[k++] = 255;
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
    requestAnimationFrame(this._animate);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.camera.position.set(2.15, 0.95, 2.3);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    this.controls.autoRotate = true;
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
  }

  _buildGlobe() {
    const geo = new THREE.SphereGeometry(1, 720, 360);
    replaceSphereUV(geo);
    const pos = geo.attributes.position;
    const count = pos.count;
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
    this._applyHeight(this.exaggeration);

    this.colorTexture = makeColorTexture(data.globe8);
    this.densityTexture = makeDensityTexture(new Float64Array(72 * 36), 1, data.globe8, 5);
    this.baseMaterial = new THREE.MeshStandardMaterial({
      map: this.colorTexture,
      roughness: 0.97,
      metalness: 0.0,
      color: 0xffffff,
    });
    this.densityMaterial = new THREE.MeshBasicMaterial({ map: this.densityTexture });
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

    this.pickables = [this.globeMesh];
  }

  _applyHeight(exag) {
    const pos = this.geometry.attributes.position;
    const heights = this.baseHeights;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const r = 1 + (heights[i] / R_MARS_M) * exag;
      pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  _buildWater() {
    const geo = new THREE.SphereGeometry(1, 720, 360);
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
        uTexel: { value: new THREE.Vector2(1 / MASK_W, 1 / MASK_H) },
        uOpacity: { value: 0.88 },
      },
      vertexShader: `varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D uMask;
        uniform vec2 uTexel;
        uniform float uOpacity;
        varying vec2 vUv;
        void main(){
          vec4 m = texture2D(uMask, vUv);
          if (m.a < 0.5) discard;
          float edge = 0.0;
          edge += 1.0 - texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).a;
          edge += 1.0 - texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).a;
          edge += 1.0 - texture2D(uMask, vUv + vec2(0.0, uTexel.y)).a;
          edge += 1.0 - texture2D(uMask, vUv - vec2(0.0, uTexel.y)).a;
          float depth = m.g;
          vec3 shallow = vec3(0.24, 0.68, 0.84);
          vec3 deep = vec3(0.008, 0.055, 0.25);
          vec3 col = mix(shallow, deep, pow(depth, 0.62));
          if (edge > 0.05) col = mix(col, vec3(0.72, 0.98, 1.0), 0.9);
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
      el.innerHTML = `<i></i><span>${def.label}</span>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onMarker?.(def.id); });
      this.labelsEl.appendChild(el);

      this.markers.push({ ...def, group, dot, ring, hit, el, visible: true });
    }
    this._updateMarkerPositions();
    this.pickables.push(...this.markerHitMeshes);
  }

  _buildShoreLines() {
    const defs = [
      { key: 'A', color: 0xffc45e },
      { key: 'B', color: 0x6fe7ff },
    ];
    this.shoreLines = [];
    for (const def of defs) {
      const pts = this.data.shore[def.key].points;
      const positions = [];
      for (const p of pts) {
        const r = this._surfaceRadius(p.lat, p.lon, 0.0045);
        positions.push(...latLonToVec3(p.lat, p.lon, r));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: def.color, transparent: true, opacity: 0.95, depthWrite: false,
      }));
      line.renderOrder = 1;
      this.scene.add(line);
      this.shoreLines.push({ line, points: pts });
    }
  }

  _updateMarkerPositions() {
    for (const m of this.markers) {
      const radius = this._surfaceRadius(m.lat, m.lon, 0.007);
      const [x, y, z] = latLonToVec3(m.lat, m.lon, radius);
      m.group.position.set(x, y, z);
      const dir = new THREE.Vector3(x, y, z).normalize();
      m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    }
    if (this.shoreLines) {
      for (const entry of this.shoreLines) {
        const pos = entry.line.geometry.attributes.position;
        for (let i = 0; i < entry.points.length; i++) {
          const p = entry.points[i];
          const r = this._surfaceRadius(p.lat, p.lon, 0.0045);
          const [x, y, z] = latLonToVec3(p.lat, p.lon, r);
          pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
        entry.line.geometry.computeBoundingSphere();
      }
    }
    if (this.craterPoints) {
      const pos = this.craterPoints.geometry.attributes.position;
      for (let i = 0; i < this.craterMeta.length; i++) {
        const c = this.craterMeta[i];
        const r = 1.006 + (bilerpGrid(this.data.globe4, 720, 1440, c.lat, c.lon) / R_MARS_M) * this.exaggeration;
        const [x, y, z] = latLonToVec3(c.lat, c.lon, r);
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
    this._updateWaterRadius();
  }

  _buildCraters() {
    const craters = this.data.craters;
    const n = craters.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const cN = new THREE.Color(0xffa36b);
    const cS = new THREE.Color(0x6fd8e8);
    this.craterMeta = craters;
    for (let i = 0; i < n; i++) {
      const c = craters[i];
      const [x, y, z] = latLonToVec3(c.lat, c.lon, 1.006);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
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
    const n = 1800;
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
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of hits) {
      if (hit.object.userData.markerId) return { marker: hit.object.userData.markerId };
    }
    const globeHit = hits.find((h) => h.object === this.globeMesh);
    if (!globeHit) return null;
    const p = globeHit.point;
    const { lat, lon } = vec3ToLatLon(p.x, p.y, p.z);
    const z = bilerpGrid(this.data.mola4, 720, 1440, lat, lon);
    return { lat, lon, z };
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _animate(now) {
    requestAnimationFrame(this._animate);
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
    const rect = this.canvas.getBoundingClientRect();
    const cam = this.camera.position.clone().normalize();
    const v = new THREE.Vector3();
    for (const m of this.markers) {
      v.copy(m.group.position).project(this.camera);
      const world = m.group.position.clone().normalize();
      const front = world.dot(cam) > 0.02;
      const inView = v.z < 1 && v.x > -1.08 && v.x < 1.08 && v.y > -1.08 && v.y < 1.08;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      // Do not let a label slide under the stage buttons / coordinates HUD.
      const safe = !(sy < 72 && sx > rect.width - 185) && !(sy < 92 && sx < 225);
      const visible = front && inView && safe;
      m.el.classList.toggle('visible', visible);
      if (visible) {
        m.el.style.left = `${sx}px`;
        m.el.style.top = `${sy}px`;
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

  setWaterMask(mask, level) {
    this.waterMask = mask;
    this.waterLevel = level;
    const image = this.waterTexture.image;
    if (!image.data || image.data.length !== MASK_W * MASK_H * 4) {
      image.data = new Uint8Array(MASK_W * MASK_H * 4);
    }
    const out = image.data;
    const z = this.data.mola4;
    for (let i = 0; i < MASK_W * MASK_H; i++) {
      if (mask[i]) {
        const depth = clamp((level - z[i]) / 6000, 0, 1);
        out[i * 4] = 255;
        out[i * 4 + 1] = Math.round(depth * 255);
        out[i * 4 + 2] = 255;
        out[i * 4 + 3] = 255;
      } else {
        out[i * 4] = 0; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; out[i * 4 + 3] = 0;
      }
    }
    this.waterTexture.needsUpdate = true;
    this._updateWaterRadius();
    this.waterMesh.visible = this.waterUserVisible && !this.densityMode;
    this._updateMarkerPositions();
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

