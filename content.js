(function () {
  // ==========================================================================
  // 0. GARDE-CLAVIER DÈS DOCUMENT_START (Protège Espace sur Meet sauf saisie texte)
  // ==========================================================================
  const guard = { camActive: false, held: false, onDown: null, onUp: null };
  let pendingMeetCamRequest = false;
  let pendingRequestedDeviceId = '';

  const MAX_SHAPES = 300;
  const MAX_AR_OBJECTS = 3;

  const DEFAULT_SETTINGS = {
    extEnabled: true,
    drawMode: false,
    ecoMode: false,
    mode: 'paint',
    color: '#00f0ff',
    strokeWidth: 3.5,
    filled: false,
    smartShape: false,
    laserMode: false,
    mirror: true,
    arFlip: false,
    arOpacity: 0.92,
    showAirMenu: false,
    bwFilter: false,
    showHudOnMeet: false,
    selectedDeviceId: '',
    pinchThreshold: 0.58,
    windowBounds: null,
    bubblePos: null
  };

  function readInitialExtEnabledSync() {
    try {
      const saved = localStorage.getItem('vs_ext_enabled');
      if (saved === 'false') return false;
    } catch (e) {}
    return true;
  }

  const initialExtEnabled = readInitialExtEnabledSync();
  if (document.documentElement) {
    document.documentElement.dataset.vsExtEnabled = initialExtEnabled ? 'true' : 'false';
  }

  // Synchronisation dès document_start avec chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ extEnabled: initialExtEnabled }, (res) => {
      const enabled = res.extEnabled !== false;
      if (document.documentElement) {
        document.documentElement.dataset.vsExtEnabled = enabled ? 'true' : 'false';
      }
      try {
        localStorage.setItem('vs_ext_enabled', enabled ? 'true' : 'false');
      } catch (e) {}
    });
  }

  window.addEventListener('vs-meet-request-cam', (e) => {
    pendingMeetCamRequest = true;
    if (e.detail && e.detail.deviceId) {
      pendingRequestedDeviceId = e.detail.deviceId;
    }
  });

  function isTextEntry(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'].includes(type);
    }
    return false;
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function releaseSpace() {
    if (!guard.held) return;
    guard.held = false;
    if (guard.onUp) guard.onUp();
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (guard.held) { swallow(e); return; }
    if (!guard.camActive) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (isTextEntry(target)) return;
    swallow(e);
    if (e.repeat) return;
    guard.held = true;
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    if (guard.onDown) guard.onDown();
  }, true);

  window.addEventListener('keypress', (e) => {
    if (guard.held && e.code === 'Space') swallow(e);
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !guard.held) return;
    swallow(e);
    releaseSpace();
  }, true);

  window.addEventListener('blur', releaseSpace);

  function loadStoredSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({ ...DEFAULT_SETTINGS, extEnabled: readInitialExtEnabledSync() });
          } else {
            resolve({ ...DEFAULT_SETTINGS, ...items });
          }
        });
      } else {
        resolve({ ...DEFAULT_SETTINGS, extEnabled: readInitialExtEnabledSync() });
      }
    });
  }

  // Simplification géométrique Ramer-Douglas-Peucker (RDP)
  function perpendicularDistance(pt, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 0.0001) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
    const u = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / (mag * mag);
    const clampedU = Math.max(0, Math.min(1, u));
    const projX = lineStart.x + clampedU * dx;
    const projY = lineStart.y + clampedU * dy;
    return Math.hypot(pt.x - projX, pt.y - projY);
  }

  function simplifyRDP(points, epsilon = 1.6) {
    if (!points || points.length <= 2) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[0], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }
    if (dmax > epsilon) {
      const rec1 = simplifyRDP(points.slice(0, index + 1), epsilon);
      const rec2 = simplifyRDP(points.slice(index), epsilon);
      return rec1.slice(0, rec1.length - 1).concat(rec2);
    }
    return [points[0], points[end]];
  }

  // ==========================================================================
  // 1. INITIALISATION DE L'INTERFACE RUBAN (LECTURE STORAGE AVANT CONSTRUCTION UI)
  // ==========================================================================
  let booted = false;

  async function boot() {
    if (booted || !document.body) return;
    booted = true;

    const savedSettings = await loadStoredSettings();

    let state = {
      extEnabled: savedSettings.extEnabled !== false,
      drawMode: Boolean(savedSettings.drawMode),
      ecoMode: Boolean(savedSettings.ecoMode),
      mode: savedSettings.mode || 'paint',
      color: savedSettings.color || '#00f0ff',
      strokeWidth: Number(savedSettings.strokeWidth) || 3.5,
      filled: Boolean(savedSettings.filled),
      smartShape: Boolean(savedSettings.smartShape),
      laserMode: Boolean(savedSettings.laserMode),
      eraser: false,
      mirror: savedSettings.mirror !== false,
      arFlip: Boolean(savedSettings.arFlip),
      arOpacity: Number(savedSettings.arOpacity) || 0.92,
      showAirMenu: Boolean(savedSettings.showAirMenu),
      bwFilter: Boolean(savedSettings.bwFilter),
      showHudOnMeet: Boolean(savedSettings.showHudOnMeet),
      cameraActive: false,
      selectedDeviceId: savedSettings.selectedDeviceId || '',
      pinchThreshold: Number(savedSettings.pinchThreshold) || 0.58,
      windowBounds: savedSettings.windowBounds || null,
      bubblePos: savedSettings.bubblePos || null,
      spacePressed: false,
      leftHandClutch: false
    };

    if (document.documentElement) {
      document.documentElement.dataset.vsExtEnabled = state.extEnabled ? 'true' : 'false';
    }
    try {
      localStorage.setItem('vs_ext_enabled', state.extEnabled ? 'true' : 'false');
    } catch (e) {}

    // Écriture dans chrome.storage.local avec debounce de 500 ms
    let saveDebounceTimer = null;
    function scheduleSaveSettings() {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            extEnabled: state.extEnabled,
            drawMode: state.drawMode,
            ecoMode: state.ecoMode,
            mode: state.mode,
            color: state.color,
            strokeWidth: state.strokeWidth,
            filled: state.filled,
            smartShape: state.smartShape,
            laserMode: state.laserMode,
            mirror: state.mirror,
            arFlip: state.arFlip,
            arOpacity: state.arOpacity,
            showAirMenu: state.showAirMenu,
            bwFilter: state.bwFilter,
            showHudOnMeet: state.showHudOnMeet,
            selectedDeviceId: state.selectedDeviceId,
            pinchThreshold: state.pinchThreshold,
            windowBounds: state.windowBounds,
            bubblePos: state.bubblePos
          });
        }
      }, 500);
    }

    const style = document.createElement('style');
    style.id = 'vs-studio-styles';
    style.textContent = `
      #vs-floating-bubble {
        position: fixed !important;
        bottom: 88px;
        right: 24px;
        width: 52px !important;
        height: 52px !important;
        border-radius: 50% !important;
        background: radial-gradient(circle at 30% 30%, #00f0ff, #6366f1 60%, #0e1015 100%) !important;
        border: 2px solid rgba(255, 255, 255, 0.9) !important;
        box-shadow: 0 6px 24px rgba(0, 240, 255, 0.5), inset 0 0 12px rgba(255, 255, 255, 0.4) !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: monospace !important;
        font-size: 22px !important;
        font-weight: bold !important;
        cursor: grab !important;
        z-index: 2147483647 !important;
        user-select: none !important;
        transition: transform 0.15s ease, box-shadow 0.15s ease !important;
      }
      #vs-floating-bubble.vs-hidden {
        display: none !important;
      }
      #vs-floating-bubble:hover {
        transform: scale(1.08) !important;
        box-shadow: 0 8px 30px rgba(0, 240, 255, 0.8) !important;
      }
      #vs-floating-bubble:active {
        cursor: grabbing !important;
      }
      #vs-floating-bubble.clutch-active {
        background: radial-gradient(circle at 30% 30%, #39ff14, #059669 65%, #08090c 100%) !important;
        box-shadow: 0 0 28px #39ff14 !important;
      }
      #vs-floating-bubble .vs-bubble-dot {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ff334b;
        border: 2px solid #08090c;
      }
      #vs-floating-bubble.cam-on .vs-bubble-dot {
        background: #39ff14;
      }

      /* MINI-APERÇU LOCAL (224x126 px) À CÔTÉ DE LA BULLE */
      #vs-mini-preview {
        position: fixed !important;
        width: 224px !important;
        height: 126px !important;
        border-radius: 8px !important;
        background: #050608 !important;
        border: 1.5px solid rgba(0, 240, 255, 0.55) !important;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.8) !important;
        overflow: hidden !important;
        z-index: 2147483646 !important;
        display: none;
        cursor: pointer !important;
        user-select: none !important;
      }
      #vs-mini-preview.vs-visible {
        display: block !important;
      }
      #vsMiniPreviewCanvas {
        width: 224px !important;
        height: 126px !important;
        display: block !important;
      }
      #vs-mini-preview .vs-mini-tag {
        position: absolute;
        top: 4px;
        left: 6px;
        background: rgba(8, 9, 12, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #00f0ff;
        font-family: monospace;
        font-size: 8.5px;
        padding: 1px 5px;
        border-radius: 3px;
        pointer-events: none;
      }

      /* TOASTS NON BLOQUANTS */
      #vs-toast-container {
        position: fixed !important;
        top: 18px !important;
        right: 18px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        max-width: 360px !important;
        pointer-events: none !important;
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace !important;
      }
      .vs-toast {
        pointer-events: auto !important;
        background: rgba(14, 16, 21, 0.96) !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        border-left: 4px solid #00f0ff !important;
        border-radius: 8px !important;
        padding: 10px 12px !important;
        color: #e8ecf2 !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.8) !important;
        font-size: 10.5px !important;
        line-height: 1.4 !important;
        backdrop-filter: blur(10px) !important;
      }
      .vs-toast.vs-toast-error {
        border-left-color: #ff334b !important;
      }
      .vs-toast.vs-toast-warn {
        border-left-color: #ffb800 !important;
      }
      .vs-toast-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 700;
        margin-bottom: 4px;
        color: #fff;
      }
      .vs-toast-close {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        font-size: 12px;
        padding: 0 2px;
      }
      .vs-toast-close:hover {
        color: #fff;
      }
      .vs-toast-actions {
        margin-top: 8px;
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .vs-toast-btn {
        background: rgba(0, 240, 255, 0.15);
        color: #00f0ff;
        border: 1px solid rgba(0, 240, 255, 0.5);
        border-radius: 4px;
        padding: 3px 8px;
        font-family: inherit;
        font-size: 9.5px;
        font-weight: 700;
        cursor: pointer;
      }
      .vs-toast-btn:hover {
        background: #00f0ff;
        color: #000;
      }

      #vs-root-overlay {
        --bg: #08090c;
        --panel: #0e1015;
        --ribbon: #13161f;
        --border: rgba(255, 255, 255, 0.16);
        --text: #e8ecf2;
        --muted: rgba(255, 255, 255, 0.58);
        --theme-color: #00f0ff;
        --danger: #ff334b;
        --success: #39ff14;
        --ar-accent: #ffb800;
        --font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        position: fixed !important;
        bottom: 88px;
        right: 24px;
        width: 560px;
        min-width: 360px;
        max-width: calc(100vw - 16px);
        background: rgba(8, 9, 12, 0.96);
        border: 1px solid var(--border);
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.85);
        color: var(--text);
        font-family: var(--font-mono);
        font-size: 10.5px;
        z-index: 2147483647 !important;
        display: none;
        flex-direction: column;
        border-radius: 10px;
        overflow: hidden;
        backdrop-filter: blur(12px);
        user-select: none;
      }
      #vs-root-overlay.vs-open {
        display: flex !important;
      }
      #vs-root-overlay.hide-preview .vs-viewport {
        display: none !important;
      }

      /* BARRE D'ONGLETS SUPÉRIEURE AVEC DÉFILEMENT HORIZONTAL FLUIDE */
      .vs-topbar {
        min-height: 34px;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px;
        gap: 6px;
        cursor: grab;
      }
      .vs-topbar:active {
        cursor: grabbing;
      }
      .vs-brand {
        display: flex;
        align-items: center;
        gap: 5px;
        font-weight: 700;
        font-size: 10.5px;
        padding-right: 8px;
        border-right: 1px solid var(--border);
        white-space: nowrap;
        pointer-events: none;
        flex-shrink: 0;
      }
      .vs-brand-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--theme-color);
        box-shadow: 0 0 8px var(--theme-color);
      }
      .vs-tabs {
        display: flex;
        align-items: stretch;
        gap: 2px;
        height: 34px;
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        -ms-overflow-style: none;
        scroll-behavior: smooth;
      }
      .vs-tabs::-webkit-scrollbar {
        display: none;
      }
      .vs-tab-btn {
        background: transparent;
        color: var(--muted);
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0 8px;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.12s ease;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .vs-tab-btn:hover {
        color: var(--text);
        background: rgba(255, 255, 255, 0.04);
      }
      .vs-tab-btn.active {
        color: var(--theme-color);
        border-bottom-color: var(--theme-color);
        background: rgba(0, 240, 255, 0.07);
      }
      .vs-status-Cluster {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
        flex-shrink: 0;
      }
      .vs-led-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 9px;
        font-weight: 700;
        border: 1px solid var(--border);
        color: var(--muted);
        background: rgba(0, 0, 0, 0.35);
      }
      .vs-led-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #666;
      }
      .vs-led-pill.on {
        color: var(--success);
        border-color: rgba(57, 255, 20, 0.5);
      }
      .vs-led-pill.on .vs-led-dot {
        background: var(--success);
        box-shadow: 0 0 6px var(--success);
      }
      .vs-led-pill.err {
        color: var(--danger);
        border-color: var(--danger);
      }
      .vs-led-pill.err .vs-led-dot {
        background: var(--danger);
      }

      /* RUBAN CONTEXTUEL + ACTIONS FIGÉES (UNDO / CLEAR) À DROITE */
      .vs-ribbon {
        background: var(--ribbon);
        border-bottom: 1px solid var(--border);
        min-height: 38px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        gap: 6px;
      }
      .vs-ribbon-pane {
        display: none;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        flex: 1;
        min-width: 0;
      }
      .vs-ribbon-pane.active {
        display: flex;
      }
      .vs-ribbon-pinned {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding-left: 6px;
        border-left: 1px solid var(--border);
        flex-shrink: 0;
      }
      .vs-sep {
        width: 1px;
        height: 18px;
        background: var(--border);
        margin: 0 2px;
      }
      .vs-btn {
        background: rgba(255, 255, 255, 0.03);
        color: var(--text);
        border: 1px solid var(--border);
        padding: 4px 7px;
        font-family: var(--font-mono);
        font-size: 9.5px;
        cursor: pointer;
        transition: all 0.12s ease;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 4px;
      }
      .vs-btn:hover {
        border-color: rgba(255, 255, 255, 0.4);
        background: rgba(255, 255, 255, 0.1);
      }
      .vs-btn.active {
        background: var(--theme-color);
        color: #000;
        font-weight: 700;
        border-color: var(--theme-color);
      }
      .vs-btn-ar {
        border-color: rgba(255, 184, 0, 0.55);
        color: #ffb800;
        background: rgba(255, 184, 0, 0.08);
      }
      .vs-btn-ar:hover {
        background: rgba(255, 184, 0, 0.22);
        color: #fff;
      }
      .vs-btn-laser.active {
        background: #ff2a85;
        color: #fff;
        border-color: #ff2a85;
        box-shadow: 0 0 10px rgba(255, 42, 133, 0.6);
      }
      .vs-btn-danger.active {
        background: var(--danger);
        color: #fff;
        border-color: var(--danger);
      }
      .vs-btn-drawmode.active {
        background: var(--success);
        color: #000;
        border-color: var(--success);
        box-shadow: 0 0 10px rgba(57, 255, 20, 0.4);
      }
      .vs-control-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--muted);
        font-size: 9.5px;
        white-space: nowrap;
      }
      #vs-root-overlay select, #vs-root-overlay input[type="range"], #vs-root-overlay input[type="text"] {
        background: #0b0d13;
        color: var(--text);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: 9.5px;
        padding: 3px 6px;
        border-radius: 4px;
        outline: none;
      }
      #vs-root-overlay input[type="text"] {
        width: 115px;
      }
      #vs-root-overlay input[type="text"]:focus {
        border-color: var(--ar-accent);
      }
      #vs-root-overlay input[type="range"] {
        -webkit-appearance: none;
        width: 52px;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        padding: 0;
        border: none;
        cursor: pointer;
      }
      #vs-root-overlay input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--theme-color);
        cursor: pointer;
      }
      .vs-swatches {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .vs-swatch {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.35);
        cursor: pointer;
      }
      .vs-swatch.active {
        transform: scale(1.22);
        border: 2px solid #fff;
      }

      /* VIEWPORT VIDÉO + POIGNÉE DE REDIMENSIONNEMENT */
      .vs-viewport {
        position: relative;
        width: 100%;
        height: 270px;
        min-height: 150px;
        background: #050608;
        cursor: crosshair;
      }
      #vsMainCanvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .vs-hint {
        position: absolute;
        bottom: 5px;
        left: 7px;
        right: 26px;
        background: rgba(0, 0, 0, 0.75);
        border: 1px solid var(--border);
        padding: 2px 6px;
        font-size: 8.8px;
        color: rgba(255, 255, 255, 0.85);
        pointer-events: none;
        border-radius: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #vsResizeHandle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 20px;
        height: 20px;
        cursor: nwse-resize;
        color: var(--theme-color);
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        padding: 2px 3px;
        font-size: 11px;
        line-height: 1;
        background: linear-gradient(135deg, transparent 50%, rgba(0, 240, 255, 0.25) 50%);
        z-index: 10;
      }
      #vsResizeHandle:hover {
        background: linear-gradient(135deg, transparent 50%, rgba(0, 240, 255, 0.6) 50%);
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    // CONTENEUR DE TOASTS NON BLOQUANTS
    const toastContainer = document.createElement('div');
    toastContainer.id = 'vs-toast-container';
    document.body.appendChild(toastContainer);

    function showToast({ id = '', title, message, kind = 'error', duration = 6500, actionLabel = '', onAction = null }) {
      if (id) {
        const existing = toastContainer.querySelector(`[data-toast-id="${id}"]`);
        if (existing) existing.remove();
      }
      const toast = document.createElement('div');
      toast.className = `vs-toast vs-toast-${kind}`;
      if (id) toast.dataset.toastId = id;

      const header = document.createElement('div');
      header.className = 'vs-toast-header';

      const titleSpan = document.createElement('span');
      titleSpan.textContent = title || 'Vision Studio';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'vs-toast-close';
      closeBtn.textContent = '✕';
      closeBtn.onclick = () => toast.remove();

      header.appendChild(titleSpan);
      header.appendChild(closeBtn);
      toast.appendChild(header);

      const body = document.createElement('div');
      body.textContent = message || '';
      toast.appendChild(body);

      if (actionLabel && typeof onAction === 'function') {
        const actions = document.createElement('div');
        actions.className = 'vs-toast-actions';
        const actBtn = document.createElement('button');
        actBtn.className = 'vs-toast-btn';
        actBtn.textContent = actionLabel;
        actBtn.onclick = () => {
          toast.remove();
          onAction();
        };
        actions.appendChild(actBtn);
        toast.appendChild(actions);
      }

      toastContainer.appendChild(toast);
      if (duration > 0) {
        setTimeout(() => {
          if (toast.isConnected) toast.remove();
        }, duration);
      }
    }

    // 2. BULLE FLOTTANTE + MINI-APERÇU LOCAL (224x126 px)
    const bubble = document.createElement('div');
    bubble.id = 'vs-floating-bubble';
    bubble.title = 'Vision Studio — Cliquer pour ouvrir / Glisser pour déplacer';
    bubble.innerHTML = `✦<span class="vs-bubble-dot"></span>`;
    document.body.appendChild(bubble);

    const miniPreview = document.createElement('div');
    miniPreview.id = 'vs-mini-preview';
    miniPreview.title = 'Aperçu local Vision Studio (non envoyé tel quel) — Cliquer pour agrandir';
    miniPreview.innerHTML = `
      <canvas id="vsMiniPreviewCanvas" width="224" height="126"></canvas>
      <span class="vs-mini-tag">APERÇU LOCAL</span>
    `;
    document.body.appendChild(miniPreview);
    const miniPreviewCanvas = miniPreview.querySelector('#vsMiniPreviewCanvas');
    const miniPreviewCtx = miniPreviewCanvas.getContext('2d');

    // 3. FENÊTRE AVEC RUBAN À 4 ONGLETS + BOUTONS UNDO/CLEAR FIGÉS
    const root = document.createElement('div');
    root.id = 'vs-root-overlay';
    root.innerHTML = `
      <header class="vs-topbar" id="vsDragHeader" title="Glisser cette barre pour déplacer la fenêtre (Molette sur les onglets pour défiler)">
        <div class="vs-brand">
          <span class="vs-brand-dot"></span>
          <span>VISION</span>
        </div>

        <nav class="vs-tabs" id="vsTabsNav">
          <button class="vs-tab-btn active" data-tab="home">🏠 Accueil</button>
          <button class="vs-tab-btn" data-tab="insert">➕ Insertion & AR</button>
          <button class="vs-tab-btn" data-tab="style">🎨 Dessin & Style</button>
          <button class="vs-tab-btn" data-tab="settings">⚙️ Caméra & IA</button>
        </nav>

        <div class="vs-status-Cluster">
          <button class="vs-btn active" id="vsExtActiveBtn" title="Activer ou désactiver l'extension (OFF = vraie caméra directe dans Meet)">🟢 Ext: ON</button>
          <div class="vs-led-pill" id="vsClutchBadge" title="Embrayage écriture (Maintenir Espace en Mode dessin ou Poing Gauche)">
            <span class="vs-led-dot"></span><span id="vsClutchText">⚡ OFF</span>
          </div>
          <div class="vs-led-pill" id="vsAiBadge" title="Statut du suivi des mains MediaPipe">
            <span class="vs-led-dot"></span><span id="vsAiText">IA…</span>
          </div>
          <button class="vs-btn active" id="vsPreviewToggleBtn" title="Afficher / Masquer le retour vidéo">📺</button>
          <button class="vs-btn" id="vsCollapseBtn" title="Réduire dans la bulle flottante">➖</button>
        </div>
      </header>

      <div class="vs-ribbon">
        <!-- ONGLET 1 : ACCUEIL -->
        <div class="vs-ribbon-pane active" data-pane="home">
          <button class="vs-btn" id="vsCamBtn">📷 START CAM</button>
          <button class="vs-btn vs-btn-danger" id="vsStopCamBtn" title="Arrêter les pistes caméra et rendre la barre Espace à Meet">⏹️ STOP CAM</button>
          <button class="vs-btn vs-btn-drawmode" id="vsDrawModeBtn" title="Capturer Espace pour dessiner (OFF = Push-to-Talk Meet actif)">✍️ Mode dessin: OFF</button>
          <div class="vs-sep"></div>
          <button class="vs-btn vs-btn-laser" id="vsLaserQuickBtn" title="Encre éphémère qui disparaît au bout de 2 secondes">☄️ Laser</button>
          <button class="vs-btn vs-btn-danger" id="vsEraserBtn" title="Gomme au doigt">🧽 Gomme</button>
        </div>

        <!-- ONGLET 2 : INSERTION & RÉALITÉ AUGMENTÉE -->
        <div class="vs-ribbon-pane" data-pane="insert">
          <button class="vs-btn vs-btn-ar" id="vsArWinBtn" title="Capturer une fenêtre (Excel, VS Code, Chrome) en direct (15 fps max, 3 max)">🖥️ Fenêtre AR</button>
          <button class="vs-btn vs-btn-ar" id="vsArImgBtn" title="Importer une image (ou Ctrl+V)">🖼️ Image</button>
          <input type="file" id="vsArFileInput" accept="image/*" style="display:none;" />
          <div class="vs-control-group">
            <input type="text" id="vsArTextInput" placeholder="Note Texte AR…" title="Tape un texte puis Entrée pour créer une carte AR" />
            <button class="vs-btn vs-btn-ar" id="vsArTextAddBtn" title="Ajouter la note en réalité augmentée">➕</button>
          </div>
          <div class="vs-sep"></div>
          <button class="vs-btn" id="vsAirMenuToggleBtn" title="Afficher/Masquer la barre des 6 formes géométriques sur la vidéo">📐 Formes: OFF</button>
          <div class="vs-control-group" title="Transparence des fenêtres AR (pour te voir à travers)">
            <span>Opacité</span>
            <input type="range" id="vsArOpacitySlider" min="0.25" max="1" step="0.05" value="0.92" />
          </div>
          <button class="vs-btn" id="vsArFlipBtn" title="Inverser horizontalement les fenêtres AR">⇄ Flip AR</button>
        </div>

        <!-- ONGLET 3 : DESSIN & STYLE -->
        <div class="vs-ribbon-pane" data-pane="style">
          <button class="vs-btn vs-btn-laser" id="vsLaserStyleBtn" title="Le trait s'efface tout seul après 2 secondes">☄️ Mode Laser (2s)</button>
          <div class="vs-sep"></div>
          <div class="vs-swatches">
            <div class="vs-swatch active" data-color="#00f0ff" style="background:#00f0ff"></div>
            <div class="vs-swatch" data-color="#ffffff" style="background:#ffffff"></div>
            <div class="vs-swatch" data-color="#39ff14" style="background:#39ff14"></div>
            <div class="vs-swatch" data-color="#ffb800" style="background:#ffb800"></div>
            <div class="vs-swatch" data-color="#ff2a85" style="background:#ff2a85"></div>
            <div class="vs-swatch" data-color="#a855f7" style="background:#a855f7"></div>
            <input type="color" id="vsColorPicker" value="#00f0ff" style="width:16px;height:15px;padding:0;border:none;background:none;cursor:pointer;" />
          </div>
          <div class="vs-sep"></div>
          <div class="vs-control-group">
            <span>Trait</span>
            <input type="range" id="vsStrokeSlider" min="1.5" max="12" step="0.5" value="3.5" />
          </div>
          <button class="vs-btn" id="vsSmartBtn" title="Reconnaissance automatique de formes géométriques (cercle, rectangle, ligne) à la fin du tracé">✦ Smart Shape</button>
          <button class="vs-btn" id="vsFillBtn" title="Remplir les formes géométriques">▢ Fill</button>
        </div>

        <!-- ONGLET 4 : CAMÉRA & IA -->
        <div class="vs-ribbon-pane" data-pane="settings">
          <div class="vs-control-group">
            <span>Cam</span>
            <select id="vsCameraSelect"><option value="">Caméra PC / Tel</option></select>
          </div>
          <div class="vs-control-group" title="Sensibilité du pincement des doigts">
            <span>Pinch</span>
            <input type="range" id="vsPinchSlider" min="0.35" max="0.85" step="0.02" value="0.58" />
          </div>
          <div class="vs-sep"></div>
          <button class="vs-btn active" id="vsMirrorBtn" title="Inverser uniquement l'aperçu local en miroir">⇄ Miroir</button>
          <button class="vs-btn" id="vsHudMeetBtn" title="Montrer ou cacher le curseur et le HUD aux participants Meet">👁️ HUD Meet: OFF</button>
          <button class="vs-btn" id="vsBwBtn" title="Filtre Noir & Blanc">◑ N&B</button>
          <button class="vs-btn" id="vsEcoBtn" title="Mode économie : allège le CPU/GPU (IA 15 fps, flux 20 fps, sans flous lumineux)">🍃 Éco: OFF</button>
        </div>

        <!-- ZONE FIGÉE À DROITE SUR TOUS LES ONGLETS : UNDO & CLEAR -->
        <div class="vs-ribbon-pinned">
          <button class="vs-btn" id="vsUndoBtn" title="Annuler le dernier élément">↩</button>
          <button class="vs-btn" id="vsClearBtn" title="Tout effacer">✕ Clear</button>
        </div>
      </div>

      <main class="vs-viewport" id="vsViewport">
        <canvas id="vsMainCanvas"></canvas>
        <div class="vs-hint" id="vsHintText">
          GESTES AUTO : [POING G] ou [ESPACE] = DESSINER · [PINCER 1 MAIN] = DÉPLACER · [PINCER 2 MAINS] = ZOOMER
        </div>
        <div id="vsResizeHandle" title="Glisser pour agrandir ou rétrécir la fenêtre">◢</div>
      </main>
    `;
    document.body.appendChild(root);

    const resizeHandle = document.getElementById('vsResizeHandle');
    const viewportEl = document.getElementById('vsViewport');

    function applyStoredGeometry() {
      if (state.bubblePos && typeof state.bubblePos.left === 'number' && typeof state.bubblePos.top === 'number') {
        const clampedLeft = Math.max(8, Math.min(window.innerWidth - 60, state.bubblePos.left));
        const clampedTop = Math.max(8, Math.min(window.innerHeight - 60, state.bubblePos.top));
        bubble.style.right = 'auto';
        bubble.style.bottom = 'auto';
        bubble.style.left = `${Math.round(clampedLeft)}px`;
        bubble.style.top = `${Math.round(clampedTop)}px`;
      }

      if (state.windowBounds) {
        if (typeof state.windowBounds.width === 'number') {
          const w = Math.max(360, Math.min(window.innerWidth - 20, state.windowBounds.width));
          root.style.width = `${Math.round(w)}px`;
        }
        if (typeof state.windowBounds.viewportHeight === 'number') {
          const h = Math.max(160, Math.min(window.innerHeight - 110, state.windowBounds.viewportHeight));
          viewportEl.style.height = `${Math.round(h)}px`;
        }
        if (typeof state.windowBounds.left === 'number' && typeof state.windowBounds.top === 'number') {
          const left = Math.max(4, Math.min(window.innerWidth - 220, state.windowBounds.left));
          const top = Math.max(4, Math.min(window.innerHeight - 60, state.windowBounds.top));
          root.style.right = 'auto';
          root.style.bottom = 'auto';
          root.style.left = `${Math.round(left)}px`;
          root.style.top = `${Math.round(top)}px`;
        }
      }
    }

    function applyStoredControlsToUI() {
      root.style.setProperty('--theme-color', state.color);
      const colorPicker = document.getElementById('vsColorPicker');
      if (colorPicker) colorPicker.value = state.color;

      root.querySelectorAll('.vs-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === state.color.toLowerCase());
      });

      document.getElementById('vsStrokeSlider').value = String(state.strokeWidth);
      document.getElementById('vsArOpacitySlider').value = String(state.arOpacity);
      document.getElementById('vsPinchSlider').value = String(state.pinchThreshold);

      const drawBtn = document.getElementById('vsDrawModeBtn');
      drawBtn.classList.toggle('active', state.drawMode);
      drawBtn.textContent = state.drawMode ? '✍️ Mode dessin: ON' : '✍️ Mode dessin: OFF';

      document.getElementById('vsLaserQuickBtn').classList.toggle('active', state.laserMode);
      document.getElementById('vsLaserStyleBtn').classList.toggle('active', state.laserMode);

      const airMenuBtn = document.getElementById('vsAirMenuToggleBtn');
      airMenuBtn.classList.toggle('active', state.showAirMenu);
      airMenuBtn.textContent = state.showAirMenu ? '📐 Formes: ON' : '📐 Formes: OFF';

      document.getElementById('vsSmartBtn').classList.toggle('active', state.smartShape);
      document.getElementById('vsFillBtn').classList.toggle('active', state.filled);
      document.getElementById('vsMirrorBtn').classList.toggle('active', state.mirror);
      document.getElementById('vsBwBtn').classList.toggle('active', state.bwFilter);
      document.getElementById('vsArFlipBtn').classList.toggle('active', state.arFlip);

      const hudBtn = document.getElementById('vsHudMeetBtn');
      hudBtn.classList.toggle('active', state.showHudOnMeet);
      hudBtn.textContent = state.showHudOnMeet ? '👁️ HUD Meet: ON' : '👁️ HUD Meet: OFF';

      const ecoBtn = document.getElementById('vsEcoBtn');
      ecoBtn.classList.toggle('active', state.ecoMode);
      ecoBtn.textContent = state.ecoMode ? '🍃 Éco: ON' : '🍃 Éco: OFF';
    }

    applyStoredGeometry();
    applyStoredControlsToUI();

    const tabsNav = document.getElementById('vsTabsNav');
    tabsNav.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        tabsNav.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    root.querySelectorAll('.vs-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        const targetTab = tabBtn.dataset.tab;
        root.querySelectorAll('.vs-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
        root.querySelectorAll('.vs-ribbon-pane').forEach(pane => {
          pane.classList.toggle('active', pane.dataset.pane === targetTab);
        });
        tabBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        e.currentTarget.blur();
      });
    });

    const sourceVideo = document.createElement('video');
    sourceVideo.id = 'vsSourceVideo';
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(sourceVideo);

    const sandboxFrame = document.createElement('iframe');
    sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
    sandboxFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(sandboxFrame);

    let panelOpen = false;
    let ignoreOutsideClickUntil = 0;

    function syncSpaceGuard() {
      guard.camActive = Boolean(state.extEnabled && state.cameraActive && state.drawMode);
      if (!guard.camActive) {
        releaseSpace();
      }
    }

    function positionMiniPreview() {
      if (panelOpen || !state.cameraActive || !state.extEnabled) {
        miniPreview.classList.remove('vs-visible');
        return;
      }
      miniPreview.classList.add('vs-visible');
      const bRect = bubble.getBoundingClientRect();
      const previewW = 224;
      const previewH = 126;
      let left = bRect.left - previewW - 12;
      if (left < 8) {
        left = Math.min(window.innerWidth - previewW - 8, bRect.right + 12);
      }
      let top = bRect.bottom - previewH;
      top = Math.max(8, Math.min(window.innerHeight - previewH - 8, top));
      miniPreview.style.left = `${Math.round(left)}px`;
      miniPreview.style.top = `${Math.round(top)}px`;
    }

    function syncVisibility() {
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
      if (!toastContainer.isConnected) document.body.appendChild(toastContainer);
      if (!bubble.isConnected) document.body.appendChild(bubble);
      if (!miniPreview.isConnected) document.body.appendChild(miniPreview);
      if (!root.isConnected) document.body.appendChild(root);
      if (!sourceVideo.isConnected) document.body.appendChild(sourceVideo);
      if (!sandboxFrame.isConnected) document.body.appendChild(sandboxFrame);

      root.classList.toggle('vs-open', panelOpen);
      bubble.classList.toggle('vs-hidden', panelOpen);
      positionMiniPreview();
    }

    function openPanel() {
      panelOpen = true;
      syncVisibility();
    }

    function collapseToBubble() {
      panelOpen = false;
      syncVisibility();
    }

    miniPreview.addEventListener('click', () => {
      openPanel();
    });

    setInterval(syncVisibility, 800);
    syncVisibility();

    // 4. DRAG & DROP DE LA BULLE FLOTTANTE
    let bDrag = { active: false, moved: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 };
    bubble.addEventListener('pointerdown', (e) => {
      bDrag.active = true;
      bDrag.moved = false;
      bDrag.startX = e.clientX;
      bDrag.startY = e.clientY;
      const rect = bubble.getBoundingClientRect();
      bDrag.initLeft = rect.left;
      bDrag.initTop = rect.top;
      bubble.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    bubble.addEventListener('pointermove', (e) => {
      if (!bDrag.active) return;
      const dx = e.clientX - bDrag.startX;
      const dy = e.clientY - bDrag.startY;
      if (Math.hypot(dx, dy) > 5) bDrag.moved = true;
      if (bDrag.moved) {
        const newLeft = Math.max(8, Math.min(window.innerWidth - 60, bDrag.initLeft + dx));
        const newTop = Math.max(8, Math.min(window.innerHeight - 60, bDrag.initTop + dy));
        bubble.style.right = 'auto';
        bubble.style.bottom = 'auto';
        bubble.style.left = `${Math.round(newLeft)}px`;
        bubble.style.top = `${Math.round(newTop)}px`;
        state.bubblePos = { left: Math.round(newLeft), top: Math.round(newTop) };
        positionMiniPreview();
        scheduleSaveSettings();
      }
    });

    bubble.addEventListener('pointerup', (e) => {
      if (!bDrag.active) return;
      bDrag.active = false;
      bubble.releasePointerCapture(e.pointerId);
      if (!bDrag.moved) openPanel();
    });

    // 5. DRAG & DROP DE LA FENÊTRE VISION STUDIO
    const dragHeader = document.getElementById('vsDragHeader');
    let wDrag = { active: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 };

    function recordWindowBounds() {
      const rootRect = root.getBoundingClientRect();
      const vpRect = viewportEl.getBoundingClientRect();
      state.windowBounds = {
        left: Math.round(rootRect.left),
        top: Math.round(rootRect.top),
        width: Math.round(rootRect.width),
        viewportHeight: Math.round(vpRect.height)
      };
      scheduleSaveSettings();
    }

    dragHeader.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      wDrag.active = true;
      wDrag.startX = e.clientX;
      wDrag.startY = e.clientY;
      const rect = root.getBoundingClientRect();
      wDrag.initLeft = rect.left;
      wDrag.initTop = rect.top;
      dragHeader.setPointerCapture(e.pointerId);
    });

    dragHeader.addEventListener('pointermove', (e) => {
      if (!wDrag.active) return;
      const dx = e.clientX - wDrag.startX;
      const dy = e.clientY - wDrag.startY;
      const newLeft = Math.max(4, Math.min(window.innerWidth - 220, wDrag.initLeft + dx));
      const newTop = Math.max(4, Math.min(window.innerHeight - 60, wDrag.initTop + dy));
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = `${Math.round(newLeft)}px`;
      root.style.top = `${Math.round(newTop)}px`;
      recordWindowBounds();
    });

    dragHeader.addEventListener('pointerup', (e) => {
      if (!wDrag.active) return;
      wDrag.active = false;
      dragHeader.releasePointerCapture(e.pointerId);
      recordWindowBounds();
    });

    // 6. REDIMENSIONNEMENT DE LA FENÊTRE
    let rDrag = { active: false, startX: 0, startY: 0, startW: 560, startH: 270 };

    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      rDrag.active = true;
      rDrag.startX = e.clientX;
      rDrag.startY = e.clientY;
      const rootRect = root.getBoundingClientRect();
      const vpRect = viewportEl.getBoundingClientRect();
      rDrag.startW = rootRect.width;
      rDrag.startH = vpRect.height;
      root.style.left = `${rootRect.left}px`;
      root.style.top = `${rootRect.top}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      resizeHandle.setPointerCapture(e.pointerId);
    });

    resizeHandle.addEventListener('pointermove', (e) => {
      if (!rDrag.active) return;
      const dx = e.clientX - rDrag.startX;
      const dy = e.clientY - rDrag.startY;
      const newW = Math.max(360, Math.min(window.innerWidth - 20, rDrag.startW + dx));
      const newH = Math.max(160, Math.min(window.innerHeight - 110, rDrag.startH + dy));
      root.style.width = `${Math.round(newW)}px`;
      viewportEl.style.height = `${Math.round(newH)}px`;
      recordWindowBounds();
    });

    resizeHandle.addEventListener('pointerup', (e) => {
      if (!rDrag.active) return;
      rDrag.active = false;
      resizeHandle.releasePointerCapture(e.pointerId);
      recordWindowBounds();
    });

    document.addEventListener('pointerdown', (e) => {
      if (!panelOpen || performance.now() < ignoreOutsideClickUntil) return;
      if (!root.contains(e.target) && !bubble.contains(e.target) && !toastContainer.contains(e.target)) {
        collapseToBubble();
      }
    }, true);

    document.getElementById('vsCollapseBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      collapseToBubble();
    });

    document.getElementById('vsPreviewToggleBtn').addEventListener('click', (e) => {
      const hidden = root.classList.toggle('hide-preview');
      e.currentTarget.classList.toggle('active', !hidden);
      e.currentTarget.blur();
    });

    // ==========================================================================
    // 7. MOTEUR GRAPHIQUE, CACHE HORS-ÉCRAN, PLAFONDS & MEDIAPIPE
    // ==========================================================================
    const aiMiniCanvas = document.createElement('canvas');
    aiMiniCanvas.width = 384;
    aiMiniCanvas.height = 216;
    const aiMiniCtx = aiMiniCanvas.getContext('2d');

    let sandboxBusy = false;
    let lastSentTime = 0;
    let aiReady = false;

    const mainCanvas = document.getElementById('vsMainCanvas');
    const ctx = mainCanvas.getContext('2d');
    const clutchBadge = document.getElementById('vsClutchBadge');
    const clutchText = document.getElementById('vsClutchText');
    const aiBadge = document.getElementById('vsAiBadge');
    const aiText = document.getElementById('vsAiText');

    mainCanvas.width = 960;
    mainCanvas.height = 540;

    // Calques de cache hors-écran pour les formes statiques (local et flux sortant)
    const localStaticCacheCanvas = document.createElement('canvas');
    localStaticCacheCanvas.width = 960;
    localStaticCacheCanvas.height = 540;
    const localStaticCacheCtx = localStaticCacheCanvas.getContext('2d');
    let localStaticSignature = '';

    const streamStaticCacheCanvas = document.createElement('canvas');
    streamStaticCacheCanvas.width = 960;
    streamStaticCacheCanvas.height = 540;
    const streamStaticCacheCtx = streamStaticCacheCanvas.getContext('2d');
    let streamStaticSignature = '';

    let shapes = [];
    let shapeCounter = 1;
    let handsData = [];
    let prevHandsPinching = { R: false, L: false };
    let smoothPinchCoords = { R: { x: 0, y: 0 }, L: { x: 0, y: 0 } };
    let smoothIndexCoords = { R: { x: 0, y: 0 }, L: { x: 0, y: 0 } };
    let prevWriteActive = false;
    let grabbedShape = null;
    let grabOffset = { x: 0, y: 0 };
    let activeAirStroke = [];
    let menuCooldown = 0;
    let twoHandStretch = {
      active: false,
      shape: null,
      initialDist: 1,
      initialSize: 100,
      initialAngle: 0,
      initialRot: 0,
      offsetX: 0,
      offsetY: 0
    };

    const AIR_MENU_ITEMS = [
      { type: 'circle', label: 'CIRCLE' },
      { type: 'rect', label: 'RECT' },
      { type: 'triangle', label: 'TRIANGLE' },
      { type: 'star', label: 'STAR' },
      { type: 'hexagon', label: 'HEXAGON' },
      { type: 'line', label: 'LINE' }
    ];

    function setAiStatus(kind, msg) {
      aiReady = kind === 'ready';
      aiBadge.classList.toggle('on', kind === 'ready');
      aiBadge.classList.toggle('err', kind === 'error');
      aiText.textContent = kind === 'ready' ? 'IA OK' : (kind === 'error' ? 'IA ERR' : 'IA…');
      if (msg) aiBadge.title = msg;
    }

    function retryMediaPipeSandbox() {
      setAiStatus('loading', 'Rechargement de MediaPipe…');
      sandboxBusy = false;
      sandboxFrame.src = chrome.runtime.getURL('sandbox.html') + '?retry=' + Date.now();
    }

    function setThemeColor(hex) {
      state.color = hex;
      root.style.setProperty('--theme-color', hex);
      const picker = document.getElementById('vsColorPicker');
      if (picker && picker.value.toLowerCase() !== hex.toLowerCase()) {
        picker.value = hex;
      }
      root.querySelectorAll('.vs-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === hex.toLowerCase());
      });
      scheduleSaveSettings();
    }

    function hexToRgba(hex, alpha) {
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    function setDrawMode(enabled) {
      state.drawMode = Boolean(enabled);
      const drawBtn = document.getElementById('vsDrawModeBtn');
      if (drawBtn) {
        drawBtn.classList.toggle('active', state.drawMode);
        drawBtn.textContent = state.drawMode ? '✍️ Mode dessin: ON' : '✍️ Mode dessin: OFF';
      }
      syncSpaceGuard();
      updateClutchBadge();
      scheduleSaveSettings();
    }

    function toggleLaserMode() {
      state.laserMode = !state.laserMode;
      if (state.laserMode) {
        state.eraser = false;
        document.getElementById('vsEraserBtn').classList.remove('active');
      }
      document.getElementById('vsLaserQuickBtn').classList.toggle('active', state.laserMode);
      document.getElementById('vsLaserStyleBtn').classList.toggle('active', state.laserMode);
      scheduleSaveSettings();
    }

    guard.onDown = () => { state.spacePressed = true; updateClutchBadge(); };
    guard.onUp = () => { state.spacePressed = false; updateClutchBadge(); };

    function isClutchEngaged() {
      return (state.drawMode && state.spacePressed) || state.leftHandClutch;
    }

    function updateClutchBadge() {
      const engaged = isClutchEngaged();
      clutchBadge.classList.toggle('on', engaged);
      bubble.classList.toggle('clutch-active', engaged);
      if (engaged) {
        const src = (state.drawMode && state.spacePressed) ? 'ESP' : 'POING G';
        clutchText.textContent = `⚡ ${src}`;
      } else {
        clutchText.textContent = '⚡ OFF';
      }
    }

    function isArObject(s) {
      return s && (s.type === 'ar-window' || s.type === 'ar-image' || s.type === 'ar-text');
    }

    function cleanupShapeResources(s) {
      if (!s) return;
      if (s.mediaStream) {
        try { s.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      }
      if (s.videoEl && s.videoEl.parentNode) {
        try { s.videoEl.parentNode.removeChild(s.videoEl); } catch (e) {}
      }
      if (s.frameCacheCanvas) {
        s.frameCacheCanvas = null;
        s.frameCacheCtx = null;
      }
    }

    // Plafond de 300 objets et 3 fenêtres AR
    function checkArObjectCap() {
      const currentArCount = shapes.filter(isArObject).length;
      if (currentArCount >= MAX_AR_OBJECTS) {
        showToast({
          id: 'ar-cap',
          title: 'Plafond AR atteint (3 max)',
          message: `Vous avez déjà ${MAX_AR_OBJECTS} objets AR actifs. Fermez-en un avec [✕] avant d'en ajouter un nouveau.`,
          kind: 'warn',
          duration: 4500
        });
        return false;
      }
      return true;
    }

    function pushShapeWithCap(newObj) {
      if (!newObj) return;
      shapes.push(newObj);
      while (shapes.length > MAX_SHAPES) {
        const idx = shapes.findIndex(s => !isArObject(s));
        if (idx !== -1) {
          const [removed] = shapes.splice(idx, 1);
          cleanupShapeResources(removed);
        } else {
          break;
        }
      }
    }

    // ANCRAGE DES ANNOTATIONS SUR LES FENÊTRES AR
    function findArObjectUnderPoint(x, y) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!isArObject(s)) continue;
        const halfW = s.size / 2;
        const halfH = (s.size / (s.aspect || 1.6)) / 2;
        if (x >= s.x - halfW && x <= s.x + halfW && y >= s.y - halfH && y <= s.y + halfH) {
          return s;
        }
      }
      return null;
    }

    function attachAnnotationToArParentIfInside(childObj) {
      if (!childObj || isArObject(childObj) || childObj.isLaser) return;
      const parentAr = findArObjectUnderPoint(childObj.x, childObj.y);
      if (!parentAr) return;
      childObj.parentId = parentAr.id;
      childObj.relX = (childObj.x - parentAr.x) / parentAr.size;
      childObj.relY = (childObj.y - parentAr.y) / parentAr.size;
      childObj.relScale = childObj.size / parentAr.size;
      childObj.baseStrokeRatio = childObj.strokeWidth / parentAr.size;
    }

    function syncAttachedAnnotations() {
      const arMap = new Map();
      for (let i = 0; i < shapes.length; i++) {
        if (isArObject(shapes[i])) arMap.set(shapes[i].id, shapes[i]);
      }
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (!s.parentId) continue;
        const parent = arMap.get(s.parentId);
        if (!parent) {
          delete s.parentId;
          continue;
        }
        if (s === grabbedShape) {
          s.relX = (s.x - parent.x) / parent.size;
          s.relY = (s.y - parent.y) / parent.size;
        } else {
          s.x = parent.x + s.relX * parent.size;
          s.y = parent.y + s.relY * parent.size;
          s.size = Math.max(4, s.relScale * parent.size);
          if (s.baseStrokeRatio) {
            s.strokeWidth = Math.max(1.5, Math.min(14, s.baseStrokeRatio * parent.size));
          }
        }
      }
    }

    function removeShapeAndChildren(targetShape) {
      if (!targetShape) return;
      cleanupShapeResources(targetShape);
      shapes = shapes.filter(s => s !== targetShape && s.parentId !== targetShape.id);
    }

    function findArCloseButtonHit(x, y) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!isArObject(s)) continue;
        const halfW = s.size / 2;
        const halfH = (s.size / (s.aspect || 1.6)) / 2;
        const btnX = s.x + halfW - 24;
        const btnY = s.y - halfH - 22;
        if (x >= btnX - 6 && x <= btnX + 30 && y >= btnY - 6 && y <= btnY + 26) {
          return s;
        }
      }
      return null;
    }

    function createShapeObject(type, x, y, size = 110, points = null, isLaser = false) {
      const obj = {
        id: `OBJ${shapeCounter++}`,
        type, x, y, size,
        rotation: 0,
        color: state.color,
        strokeWidth: state.strokeWidth,
        filled: state.filled,
        points,
        isLaser,
        createdAt: isLaser ? performance.now() : 0
      };
      attachAnnotationToArParentIfInside(obj);
      return obj;
    }

    function createArMediaObject(type, mediaEl, naturalW, naturalH, labelText, mediaStream = null) {
      if (!checkArObjectCap()) {
        if (mediaStream) {
          try { mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        }
        return null;
      }
      const aspect = Math.max(0.25, Math.min(4, (naturalW || 16) / (naturalH || 9)));
      const obj = {
        id: `AR${shapeCounter++}`,
        type,
        label: labelText || (type === 'ar-window' ? 'LIVE WINDOW' : 'IMAGE AR'),
        x: mainCanvas.width / 2,
        y: mainCanvas.height / 2 + 15,
        size: type === 'ar-text' ? 320 : 420,
        aspect,
        rotation: 0,
        color: state.color,
        strokeWidth: 2,
        mediaEl,
        videoEl: type === 'ar-window' ? mediaEl : null,
        mediaStream,
        lastCaptureMs: 0,
        frameCacheCanvas: null,
        frameCacheCtx: null
      };
      if (type === 'ar-window') {
        const fc = document.createElement('canvas');
        fc.width = Math.min(1280, Math.max(320, naturalW || 960));
        fc.height = Math.min(720, Math.max(180, naturalH || 540));
        obj.frameCacheCanvas = fc;
        obj.frameCacheCtx = fc.getContext('2d');
      }
      pushShapeWithCap(obj);
      return obj;
    }

    function createArTextCard(rawText) {
      const text = (rawText || '').trim();
      if (!text) return;
      if (!checkArObjectCap()) return;

      const cardCanvas = document.createElement('canvas');
      cardCanvas.width = 640;
      cardCanvas.height = 320;
      const cCtx = cardCanvas.getContext('2d');

      cCtx.fillStyle = 'rgba(10, 14, 24, 0.92)';
      cCtx.fillRect(0, 0, 640, 320);
      cCtx.strokeStyle = hexToRgba(state.color, 0.2);
      cCtx.lineWidth = 1;
      for (let gx = 40; gx < 640; gx += 40) {
        cCtx.beginPath(); cCtx.moveTo(gx, 0); cCtx.lineTo(gx, 320); cCtx.stroke();
      }
      for (let gy = 40; gy < 320; gy += 40) {
        cCtx.beginPath(); cCtx.moveTo(0, gy); cCtx.lineTo(640, gy); cCtx.stroke();
      }

      cCtx.fillStyle = state.color;
      cCtx.fillRect(0, 0, 10, 320);

      cCtx.fillStyle = '#ffffff';
      const fontSize = text.length > 55 ? 28 : (text.length > 25 ? 36 : 46);
      cCtx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
      cCtx.textBaseline = 'middle';

      const words = text.split(/\s+/);
      const lines = [];
      let currentLine = '';
      for (const w of words) {
        const test = currentLine ? `${currentLine} ${w}` : w;
        if (cCtx.measureText(test).width > 560 && currentLine) {
          lines.push(currentLine);
          currentLine = w;
        } else {
          currentLine = test;
        }
      }
      if (currentLine) lines.push(currentLine);

      const lineH = fontSize * 1.32;
      const startY = 160 - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, idx) => {
        cCtx.fillText(line, 36, startY + idx * lineH);
      });

      createArMediaObject('ar-text', cardCanvas, 640, 320, 'NOTE AR');
    }

    async function startArWindowCapture() {
      if (!checkArObjectCap()) return;
      try {
        ignoreOutsideClickUntil = performance.now() + 4000;
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 15 }
          },
          audio: false
        });
        const vEl = document.createElement('video');
        vEl.muted = true;
        vEl.playsInline = true;
        vEl.srcObject = displayStream;
        vEl.style.cssText = 'position:fixed;left:2px;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(vEl);
        await vEl.play();

        const track = displayStream.getVideoTracks()[0];
        const settings = track ? track.getSettings() : {};
        const natW = vEl.videoWidth || settings.width || 1280;
        const natH = vEl.videoHeight || settings.height || 720;
        const title = (track && track.label) ? track.label.slice(0, 20) : 'FENÊTRE LIVE';

        const arObj = createArMediaObject('ar-window', vEl, natW, natH, title, displayStream);

        if (track && arObj) {
          track.addEventListener('ended', () => {
            removeShapeAndChildren(arObj);
          }, { once: true });
        }
      } catch (err) {
        showToast({
          title: 'Capture d’écran annulée',
          message: 'Aucune fenêtre ou écran n’a été sélectionné pour la projection AR.',
          kind: 'warn',
          duration: 4000
        });
      }
    }

    // Révocation systématique d'ObjectURL après chargement ou erreur
    function loadArImageFromBlob(blob, labelName = 'TABLEAU / IMAGE') {
      if (!checkArObjectCap()) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        createArMediaObject('ar-image', img, img.naturalWidth || 800, img.naturalHeight || 600, labelName);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }

    document.getElementById('vsArWinBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      startArWindowCapture();
    });

    const arFileInput = document.getElementById('vsArFileInput');
    document.getElementById('vsArImgBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (!checkArObjectCap()) return;
      ignoreOutsideClickUntil = performance.now() + 4000;
      arFileInput.click();
    });

    arFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        loadArImageFromBlob(file, file.name.slice(0, 18).toUpperCase());
        arFileInput.value = '';
      }
    });

    const arTextInput = document.getElementById('vsArTextInput');
    document.getElementById('vsArTextAddBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      createArTextCard(arTextInput.value);
      arTextInput.value = '';
    });
    arTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createArTextCard(arTextInput.value);
        arTextInput.value = '';
        arTextInput.blur();
      }
    });

    window.addEventListener('paste', (e) => {
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      if (isTextEntry(target)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            loadArImageFromBlob(blob, 'CAPTURE COLLÉE');
            break;
          }
        }
      }
    });

    function classifyAndCreateShape(rawPoints) {
      if (rawPoints.length < 2) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      rawPoints.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
      const width = maxX - minX, height = maxY - minY;
      const diag = Math.hypot(width, height);
      if (diag < 2 && rawPoints.length < 2) return null;

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const size = Math.max(width, height, 18);

      if (state.smartShape && !state.laserMode && diag >= 28) {
        let pathLen = 0;
        for (let i = 1; i < rawPoints.length; i++) {
          pathLen += Math.hypot(rawPoints[i].x - rawPoints[i - 1].x, rawPoints[i].y - rawPoints[i - 1].y);
        }
        const startEndDist = Math.hypot(rawPoints[rawPoints.length - 1].x - rawPoints[0].x, rawPoints[rawPoints.length - 1].y - rawPoints[0].y);
        if (startEndDist / (pathLen || 1) > 0.82) {
          const s = createShapeObject('line', cx, cy, startEndDist);
          s.rotation = Math.atan2(rawPoints[rawPoints.length - 1].y - rawPoints[0].y, rawPoints[rawPoints.length - 1].x - rawPoints[0].x);
          return s;
        }
        if (startEndDist < diag * 0.65) {
          const radii = rawPoints.map(p => Math.hypot(p.x - cx, p.y - cy));
          const avgR = radii.reduce((a, b) => a + b, 0) / radii.length;
          const variance = radii.reduce((acc, r) => acc + Math.pow(r - avgR, 2), 0) / radii.length;
          if (Math.sqrt(variance) / (avgR || 1) < 0.25) return createShapeObject('circle', cx, cy, avgR * 2);
          return createShapeObject('rect', cx, cy, size);
        }
      }

      // Simplification Ramer-Douglas-Peucker avant stockage
      const simplified = simplifyRDP(rawPoints, state.laserMode ? 2.2 : 1.6);
      const normPts = simplified.map(p => ({ dx: (p.x - cx) / (size || 1), dy: (p.y - cy) / (size || 1) }));
      return createShapeObject('ink', cx, cy, size, normPts, state.laserMode);
    }

    function detectStrictHandFist(lm) {
      const wrist = lm[0];
      const dIndexTip = Math.hypot(lm[8].x - wrist.x, lm[8].y - wrist.y);
      const dIndexPip = Math.hypot(lm[6].x - wrist.x, lm[6].y - wrist.y);
      if (dIndexTip > dIndexPip * 1.02) return false;

      const otherPairs = [[12, 10], [16, 14], [20, 18]];
      for (const [tip, pip] of otherPairs) {
        if (Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y) > Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y) * 1.08) {
          return false;
        }
      }
      return true;
    }

    const EDGE_MARGIN = 0.08;
    function projectCoord(normVal, maxDim) {
      const scaled = (normVal - EDGE_MARGIN) / (1 - EDGE_MARGIN * 2);
      return Math.max(0, Math.min(maxDim, scaled * maxDim));
    }

    window.addEventListener('message', (e) => {
      if (!e.data || !sandboxFrame || e.source !== sandboxFrame.contentWindow) return;
      const type = e.data.type;
      if (type === 'VS_SANDBOX_READY') {
        setAiStatus('ready');
        sandboxBusy = false;
        return;
      }
      if (type === 'VS_SANDBOX_ERROR') {
        const errMsg = e.data.message || 'Échec du chargement de MediaPipe Hands.';
        setAiStatus('error', errMsg);
        sandboxBusy = false;
        showToast({
          id: 'mp-error',
          title: 'MediaPipe en échec',
          message: `${errMsg} Vérifiez votre connexion ou réessayez d'initialiser le moteur IA.`,
          kind: 'error',
          duration: 10000,
          actionLabel: '🔄 Réessayer',
          onAction: retryMediaPipeSandbox
        });
        return;
      }
      if (type === 'VS_HANDS_BUSY' || type === 'VS_FRAME_SKIPPED') {
        sandboxBusy = false;
        return;
      }
      if (type !== 'VS_HANDS_RESULTS') return;

      sandboxBusy = false;

      const w = mainCanvas.width;
      const h = mainCanvas.height;
      const mapX = (x) => projectCoord(state.mirror ? (1 - x) : x, w);
      const mapY = (y) => projectCoord(y, h);

      const rawHands = [];
      const handednessList = e.data.multiHandedness || [];

      if (e.data.multiHandLandmarks && e.data.multiHandLandmarks.length > 0) {
        e.data.multiHandLandmarks.forEach((lm, idx) => {
          const wristScreenX = mapX(lm[0].x);
          const isFist = detectStrictHandFist(lm);
          const mpLabel = (handednessList[idx] && handednessList[idx].label) ? handednessList[idx].label : '';
          const isAnatomicalLeft = (mpLabel === 'Right');

          rawHands.push({ lm, wristScreenX, isFist, isAnatomicalLeft });
        });

        if (rawHands.length === 1) {
          const h0 = rawHands[0];
          if (h0.isAnatomicalLeft && h0.isFist && h0.wristScreenX < w * 0.45) {
            h0.role = 'L';
          } else {
            h0.role = 'R';
          }
        } else if (rawHands.length >= 2) {
          if (rawHands[0].wristScreenX >= rawHands[1].wristScreenX) {
            rawHands[0].role = 'R';
            rawHands[1].role = 'L';
          } else {
            rawHands[0].role = 'L';
            rawHands[1].role = 'R';
          }
        }
      }

      const detected = [];
      let sawRightHand = false;

      rawHands.forEach((item) => {
        const lm = item.lm;
        const role = item.role;
        if (role === 'R') sawRightHand = true;

        const rawPinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        const rawPalmSize = Math.max(0.04, Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y));
        const pinchRatio = rawPinchDist / rawPalmSize;

        const thresh = state.pinchThreshold;
        const wasPinching = prevHandsPinching[role] || false;
        const isPinching = !item.isFist && (wasPinching ? (pinchRatio < thresh + 0.14) : (pinchRatio < thresh));
        prevHandsPinching[role] = isPinching;

        const isFist = item.isFist;
        const thumbTip = { x: mapX(lm[4].x), y: mapY(lm[4].y) };
        const indexTip = { x: mapX(lm[8].x), y: mapY(lm[8].y) };
        const rawCx = (thumbTip.x + indexTip.x) / 2;
        const rawCy = (thumbTip.y + indexTip.y) / 2;

        if (smoothPinchCoords[role].x === 0) {
          smoothPinchCoords[role] = { x: rawCx, y: rawCy };
        } else {
          smoothPinchCoords[role].x += (rawCx - smoothPinchCoords[role].x) * 0.68;
          smoothPinchCoords[role].y += (rawCy - smoothPinchCoords[role].y) * 0.68;
        }

        if (smoothIndexCoords[role].x === 0) {
          smoothIndexCoords[role] = { x: indexTip.x, y: indexTip.y };
        } else {
          smoothIndexCoords[role].x += (indexTip.x - smoothIndexCoords[role].x) * 0.74;
          smoothIndexCoords[role].y += (indexTip.y - smoothIndexCoords[role].y) * 0.74;
        }

        detected.push({
          id: role,
          landmarks: lm.map(pt => ({ x: mapX(pt.x), y: mapY(pt.y) })),
          thumbTip, indexTip,
          smoothIndexX: smoothIndexCoords[role].x,
          smoothIndexY: smoothIndexCoords[role].y,
          pinchX: smoothPinchCoords[role].x,
          pinchY: smoothPinchCoords[role].y,
          pinchRatio, isPinching, isFist,
          justPinched: isPinching && !wasPinching
        });
      });

      if (!sawRightHand) {
        prevHandsPinching.R = false;
        smoothIndexCoords.R = { x: 0, y: 0 };
        smoothPinchCoords.R = { x: 0, y: 0 };
      }

      detected.sort((a, b) => (a.id === 'R' ? -1 : 1));
      if (detected.length === 0) prevHandsPinching = { R: false, L: false };

      const leftHandObj = detected.find(h => h.id === 'L');
      const rightHandObj = detected.find(h => h.id === 'R');
      const leftClutchNow = Boolean(leftHandObj && leftHandObj.isFist && !(rightHandObj && rightHandObj.isPinching));

      if (state.leftHandClutch !== leftClutchNow) {
        state.leftHandClutch = leftClutchNow;
        updateClutchBadge();
      }

      handsData = detected;
      processHandInteractions(w, h);
    });

    function findShapeAt(x, y) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!isArObject(s) && s.type !== 'ink') {
          if (Math.hypot(x - s.x, y - s.y) <= Math.max(42, s.size * 0.6)) return s;
        }
      }
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (isArObject(s)) {
          const halfW = s.size / 2 + 28;
          const halfH = (s.size / (s.aspect || 1.5)) / 2 + 28;
          if (x >= s.x - halfW && x <= s.x + halfW && y >= s.y - halfH && y <= s.y + halfH) {
            return s;
          }
        }
      }
      return null;
    }

    function eraseAtPoint(x, y) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (isArObject(s)) continue;
        if ((s.type === 'ink' || s.type === 'freehand') && s.points) {
          if (s.points.some(pt => Math.hypot(x - (s.x + pt.dx * s.size), y - (s.y + pt.dy * s.size)) < 26)) {
            shapes.splice(i, 1);
            return;
          }
        } else if (Math.hypot(x - s.x, y - s.y) <= Math.max(34, s.size * 0.55)) {
          shapes.splice(i, 1);
          return;
        }
      }
    }

    function isInTrashEdge(x, y, w, h) {
      return (x < 36 || x > w - 36 || y > h - 36);
    }

    function getAirMenuRects(w) {
      const itemW = 88, itemH = 34, gap = 8;
      const totalW = AIR_MENU_ITEMS.length * itemW + (AIR_MENU_ITEMS.length - 1) * gap;
      const startX = (w - totalW) / 2;
      return AIR_MENU_ITEMS.map((item, idx) => ({
        ...item, x: startX + idx * (itemW + gap), y: 14, w: itemW, h: itemH
      }));
    }

    function checkAirMenuHit(px, py, w) {
      if (!state.showAirMenu) return null;
      for (const r of getAirMenuRects(w)) {
        if (px >= r.x - 6 && px <= r.x + r.w + 6 && py >= r.y - 6 && py <= r.y + r.h + 12) return r;
      }
      return null;
    }

    function processHandInteractions(w, h) {
      const now = performance.now();
      const rightHand = handsData.find(hd => hd.id === 'R');
      const leftHand = handsData.find(hd => hd.id === 'L');
      const writeActive = isClutchEngaged();

      // 1. GESTE 2 MAINS : PINCEMENT DOUBLE -> ZOOMER / ÉTIRER / TOURNER
      if (!writeActive && rightHand && leftHand && rightHand.isPinching && leftHand.isPinching) {
        if (activeAirStroke.length > 0) finishActiveInteractions(w, h);
        grabbedShape = null;
        prevWriteActive = false;

        const dist = Math.max(20, Math.hypot(leftHand.pinchX - rightHand.pinchX, leftHand.pinchY - rightHand.pinchY));
        const angle = Math.atan2(leftHand.pinchY - rightHand.pinchY, leftHand.pinchX - rightHand.pinchX);
        const midX = (rightHand.pinchX + leftHand.pinchX) / 2;
        const midY = (rightHand.pinchY + leftHand.pinchY) / 2;

        if (!twoHandStretch.active) {
          const lastAr = [...shapes].reverse().find(isArObject);
          const target = findShapeAt(midX, midY) || lastAr || shapes[shapes.length - 1];
          if (target) {
            twoHandStretch = {
              active: true,
              shape: target,
              initialDist: dist,
              initialSize: target.size,
              initialAngle: angle,
              initialRot: target.rotation,
              offsetX: target.x - midX,
              offsetY: target.y - midY
            };
          }
        } else if (twoHandStretch.shape) {
          const s = twoHandStretch.shape;
          const maxAllowed = isArObject(s) ? 920 : 500;
          const minAllowed = isArObject(s) ? 140 : 30;
          s.size = Math.min(maxAllowed, Math.max(minAllowed, twoHandStretch.initialSize * (dist / twoHandStretch.initialDist)));
          if (!isArObject(s)) {
            s.rotation = twoHandStretch.initialRot + (angle - twoHandStretch.initialAngle);
          } else {
            s.rotation = 0;
          }
          s.x = midX + twoHandStretch.offsetX;
          s.y = midY + twoHandStretch.offsetY;
          syncAttachedAnnotations();
        }
        return;
      } else {
        twoHandStretch.active = false;
      }

      if (!rightHand) {
        finishActiveInteractions(w, h);
        prevWriteActive = false;
        return;
      }

      // 2. GESTE DESSIN : EMBRAYAGE ACTIF (ESPACE OU POING GAUCHE) + INDEX DROIT
      if (writeActive) {
        if (grabbedShape) {
          finishActiveInteractions(w, h);
        }
        const penX = rightHand.smoothIndexX;
        const penY = rightHand.smoothIndexY;
        const justStartedWrite = !prevWriteActive;
        prevWriteActive = true;

        if (justStartedWrite) {
          const menuHit = checkAirMenuHit(penX, penY, w);
          if (menuHit && now - menuCooldown > 400) {
            menuCooldown = now;
            pushShapeWithCap(createShapeObject(menuHit.type, penX, penY + 60, 105));
            return;
          }
        }

        if (state.eraser) {
          eraseAtPoint(penX, penY);
          activeAirStroke = [];
        } else if (justStartedWrite || activeAirStroke.length === 0) {
          activeAirStroke = [{ x: penX, y: penY }];
        } else {
          const lastPt = activeAirStroke[activeAirStroke.length - 1];
          if (Math.hypot(penX - lastPt.x, penY - lastPt.y) > 260) {
            finishActiveInteractions(w, h);
            activeAirStroke = [{ x: penX, y: penY }];
          } else if (Math.hypot(penX - lastPt.x, penY - lastPt.y) > 2) {
            activeAirStroke.push({ x: penX, y: penY });
          }
        }
        return;
      }

      if (prevWriteActive) {
        finishActiveInteractions(w, h);
        prevWriteActive = false;
      }

      // 3. GESTE 1 MAIN : PINCEMENT MAIN DROITE -> DÉPLACER UN OBJET / FERMER AR / MENU FORMES
      if (rightHand.justPinched) {
        if (state.eraser) {
          eraseAtPoint(rightHand.pinchX, rightHand.pinchY);
          return;
        }

        const closeArHit = findArCloseButtonHit(rightHand.pinchX, rightHand.pinchY) ||
                           findArCloseButtonHit(rightHand.smoothIndexX, rightHand.smoothIndexY);
        if (closeArHit && now - menuCooldown > 350) {
          menuCooldown = now;
          removeShapeAndChildren(closeArHit);
          return;
        }

        const menuHit = checkAirMenuHit(rightHand.pinchX, rightHand.pinchY, w) ||
                        checkAirMenuHit(rightHand.smoothIndexX, rightHand.smoothIndexY, w);
        if (menuHit && now - menuCooldown > 400) {
          menuCooldown = now;
          const ns = createShapeObject(menuHit.type, rightHand.pinchX, rightHand.pinchY + 55, 105);
          pushShapeWithCap(ns);
          grabbedShape = ns;
          grabOffset = { x: 0, y: 0 };
          return;
        }

        const clicked = findShapeAt(rightHand.pinchX, rightHand.pinchY) ||
                        findShapeAt(rightHand.smoothIndexX, rightHand.smoothIndexY);
        if (clicked) {
          grabbedShape = clicked;
          grabOffset = { x: clicked.x - rightHand.pinchX, y: clicked.y - rightHand.pinchY };
        }
      } else if (rightHand.isPinching) {
        if (state.eraser) {
          eraseAtPoint(rightHand.pinchX, rightHand.pinchY);
          return;
        }
        if (grabbedShape) {
          grabbedShape.x = rightHand.pinchX + grabOffset.x;
          grabbedShape.y = rightHand.pinchY + grabOffset.y;
          syncAttachedAnnotations();
        }
      } else if (grabbedShape) {
        finishActiveInteractions(w, h);
      }
    }

    function finishActiveInteractions(w, h) {
      if (grabbedShape) {
        if (!isArObject(grabbedShape) && isInTrashEdge(grabbedShape.x, grabbedShape.y, w, h)) {
          removeShapeAndChildren(grabbedShape);
        }
        grabbedShape = null;
      }
      if (activeAirStroke.length >= 2) {
        const newObj = classifyAndCreateShape(activeAirStroke);
        if (newObj) pushShapeWithCap(newObj);
      }
      activeAirStroke = [];
    }

    // Interactions Souris sur l'écran d'aperçu
    let mouseDragging = false;
    mainCanvas.addEventListener('pointerdown', (e) => {
      const rect = mainCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (mainCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (mainCanvas.height / rect.height);

      const closeArHit = findArCloseButtonHit(mx, my);
      if (closeArHit) {
        removeShapeAndChildren(closeArHit);
        return;
      }

      const hit = findShapeAt(mx, my);
      if (hit) {
        mouseDragging = true;
        grabbedShape = hit;
        grabOffset = { x: hit.x - mx, y: hit.y - my };
        mainCanvas.setPointerCapture(e.pointerId);
      }
    });
    mainCanvas.addEventListener('pointermove', (e) => {
      if (!mouseDragging || !grabbedShape) return;
      const rect = mainCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (mainCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (mainCanvas.height / rect.height);
      grabbedShape.x = mx + grabOffset.x;
      grabbedShape.y = my + grabOffset.y;
      syncAttachedAnnotations();
    });
    mainCanvas.addEventListener('pointerup', (e) => {
      if (!mouseDragging) return;
      mouseDragging = false;
      mainCanvas.releasePointerCapture(e.pointerId);
      finishActiveInteractions(mainCanvas.width, mainCanvas.height);
    });
    mainCanvas.addEventListener('wheel', (e) => {
      const rect = mainCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (mainCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (mainCanvas.height / rect.height);
      const hit = findShapeAt(mx, my);
      if (hit) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        const maxS = isArObject(hit) ? 920 : 500;
        hit.size = Math.min(maxS, Math.max(80, hit.size * factor));
        syncAttachedAnnotations();
      }
    }, { passive: false });

    function drawSmoothPath(targetCtx, pts, scale = 1) {
      if (!pts || pts.length === 0) return;
      const getX = (p) => (p.dx !== undefined ? p.dx * scale : p.x);
      const getY = (p) => (p.dy !== undefined ? p.dy * scale : p.y);
      if (pts.length === 1) {
        targetCtx.arc(getX(pts[0]), getY(pts[0]), targetCtx.lineWidth / 2, 0, Math.PI * 2);
        return;
      }
      targetCtx.moveTo(getX(pts[0]), getY(pts[0]));
      for (let i = 1; i < pts.length - 1; i++) {
        targetCtx.quadraticCurveTo(getX(pts[i]), getY(pts[i]), (getX(pts[i]) + getX(pts[i + 1])) / 2, (getY(pts[i]) + getY(pts[i + 1])) / 2);
      }
      const last = pts[pts.length - 1];
      targetCtx.lineTo(getX(last), getY(last));
    }

    function computeRenderX(s, canvasW, forStream) {
      if (!forStream || !state.mirror) return s.x;
      if (s.parentId) {
        const parent = shapes.find(p => p.id === s.parentId);
        if (parent) {
          const parentStreamX = canvasW - parent.x;
          return parentStreamX + (s.relX || 0) * parent.size;
        }
      }
      return canvasW - s.x;
    }

    function drawArPanel(targetCtx, s, cleanForMeet = false, drawX = s.x, nowMs = performance.now()) {
      if (!s.mediaEl) return;
      if (s.type === 'ar-window' && s.videoEl) {
        if (s.videoEl.paused && s.videoEl.srcObject) {
          s.videoEl.play().catch(() => {});
        }
        // Échantillonnage de la capture d'écran limité à 15 images/s max (~66.6 ms)
        if (s.frameCacheCanvas && s.frameCacheCtx && nowMs - (s.lastCaptureMs || 0) >= 66) {
          s.lastCaptureMs = nowMs;
          try {
            s.frameCacheCtx.drawImage(s.videoEl, 0, 0, s.frameCacheCanvas.width, s.frameCacheCanvas.height);
          } catch (e) {}
        }
      }

      const w = s.size;
      const h = s.size / (s.aspect || 1.6);
      const halfW = w / 2;
      const halfH = h / 2;
      const isSelected = (s === grabbedShape || s === twoHandStretch.shape);

      targetCtx.save();
      targetCtx.translate(drawX, s.y);

      const borderCol = isSelected ? '#39ff14' : '#00f0ff';
      if (!state.ecoMode) {
        targetCtx.shadowColor = borderCol;
        targetCtx.shadowBlur = isSelected ? 18 : 8;
      }

      if (!cleanForMeet) {
        targetCtx.fillStyle = 'rgba(8, 12, 20, 0.88)';
        targetCtx.fillRect(-halfW, -halfH - 20, w, 20);
        targetCtx.strokeStyle = borderCol;
        targetCtx.lineWidth = 1.5;
        targetCtx.strokeRect(-halfW, -halfH - 20, w, 20);

        targetCtx.fillStyle = borderCol;
        targetCtx.font = 'bold 10px monospace';
        targetCtx.fillText(`✦ ${s.label}`, -halfW + 8, -halfH - 6);

        targetCtx.fillStyle = 'rgba(255, 51, 75, 0.85)';
        targetCtx.fillRect(halfW - 22, -halfH - 20, 22, 20);
        targetCtx.fillStyle = '#fff';
        targetCtx.font = 'bold 11px monospace';
        targetCtx.fillText('✕', halfW - 15, -halfH - 6);
      }

      targetCtx.save();
      targetCtx.globalAlpha = state.arOpacity;
      if (state.arFlip) {
        targetCtx.scale(-1, 1);
      }
      try {
        const sourceToDraw = (s.type === 'ar-window' && s.frameCacheCanvas && s.lastCaptureMs > 0)
          ? s.frameCacheCanvas
          : s.mediaEl;
        targetCtx.drawImage(sourceToDraw, -halfW, -halfH, w, h);
      } catch (e) {}
      targetCtx.restore();

      targetCtx.strokeStyle = borderCol;
      targetCtx.lineWidth = isSelected && !cleanForMeet ? 3 : 1.8;
      targetCtx.strokeRect(-halfW, -halfH, w, h);

      const cLen = 14;
      targetCtx.lineWidth = 3.5;
      targetCtx.beginPath();
      targetCtx.moveTo(-halfW, -halfH + cLen); targetCtx.lineTo(-halfW, -halfH); targetCtx.lineTo(-halfW + cLen, -halfH);
      targetCtx.moveTo(halfW - cLen, -halfH); targetCtx.lineTo(halfW, -halfH); targetCtx.lineTo(halfW, -halfH + cLen);
      targetCtx.moveTo(-halfW, halfH - cLen); targetCtx.lineTo(-halfW, halfH); targetCtx.lineTo(-halfW + cLen, halfH);
      targetCtx.moveTo(halfW - cLen, halfH); targetCtx.lineTo(halfW, halfH); targetCtx.lineTo(halfW, halfH - cLen);
      targetCtx.stroke();

      targetCtx.restore();
    }

    function drawShape(targetCtx, s, cleanForMeet = false, nowMs = performance.now(), forStream = false, canvasW = 960) {
      const drawX = computeRenderX(s, canvasW, forStream);
      if (isArObject(s)) {
        drawArPanel(targetCtx, s, cleanForMeet, drawX, nowMs);
        return;
      }

      let alpha = 1;
      if (s.isLaser && s.createdAt) {
        const age = nowMs - s.createdAt;
        if (age > 1100) {
          alpha = Math.max(0, 1 - (age - 1100) / 1000);
        }
      }

      targetCtx.save();
      targetCtx.globalAlpha = alpha;
      targetCtx.translate(drawX, s.y);
      targetCtx.rotate(s.rotation);
      targetCtx.strokeStyle = s.isLaser ? '#ff2a85' : s.color;
      targetCtx.fillStyle = hexToRgba(s.color, 0.25);
      targetCtx.lineWidth = s.isLaser ? s.strokeWidth + 2.5 : s.strokeWidth;
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';

      if (s.isLaser && !state.ecoMode) {
        targetCtx.shadowColor = '#ff2a85';
        targetCtx.shadowBlur = 14;
      }

      const half = s.size / 2;
      targetCtx.beginPath();
      if (s.type === 'circle') targetCtx.arc(0, 0, half, 0, Math.PI * 2);
      else if (s.type === 'rect') targetCtx.rect(-half, -half * 0.78, s.size, s.size * 0.78);
      else if (s.type === 'triangle') { targetCtx.moveTo(0, -half); targetCtx.lineTo(half, half * 0.85); targetCtx.lineTo(-half, half * 0.85); targetCtx.closePath(); }
      else if (s.type === 'star') {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? half : half * 0.42, a = (i * Math.PI) / 5 - Math.PI / 2;
          if (i === 0) targetCtx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else targetCtx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        targetCtx.closePath();
      } else if (s.type === 'hexagon') {
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          if (i === 0) targetCtx.moveTo(Math.cos(a) * half, Math.sin(a) * half); else targetCtx.lineTo(Math.cos(a) * half, Math.sin(a) * half);
        }
        targetCtx.closePath();
      } else if (s.type === 'line') { targetCtx.moveTo(-half, 0); targetCtx.lineTo(half, 0); }
      else if ((s.type === 'freehand' || s.type === 'ink') && s.points) drawSmoothPath(targetCtx, s.points, s.size);

      if (s.filled && s.type !== 'line' && s.type !== 'ink') targetCtx.fill();
      targetCtx.stroke();

      if (s.isLaser && s.points) {
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = Math.max(1.5, s.strokeWidth * 0.55);
        targetCtx.stroke();
      }

      if (!cleanForMeet && s.type !== 'ink' && !s.isLaser) {
        targetCtx.fillStyle = s.color;
        targetCtx.font = '9px monospace';
        targetCtx.fillText(`${s.id}`, -half, -half - 6);
      }
      targetCtx.restore();
    }

    // Calque de cache hors-écran avec vérification de signature pour les formes statiques
    function isStaticCacheableShape(s) {
      return !isArObject(s) && !s.isLaser && s !== grabbedShape && s !== twoHandStretch.shape;
    }

    function computeStaticLayerSignature(staticShapes, forStream, cleanForMeet, canvasW) {
      let sig = `${forStream ? 1 : 0}|${cleanForMeet ? 1 : 0}|${state.mirror ? 1 : 0}|${canvasW}|`;
      for (let i = 0; i < staticShapes.length; i++) {
        const s = staticShapes[i];
        const rx = Math.round(computeRenderX(s, canvasW, forStream));
        const ry = Math.round(s.y);
        const rSize = Math.round(s.size);
        const rRot = s.rotation.toFixed(2);
        const ptsLen = s.points ? s.points.length : 0;
        sig += `${s.id}:${rx},${ry},${rSize},${rRot},${s.color},${s.strokeWidth},${s.filled ? 1 : 0},${ptsLen};`;
      }
      return sig;
    }

    function renderNonArShapesWithCache(targetCtx, cleanForMeet, nowMs, forStream, canvasW, canvasH) {
      const staticShapes = [];
      const dynamicShapes = [];

      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (isArObject(s)) continue;
        if (isStaticCacheableShape(s)) {
          staticShapes.push(s);
        } else {
          dynamicShapes.push(s);
        }
      }

      if (staticShapes.length > 0) {
        const sig = computeStaticLayerSignature(staticShapes, forStream, cleanForMeet, canvasW);
        if (forStream) {
          if (sig !== streamStaticSignature) {
            streamStaticSignature = sig;
            streamStaticCacheCtx.clearRect(0, 0, canvasW, canvasH);
            for (let i = 0; i < staticShapes.length; i++) {
              drawShape(streamStaticCacheCtx, staticShapes[i], cleanForMeet, nowMs, true, canvasW);
            }
          }
          targetCtx.drawImage(streamStaticCacheCanvas, 0, 0);
        } else {
          if (sig !== localStaticSignature) {
            localStaticSignature = sig;
            localStaticCacheCtx.clearRect(0, 0, canvasW, canvasH);
            for (let i = 0; i < staticShapes.length; i++) {
              drawShape(localStaticCacheCtx, staticShapes[i], cleanForMeet, nowMs, false, canvasW);
            }
          }
          targetCtx.drawImage(localStaticCacheCanvas, 0, 0);
        }
      } else {
        if (forStream) streamStaticSignature = '';
        else localStaticSignature = '';
      }

      for (let i = 0; i < dynamicShapes.length; i++) {
        drawShape(targetCtx, dynamicShapes[i], cleanForMeet, nowMs, forStream, canvasW);
      }
    }

    function drawActiveStroke(targetCtx, w, forStream = false) {
      if (activeAirStroke.length === 0) return;
      let shiftX = 0;
      if (forStream && state.mirror) {
        const parentAr = findArObjectUnderPoint(activeAirStroke[0].x, activeAirStroke[0].y);
        if (parentAr) {
          shiftX = w - 2 * parentAr.x;
        } else {
          let minX = Infinity, maxX = -Infinity;
          for (let i = 0; i < activeAirStroke.length; i++) {
            const px = activeAirStroke[i].x;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
          }
          const cx = (minX + maxX) / 2;
          shiftX = w - 2 * cx;
        }
      }

      targetCtx.save();
      if (shiftX !== 0) targetCtx.translate(shiftX, 0);
      targetCtx.strokeStyle = state.laserMode ? '#ff2a85' : state.color;
      targetCtx.lineWidth = state.laserMode ? state.strokeWidth + 2.5 : state.strokeWidth;
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';
      if (state.laserMode && !state.ecoMode) {
        targetCtx.shadowColor = '#ff2a85';
        targetCtx.shadowBlur = 14;
      }
      targetCtx.beginPath();
      drawSmoothPath(targetCtx, activeAirStroke, 1);
      targetCtx.stroke();
      if (state.laserMode) {
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = Math.max(1.5, state.strokeWidth * 0.55);
        targetCtx.stroke();
      }
      targetCtx.restore();
    }

    function drawHUDElements(targetCtx, w, forStream = false) {
      const mapHudX = (x) => (forStream && state.mirror ? (w - x) : x);
      const rightHand = handsData.find(h => h.id === 'R');
      const cx = rightHand ? (rightHand.isPinching ? rightHand.pinchX : rightHand.smoothIndexX) : -999;
      const cy = rightHand ? (rightHand.isPinching ? rightHand.pinchY : rightHand.smoothIndexY) : -999;

      if (state.showAirMenu) {
        const rects = getAirMenuRects(w);
        rects.forEach(r => {
          const hovered = (cx >= r.x - 6 && cx <= r.x + r.w + 6 && cy >= r.y - 6 && cy <= r.y + r.h + 12);
          const rx = forStream && state.mirror ? (w - r.x - r.w) : r.x;
          targetCtx.fillStyle = hovered ? hexToRgba(state.color, 0.35) : 'rgba(10, 12, 18, 0.82)';
          targetCtx.strokeStyle = hovered ? state.color : 'rgba(255, 255, 255, 0.32)';
          targetCtx.lineWidth = hovered ? 2 : 1;
          targetCtx.fillRect(rx, r.y, r.w, r.h);
          targetCtx.strokeRect(rx, r.y, r.w, r.h);
          targetCtx.fillStyle = '#fff';
          targetCtx.font = 'bold 9.5px monospace';
          targetCtx.textAlign = 'center';
          targetCtx.fillText(`+ ${r.label}`, rx + r.w / 2, r.y + 21);
          targetCtx.textAlign = 'left';
        });
      }

      const clutchOn = isClutchEngaged();
      handsData.forEach(h => {
        if (h.id === 'L') {
          const on = h.isFist || h.isPinching;
          targetCtx.beginPath();
          targetCtx.arc(mapHudX(h.landmarks[9].x), h.landmarks[9].y, 14, 0, Math.PI * 2);
          targetCtx.strokeStyle = on ? '#39ff14' : '#ffffff';
          targetCtx.lineWidth = 2;
          targetCtx.stroke();
          return;
        }
        if (h.id === 'R') {
          const usePinchPos = h.isPinching && !clutchOn;
          const rawPx = usePinchPos ? h.pinchX : h.smoothIndexX;
          const py = usePinchPos ? h.pinchY : h.smoothIndexY;
          const px = mapHudX(rawPx);
          const col = state.eraser ? '#ff334b' : (state.laserMode ? '#ff2a85' : (usePinchPos ? '#39ff14' : state.color));
          targetCtx.beginPath();
          targetCtx.arc(px, py, (clutchOn || h.isPinching) ? 7 : 9, 0, Math.PI * 2);
          if (clutchOn || h.isPinching) {
            targetCtx.fillStyle = col;
            targetCtx.fill();
          } else {
            targetCtx.strokeStyle = col;
            targetCtx.lineWidth = 2;
            targetCtx.stroke();
          }
        }
      });
    }

    async function sendFrameToSandbox() {
      if (!aiReady || !state.cameraActive || sourceVideo.readyState < 2 || !sandboxFrame || !sandboxFrame.contentWindow) return;
      const now = performance.now();
      if (sandboxBusy && now - lastSentTime < 500) return;
      const minInterval = state.ecoMode ? 66 : 33;
      if (now - lastSentTime < minInterval) return;

      sandboxBusy = true;
      lastSentTime = now;
      try {
        aiMiniCtx.drawImage(sourceVideo, 0, 0, 384, 216);
        const bitmap = await createImageBitmap(aiMiniCanvas);
        sandboxFrame.contentWindow.postMessage({ type: 'VS_PROCESS_FRAME', bitmap }, '*', [bitmap]);
      } catch (e) {
        sandboxBusy = false;
      }
    }

    let streamCanvasNode = null;
    function streamCanvasEl() {
      if (!streamCanvasNode || !streamCanvasNode.isConnected) {
        streamCanvasNode = document.getElementById('vs-meet-stream-canvas');
      }
      return streamCanvasNode;
    }

    let lastStreamRenderMs = 0;
    let lastLocalRenderMs = 0;

    function renderStep(nowMs = performance.now(), fromBackgroundWorker = false) {
      if (!state.cameraActive && !panelOpen) return;

      const minStepMs = state.ecoMode ? 48 : 32.5; // 20 fps en mode Éco, 30 fps max en mode normal
      const w = mainCanvas.width;
      const h = mainCanvas.height;

      if (shapes.some(s => s.isLaser && nowMs - s.createdAt > 2100)) {
        shapes = shapes.filter(s => !(s.isLaser && nowMs - s.createdAt > 2100));
      }

      if (state.cameraActive) {
        if (sourceVideo.paused && sourceVideo.srcObject) sourceVideo.play().catch(() => {});
        if (!fromBackgroundWorker && sourceVideo.readyState >= 2) {
          sendFrameToSandbox();
        }
      }

      syncAttachedAnnotations();

      // 1. RENDU LOCAL (#vsMainCanvas : uniquement quand l'onglet est visible)
      if (!document.hidden && (nowMs - lastLocalRenderMs >= (state.ecoMode ? 48 : 16))) {
        lastLocalRenderMs = nowMs;

        ctx.fillStyle = '#06070a';
        ctx.fillRect(0, 0, w, h);

        if (state.cameraActive && sourceVideo.readyState >= 2) {
          ctx.save();
          if (state.bwFilter) ctx.filter = 'grayscale(100%) contrast(125%)';
          if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
          ctx.drawImage(sourceVideo, 0, 0, w, h);
          ctx.restore();
        }

        shapes.forEach(s => {
          if (isArObject(s)) drawShape(ctx, s, false, nowMs, false, w);
        });
        renderNonArShapesWithCache(ctx, false, nowMs, false, w, h);
        drawActiveStroke(ctx, w, false);
        drawHUDElements(ctx, w, false);

        if (!panelOpen && state.cameraActive && state.extEnabled) {
          positionMiniPreview();
          miniPreviewCtx.drawImage(mainCanvas, 0, 0, 224, 126);
        }
      }

      // 2. RENDU DU FLUX SORTANT MEET (#vs-meet-stream-canvas : limité à 30 images/s max, ou 20 images/s en mode Éco)
      const meetStreamCanvas = streamCanvasEl();
      if (meetStreamCanvas && state.cameraActive && state.extEnabled && (nowMs - lastStreamRenderMs >= minStepMs)) {
        lastStreamRenderMs = nowMs;
        const mCtx = meetStreamCanvas.getContext('2d');
        const mw = meetStreamCanvas.width;
        const mh = meetStreamCanvas.height;

        mCtx.fillStyle = '#06070a';
        mCtx.fillRect(0, 0, mw, mh);

        if (sourceVideo.readyState >= 2) {
          mCtx.save();
          if (state.bwFilter) mCtx.filter = 'grayscale(100%) contrast(125%)';
          mCtx.drawImage(sourceVideo, 0, 0, mw, mh);
          mCtx.restore();
        }

        const cleanForMeet = !state.showHudOnMeet;
        shapes.forEach(s => {
          if (isArObject(s)) drawShape(mCtx, s, cleanForMeet, nowMs, true, mw);
        });
        renderNonArShapesWithCache(mCtx, cleanForMeet, nowMs, true, mw, mh);
        drawActiveStroke(mCtx, mw, true);

        if (state.showHudOnMeet) {
          drawHUDElements(mCtx, mw, true);
        }
      }
    }

    function animate(nowMs) {
      requestAnimationFrame(animate);
      if (!document.hidden) {
        renderStep(nowMs, false);
      }
    }

    // WEB WORKER DE MAINTIEN DU FLUX QUAND L'ONGLET MEET EST EN ARRIÈRE-PLAN (document.hidden)
    let bgTimerWorker = null;
    try {
      const workerCode = `
        let intervalId = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(function() { self.postMessage('tick'); }, 33);
          } else if (e.data === 'stop') {
            if (intervalId) { clearInterval(intervalId); intervalId = null; }
          }
        };
      `;
      const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(workerBlob);
      bgTimerWorker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);

      bgTimerWorker.onmessage = () => {
        if (document.hidden && state.cameraActive && state.extEnabled) {
          renderStep(performance.now(), true);
        }
      };
    } catch (e) {}

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        releaseSpace();
        if (bgTimerWorker && state.cameraActive && state.extEnabled) {
          bgTimerWorker.postMessage('start');
        }
        if (state.cameraActive && state.extEnabled) {
          showToast({
            id: 'bg-tab-warn',
            title: 'Onglet Meet en arrière-plan',
            message: 'Minuteur Web Worker actif pour éviter le gel de votre caméra virtuelle (le suivi des mains MediaPipe reprendra à pleine vitesse au retour sur l’onglet).',
            kind: 'warn',
            duration: 6000
          });
        }
      } else {
        if (bgTimerWorker) {
          bgTimerWorker.postMessage('stop');
        }
      }
    });

    // 8. CAMÉRA, SYNCHRONISATION CHROME.STORAGE & ÉVÉNEMENTS BOUTONS
    const cameraSelect = document.getElementById('vsCameraSelect');

    async function updateCameraList() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput' && d.deviceId !== 'vision-studio-virtual-cam');
        cameraSelect.innerHTML = '';
        videoDevices.forEach((dev, i) => {
          const opt = document.createElement('option');
          opt.value = dev.deviceId;
          opt.textContent = dev.label || `Caméra ${i + 1}`;
          if (dev.deviceId === state.selectedDeviceId) opt.selected = true;
          cameraSelect.appendChild(opt);
        });
      } catch (e) {}
    }

    function onCameraEnded() {
      state.cameraActive = false;
      state.spacePressed = false;
      state.leftHandClutch = false;
      if (bgTimerWorker) bgTimerWorker.postMessage('stop');
      syncSpaceGuard();
      document.documentElement.dataset.vsCamRunning = 'false';
      bubble.classList.remove('cam-on');
      const camBtn = document.getElementById('vsCamBtn');
      if (camBtn) {
        camBtn.classList.remove('active');
        camBtn.textContent = '📷 START CAM';
      }
      positionMiniPreview();
      updateClutchBadge();

      const meetStreamCanvas = streamCanvasEl();
      if (meetStreamCanvas) {
        const mCtx = meetStreamCanvas.getContext('2d');
        mCtx.fillStyle = '#06070a';
        mCtx.fillRect(0, 0, meetStreamCanvas.width, meetStreamCanvas.height);
      }
    }

    function stopCamera() {
      if (sourceVideo.srcObject) {
        try {
          sourceVideo.srcObject.getTracks().forEach(t => t.stop());
        } catch (e) {}
        sourceVideo.srcObject = null;
      }
      onCameraEnded();
    }

    let startingCameraPromise = null;

    async function startCamera(deviceId = '') {
      if (!state.extEnabled) return;
      if (startingCameraPromise) return startingCameraPromise;

      startingCameraPromise = (async () => {
        try {
          if (sourceVideo.srcObject) {
            sourceVideo.srcObject.getTracks().forEach(t => t.stop());
          }
          const targetId = (deviceId && deviceId !== 'vision-studio-virtual-cam') ? deviceId : '';
          const constraints = {
            video: targetId
              ? { deviceId: { exact: targetId }, width: { ideal: 960 }, height: { ideal: 540 } }
              : { width: { ideal: 960 }, height: { ideal: 540 } }
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          sourceVideo.srcObject = stream;
          await sourceVideo.play();
          state.cameraActive = true;
          if (document.hidden && bgTimerWorker) {
            bgTimerWorker.postMessage('start');
          }
          syncSpaceGuard();
          document.documentElement.dataset.vsCamRunning = 'true';
          bubble.classList.add('cam-on');

          const track = stream.getVideoTracks()[0];
          if (track) {
            track.addEventListener('ended', onCameraEnded, { once: true });
            const settings = track.getSettings ? track.getSettings() : {};
            if (settings.deviceId) {
              state.selectedDeviceId = settings.deviceId;
              scheduleSaveSettings();
            }
          }
          await updateCameraList();
          const camBtn = document.getElementById('vsCamBtn');
          if (camBtn) {
            camBtn.classList.add('active');
            camBtn.textContent = '📷 CAM ON';
            camBtn.blur();
          }
          positionMiniPreview();
        } catch (err) {
          onCameraEnded();
          showToast({
            id: 'cam-error',
            title: 'Accès caméra impossible',
            message: `La caméra n'a pas pu démarrer (${err && err.name ? err.name : 'Erreur'}). Marche à suivre : cliquez sur l'icône 🔒 ou 📷 à gauche de l'URL meet.google.com → Autoriser la caméra, puis cliquez sur Réessayer.`,
            kind: 'error',
            duration: 10000,
            actionLabel: '🔄 Réessayer',
            onAction: () => startCamera(state.selectedDeviceId)
          });
        } finally {
          startingCameraPromise = null;
        }
      })();

      return startingCameraPromise;
    }

    function updateExtActiveUI() {
      const extBtn = document.getElementById('vsExtActiveBtn');
      if (!extBtn) return;
      extBtn.classList.toggle('active', state.extEnabled);
      extBtn.textContent = state.extEnabled ? '🟢 Ext: ON' : '⚫ Ext: OFF';
    }

    function setExtensionEnabled(enabled, options = {}) {
      const nextVal = Boolean(enabled);
      if (state.extEnabled === nextVal && options.fromExternal) return;

      state.extEnabled = nextVal;
      if (document.documentElement) {
        document.documentElement.dataset.vsExtEnabled = state.extEnabled ? 'true' : 'false';
      }
      try {
        localStorage.setItem('vs_ext_enabled', state.extEnabled ? 'true' : 'false');
      } catch (e) {}

      updateExtActiveUI();
      syncSpaceGuard();

      if (!options.fromExternal && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          chrome.storage.local.set({ extEnabled: state.extEnabled });
        } catch (e) {}
      }

      window.dispatchEvent(new CustomEvent('vs-ext-state-changed', {
        detail: { enabled: state.extEnabled }
      }));

      if (!state.extEnabled) {
        stopCamera();
        showToast({
          id: 'ext-state',
          title: 'Extension désactivée (Passthrough)',
          message: 'Meet utilise désormais votre vraie caméra directement. Activez ou coupez/relancez la caméra dans Meet si besoin.',
          kind: 'warn',
          duration: 4500
        });
      } else {
        startCamera(state.selectedDeviceId);
        showToast({
          id: 'ext-state',
          title: 'Extension activée',
          message: 'Caméra virtuelle Vision Studio active.',
          kind: 'info',
          duration: 3500
        });
      }
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.extEnabled !== undefined) {
          setExtensionEnabled(changes.extEnabled.newValue !== false, { fromExternal: true });
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === 'VS_POPUP_TOGGLE_EXT') {
          setExtensionEnabled(msg.enabled !== false, { fromExternal: true });
          sendResponse({ ok: true });
        }
      });
    }

    updateExtActiveUI();
    syncSpaceGuard();
    updateClutchBadge();

    document.getElementById('vsExtActiveBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      setExtensionEnabled(!state.extEnabled);
    });

    document.getElementById('vsCamBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (!state.extEnabled) {
        setExtensionEnabled(true);
      } else {
        startCamera(cameraSelect.value || state.selectedDeviceId);
      }
    });

    document.getElementById('vsStopCamBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      stopCamera();
    });

    document.getElementById('vsDrawModeBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      setDrawMode(!state.drawMode);
    });

    window.addEventListener('vs-meet-request-cam', (e) => {
      const reqId = (e.detail && e.detail.deviceId) || '';
      if (reqId && !state.selectedDeviceId) {
        state.selectedDeviceId = reqId;
        scheduleSaveSettings();
      }
      if (state.extEnabled && !state.cameraActive) {
        startCamera(state.selectedDeviceId);
      }
    });

    cameraSelect.addEventListener('change', (e) => {
      e.currentTarget.blur();
      state.selectedDeviceId = e.target.value;
      scheduleSaveSettings();
      if (state.cameraActive) startCamera(e.target.value);
    });

    document.getElementById('vsLaserQuickBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleLaserMode();
    });

    document.getElementById('vsLaserStyleBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleLaserMode();
    });

    document.getElementById('vsAirMenuToggleBtn').addEventListener('click', (e) => {
      state.showAirMenu = !state.showAirMenu;
      e.currentTarget.classList.toggle('active', state.showAirMenu);
      e.currentTarget.textContent = state.showAirMenu ? '📐 Formes: ON' : '📐 Formes: OFF';
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsArOpacitySlider').addEventListener('input', (e) => {
      state.arOpacity = parseFloat(e.target.value);
      scheduleSaveSettings();
    });

    document.getElementById('vsHudMeetBtn').addEventListener('click', (e) => {
      state.showHudOnMeet = !state.showHudOnMeet;
      e.currentTarget.classList.toggle('active', state.showHudOnMeet);
      e.currentTarget.textContent = state.showHudOnMeet ? '👁️ HUD Meet: ON' : '👁️ HUD Meet: OFF';
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsSmartBtn').addEventListener('click', (e) => {
      state.smartShape = !state.smartShape;
      e.currentTarget.classList.toggle('active', state.smartShape);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsFillBtn').addEventListener('click', (e) => {
      state.filled = !state.filled;
      e.currentTarget.classList.toggle('active', state.filled);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsMirrorBtn').addEventListener('click', (e) => {
      state.mirror = !state.mirror;
      e.currentTarget.classList.toggle('active', state.mirror);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsBwBtn').addEventListener('click', (e) => {
      state.bwFilter = !state.bwFilter;
      e.currentTarget.classList.toggle('active', state.bwFilter);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsEcoBtn').addEventListener('click', (e) => {
      state.ecoMode = !state.ecoMode;
      e.currentTarget.classList.toggle('active', state.ecoMode);
      e.currentTarget.textContent = state.ecoMode ? '🍃 Éco: ON' : '🍃 Éco: OFF';
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsArFlipBtn').addEventListener('click', (e) => {
      state.arFlip = !state.arFlip;
      e.currentTarget.classList.toggle('active', state.arFlip);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    document.getElementById('vsEraserBtn').addEventListener('click', (e) => {
      state.eraser = !state.eraser;
      if (state.eraser && state.laserMode) toggleLaserMode();
      e.currentTarget.classList.toggle('active', state.eraser);
      e.currentTarget.blur();
    });

    root.querySelectorAll('.vs-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        setThemeColor(sw.dataset.color);
      });
    });

    document.getElementById('vsColorPicker').addEventListener('input', (e) => setThemeColor(e.target.value));
    document.getElementById('vsPinchSlider').addEventListener('input', (e) => {
      state.pinchThreshold = parseFloat(e.target.value);
      scheduleSaveSettings();
    });
    document.getElementById('vsStrokeSlider').addEventListener('input', (e) => {
      state.strokeWidth = parseFloat(e.target.value);
      scheduleSaveSettings();
    });

    document.getElementById('vsUndoBtn').addEventListener('click', (e) => {
      const removed = shapes.pop();
      if (removed) removeShapeAndChildren(removed);
      e.currentTarget.blur();
    });

    document.getElementById('vsClearBtn').addEventListener('click', (e) => {
      shapes.forEach(cleanupShapeResources);
      shapes = [];
      localStaticSignature = '';
      streamStaticSignature = '';
      e.currentTarget.blur();
    });

    updateCameraList();
    setAiStatus('loading');
    requestAnimationFrame(animate);

    const meetAsked = pendingMeetCamRequest || (document.documentElement && document.documentElement.dataset.vsMeetRequestedVideo === 'true');
    const initDevId = pendingRequestedDeviceId || (document.documentElement && document.documentElement.dataset.vsRequestedDeviceId) || '';
    if (meetAsked && state.extEnabled) {
      if (initDevId && !state.selectedDeviceId) state.selectedDeviceId = initDevId;
      startCamera(state.selectedDeviceId);
    }
  }

  const bootPoller = setInterval(() => {
    if (document.body) {
      clearInterval(bootPoller);
      try { boot(); } catch (err) { console.error('[Vision Studio] Erreur boot:', err); }
    }
  }, 100);
})();