import { loadAtlasData } from './data.js';
import { MarsGlobe } from './globe.js';
import { CraterLab } from './crater.js';
import { CatalogModule } from './catalog.js';
import { OceanModule } from './ocean.js';
import { ShoreModule } from './shore.js';
import { MobileUI } from './mobile.js';
import {
  formatInt, formatNumber, formatMeters, fmtLat, fmtLon, rafThrottle, esc, isMobileLayout
} from './utils.js';

const $ = (id) => document.getElementById(id);
try { performance.mark?.('mars-boot-start'); } catch { /* ignored */ }
const state = {
  data: null,
  globe: null,
  craterLab: null,
  catalog: null,
  ocean: null,
  shore: null,
  tab: 'globe',
  defense: null,
  defenseClose: null,
  toastTimer: 0,
  booted: false,
};

function setBoot(pct, status, detail = '') {
  const bar = $('boot-bar');
  if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
  if ($('boot-status') && status) $('boot-status').textContent = status;
  if ($('boot-detail')) $('boot-detail').textContent = detail;
}

function showBootError(err) {
  const e = $('boot-error');
  if (e) e.hidden = false;
  const t = $('boot-error-text');
  if (t) t.textContent = String(err?.message || err || 'Неизвестная ошибка');
  if ($('boot-status')) $('boot-status').textContent = 'Загрузка остановлена';
  if ($('boot-bar')) $('boot-bar').style.width = '100%';
}

function toast(message, duration = 2600) {
  const el = $('toast');
  if (!el) return;
  clearTimeout(state.toastTimer);
  el.textContent = message;
  el.classList.add('show');
  state.toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function setStageCaption(extra = '') {
  const globe = state.globe;
  if (!globe) return;
  const base = `MOLA 16 px/° · отображение 4 px/° · вертикальное усиление ×${globe.exaggeration}`;
  const text = extra || base;
  const el = $('stage-caption-text');
  if (el) el.textContent = text;
}

function setTab(name) {
  if (!name) return;
  if (document.activeElement?.closest?.('#tabs')) document.activeElement.blur();
  state.tab = name;
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('[data-panel]').forEach((p) => {
    p.classList.toggle('active', p.dataset.panel === name);
  });
  const scroll = $('sidebar-scroll');
  if (scroll) scroll.scrollTop = 0;
  if (name !== 'catalog' && state.catalog?.densityOn) {
    state.catalog.setDensity(false);
  }
  const showWater = name === 'ocean';
  state.globe?.setWaterVisible(showWater);
  if (name === 'ocean') {
    state.ocean?.ensureLevel?.();
    state.ocean?.ensureCurve?.();
  }
  const waterToggle = $('layer-water');
  if (waterToggle) waterToggle.checked = showWater;
  if (name === 'catalog') {
    // Keep the density view in sync with the current filter.
    state.catalog?._update?.();
  }
  window.dispatchEvent(new CustomEvent('mars-tab', { detail: { tab: name } }));
}

function updateHover(pos) {
  const b = $('coords-readout')?.querySelector('b');
  const small = $('coords-readout')?.querySelector('small');
  if (!b || !small) return;
  if (!pos) {
    b.textContent = '—';
    small.textContent = 'высота —';
    return;
  }
  b.textContent = `${fmtLat(pos.lat)} · ${fmtLon(pos.lon)}`;
  small.textContent = `${formatMeters(pos.z)} м от ареоида`;
}

function setLegendDensity(on) {
  const legend = $('legend');
  if (!legend) return;
  legend.classList.toggle('density', on);
  const title = legend.querySelector('.legend-title');
  const ticks = legend.querySelector('.legend-ticks');
  const note = legend.querySelector('.legend-note');
  if (!legend.dataset.heightHtml) {
    legend.dataset.heightHtml = title.innerHTML;
    legend.dataset.ticksHtml = ticks.innerHTML;
    legend.dataset.noteHtml = note.innerHTML;
  }
  if (on) {
    title.innerHTML = 'Плотность кратеров <span id="legend-exag">5° × 5°</span>';
    ticks.innerHTML = '<span>0</span><span>кратеров / млн км²</span><span>макс.</span>';
    note.textContent = 'площадь учтена · сглажено на глобусе';
  } else {
    title.innerHTML = legend.dataset.heightHtml;
    ticks.innerHTML = legend.dataset.ticksHtml;
    note.innerHTML = legend.dataset.noteHtml;
  }
}

function buildDefense() {
  const isPhone = () => isMobileLayout();
  const steps = [
    {
      tag: '01 · глобус',
      title: 'MOLA 16 пикселей на градус',
      text: 'Вращайте планету. Цвет — высота относительно ареоида; вертикальное усиление меняет только рисунок. Исходная сетка 2880 × 5760; расчёты всегда в метрах.',
      metrics: [['Исходник', '2880 × 5760'], ['Разрешение', '16 px/°'], ['Высоты', 'ареоид']],
      apply: () => { setTab('globe'); state.globe?.setDensityMode(false); state.globe?.flyTo(5, 20, 3.2); },
    },
    {
      tag: '02 · профиль',
      title: 'Stokes: глубина 2083 м',
      text: 'Строка 96 северного фрагмента 128 px/°. Края вала −3163 и −3691 м, дно −5510 м. Отрицательные высоты: −4000 м выше, чем −5000 м. d = 2083 м, d/(1000D) = 0.0333.',
      metrics: [['d', '2083 м'], ['d / (1000D)', '0.0333'], ['Дно', '−5510 м']],
      apply: () => {
        setTab('craters');
        state.globe?.flyTo(55.621, 171.287, 1.85);
        if (!isPhone()) state.craterLab?.open('north');
      },
    },
    {
      tag: '03 · сравнение',
      title: 'Horowitz: 2478 м',
      text: 'Южный фрагмент, строка 97: края 2025 и 1761 м, дно −585 м. d = 2478 м, d/(1000D) = 0.0393. На одном масштабе видно абсолютный сдвиг около 5.5 км между полушариями.',
      metrics: [['d', '2478 м'], ['d / (1000D)', '0.0393'], ['Сдвиг', '≈ 5.5 км']],
      apply: () => {
        setTab('craters');
        state.globe?.flyTo(-32.063, 140.760, 1.85);
        if (!isPhone()) state.craterLab?.open('south');
      },
    },
    {
      tag: '04 · каталог',
      title: 'Юг кратерирован плотнее',
      text: 'Всего 10 892 кратера D ≥ 20 км: 3 076 на севере и 7 816 на юге. Плотность на 1 млн км² — 42.6 против 108.3. Карта плотности считает площадь каждой ячейки отдельно.',
      metrics: [['Всего', '10 892'], ['Север / юг', '3 076 / 7 816'], ['Плотность', '42.6 / 108.3']],
      apply: () => { state.craterLab?.close(); setTab('catalog'); state.catalog?.setDensity(true); state.globe?.flyTo(0, 0, 3.2); },
    },
    {
      tag: '05 · океан',
      title: '223 851 ячейка · 23.070 млн км²',
      text: 'Старт в Утопии, h = −3800 м. Эллада лежит на −6028 м, но не соединена с Утопией. «Все низкие места» дают 244 249 ячеек и 26.565 млн км². При +1304 м вода впервые переливается в Элладу.',
      metrics: [['Контроль', '223 851'], ['Площадь', '23.070 млн км²'], ['Перелив', '+1304 м']],
      apply: () => {
        state.craterLab?.close();
        setTab('ocean');
        state.catalog?.setDensity(false);
        state.ocean?.setMode('connected');
        state.ocean?.setLevel(-3800);
        state.globe?.flyTo(45, 115, 2.05);
      },
    },
    {
      tag: '06 · берег',
      title: 'Один уровень не описывает B',
      text: 'Уровень выбирается только по A и равен −3907 м. B выше на 376–404 м на всём участке 51.5 км; медиана |B − A| = 386 м. Это проверка современного рельефа, а не приговор древнему океану.',
      metrics: [['Уровень A', '−3907 м'], ['Медиана', '386 м'], ['Длина B', '51.5 км']],
      apply: () => {
        state.craterLab?.close();
        setTab('shore');
        state.catalog?.setDensity(false);
        if (!isPhone()) state.shore?.focus('A');
      },
    },
    {
      tag: '07 · вывод',
      title: 'Возраст, материал, границы',
      text: 'Stokes — молодая низменность mAl/lHl с лёссом и перигляциальной переработкой. Horowitz — Noachian highlands Nhe/lNh/mNh. Заполнение дна и древняя кратерность различимы по слоистости, эмбейменту вала, возрасту дна и плотности кратеров; одной пары недостаточно.',
      metrics: [['Stokes', 'mAl / lHl'], ['Horowitz', 'Nhe / lNh / mNh'], ['Ограничение', 'одна пара']],
      apply: () => { state.craterLab?.close(); setTab('geology'); state.catalog?.setDensity(false); state.globe?.flyTo(15, 100, 3.2); },
    },
  ];
  return steps;
}

function openDefense() {
  if (state.defense) { state.defenseClose?.(); return; }
  const steps = buildDefense();
  const onKey = (e) => { if (e.key === 'Escape') closePanel(); };
  let idx = 0;
  const panel = document.createElement('div');
  panel.className = 'defense-panel';
  panel.innerHTML = `
    <div class="defense-head">
      <div><div class="eyebrow">Сценарий защиты · 3 минуты</div><h3 id="def-title">${esc(steps[0].title)}</h3></div>
      <button class="modal-close" type="button" aria-label="Закрыть режим защиты">×</button>
    </div>
    <div class="defense-progress" id="def-progress">${steps.map((_, i) => `<i class="${i === 0 ? 'done' : ''}"></i>`).join('')}</div>
    <div class="defense-body">
      <div class="defense-step" id="def-tag">${esc(steps[0].tag)}</div>
      <p id="def-text">${esc(steps[0].text)}</p>
      <div class="defense-metrics" id="def-metrics">${steps[0].metrics.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>
    </div>
    <div class="defense-actions">
      <button class="btn" type="button" id="def-prev">← Назад</button>
      <button class="btn defense-action-main" type="button" id="def-next">Далее →</button>
    </div>
    <div class="defense-tip">Шаги сами переключают раздел, камеру и нужный слой. Закройте панель, чтобы вернуться к свободному исследованию.</div>`;
  document.body.appendChild(panel);
  state.defense = panel;
  document.addEventListener('keydown', onKey);
  function closePanel() {
    panel.remove();
    state.defense = null;
    state.defenseClose = null;
    document.removeEventListener('keydown', onKey);
  }
  state.defenseClose = closePanel;
  const render = () => {
    const s = steps[idx];
    panel.querySelector('#def-title').textContent = s.title;
    panel.querySelector('#def-tag').textContent = s.tag;
    panel.querySelector('#def-text').textContent = s.text;
    panel.querySelector('#def-metrics').innerHTML = s.metrics.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    panel.querySelector('#def-progress').innerHTML = steps.map((_, i) => `<i class="${i <= idx ? 'done' : ''}"></i>`).join('');
    panel.querySelector('#def-prev').disabled = idx === 0;
    panel.querySelector('#def-next').textContent = idx === steps.length - 1 ? 'Завершить' : 'Далее →';
    try { s.apply(); } catch (e) { console.warn(e); }
  };
  panel.querySelector('.modal-close').addEventListener('click', closePanel);
  panel.querySelector('#def-prev').addEventListener('click', () => {
    if (idx > 0) { idx--; render(); }
  });
  panel.querySelector('#def-next').addEventListener('click', () => {
    if (idx < steps.length - 1) { idx++; render(); }
    else { closePanel(); toast('Сценарий завершён. Глобус снова свободен.'); }
  });
  render();
}

function openInfo(scrollSources = false) {
  if (document.querySelector('.info-modal')) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop info-modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Методика и источники">
      <div class="modal-head">
        <div><div class="eyebrow">Как это сделано</div><h2>Методика, числа и источники</h2><p>Всё считается по исходным метрам; усиление влияет только на рисунок.</p></div>
        <button class="modal-close" type="button" aria-label="Закрыть">×</button>
      </div>
      <div class="modal-body">
        <div class="help-grid">
          <div class="help-card">
            <h3>Профиль и глубина</h3>
            <p>Расстояние по параллели: <span class="formula">s = R · cos φ · Δλ · π/180</span></p>
            <p>Глубина по двум краям и дну: <span class="formula">d = (z₁ + z₂)/2 − zmin</span></p>
            <p>Безразмерная мера: <span class="formula">d / (1000D)</span>, где D — диаметр в км, d — в метрах.</p>
            <p>Высоты — относительно ареоида. −4000 м выше, чем −5000 м. Ноль не пропуск.</p>
          </div>
          <div class="help-card">
            <h3>Заливка</h3>
            <p>Сетка MOLA4: 720 × 1440, 4 px/°. Ячейка допустима при z &lt; h. Соседи — по общей стороне; столбцы 1 и 1440 соединены, верх и низ — нет.</p>
            <p>Площадь строки: <span class="formula">A = R² · (π/720) · (sin φN − sin φS)</span></p>
            <p>Старт: 45° с.ш., 115° в.д. — строка 181, столбец 461. Контроль при h = −3800 м: 223 851 ячейка, 23.070 млн км².</p>
          </div>
          <div class="help-card">
            <h3>Каталог и плотность</h3>
            <p>Площадь полушария: <span class="formula">2πR² = 72.186 млн км²</span>, R = 3389.5 км.</p>
            <p>Плотность: <span class="formula">N / 72.186 млн км²</span>. Для карты используется площадь каждой ячейки 5° × 5° отдельно, поэтому у полюса она меньше. Цвет на глобусе сглажен для чтения; 2D-карта и числа — по исходным ячейкам.</p>
            <p>Каталог — снимок PADC, Robbins &amp; Hynek (2012), D ≥ 20 км; бассейн Prometheus исключён источником.</p>
          </div>
          <div class="help-card">
            <h3>Берег</h3>
            <p>Медиана A по 40 точкам: −3907 м. Уровень фиксируется по A и не подбирается по B.</p>
            <p>Для B: <span class="formula">median |height − уровень A| = 386 м</span>. Диапазон B − A: +376…+404 м на 51.488 км.</p>
            <p>Это проверка единого уровня на современном рельефе; она не доказывает и не опровергает древний океан.</p>
          </div>
        </div>
        <div class="note" style="margin-top:14px"><b>Что не делает приложение</b><p>Не интерполирует отсутствующие высоты, не меняет исходные значения при вертикальном усилении и не выбирает уровень берега B заново. Площадь заливки считается только по достигнутым от Утопии ячейкам.</p></div>
        <h3 style="font-size:15px;margin:18px 0 8px">Источники и данные</h3>
        <div class="source-list">
          <a href="prompt/README.html" target="_blank" rel="noopener">README комплекта задачи<small>форматы, единицы, координаты</small></a>
          <a href="prompt/README_mola16.txt" target="_blank" rel="noopener">MOLA MEGDR 16 px/°<small>NASA / MGS MOLA, PDS Geosciences</small></a>
          <a href="prompt/README_mola4.txt" target="_blank" rel="noopener">MOLA4 и формула площади<small>4 px/°, 720 × 1440</small></a>
          <a href="prompt/README_craters128.txt" target="_blank" rel="noopener">Фрагменты 128 px/°<small>Stokes и Horowitz, геопривязка в JSON</small></a>
          <a href="prompt/README_sources.txt" target="_blank" rel="noopener">Каталог, берег, геология<small>Robbins &amp; Hynek 2012; Ivanov 2017 / Sholes 2021; USGS 2014</small></a>
          <a href="prompt/geology_map_usgs.pdf" target="_blank" rel="noopener">USGS Scientific Investigations Map 3292<small>Tanaka et al., 2014 · Geologic Map of Mars</small></a>
          <a href="prompt/geology_units_usgs.pdf" target="_blank" rel="noopener">Легенда геологических единиц<small>mAl, Nhe, lNh, mNh и другие</small></a>
        </div>
        <p class="credit" style="margin-top:12px">Three.js — MIT. Данные предоставлены в комплекте задачи; исходные файлы не изменялись. Фрагменты геологической карты вырезаны из предоставленного PDF для контекста.</p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  if (scrollSources) {
    setTimeout(() => {
      modal.querySelector('.source-list')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  }
}

async function boot() {
  try {
    try { performance.mark?.('mars-data-start'); } catch { /* ignored */ }
    const data = await loadAtlasData((pct, status, detail) => setBoot(pct, status, detail));
    try { performance.mark?.('mars-data-end'); performance.measure?.('mars-data', 'mars-data-start', 'mars-data-end'); } catch { /* ignored */ }
    state.data = data;
    $('app')?.classList.remove('is-hidden');
    if ($('boot-status')) $('boot-status').textContent = 'Собираю сцену…';
    if ($('boot-bar')) $('boot-bar').style.width = '100%';

    // Global readouts
    const range = $('stat-range');
    if (range) range.textContent = `${formatMeters(data.meta.mola4.min)}…${formatMeters(data.meta.mola4.max)}`;
    const status = $('data-status');
    if (status) status.textContent = `MOLA16 · MOLA4 · ${formatInt(data.craters.length)} кратеров · проверено`;

    // Profile source check
    const check = $('profile-check');
    if (check) {
      const pc = data.meta.profileCheck;
      if (pc.equal) {
        const hashNote = data.meta.fragmentHashChecked
          ? (data.meta.fragmentHashOk ? ' SHA-256 обоих фрагментов 128 px/° совпал.' : ' SHA-256 фрагментов не совпал — проверьте файлы.')
          : '';
        check.innerHTML = `<b>Проверка источника ✓</b><p>Строка 96 северного фрагмента совпала с <code>Профиль_Стокса.csv</code>: ${pc.count} из ${pc.count} значений, расхождений ${pc.mismatches}.${hashNote}</p>`;
      } else {
        check.innerHTML = `<b>Проверка источника — есть расхождение</b><p>Совпало ${pc.count - pc.mismatches} из ${pc.count}; проверьте кодировку и разделитель.</p>`;
      }
    }

    state.globe = new MarsGlobe({
      canvas: $('globe-canvas'),
      labelsEl: $('globe-labels'),
      data,
      onHover: updateHover,
      onMarker: handleMarker,
      onPick: (p) => {
        updateHover(p);
      },
      onStatus: () => {},
    });
    try { performance.mark?.('mars-globe-end'); performance.measure?.('mars-globe', 'mars-data-end', 'mars-globe-end'); } catch { /* ignored */ }

    state.craterLab = new CraterLab({
      data,
      modalRoot: $('modal-root'),
      onToast: toast,
      onOpenGlobe: (side) => {
        state.craterLab.close();
        setTab('craters');
        state.globe.flyTo(side === 'north' ? 55.621 : -32.063, side === 'north' ? 171.287 : 140.760, 1.85);
      },
    });

    state.catalog = new CatalogModule({ data, globe: state.globe });
    state.ocean = new OceanModule({ data, globe: state.globe, modalRoot: $('modal-root'), onToast: toast });
    state.shore = new ShoreModule({ data, globe: state.globe, modalRoot: $('modal-root') });

    state.mobile = new MobileUI({ getState: () => state, setTab, toast });
    state.mobile.init();
    try { performance.mark?.('mars-modules-end'); performance.measure?.('mars-modules', 'mars-globe-end', 'mars-modules-end'); } catch { /* ignored */ }

    // Pause the WebGL loop while a full-screen modal is open. The globe is not
    // visible through the backdrop, and blurring/animating it wastes frames.
    let overlayOpen = false;
    const syncOverlay = () => {
      const open = !!document.querySelector('.modal-backdrop');
      if (open !== overlayOpen) {
        overlayOpen = open;
        state.globe?.setOverlayOpen(open);
      }
    };
    new MutationObserver(syncOverlay).observe(document.body, { childList: true, subtree: true });

    // expose for verification / debugging in the browser only
    window.__mars = {
      data, globe: state.globe, craterLab: state.craterLab, catalog: state.catalog,
      ocean: state.ocean, shore: state.shore, mobile: state.mobile, setTab,
      get state() { return { tab: state.tab, level: state.ocean?.level, mode: state.ocean?.mode }; },
    };

    bindUi();
    setTab('globe');
    state.globe?._resize();
    $('boot')?.classList.add('done');
    setStageCaption();
    state.booted = true;
    try {
      performance.mark?.('mars-ready');
      performance.measure?.('mars-boot', 'mars-boot-start', 'mars-ready');
    } catch { /* ignored */ }
  } catch (err) {
    console.error(err);
    showBootError(err);
  }
}

function handleMarker(id) {
  if (id === 'stokes') {
    setTab('craters');
    state.globe.flyTo(55.621, 171.287, 1.85);
    state.craterLab.open('north');
  } else if (id === 'horowitz') {
    setTab('craters');
    state.globe.flyTo(-32.063, 140.760, 1.85);
    state.craterLab.open('south');
  } else if (id === 'utopia') {
    setTab('ocean');
    state.globe.flyTo(45, 115, 1.95);
  } else if (id === 'hellas') {
    setTab('ocean');
    state.globe.flyTo(-42, 70, 1.95);
  } else if (id === 'shoreA') {
    setTab('shore');
    if (!isMobileLayout()) state.shore.focus('A');
  } else if (id === 'shoreB') {
    setTab('shore');
    if (!isMobileLayout()) state.shore.focus('B');
  }
}

function bindUi() {
  const tabs = $('tabs');
  tabs?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setTab(b.dataset.tab);
  });

  document.querySelectorAll('[data-focus]').forEach((b) => {
    b.addEventListener('click', () => {
      const f = b.dataset.focus;
      if (f === 'north') state.globe.flyTo(82, 0, 3.2);
      else if (f === 'south') state.globe.flyTo(-82, 0, 3.2);
      else if (f === 'utopia') state.globe.flyTo(45, 115, 1.95);
      else if (f === 'hellas') state.globe.flyTo(-42, 70, 1.95);
      else if (f === 'stokes') { setTab('craters'); state.globe.flyTo(55.621, 171.287, 1.85); }
      else if (f === 'horowitz') { setTab('craters'); state.globe.flyTo(-32.063, 140.760, 1.85); }
    });
  });

  const exag = $('globe-exag');
  const updateExag = rafThrottle(() => {
    const v = Number(exag.value);
    state.globe.setExaggeration(v);
    $('globe-exag-val').textContent = `×${v}`;
    const le = $('legend-exag');
    if (le && !$('legend')?.classList.contains('density')) {
      le.textContent = `×${v}`;
      const legend = $('legend');
      const title = legend?.querySelector('.legend-title');
      if (legend && title) legend.dataset.heightHtml = title.innerHTML;
    }
    setStageCaption();
  });
  exag?.addEventListener('input', updateExag);

  $('layer-graticule')?.addEventListener('change', (e) => state.globe.setGraticuleVisible(e.target.checked));
  $('layer-points')?.addEventListener('change', (e) => state.globe.setPointsVisible(e.target.checked));
  $('layer-water')?.addEventListener('change', (e) => {
    state.globe.setWaterVisible(e.target.checked);
    if (e.target.checked) state.ocean?.ensureLevel?.();
  });
  const water = $('layer-water');
  if (water) water.checked = !!state.globe?.waterUserVisible;

  $('view-reset')?.addEventListener('click', () => { state.globe.setAutoRotate(false); state.globe.flyTo(8, 10, 3.25); });
  $('view-north')?.addEventListener('click', () => { state.globe.setAutoRotate(false); state.globe.flyTo(86, 0, 3.2); });
  $('view-south')?.addEventListener('click', () => { state.globe.setAutoRotate(false); state.globe.flyTo(-86, 0, 3.2); });
  const rotate = $('view-rotate');
  rotate?.classList.toggle('active', !!state.globe?.autoRotate);
  rotate?.addEventListener('click', () => {
    const on = !state.globe.autoRotate;
    state.globe.setAutoRotate(on);
    rotate.classList.toggle('active', on);
  });

  $('compare-btn')?.addEventListener('click', () => state.craterLab.openCompare());
  $('btn-defense')?.addEventListener('click', openDefense);
  $('btn-help')?.addEventListener('click', () => openInfo(false));
  $('btn-sources')?.addEventListener('click', () => openInfo(true));

  window.addEventListener('mars-density', (e) => setLegendDensity(!!e.detail?.on));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Modal/crater modules handle their own Escape; defense panel too.
    }
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey) state.globe?.setAutoRotate(true);
  });

  // card clicks
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-open-crater]');
    if (card) state.craterLab.open(card.dataset.openCrater);
  });

  // fill crater cards
  const cards = $('crater-cards');
  if (cards && state.data) {
    const n = state.data.craterInfo.north;
    const s = state.data.craterInfo.south;
    const nm = state.data.craterProfiles.north.measure;
    const sm = state.data.craterProfiles.south.measure;
    cards.innerHTML = `
      <button type="button" class="crater-card" data-open-crater="north">
        <div class="cc-head"><span class="hemi north"></span><h3>Stokes</h3></div>
        <div class="cc-go">↗</div>
        <div class="cc-sub">${formatNumber(n.centerLat, 3)}° с.ш. · ${formatNumber(n.centerLon, 3)}° в.д. · D = ${formatNumber(n.diameter, 2)} км</div>
        <div class="cc-stats">
          <div class="cc-stat">дно<b>${formatMeters(nm.zmin)}</b></div>
          <div class="cc-stat">d<b>${formatInt(nm.d)} м</b></div>
          <div class="cc-stat">d/(1000D)<b>${formatNumber(nm.ratio, 4)}</b></div>
        </div>
      </button>
      <button type="button" class="crater-card" data-open-crater="south">
        <div class="cc-head"><span class="hemi south"></span><h3>Horowitz</h3></div>
        <div class="cc-go">↗</div>
        <div class="cc-sub">${formatNumber(Math.abs(s.centerLat), 3)}° ю.ш. · ${formatNumber(s.centerLon, 3)}° в.д. · D = ${formatNumber(s.diameter, 2)} км</div>
        <div class="cc-stats">
          <div class="cc-stat">дно<b>${formatMeters(sm.zmin)}</b></div>
          <div class="cc-stat">d<b>${formatInt(sm.d)} м</b></div>
          <div class="cc-stat">d/(1000D)<b>${formatNumber(sm.ratio, 4)}</b></div>
        </div>
      </button>`;
  }

  // initial surface button state
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
    });
  });
}

boot();


