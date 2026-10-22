(function () {
  // ==========================================================================
  // 0. GARDE-CLAVIER DÈS DOCUMENT_START (Protège Espace sur Meet sauf dans le chat)
  // ==========================================================================
  const guard = { camActive: false, held: false, onDown: null, onUp: null };

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

  // ==========================================================================
  // 1. INITIALISATION GARANTIE DÈS QUE DOCUMENT.BODY EXISTE
  // ==========================================================================
  let booted = false;

  function boot() {
    if (booted || !document.body) return;
    booted = true;

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

      #vs-root-overlay {
        --bg: #08090c;
        --panel: #0e1015;
        --border: rgba(255, 255, 255, 0.18);
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
        max-width: calc(100vw - 24px);
        background: rgba(8, 9, 12, 0.94);
        border: 1px solid var(--border);
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.8);
        color: var(--text);
        font-family: var(--font-mono);
        font-size: 10.5px;
        z-index: 2147483647 !important;
        display: none;
        flex-direction: column;
        border-radius: 10px;
        overflow: hidden;
        backdrop-filter: blur(10px);
        user-select: none;
      }
      #vs-root-overlay.vs-open {
        display: flex !important;
      }
      #vs-root-overlay.hide-preview .vs-viewport {
        display: none !important;
      }
      .vs-topbar {
        min-height: 36px;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        gap: 4px;
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
        padding-right: 6px;
        border-right: 1px solid var(--border);
        white-space: nowrap;
        pointer-events: none;
      }
      .vs-brand-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--theme-color);
        box-shadow: 0 0 8px var(--theme-color);
      }
      .vs-modes, .vs-right-controls {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-wrap: wrap;
      }
      .vs-btn {
        background: transparent;
        color: var(--muted);
        border: 1px solid transparent;
        padding: 3px 6px;
        font-family: var(--font-mono);
        font-size: 9.5px;
        cursor: pointer;
        transition: all 0.12s ease;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        border-radius: 4px;
      }
      .vs-btn:hover {
        color: var(--text);
        border-color: var(--border);
        background: rgba(255, 255, 255, 0.08);
      }
      .vs-btn.active {
        background: var(--theme-color);
        color: #000;
        font-weight: 700;
        border-color: var(--theme-color);
      }
      .vs-btn-outline {
        border: 1px solid var(--border);
        color: var(--text);
      }
      .vs-btn-ar {
        border: 1px solid rgba(255, 184, 0, 0.55);
        color: #ffb800;
        background: rgba(255, 184, 0, 0.08);
      }
      .vs-btn-ar:hover {
        background: rgba(255, 184, 0, 0.2);
        color: #fff;
        border-color: #ffb800;
      }
      .vs-btn-danger.active {
        background: var(--danger);
        color: #fff;
        border-color: var(--danger);
      }
      .vs-subbar {
        background: rgba(14, 16, 21, 0.96);
        border-bottom: 1px solid var(--border);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        padding: 5px 8px;
        gap: 6px;
      }
      .vs-control-group {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--muted);
        font-size: 9.5px;
        white-space: nowrap;
      }
      .vs-clutch-badge {
        padding: 2px 5px;
        border: 1px solid var(--border);
        font-size: 9.5px;
        font-weight: 700;
        color: var(--muted);
        border-radius: 4px;
      }
      .vs-clutch-badge.engaged {
        background: rgba(57, 255, 20, 0.18);
        border-color: var(--success);
        color: var(--success);
      }
      .vs-clutch-badge.ai-ready {
        color: var(--success);
        border-color: var(--success);
      }
      .vs-clutch-badge.ai-error {
        color: var(--danger);
        border-color: var(--danger);
      }
      #vs-root-overlay select, #vs-root-overlay input[type="range"] {
        background: #161922;
        color: var(--text);
        border: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: 9.5px;
        padding: 2px 4px;
        outline: none;
        cursor: pointer;
        max-width: 105px;
      }
      #vs-root-overlay input[type="range"] {
        -webkit-appearance: none;
        width: 44px;
        height: 3px;
        background: rgba(255, 255, 255, 0.2);
        padding: 0;
        border: none;
      }
      #vs-root-overlay input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 9px;
        height: 9px;
        background: var(--theme-color);
        cursor: pointer;
      }
      .vs-swatches {
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .vs-swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.35);
        cursor: pointer;
      }
      .vs-swatch.active {
        transform: scale(1.2);
        border: 2px solid #fff;
      }
      .vs-viewport {
        position: relative;
        width: 100%;
        height: 260px;
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
        left: 6px;
        background: rgba(0, 0, 0, 0.78);
        border: 1px solid var(--border);
        padding: 2px 6px;
        font-size: 9px;
        color: #fff;
        pointer-events: none;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. BULLE FLOTTANTE (TOUJOURS VISIBLE PAR DÉFAUT)
    const bubble = document.createElement('div');
    bubble.id = 'vs-floating-bubble';
    bubble.title = 'Vision Studio — Cliquer pour ouvrir / Glisser pour déplacer';
    bubble.innerHTML = `✦<span class="vs-bubble-dot"></span>`;
    document.body.appendChild(bubble);

    // 3. FENÊTRE COMPACTE DÉPLAÇABLE AVEC BOUTONS RÉALITÉ AUGMENTÉE (AR)
    const root = document.createElement('div');
    root.id = 'vs-root-overlay';
    root.innerHTML = `
      <header class="vs-topbar" id="vsDragHeader" title="Glisser pour déplacer">
        <div style="display:flex; align-items:center; gap:5px;">
          <div class="vs-brand">
            <span class="vs-brand-dot"></span>
            <span>VISION·AR</span>
          </div>
          <nav class="vs-modes">
            <button class="vs-btn" data-mode="static" title="Déplacer et zoomer les fenêtres AR / formes avec les doigts">01·MANIPULER AR</button>
            <button class="vs-btn" data-mode="physics">02·GRAV</button>
            <button class="vs-btn active" data-mode="paint" title="Écrire ou annoter par-dessus tes fenêtres AR">03·PAINT</button>
          </nav>
        </div>
        <div class="vs-right-controls">
          <button class="vs-btn vs-btn-ar" id="vsArWinBtn" title="Capturer une fenêtre (Excel, Dashboard, Chrome) en réalité augmentée">🖥️ FENÊTRE AR</button>
          <button class="vs-btn vs-btn-ar" id="vsArImgBtn" title="Importer une image ou un tableau (ou Ctrl+V)">🖼️ IMAGE AR</button>
          <input type="file" id="vsArFileInput" accept="image/*" style="display:none;" />
          <button class="vs-btn vs-btn-outline active" id="vsPreviewToggleBtn" title="Afficher/Masquer l'écran d'aperçu">📺 ÉCRAN</button>
          <button class="vs-btn vs-btn-outline" id="vsCamBtn">📷 START CAM</button>
          <button class="vs-btn vs-btn-outline" id="vsCollapseBtn" title="Réduire en bulle">➖</button>
        </div>
      </header>

      <div class="vs-body">
        <div class="vs-subbar">
          <div class="vs-control-group">
            <select id="vsCameraSelect"><option value="">Caméra PC / Tel</option></select>
          </div>

          <div class="vs-clutch-badge" id="vsClutchBadge">⚡ ESPACE / MAIN G : OFF</div>
          <div class="vs-clutch-badge" id="vsAiBadge">IA : chargement…</div>

          <div class="vs-control-group">
            <span>PINCH</span>
            <input type="range" id="vsPinchSlider" min="0.35" max="0.85" step="0.02" value="0.58" />
          </div>

          <div class="vs-control-group">
            <div class="vs-swatches">
              <div class="vs-swatch active" data-color="#00f0ff" style="background:#00f0ff"></div>
              <div class="vs-swatch" data-color="#ffffff" style="background:#ffffff"></div>
              <div class="vs-swatch" data-color="#39ff14" style="background:#39ff14"></div>
              <div class="vs-swatch" data-color="#ffb800" style="background:#ffb800"></div>
              <div class="vs-swatch" data-color="#ff2a85" style="background:#ff2a85"></div>
              <div class="vs-swatch" data-color="#a855f7" style="background:#a855f7"></div>
              <input type="color" id="vsColorPicker" value="#00f0ff" style="width:15px;height:14px;padding:0;border:none;background:none;cursor:pointer;" />
            </div>
          </div>

          <div class="vs-control-group">
            <span>TRAIT</span>
            <input type="range" id="vsStrokeSlider" min="1.5" max="12" step="0.5" value="3.5" />
          </div>

          <button class="vs-btn vs-btn-outline" id="vsHudMeetBtn" title="Afficher le curseur/menu aux participants">👁️ HUD: OFF</button>
          <button class="vs-btn vs-btn-outline active" id="vsMirrorBtn" title="Miroir caméra">⇄ CAM</button>
          <button class="vs-btn vs-btn-outline" id="vsArFlipBtn" title="Inverser horizontalement les fenêtres AR si tu veux les lire dans ton retour Meet">⇄ FLIP AR</button>
          <button class="vs-btn vs-btn-outline" id="vsSmartBtn" title="Reconnaissance automatique de formes">✦ SMART</button>

          <div style="margin-left:auto; display:flex; gap:3px;">
            <button class="vs-btn vs-btn-outline vs-btn-danger" id="vsEraserBtn">🧽 GOMME</button>
            <button class="vs-btn vs-btn-outline" id="vsUndoBtn" title="Annuler le dernier ajout">↩</button>
            <button class="vs-btn vs-btn-outline" id="vsClearBtn" title="Tout effacer">✕</button>
          </div>
        </div>

        <main class="vs-viewport">
          <canvas id="vsMainCanvas"></canvas>
          <div class="vs-hint" id="vsHintText">
            ASTUCE AR : AJOUTE UNE [🖥️ FENÊTRE AR] OU COLLE UNE IMAGE [CTRL+V] · MANIPULE-LA EN MODE [01·MANIPULER AR] · ANNOTE EN [03·PAINT]
          </div>
        </main>
      </div>
    `;
    document.body.appendChild(root);

    // Vidéo source en 2x2px hors de la fenêtre (ne se met jamais en pause quand on réduit en bulle)
    const sourceVideo = document.createElement('video');
    sourceVideo.id = 'vsSourceVideo';
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(sourceVideo);

    // Sandbox MediaPipe en 2x2px
    const sandboxFrame = document.createElement('iframe');
    sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
    sandboxFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(sandboxFrame);

    let panelOpen = false;

    function syncVisibility() {
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
      if (!bubble.isConnected) document.body.appendChild(bubble);
      if (!root.isConnected) document.body.appendChild(root);
      if (!sourceVideo.isConnected) document.body.appendChild(sourceVideo);
      if (!sandboxFrame.isConnected) document.body.appendChild(sandboxFrame);

      root.classList.toggle('vs-open', panelOpen);
      bubble.classList.toggle('vs-hidden', panelOpen);
    }

    function openPanel() {
      panelOpen = true;
      syncVisibility();
    }

    function collapseToBubble() {
      panelOpen = false;
      syncVisibility();
    }

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
        bubble.style.right = 'auto';
        bubble.style.bottom = 'auto';
        bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - 60, bDrag.initLeft + dx))}px`;
        bubble.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, bDrag.initTop + dy))}px`;
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
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = `${Math.max(4, Math.min(window.innerWidth - 220, wDrag.initLeft + dx))}px`;
      root.style.top = `${Math.max(4, Math.min(window.innerHeight - 60, wDrag.initTop + dy))}px`;
    });

    dragHeader.addEventListener('pointerup', (e) => {
      if (!wDrag.active) return;
      wDrag.active = false;
      dragHeader.releasePointerCapture(e.pointerId);
    });

    document.addEventListener('pointerdown', (e) => {
      if (!panelOpen) return;
      if (!root.contains(e.target) && !bubble.contains(e.target)) {
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

    // 6. MOTEUR GRAPHIQUE, RÉALITÉ AUGMENTÉE & MEDIAPIPE PING-PONG
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
    const aiBadge = document.getElementById('vsAiBadge');

    mainCanvas.width = 960;
    mainCanvas.height = 540;

    let state = {
      mode: 'paint',
      color: '#00f0ff',
      strokeWidth: 3.5,
      filled: false,
      smartShape: false,
      eraser: false,
      mirror: true,
      arFlip: false,
      bwFilter: false,
      showHudOnMeet: false,
      cameraActive: false,
      selectedDeviceId: '',
      pinchThreshold: 0.58,
      spacePressed: false,
      leftHandClutch: false
    };

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
    let twoHandStretch = { active: false, shape: null, initialDist: 1, initialSize: 100, initialAngle: 0, initialRot: 0 };

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
      aiBadge.classList.toggle('ai-ready', kind === 'ready');
      aiBadge.classList.toggle('ai-error', kind === 'error');
      aiBadge.textContent = kind === 'ready' ? 'IA : prête' : (kind === 'error' ? 'IA : erreur' : 'IA : chargement…');
      if (msg) aiBadge.title = msg;
    }

    function setThemeColor(hex) {
      state.color = hex;
      root.style.setProperty('--theme-color', hex);
    }

    function hexToRgba(hex, alpha) {
      const clean = hex.replace('#', '');
      const num = parseInt(clean, 16);
      return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    function setActiveMode(newMode) {
      state.mode = newMode;
      root.querySelectorAll('.vs-modes .vs-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === newMode);
      });
    }

    guard.onDown = () => { state.spacePressed = true; updateClutchBadge(); };
    guard.onUp = () => { state.spacePressed = false; updateClutchBadge(); };

    function isClutchEngaged() {
      return state.spacePressed || state.leftHandClutch;
    }

    function updateClutchBadge() {
      const engaged = isClutchEngaged();
      clutchBadge.classList.toggle('engaged', engaged);
      bubble.classList.toggle('clutch-active', engaged);
      if (engaged) {
        const src = state.spacePressed ? 'ESPACE' : 'MAIN G';
        clutchBadge.textContent = `⚡ EMBRAYAGE ON (${src})`;
      } else {
        clutchBadge.textContent = '⚡ ESPACE / MAIN G : OFF';
      }
    }

    function isArObject(s) {
      return s && (s.type === 'ar-window' || s.type === 'ar-image');
    }

    function cleanupShapeResources(s) {
      if (!s) return;
      if (s.mediaStream) {
        try { s.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      }
      if (s.videoEl && s.videoEl.parentNode) {
        try { s.videoEl.parentNode.removeChild(s.videoEl); } catch (e) {}
      }
    }

    function createShapeObject(type, x, y, size = 110, points = null) {
      return {
        id: `OBJ${shapeCounter++}`,
        type, x, y, size,
        rotation: 0, vx: 0, vy: 0, vRot: 0,
        color: state.color,
        strokeWidth: state.strokeWidth,
        filled: state.filled,
        points
      };
    }

    // Création d'un panneau Réalité Augmentée (Fenêtre en direct ou Image/Tableau)
    function createArMediaObject(type, mediaEl, naturalW, naturalH, labelText, mediaStream = null) {
      const aspect = Math.max(0.25, Math.min(4, (naturalW || 16) / (naturalH || 9)));
      const obj = {
        id: `AR${shapeCounter++}`,
        type, // 'ar-window' ou 'ar-image'
        label: labelText || (type === 'ar-window' ? 'LIVE WINDOW' : 'IMAGE AR'),
        x: mainCanvas.width / 2,
        y: mainCanvas.height / 2 + 20,
        size: 420, // Largeur initiale bien lisible
        aspect,
        rotation: 0,
        vx: 0, vy: 0, vRot: 0,
        color: state.color,
        strokeWidth: 2,
        mediaEl,
        videoEl: type === 'ar-window' ? mediaEl : null,
        mediaStream
      };
      shapes.push(obj);
      // Bascule automatiquement sur le mode Manipulation AR pour pouvoir placer et zoomer le tableau au doigt
      setActiveMode('static');
      return obj;
    }

    // A. CAPTURER UNE FENÊTRE EN DIRECT (Excel, PowerBI, Navigateur...)
    async function startArWindowCapture() {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        const vEl = document.createElement('video');
        vEl.muted = true;
        vEl.playsInline = true;
        vEl.srcObject = displayStream;
        // Placé à 2x2px dans body pour que Chrome ne fige jamais la fenêtre partagée
        vEl.style.cssText = 'position:fixed;left:2px;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(vEl);
        await vEl.play();

        const track = displayStream.getVideoTracks()[0];
        const settings = track ? track.getSettings() : {};
        const natW = vEl.videoWidth || settings.width || 1280;
        const natH = vEl.videoHeight || settings.height || 720;
        const title = (track && track.label) ? track.label.slice(0, 22) : 'FENÊTRE LIVE';

        const arObj = createArMediaObject('ar-window', vEl, natW, natH, title, displayStream);

        if (track) {
          track.addEventListener('ended', () => {
            cleanupShapeResources(arObj);
            shapes = shapes.filter(s => s !== arObj);
          }, { once: true });
        }
      } catch (err) {
        // L'utilisateur a annulé la sélection de fenêtre
      }
    }

    // B. IMPORTER UNE IMAGE OU UN TABLEAU (Fichier ou Ctrl+V)
    function loadArImageFromBlob(blob, labelName = 'TABLEAU / IMAGE') {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        createArMediaObject('ar-image', img, img.naturalWidth || 800, img.naturalHeight || 600, labelName);
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
      arFileInput.click();
    });

    arFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        loadArImageFromBlob(file, file.name.slice(0, 20).toUpperCase());
        arFileInput.value = '';
      }
    });

    // Support du Copier-Coller direct (Ctrl + V d'une capture d'écran Excel / Graphique)
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

    function classifyAndCreateShape(rawPoints, forceInk = false) {
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
      if (!forceInk && diag < 20) return null;
      if (forceInk && diag < 2 && rawPoints.length < 2) return null;

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const size = Math.max(width, height, 18);

      if (state.smartShape && diag >= 26) {
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

      const normPts = rawPoints.map(p => ({ dx: (p.x - cx) / (size || 1), dy: (p.y - cy) / (size || 1) }));
      return createShapeObject(forceInk ? 'ink' : 'freehand', cx, cy, size, normPts);
    }

    function detectHandFist(lm) {
      const wrist = lm[0];
      const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
      let folded = 0;
      for (const [tip, pip] of pairs) {
        if (Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y) < Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y) * 1.12) {
          folded++;
        }
      }
      return folded >= 3;
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
        setAiStatus('error', e.data.message);
        sandboxBusy = false;
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
      const rawHands = [];

      if (e.data.multiHandLandmarks && e.data.multiHandLandmarks.length > 0) {
        e.data.multiHandLandmarks.forEach((lm) => {
          const mapX = (x) => (state.mirror ? (1 - x) : x) * w;
          rawHands.push({ lm, wristScreenX: mapX(lm[0].x) });
        });

        if (rawHands.length === 1) {
          rawHands[0].role = 'R';
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
      let leftClutchNow = false;

      rawHands.forEach((item) => {
        const lm = item.lm;
        const role = item.role;
        const mapX = (x) => (state.mirror ? (1 - x) : x) * w;
        const mapY = (y) => y * h;

        const rawPinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        const rawPalmSize = Math.max(0.04, Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y));
        const pinchRatio = rawPinchDist / rawPalmSize;

        const thresh = state.pinchThreshold;
        const wasPinching = prevHandsPinching[role] || false;
        const isPinching = wasPinching ? (pinchRatio < thresh + 0.14) : (pinchRatio < thresh);
        prevHandsPinching[role] = isPinching;

        const isFist = detectHandFist(lm);
        const thumbTip = { x: mapX(lm[4].x), y: mapY(lm[4].y) };
        const indexTip = { x: mapX(lm[8].x), y: mapY(lm[8].y) };
        const rawCx = (thumbTip.x + indexTip.x) / 2;
        const rawCy = (thumbTip.y + indexTip.y) / 2;

        if (smoothPinchCoords[role].x === 0) {
          smoothPinchCoords[role] = { x: rawCx, y: rawCy };
        } else {
          smoothPinchCoords[role].x += (rawCx - smoothPinchCoords[role].x) * 0.65;
          smoothPinchCoords[role].y += (rawCy - smoothPinchCoords[role].y) * 0.65;
        }

        if (smoothIndexCoords[role].x === 0) {
          smoothIndexCoords[role] = { x: indexTip.x, y: indexTip.y };
        } else {
          smoothIndexCoords[role].x += (indexTip.x - smoothIndexCoords[role].x) * 0.72;
          smoothIndexCoords[role].y += (indexTip.y - smoothIndexCoords[role].y) * 0.72;
        }

        if (role === 'L' && (isFist || isPinching)) leftClutchNow = true;

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

      detected.sort((a, b) => (a.id === 'R' ? -1 : 1));
      if (detected.length === 0) prevHandsPinching = { R: false, L: false };

      if (state.leftHandClutch !== leftClutchNow) {
        state.leftHandClutch = leftClutchNow;
        updateClutchBadge();
      }

      handsData = detected;
      processHandInteractions(w, h);
    });

    function findShapeAt(x, y) {
      // 1. Cherche d'abord parmi les formes normales au premier plan
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (!isArObject(s)) {
          if (Math.hypot(x - s.x, y - s.y) <= Math.max(38, s.size * 0.58)) return s;
        }
      }
      // 2. Puis cherche parmi les fenêtres / images AR
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (isArObject(s)) {
          const halfW = s.size / 2 + 18;
          const halfH = (s.size / (s.aspect || 1.5)) / 2 + 18;
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
        if (isArObject(s)) continue; // La gomme n'efface que l'encre et les formes pour ne pas fermer ton Excel par erreur
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
      return (x < 42 || x > w - 42 || y > h - 42);
    }

    function getAirMenuRects(w) {
      const itemW = 88, itemH = 36, gap = 8;
      const totalW = AIR_MENU_ITEMS.length * itemW + (AIR_MENU_ITEMS.length - 1) * gap;
      const startX = (w - totalW) / 2;
      return AIR_MENU_ITEMS.map((item, idx) => ({
        ...item, x: startX + idx * (itemW + gap), y: 16, w: itemW, h: itemH
      }));
    }

    function checkAirMenuHit(px, py, w) {
      for (const r of getAirMenuRects(w)) {
        if (px >= r.x - 6 && px <= r.x + r.w + 6 && py >= r.y - 6 && py <= r.y + r.h + 12) return r;
      }
      return null;
    }

    function processHandInteractions(w, h) {
      const now = performance.now();
      const primary = handsData.find(h => h.id === 'R') || handsData[0];
      if (!primary) {
        finishActiveInteractions(w, h);
        prevWriteActive = false;
        return;
      }

      if (state.mode === 'paint') {
        twoHandStretch.active = false;
        const penX = primary.smoothIndexX;
        const penY = primary.smoothIndexY;
        const writeActive = isClutchEngaged();
        const justStartedWrite = writeActive && !prevWriteActive;
        prevWriteActive = writeActive;

        if (justStartedWrite || primary.justPinched) {
          const menuHit = checkAirMenuHit(penX, penY, w);
          if (menuHit && now - menuCooldown > 400) {
            menuCooldown = now;
            shapes.push(createShapeObject(menuHit.type, penX, penY + 60, 105));
            return;
          }
        }

        if (writeActive) {
          if (state.eraser) {
            eraseAtPoint(penX, penY);
            activeAirStroke = [];
          } else if (justStartedWrite || activeAirStroke.length === 0) {
            activeAirStroke = [{ x: penX, y: penY }];
          } else {
            const lastPt = activeAirStroke[activeAirStroke.length - 1];
            if (Math.hypot(penX - lastPt.x, penY - lastPt.y) > 2) {
              activeAirStroke.push({ x: penX, y: penY });
            }
          }
        } else {
          finishActiveInteractions(w, h);
        }
        return;
      }

      // ZOOM À 2 MAINS (Agrandir / Rétrécir les fenêtres AR ou les formes)
      if (handsData.length === 2 && handsData[0].isPinching && handsData[1].isPinching) {
        const h1 = handsData[0], h2 = handsData[1];
        const dist = Math.max(20, Math.hypot(h2.pinchX - h1.pinchX, h2.pinchY - h1.pinchY));
        const angle = Math.atan2(h2.pinchY - h1.pinchY, h2.pinchX - h1.pinchX);
        const midX = (h1.pinchX + h2.pinchX) / 2, midY = (h1.pinchY + h2.pinchY) / 2;

        if (!twoHandStretch.active) {
          const target = grabbedShape || findShapeAt(midX, midY) || shapes[shapes.length - 1];
          if (target) {
            twoHandStretch = { active: true, shape: target, initialDist: dist, initialSize: target.size, initialAngle: angle, initialRot: target.rotation };
            activeAirStroke = [];
            grabbedShape = null;
          }
        } else if (twoHandStretch.shape) {
          const s = twoHandStretch.shape;
          const maxAllowed = isArObject(s) ? 920 : 500;
          const minAllowed = isArObject(s) ? 140 : 30;
          s.size = Math.min(maxAllowed, Math.max(minAllowed, twoHandStretch.initialSize * (dist / twoHandStretch.initialDist)));
          // Les fenêtres AR restent bien droites (0 rotation) pour que les chiffres Excel soient toujours lisibles
          if (!isArObject(s)) {
            s.rotation = twoHandStretch.initialRot + (angle - twoHandStretch.initialAngle);
          } else {
            s.rotation = 0;
          }
          s.x = midX; s.y = midY; s.vx = 0; s.vy = 0;
        }
        return;
      } else {
        twoHandStretch.active = false;
      }

      const actionNow = primary.isPinching || isClutchEngaged();
      const justStarted = primary.justPinched || (actionNow && !prevWriteActive);
      prevWriteActive = actionNow;

      if (justStarted) {
        if (state.eraser) { eraseAtPoint(primary.pinchX, primary.pinchY); return; }
        const menuHit = checkAirMenuHit(primary.pinchX, primary.pinchY, w);
        if (menuHit && now - menuCooldown > 400) {
          menuCooldown = now;
          const ns = createShapeObject(menuHit.type, primary.pinchX, primary.pinchY + 55, 105);
          shapes.push(ns);
          grabbedShape = ns;
          grabOffset = { x: 0, y: 0 };
          return;
        }
        const clicked = findShapeAt(primary.pinchX, primary.pinchY);
        if (clicked) {
          grabbedShape = clicked;
          grabOffset = { x: clicked.x - primary.pinchX, y: clicked.y - primary.pinchY };
          return;
        }
        activeAirStroke = [{ x: primary.pinchX, y: primary.pinchY }];
      } else if (actionNow) {
        if (state.eraser) { eraseAtPoint(primary.pinchX, primary.pinchY); return; }
        if (grabbedShape) {
          const prevX = grabbedShape.x, prevY = grabbedShape.y;
          grabbedShape.x = primary.pinchX + grabOffset.x;
          grabbedShape.y = primary.pinchY + grabOffset.y;
          grabbedShape.vx = (grabbedShape.x - prevX) * 0.45;
          grabbedShape.vy = (grabbedShape.y - prevY) * 0.45;
        } else if (activeAirStroke.length > 0) {
          const lastPt = activeAirStroke[activeAirStroke.length - 1];
          if (Math.hypot(primary.pinchX - lastPt.x, primary.pinchY - lastPt.y) > 3) {
            activeAirStroke.push({ x: primary.pinchX, y: primary.pinchY });
          }
        }
      } else {
        finishActiveInteractions(w, h);
      }
    }

    function finishActiveInteractions(w, h) {
      if (grabbedShape) {
        if (isInTrashEdge(grabbedShape.x, grabbedShape.y, w, h)) {
          cleanupShapeResources(grabbedShape);
          shapes = shapes.filter(s => s !== grabbedShape);
        }
        grabbedShape = null;
      }
      const minPts = state.mode === 'paint' ? 2 : 4;
      if (activeAirStroke.length >= minPts) {
        const newObj = classifyAndCreateShape(activeAirStroke, state.mode === 'paint');
        if (newObj) shapes.push(newObj);
      }
      activeAirStroke = [];
    }

    // Permet aussi de déplacer les fenêtres AR et formes directement à la souris dans l'écran d'aperçu
    let mouseDragging = false;
    mainCanvas.addEventListener('pointerdown', (e) => {
      const rect = mainCanvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (mainCanvas.width / rect.width);
      const my = (e.clientY - rect.top) * (mainCanvas.height / rect.height);
      const hit = findShapeAt(mx, my);
      if (hit && state.mode !== 'paint') {
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
    });
    mainCanvas.addEventListener('pointerup', (e) => {
      if (!mouseDragging) return;
      mouseDragging = false;
      mainCanvas.releasePointerCapture(e.pointerId);
      finishActiveInteractions(mainCanvas.width, mainCanvas.height);
    });
    // Molette de la souris sur une fenêtre AR = Zoom rapide
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
      }
    }, { passive: false });

    function updatePhysics(w, h) {
      if (state.mode !== 'physics') return;
      shapes.forEach(s => {
        if (isArObject(s)) return; // Les fenêtres AR restent flottantes et stables en l'air
        if (s === grabbedShape || s === twoHandStretch.shape) return;
        s.vy += 0.3; s.x += s.vx; s.y += s.vy; s.rotation += s.vRot; s.vRot *= 0.98;
        const r = s.size / 2;
        if (s.y + r > h - 10) { s.y = h - 10 - r; s.vy = -s.vy * 0.72; s.vx *= 0.96; }
        if (s.y - r < 60) { s.y = 60 + r; s.vy = -s.vy * 0.72; }
        if (s.x - r < 10) { s.x = 10 + r; s.vx = -s.vx * 0.72; }
        if (s.x + r > w - 10) { s.x = w - 10 - r; s.vx = -s.vx * 0.72; }
      });
    }

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

    function drawArPanel(targetCtx, s, cleanForMeet = false) {
      if (!s.mediaEl) return;
      if (s.type === 'ar-window' && s.videoEl && s.videoEl.paused && s.videoEl.srcObject) {
        s.videoEl.play().catch(() => {});
      }

      const w = s.size;
      const h = s.size / (s.aspect || 1.6);
      const halfW = w / 2;
      const halfH = h / 2;
      const isSelected = (s === grabbedShape || s === twoHandStretch.shape);
      const deleting = isSelected && isInTrashEdge(s.x, s.y, mainCanvas.width, mainCanvas.height);

      targetCtx.save();
      targetCtx.translate(s.x, s.y);

      // Ombre et cadre futuriste AR
      const borderCol = deleting ? '#ff334b' : (isSelected ? '#39ff14' : '#00f0ff');
      targetCtx.shadowColor = borderCol;
      targetCtx.shadowBlur = isSelected ? 18 : 8;

      // Barre de titre holographique au-dessus du tableau
      if (!cleanForMeet || isSelected) {
        targetCtx.fillStyle = 'rgba(8, 12, 20, 0.85)';
        targetCtx.fillRect(-halfW, -halfH - 20, w, 20);
        targetCtx.strokeStyle = borderCol;
        targetCtx.lineWidth = 1.5;
        targetCtx.strokeRect(-halfW, -halfH - 20, w, 20);

        targetCtx.fillStyle = borderCol;
        targetCtx.font = 'bold 10px monospace';
        const titleTxt = deleting
          ? '🗑️ LÂCHE AU BORD POUR FERMER'
          : `✦ ${s.label} (${Math.round(w)}px) — PINCE À 2 MAINS POUR ZOOMER`;
        targetCtx.fillText(titleTxt, -halfW + 8, -halfH - 6);
      }

      // Contenu de la fenêtre (Excel / Dashboard / Image)
      targetCtx.save();
      if (state.arFlip) {
        targetCtx.scale(-1, 1);
      }
      try {
        targetCtx.drawImage(s.mediaEl, -halfW, -halfH, w, h);
      } catch (e) {}
      targetCtx.restore();

      // Bordure fine autour du tableau
      targetCtx.strokeStyle = borderCol;
      targetCtx.lineWidth = isSelected ? 3 : 1.8;
      targetCtx.strokeRect(-halfW, -halfH, w, h);

      // Coins AR renforcés
      const cLen = 14;
      targetCtx.lineWidth = 3.5;
      targetCtx.beginPath();
      // Haut-gauche
      targetCtx.moveTo(-halfW, -halfH + cLen); targetCtx.lineTo(-halfW, -halfH); targetCtx.lineTo(-halfW + cLen, -halfH);
      // Haut-droite
      targetCtx.moveTo(halfW - cLen, -halfH); targetCtx.lineTo(halfW, -halfH); targetCtx.lineTo(halfW, -halfH + cLen);
      // Bas-gauche
      targetCtx.moveTo(-halfW, halfH - cLen); targetCtx.lineTo(-halfW, halfH); targetCtx.lineTo(-halfW + cLen, halfH);
      // Bas-droite
      targetCtx.moveTo(halfW - cLen, halfH); targetCtx.lineTo(halfW, halfH); targetCtx.lineTo(halfW, halfH - cLen);
      targetCtx.stroke();

      targetCtx.restore();
    }

    function drawShape(targetCtx, s, cleanForMeet = false) {
      if (isArObject(s)) {
        drawArPanel(targetCtx, s, cleanForMeet);
        return;
      }

      targetCtx.save();
      targetCtx.translate(s.x, s.y);
      targetCtx.rotate(s.rotation);
      targetCtx.strokeStyle = s.color;
      targetCtx.fillStyle = hexToRgba(s.color, 0.25);
      targetCtx.lineWidth = s.strokeWidth;
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';

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

      if (!cleanForMeet && s.type !== 'ink') {
        targetCtx.fillStyle = s.color;
        targetCtx.font = '9px monospace';
        targetCtx.fillText(`${s.id}`, -half, -half - 6);
      }
      targetCtx.restore();
    }

    function drawHUDElements(targetCtx, w, onlyCursor = false) {
      const hand = handsData.find(h => h.id === 'R') || handsData[0];
      const cx = hand ? (state.mode === 'paint' ? hand.smoothIndexX : hand.pinchX) : -999;
      const cy = hand ? (state.mode === 'paint' ? hand.smoothIndexY : hand.pinchY) : -999;

      if (!onlyCursor) {
        const rects = getAirMenuRects(w);
        rects.forEach(r => {
          const hovered = (cx >= r.x - 6 && cx <= r.x + r.w + 6 && cy >= r.y - 6 && cy <= r.y + r.h + 12);
          targetCtx.fillStyle = hovered ? hexToRgba(state.color, 0.35) : 'rgba(10, 12, 18, 0.78)';
          targetCtx.strokeStyle = hovered ? state.color : 'rgba(255, 255, 255, 0.32)';
          targetCtx.lineWidth = hovered ? 2 : 1;
          targetCtx.fillRect(r.x, r.y, r.w, r.h);
          targetCtx.strokeRect(r.x, r.y, r.w, r.h);
          targetCtx.fillStyle = '#fff';
          targetCtx.font = 'bold 9.5px monospace';
          targetCtx.textAlign = 'center';
          targetCtx.fillText(`+ ${r.label}`, r.x + r.w / 2, r.y + 22);
          targetCtx.textAlign = 'left';
        });
      }

      const clutchOn = isClutchEngaged();
      handsData.forEach(h => {
        if (h.id === 'L' && !onlyCursor) {
          const on = h.isFist || h.isPinching;
          targetCtx.beginPath();
          targetCtx.arc(h.landmarks[9].x, h.landmarks[9].y, 14, 0, Math.PI * 2);
          targetCtx.strokeStyle = on ? '#39ff14' : '#ffffff';
          targetCtx.lineWidth = 2;
          targetCtx.stroke();
          return;
        }
        if (h.id === 'R') {
          const px = state.mode === 'paint' ? h.smoothIndexX : h.pinchX;
          const py = state.mode === 'paint' ? h.smoothIndexY : h.pinchY;
          const col = state.eraser ? '#ff334b' : state.color;
          targetCtx.beginPath();
          targetCtx.arc(px, py, clutchOn ? 7 : 9, 0, Math.PI * 2);
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
      if (now - lastSentTime < 33) return;

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

    function animate() {
      requestAnimationFrame(animate);
      if (!state.cameraActive && !panelOpen) return;

      const w = mainCanvas.width;
      const h = mainCanvas.height;

      ctx.fillStyle = '#06070a';
      ctx.fillRect(0, 0, w, h);

      if (state.cameraActive) {
        if (sourceVideo.paused && sourceVideo.srcObject) sourceVideo.play().catch(() => {});
        if (sourceVideo.readyState >= 2) {
          ctx.save();
          if (state.bwFilter) ctx.filter = 'grayscale(100%) contrast(125%)';
          if (state.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
          ctx.drawImage(sourceVideo, 0, 0, w, h);
          ctx.restore();
          sendFrameToSandbox();
        }
      }

      updatePhysics(w, h);

      // 1. Dessine d'abord les fenêtres et images AR (au second plan)
      shapes.forEach(s => {
        if (isArObject(s)) drawShape(ctx, s, !state.showHudOnMeet);
      });

      // 2. Dessine ensuite les formes et annotations Paint PAR-DESSUS les tableaux AR
      shapes.forEach(s => {
        if (!isArObject(s)) drawShape(ctx, s, !state.showHudOnMeet);
      });

      if (activeAirStroke.length > 0) {
        ctx.save();
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        drawSmoothPath(ctx, activeAirStroke, 1);
        ctx.stroke();
        ctx.restore();
      }

      const meetStreamCanvas = streamCanvasEl();
      if (meetStreamCanvas && state.cameraActive) {
        const mCtx = meetStreamCanvas.getContext('2d');
        if (state.showHudOnMeet) {
          drawHUDElements(ctx, w, false);
          mCtx.drawImage(mainCanvas, 0, 0, meetStreamCanvas.width, meetStreamCanvas.height);
        } else {
          if (!panelOpen || root.classList.contains('hide-preview')) {
            drawHUDElements(ctx, w, true);
          }
          mCtx.drawImage(mainCanvas, 0, 0, meetStreamCanvas.width, meetStreamCanvas.height);
          if (panelOpen && !root.classList.contains('hide-preview')) {
            drawHUDElements(ctx, w, false);
          }
        }
      } else if (panelOpen) {
        drawHUDElements(ctx, w, false);
      }
    }

    // 7. CAMÉRA & CONTRÔLES
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
      guard.camActive = false;
      releaseSpace();
      document.documentElement.dataset.vsCamRunning = 'false';
      bubble.classList.remove('cam-on');
      const camBtn = document.getElementById('vsCamBtn');
      camBtn.classList.remove('active');
      camBtn.textContent = '📷 START CAM';
      updateClutchBadge();
    }

    async function startCamera(deviceId = '') {
      try {
        if (sourceVideo.srcObject) {
          sourceVideo.srcObject.getTracks().forEach(t => t.stop());
        }
        const constraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 960 }, height: { ideal: 540 } }
            : { width: { ideal: 960 }, height: { ideal: 540 } }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        sourceVideo.srcObject = stream;
        await sourceVideo.play();
        state.cameraActive = true;
        guard.camActive = true;
        document.documentElement.dataset.vsCamRunning = 'true';
        bubble.classList.add('cam-on');

        const track = stream.getVideoTracks()[0];
        if (track) {
          track.addEventListener('ended', onCameraEnded, { once: true });
          if (track.getSettings().deviceId) state.selectedDeviceId = track.getSettings().deviceId;
        }
        await updateCameraList();
        const camBtn = document.getElementById('vsCamBtn');
        camBtn.classList.add('active');
        camBtn.textContent = '📷 CAM ON';
        camBtn.blur();
      } catch (err) {
        onCameraEnded();
        alert('Erreur caméra : ' + err.message);
      }
    }

    document.getElementById('vsCamBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      startCamera(cameraSelect.value);
    });

    cameraSelect.addEventListener('change', (e) => {
      e.currentTarget.blur();
      state.selectedDeviceId = e.target.value;
      if (state.cameraActive) startCamera(e.target.value);
    });

    document.getElementById('vsHudMeetBtn').addEventListener('click', (e) => {
      state.showHudOnMeet = !state.showHudOnMeet;
      e.currentTarget.classList.toggle('active', state.showHudOnMeet);
      e.currentTarget.textContent = state.showHudOnMeet ? '👁️ HUD: ON' : '👁️ HUD: OFF';
      e.currentTarget.blur();
    });

    root.querySelectorAll('.vs-modes .vs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveMode(btn.dataset.mode);
        btn.blur();
      });
    });

    document.getElementById('vsSmartBtn').addEventListener('click', (e) => {
      state.smartShape = !state.smartShape;
      e.currentTarget.classList.toggle('active', state.smartShape);
      e.currentTarget.blur();
    });

    document.getElementById('vsMirrorBtn').addEventListener('click', (e) => {
      state.mirror = !state.mirror;
      e.currentTarget.classList.toggle('active', state.mirror);
      e.currentTarget.blur();
    });

    document.getElementById('vsArFlipBtn').addEventListener('click', (e) => {
      state.arFlip = !state.arFlip;
      e.currentTarget.classList.toggle('active', state.arFlip);
      e.currentTarget.blur();
    });

    document.getElementById('vsEraserBtn').addEventListener('click', (e) => {
      state.eraser = !state.eraser;
      e.currentTarget.classList.toggle('active', state.eraser);
      e.currentTarget.blur();
    });

    root.querySelectorAll('.vs-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        root.querySelectorAll('.vs-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        setThemeColor(sw.dataset.color);
      });
    });

    document.getElementById('vsColorPicker').addEventListener('input', (e) => setThemeColor(e.target.value));
    document.getElementById('vsPinchSlider').addEventListener('input', (e) => { state.pinchThreshold = parseFloat(e.target.value); });
    document.getElementById('vsStrokeSlider').addEventListener('input', (e) => { state.strokeWidth = parseFloat(e.target.value); });

    document.getElementById('vsUndoBtn').addEventListener('click', (e) => {
      const removed = shapes.pop();
      cleanupShapeResources(removed);
      e.currentTarget.blur();
    });

    document.getElementById('vsClearBtn').addEventListener('click', (e) => {
      shapes.forEach(cleanupShapeResources);
      shapes = [];
      e.currentTarget.blur();
    });

    updateCameraList();
    setAiStatus('loading');
    requestAnimationFrame(animate);
  }

  // Boucle de démarrage dès que document.body est prêt
  const bootPoller = setInterval(() => {
    if (document.body) {
      clearInterval(bootPoller);
      try { boot(); } catch (err) { console.error('[Vision Studio] Erreur boot:', err); }
    }
  }, 100);
})();