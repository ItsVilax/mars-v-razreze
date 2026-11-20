import { esc, MOBILE_MEDIA } from './utils.js';

const DESKTOP_SUB = 'интерактивный 3D-атлас · MOLA / MGS';
const TITLES = {
  globe: '01 · Глобус',
  craters: '02 · Кратеры',
  catalog: '03 · Каталог',
  ocean: '04 · Океан',
  shore: '05 · Берег',
  geology: '06 · Геология',
};

const cleanClone = (node) => {
  const clone = node.cloneNode(true);
  if (!clone.querySelectorAll) return clone;
  clone.removeAttribute?.('id');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  return clone;
};

const cleanHTML = (node) => cleanClone(node).outerHTML;

/**
 * Small mobile shell: fixed screens, one section menu, and a few
 * touch-specific behaviours. It is inert above the 760px breakpoint.
 */
export class MobileUI {
  constructor({ getState, setTab, toast }) {
    this.getState = getState;
    this.setTab = setTab;
    this.toast = toast;
    this.mq = window.matchMedia(MOBILE_MEDIA);
    this.currentTab = 'globe';
    this.menu = null;
    this._resizeRaf = 0;
    this._onKey = null;
    this._popHandler = null;
  }

  init() {
    this.app = document.getElementById('app');
    this.brandSub = document.getElementById('brand-sub');
    this.tabsEl = document.getElementById('tabs');
    this.oceanTabs = document.getElementById('mobile-ocean-tabs');
    this.layout = document.querySelector('.layout');
    this._bind();
    this._mobile = this.isMobile();
    this.applyMode();
    this.updateViewport();
    this.syncTab(this.getState().tab || 'globe');

    if (typeof ResizeObserver !== 'undefined' && this.layout) {
      this.ro = new ResizeObserver(() => this.onViewportChange());
      this.ro.observe(this.layout);
    }
    window.visualViewport?.addEventListener('resize', () => this.onViewportChange());
    window.addEventListener('resize', () => this.onViewportChange());
    window.addEventListener('orientationchange', () => this.onViewportChange());
    this.mq.addEventListener('change', () => this.onViewportChange());
  }

  onViewportChange() {
    const mobile = this.isMobile();
    if (mobile !== this._mobile) {
      this._mobile = mobile;
      this.applyMode();
      return;
    }
    this.updateViewport();
  }

  _bind() {
    document.addEventListener('click', (e) => {
      const menuBtn = e.target.closest('[data-mobile-menu]');
      if (menuBtn) {
        e.preventDefault();
        this.openMenu(menuBtn.dataset.mobileMenu);
        return;
      }
      const geoBtn = e.target.closest('[data-mobile-geology]');
      if (geoBtn) {
        e.preventDefault();
        this.openMenu('geology-detail', { index: Number(geoBtn.dataset.mobileGeology) || 0 });
        return;
      }
      const oceanTab = e.target.closest('[data-mobile-ocean]');
      if (oceanTab) {
        e.preventDefault();
        this.setTab(oceanTab.dataset.mobileOcean === 'shore' ? 'shore' : 'ocean');
        return;
      }
      const shoreView = e.target.closest('[data-shore-view]');
      if (shoreView) {
        e.preventDefault();
        this.setShoreView(shoreView.dataset.shoreView);
        return;
      }
    });

    window.addEventListener('mars-tab', (e) => this.syncTab(e.detail?.tab || 'globe'));
    window.addEventListener('mars-go-globe', (e) => this.goGlobe(e.detail || {}));
    window.addEventListener('popstate', () => {
      if (this.menu) this.closeMenu(true);
    });
  }

  isMobile() {
    return this.mq.matches;
  }

  applyMode() {
    const mobile = this.isMobile();
    this._mobile = mobile;
    document.documentElement.classList.toggle('mobile-ui', mobile);
    if (!mobile) {
      this.closeMenu(true);
      document.documentElement.classList.remove('is-compact', 'is-tiny');
      if (this.brandSub) this.brandSub.textContent = DESKTOP_SUB;
      this.app?.removeAttribute('data-tab');
      this.tabsEl?.querySelectorAll('button').forEach((b) => b.classList.remove('mobile-active'));
      this.getState().globe?.setScreenActive?.(true);
      this.getState().globe?.setLabelContext?.('globe');
      return;
    }
    this.updateViewport();
    this.syncTab(this.getState().tab || 'globe');
  }

  updateViewport() {
    if (!this.isMobile()) return;
    const h = this.layout?.clientHeight || window.innerHeight;
    const root = document.documentElement;
    root.classList.toggle('is-compact', h < 560);
    root.classList.toggle('is-tiny', h < 440);
  }

  syncTab(tab) {
    this.currentTab = tab || 'globe';
    if (!this.isMobile()) return;
    this.updateViewport();
    if (this.app) this.app.dataset.tab = this.currentTab;
    if (this.brandSub) this.brandSub.textContent = TITLES[this.currentTab] || DESKTOP_SUB;

    this.tabsEl?.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('mobile-active', this.currentTab === 'shore' && b.dataset.tab === 'ocean');
    });
    this.oceanTabs?.querySelectorAll('button').forEach((b) => {
      const value = b.dataset.mobileOcean;
      b.classList.toggle('active', value === (this.currentTab === 'shore' ? 'shore' : 'ocean'));
    });

    const state = this.getState();
    const globe = state.globe;
    const active = this.currentTab === 'globe' || this.currentTab === 'ocean';
    globe?.setScreenActive?.(active);
    globe?.setLabelContext?.(this.currentTab);

    if (this.currentTab === 'shore') {
      requestAnimationFrame(() => state.shore?.resizeCharts?.());
    } else if (this.currentTab === 'catalog') {
      requestAnimationFrame(() => state.catalog?._update?.());
    }
  }

  goGlobe(detail = {}) {
    if (!this.isMobile()) return;
    this.setTab('globe');
    const state = this.getState();
    if (detail.density) state.catalog?.setDensity?.(true);
    if (Number.isFinite(detail.lat) && Number.isFinite(detail.lon)) {
      state.globe?.flyTo(detail.lat, detail.lon, detail.distance || 2.5);
    }
    if (detail.toast) this.toast?.(detail.toast);
  }

  setShoreView(view) {
    const panel = document.querySelector('[data-panel="shore"]');
    if (!panel) return;
    const dev = view === 'dev';
    panel.classList.toggle('show-dev', dev);
    document.querySelectorAll('#shore-chart-toggle button').forEach((b) => {
      b.classList.toggle('active', b.dataset.shoreView === (dev ? 'dev' : 'main'));
    });
    requestAnimationFrame(() => this.getState().shore?.resizeCharts?.());
  }

  openMenu(kind, opts = {}) {
    if (!this.isMobile() || !kind) return;
    this.closeMenu(true);
    const state = this.getState();
    const panel = (name) => document.querySelector(`[data-panel="${name}"]`);
    let config = null;

    if (kind === 'globe-view') {
      const globePanel = panel('globe');
      config = {
        title: 'Вид глобуса',
        subtitle: 'Слои, усиление рельефа и легенда',
        move: [globePanel?.querySelector('.control-card'), globePanel?.querySelector('.layer-list')],
        html: `<div class="menu-legend">
          <div class="legend-title">Высота, м <span>×${esc(String(state.globe?.exaggeration || 20))}</span></div>
          <div class="legend-bar"></div>
          <div class="legend-ticks"><span>−8 000</span><span>0</span><span>+12 000+</span></div>
          <div class="legend-note">MOLA · ареоид · выше +12 км светлее</div>
        </div>`,
      };
    } else if (kind === 'globe-data') {
      const globePanel = panel('globe');
      let dataHtml = [
        globePanel?.querySelector('.stat-grid') ? cleanHTML(globePanel.querySelector('.stat-grid')) : '',
        globePanel?.querySelector('.note') ? cleanHTML(globePanel.querySelector('.note')) : '',
      ].join('');
      if (this.isMobile()) dataHtml = dataHtml.replace('текстура 8 px/°', 'текстура 4 px/°');
      config = {
        title: 'О данных глобуса',
        subtitle: 'MOLA 16 px/° · расчёты в метрах',
        html: dataHtml,
      };
    } else if (kind === 'crater-notes') {
      const p = panel('craters');
      const notes = [...(p?.querySelectorAll('.note') || [])].map(cleanHTML).join('');
      config = {
        title: 'Как считается глубина',
        subtitle: 'Формула, источник и ограничения',
        html: notes,
      };
    } else if (kind === 'catalog-table') {
      const p = panel('catalog');
      const table = p?.querySelector('.table-wrap');
      config = {
        title: 'Каталог по группам',
        subtitle: 'Число кратеров и площадь полушарий',
        html: table ? cleanHTML(table) : '<p class="muted">Таблица ещё не загружена.</p>',
      };
    } else if (kind === 'catalog-notes') {
      const p = panel('catalog');
      const firstStat = p?.querySelector('.stat-grid .stat');
      config = {
        title: 'Площадь и границы вывода',
        subtitle: 'Что показывает карта плотности',
        html: [
          firstStat ? `<div class="stat-grid">${cleanHTML(firstStat)}</div>` : '',
          ...[...(p?.querySelectorAll('.note') || [])].map(cleanHTML),
        ].join(''),
      };
    } else if (kind === 'ocean-notes') {
      const p = panel('ocean');
      const depth = p?.querySelectorAll('.stat-grid .stat')[2];
      config = {
        title: 'Уровень, перелёты и пояснение',
        subtitle: 'Эллада, порог перелива и контроль модели',
        move: [p?.querySelector('.level-input'), p?.querySelector('.control-check'), p?.querySelector('.mini-actions')],
        html: [
          depth ? `<div class="stat-grid">${cleanHTML(depth)}</div>` : '',
          p?.querySelector('.note') ? cleanHTML(p.querySelector('.note')) : '',
        ].join(''),
      };
    } else if (kind === 'shore-notes') {
      const p = panel('shore');
      config = {
        title: 'Проверка уровня',
        subtitle: 'A, B и что из этого следует',
        html: [
          p?.querySelector('.stat-grid') ? cleanHTML(p.querySelector('.stat-grid')) : '',
          ...[...(p?.querySelectorAll('.note') || [])].map(cleanHTML),
        ].join(''),
      };
    } else if (kind === 'geology-materials') {
      const p = panel('geology');
      config = {
        title: 'Материалы и источники',
        subtitle: 'USGS, PDF и ограничения вывода',
        html: [
          ...[...(p?.querySelectorAll('.note') || [])].map(cleanHTML),
          p?.querySelector('.source-links') ? cleanHTML(p.querySelector('.source-links')) : '',
          p?.querySelector('.credit') ? cleanHTML(p.querySelector('.credit')) : '',
        ].join(''),
      };
    } else if (kind === 'geology-detail') {
      const cards = [...(panel('geology')?.querySelectorAll('.geo-card') || [])];
      const card = cards[opts.index || 0];
      if (!card) return;
      const img = card.querySelector('.geo-img img');
      const body = card.querySelector('.geo-body')?.cloneNode(true);
      body?.querySelector('.geo-more')?.remove();
      const title = card.querySelector('.geo-body h3')?.textContent || 'Геология';
      const tag = card.querySelector('.geo-tag')?.textContent || '';
      body?.querySelector('.geo-tag')?.remove();
      body?.querySelector('h3')?.remove();
      config = {
        title,
        subtitle: tag,
        html: [
          img ? `<img class="geo-detail-img" src="${esc(img.getAttribute('src'))}" alt="${esc(img.getAttribute('alt') || '')}">` : '',
          body ? body.innerHTML : '',
        ].join(''),
      };
    }

    if (!config) return;
    this.openSheet(config);
  }

  openSheet({ title, subtitle = '', move = [], html = '' }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop mobile-sheet';
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div><div class="eyebrow">Меню раздела</div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
          <button class="modal-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(backdrop);

    const body = backdrop.querySelector('.modal-body');
    const moved = [];
    for (const node of move) {
      if (!node) continue;
      moved.push({ node, parent: node.parentNode, next: node.nextSibling });
      body.appendChild(node);
    }
    if (html) body.insertAdjacentHTML('beforeend', html);

    const onKey = (e) => { if (e.key === 'Escape') this.closeMenu(); };
    document.addEventListener('keydown', onKey);
    const close = () => this.closeMenu();
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    body.addEventListener('click', (e) => {
      if (e.target.closest('.mini-actions .btn')) {
        setTimeout(() => this.closeMenu(), 90);
      }
    });

    this.menu = { backdrop, moved, onKey };
    try {
      history.pushState({ marsMenu: true }, '');
    } catch { /* file:// or restricted history */ }
    body.scrollTop = 0;
  }

  closeMenu(fromPop = false) {
    const menu = this.menu;
    if (!menu) return;
    this.menu = null;
    document.removeEventListener('keydown', menu.onKey);
    for (let i = menu.moved.length - 1; i >= 0; i--) {
      const entry = menu.moved[i];
      try {
        if (entry.next && entry.next.parentNode === entry.parent) entry.parent.insertBefore(entry.node, entry.next);
        else entry.parent.appendChild(entry.node);
      } catch { /* parent is still alive */ }
    }
    menu.backdrop.remove();
    if (!fromPop && history.state?.marsMenu) {
      try { history.back(); } catch { /* ignore */ }
    }
  }
}
