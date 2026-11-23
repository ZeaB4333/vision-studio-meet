(function () {
  // ==========================================================================
  // 0. GARDE-CLAVIER DÈS DOCUMENT_START (Protège Espace sur Meet sauf saisie texte)
  // ==========================================================================
  const guard = { camActive: false, held: false, onDown: null, onUp: null, onShortcut: null };
  let pendingMeetCamRequest = false;
  let pendingRequestedDeviceId = '';

  const MAX_SHAPES = 300;
  const MAX_AR_OBJECTS = 3;

  const DEFAULT_SHORTCUTS = {
    drawMode: 'KeyD',
    laser: 'KeyL',
    eraser: 'KeyE',
    hideAll: 'KeyH',
    undo: 'KeyZ',
    redo: 'KeyY'
  };

  const DEFAULT_SETTINGS = {
    extEnabled: true,
    drawMode: false,
    ecoMode: false,
    leftHanded: false,
    lang: 'fr',
    tutorialSeen: false,
    shortcuts: DEFAULT_SHORTCUTS,
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
    showHint: false,
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
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const target = (e.composedPath && e.composedPath()[0]) || e.target;
    if (isTextEntry(target)) return;

    if (e.code === 'Space') {
      if (guard.held) { swallow(e); return; }
      if (!guard.camActive) return;
      swallow(e);
      if (e.repeat) return;
      guard.held = true;
      const ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (guard.onDown) guard.onDown();
      return;
    }

    if (!e.repeat && guard.onShortcut) {
      guard.onShortcut(e);
    }
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
            resolve({
              ...DEFAULT_SETTINGS,
              ...items,
              shortcuts: { ...DEFAULT_SHORTCUTS, ...(items && items.shortcuts ? items.shortcuts : {}) }
            });
          }
        });
      } else {
        resolve({ ...DEFAULT_SETTINGS, extEnabled: readInitialExtEnabledSync() });
      }
    });
  }

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
  // 1. DICTIONNAIRE BILINGUE (FR / EN) & ICÔNES SVG
  // ==========================================================================
  const I18N = {
    fr: {
      tabHome: 'Accueil',
      tabInsert: 'Insertion & AR',
      tabStyle: 'Dessin & Style',
      tabSettings: 'Caméra & IA',
      startCam: 'START CAM',
      camOn: 'CAM ON',
      stopCam: 'STOP CAM',
      drawModeOn: 'Mode dessin: ON',
      drawModeOff: 'Mode dessin: OFF',
      laser: 'Laser',
      laserStyle: 'Mode Laser (2s)',
      eraser: 'Gomme',
      arWin: 'Fenêtre AR',
      arImg: 'Image',
      arTextPlaceholder: 'Note Texte AR…',
      shapesOn: 'Formes: ON',
      shapesOff: 'Formes: OFF',
      opacity: 'Opacité',
      stroke: 'Trait',
      mirror: 'Miroir',
      flipAr: 'Flip AR',
      smartShape: 'Smart Shape',
      fill: 'Remplir',
      bw: 'N&B',
      clear: 'Clear',
      camDefaultOption: 'Caméra PC / Tel',
      camLabelPrefix: 'Caméra',
      extOn: 'Ext: ON',
      extOff: 'Ext: OFF',
      hudMeetOn: 'HUD Meet: ON',
      hudMeetOff: 'HUD Meet: OFF',
      leftHandedOn: 'Gaucher: ON',
      leftHandedOff: 'Gaucher: OFF',
      ecoOn: 'Éco: ON',
      ecoOff: 'Éco: OFF',
      shortcutsBtn: 'Raccourcis',
      hideAllOn: 'Masqué',
      hideAllOff: 'Visible',
      aiLoading: 'IA…',
      aiReady: 'IA OK',
      aiError: 'IA ERR',
      clutchOff: 'OFF',
      clutchSpace: 'ESP',
      clutchFistL: 'POING G',
      clutchFistR: 'POING D',
      hint: 'GESTES AUTO : [POING] ou [ESPACE] = DESSINER · [PINCER 1 MAIN] = DÉPLACER · [PINCER 2 MAINS] = ZOOMER',
      infoHintTitle: 'Afficher / Masquer l’aide gestuelle',
      trashWarn: 'ZONE DE SUPPRESSION — RELÂCHER POUR SUPPRIMER',
      localPreview: 'APERÇU LOCAL',
      tutoTitle: 'Guide Rapide — Vision Studio',
      tutoCard1Title: 'Dessiner',
      tutoStep1: 'Fermez le poing auxiliaire (ou Mode dessin + Espace) et bougez votre index dominant.',
      tutoCard2Title: 'Déplacer (1 main)',
      tutoStep2: 'Pincez pouce + index sur un dessin ou une fenêtre AR. Glissez au bord rouge pour supprimer.',
      tutoCard3Title: 'Zoomer (2 mains)',
      tutoStep3: 'Pincez avec les 2 mains simultanément et écartez-les pour agrandir ou pivoter.',
      tutoClose: 'Compris !',
      toastMpTimeoutTitle: 'Chargement IA trop long',
      toastMpTimeoutMsg: 'Le moteur MediaPipe ne répond pas après 10 s. Cliquez sur Réessayer pour le relancer.',
      toastClearTitle: 'Tableau effacé',
      toastClearMsg: 'Tous les éléments ont été retirés.',
      undoAction: 'Annuler',
      toastAudioErrTitle: 'Microphone indisponible',
      toastAudioErrMsg: 'Impossible d’accéder au microphone dans Meet. Vérifiez vos autorisations audio.',
      scTitle: 'Raccourcis clavier (cliquer pour modifier)',
      scHint: 'Actifs quand la fenêtre Vision Studio est ouverte (hors saisie texte).',
      scDrawMode: 'Mode dessin',
      scLaser: 'Laser (2s)',
      scEraser: 'Gomme',
      scHideAll: 'Tout masquer',
      scUndo: 'Annuler (Undo)',
      scRedo: 'Rétablir (Redo)',
      retryBtn: 'Réessayer',
      toastArCapTitle: 'Plafond AR atteint (3 max)',
      toastArCapMsg: 'Vous avez déjà 3 objets AR actifs. Fermez-en un avec [✕] ou glissez-le au bord rouge.',
      toastCaptureCancelTitle: 'Capture d’écran annulée',
      toastCaptureCancelMsg: 'Aucune fenêtre ou écran n’a été sélectionné pour la projection AR.',
      toastMpErrTitle: 'MediaPipe en échec',
      toastMpErrSuffix: 'Vérifiez le dossier vendor/ ou réessayez.',
      toastBgTabTitle: 'Onglet Meet en arrière-plan',
      toastBgTabActiveMsg: 'Minuteur d’arrière-plan actif pour maintenir votre flux vidéo.',
      toastBgTabWarnMsg: 'Gardez l’onglet Meet visible pour éviter le gel de la caméra.',
      toastCamFallbackTitle: 'Caméra mémorisée introuvable',
      toastCamFallbackMsg: 'Caméra mémorisée introuvable, caméra par défaut utilisée.',
      toastCamPermTitle: 'Autorisez la caméra',
      toastCamPermMsg: 'Accès refusé. Cliquez sur l’icône de cadenas à gauche de l’URL meet.google.com → Autoriser la caméra, puis cliquez sur Réessayer.',
      toastCamErrTitle: 'Erreur matérielle caméra',
      toastCamErrPrefix: 'Impossible de démarrer la caméra',
      toastStopCamTitle: 'Caméra virtuelle arrêtée',
      toastExtOffTitle: 'Extension désactivée (Passthrough)',
      toastExtOffMsg: 'Retour à la vraie caméra. Si l’image reste figée, coupez puis rallumez la caméra dans Meet.',
      toastExtOnTitle: 'Extension activée',
      toastExtOnMsg: 'Caméra virtuelle active. Si les dessins n’apparaissent pas chez les participants, coupez puis rallumez la caméra dans Meet.'
    },
    en: {
      tabHome: 'Home',
      tabInsert: 'Insert & AR',
      tabStyle: 'Draw & Style',
      tabSettings: 'Camera & AI',
      startCam: 'START CAM',
      camOn: 'CAM ON',
      stopCam: 'STOP CAM',
      drawModeOn: 'Draw Mode: ON',
      drawModeOff: 'Draw Mode: OFF',
      laser: 'Laser',
      laserStyle: 'Laser Mode (2s)',
      eraser: 'Eraser',
      arWin: 'AR Window',
      arImg: 'Image',
      arTextPlaceholder: 'AR Text Note…',
      shapesOn: 'Shapes: ON',
      shapesOff: 'Shapes: OFF',
      opacity: 'Opacity',
      stroke: 'Stroke',
      mirror: 'Mirror',
      flipAr: 'Flip AR',
      smartShape: 'Smart Shape',
      fill: 'Fill',
      bw: 'B&W',
      clear: 'Clear',
      camDefaultOption: 'PC / Phone Cam',
      camLabelPrefix: 'Camera',
      extOn: 'Ext: ON',
      extOff: 'Ext: OFF',
      hudMeetOn: 'HUD Meet: ON',
      hudMeetOff: 'HUD Meet: OFF',
      leftHandedOn: 'Left-Hand: ON',
      leftHandedOff: 'Left-Hand: OFF',
      ecoOn: 'Eco: ON',
      ecoOff: 'Eco: OFF',
      shortcutsBtn: 'Shortcuts',
      hideAllOn: 'Hidden',
      hideAllOff: 'Visible',
      aiLoading: 'AI…',
      aiReady: 'AI OK',
      aiError: 'AI ERR',
      clutchOff: 'OFF',
      clutchSpace: 'SPACE',
      clutchFistL: 'FIST L',
      clutchFistR: 'FIST R',
      hint: 'AUTO GESTURES: [FIST] or [SPACE] = DRAW · [1-HAND PINCH] = MOVE · [2-HAND PINCH] = ZOOM',
      infoHintTitle: 'Show / Hide gesture hint',
      trashWarn: 'TRASH ZONE — RELEASE TO DELETE',
      localPreview: 'LOCAL PREVIEW',
      tutoTitle: 'Quick Guide — Vision Studio',
      tutoCard1Title: 'Draw',
      tutoStep1: 'Close your auxiliary fist (or Draw Mode + Spacebar) and move your dominant index finger.',
      tutoCard2Title: 'Move (1 hand)',
      tutoStep2: 'Pinch thumb + index on any stroke or AR window. Drag to the red edge to delete.',
      tutoCard3Title: 'Zoom (2 hands)',
      tutoStep3: 'Pinch with both hands simultaneously and spread them to resize or rotate.',
      tutoClose: 'Got it!',
      toastMpTimeoutTitle: 'AI Engine Timeout',
      toastMpTimeoutMsg: 'MediaPipe did not respond after 10s. Click Retry to reload it.',
      toastClearTitle: 'Canvas Cleared',
      toastClearMsg: 'All drawings and AR items were removed.',
      undoAction: 'Undo',
      toastAudioErrTitle: 'Microphone Unavailable',
      toastAudioErrMsg: 'Could not access the microphone for Meet. Check your browser audio permissions.',
      scTitle: 'Keyboard Shortcuts (click to rebind)',
      scHint: 'Active while the Vision Studio panel is open (outside text inputs).',
      scDrawMode: 'Draw Mode',
      scLaser: 'Laser (2s)',
      scEraser: 'Eraser',
      scHideAll: 'Hide All',
      scUndo: 'Undo',
      scRedo: 'Redo',
      retryBtn: 'Retry',
      toastArCapTitle: 'AR Limit Reached (3 max)',
      toastArCapMsg: 'You already have 3 active AR objects. Close one with [✕] or drag it to the red edge.',
      toastCaptureCancelTitle: 'Screen Capture Cancelled',
      toastCaptureCancelMsg: 'No window or screen was selected for AR projection.',
      toastMpErrTitle: 'MediaPipe Failed',
      toastMpErrSuffix: 'Check the vendor/ folder or retry.',
      toastBgTabTitle: 'Meet Tab in Background',
      toastBgTabActiveMsg: 'Background timer active to keep your video stream running.',
      toastBgTabWarnMsg: 'Keep the Meet tab visible to prevent the camera from freezing.',
      toastCamFallbackTitle: 'Saved Camera Not Found',
      toastCamFallbackMsg: 'Saved camera unavailable, falling back to default camera.',
      toastCamPermTitle: 'Allow Camera Access',
      toastCamPermMsg: 'Permission denied. Click the lock icon next to meet.google.com → Allow camera, then click Retry.',
      toastCamErrTitle: 'Camera Hardware Error',
      toastCamErrPrefix: 'Unable to start camera',
      toastStopCamTitle: 'Virtual Camera Stopped',
      toastExtOffTitle: 'Extension Disabled (Passthrough)',
      toastExtOffMsg: 'Switched back to your hardware webcam. If video stays frozen, toggle the camera off and on in Meet.',
      toastExtOnTitle: 'Extension Enabled',
      toastExtOnMsg: 'Virtual camera active. If drawings do not appear for participants, toggle the camera off and on in Meet.'
    }
  };

  const ICONS = {
    home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5-4.5-9-10-9z"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    laser: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    shapes: '<circle cx="8" cy="15" r="4"/><polygon points="15 4 21 14 9 14"/>',
    flip: '<polyline points="17 2 21 6 17 10"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 14v-1a2 2 0 0 0-4 0v3a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8v-5a2 2 0 0 0-4 0"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2"/><line x1="2" y1="2" x2="22" y2="22"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13C4 7 11 3 20 3c0 9-4 17-9 17z"/><path d="M4 20l7-7"/>',
    keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="7" y1="16" x2="17" y2="16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    tv: '<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
  };

  function iconSvg(name, size = 13) {
    const body = ICONS[name] || '';
    return `<svg class="vs-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function setBtn(el, iconKey, label = '') {
    if (!el) return;
    el.innerHTML = iconKey ? iconSvg(iconKey) : '';
    if (label) {
      const sp = document.createElement('span');
      sp.textContent = label;
      el.appendChild(sp);
    }
  }

  // ==========================================================================
  // 2. INITIALISATION DE L'INTERFACE RUBAN (LECTURE STORAGE AVANT CONSTRUCTION UI)
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
      leftHanded: Boolean(savedSettings.leftHanded),
      lang: savedSettings.lang === 'en' ? 'en' : 'fr',
      tutorialSeen: Boolean(savedSettings.tutorialSeen),
      shortcuts: { ...DEFAULT_SHORTCUTS, ...(savedSettings.shortcuts || {}) },
      hideAll: false,
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
      showHint: Boolean(savedSettings.showHint),
      windowBounds: savedSettings.windowBounds || null,
      bubblePos: savedSettings.bubblePos || null,
      spacePressed: false,
      leftHandClutch: false
    };

    const t = () => I18N[state.lang] || I18N.fr;

    if (document.documentElement) {
      document.documentElement.dataset.vsExtEnabled = state.extEnabled ? 'true' : 'false';
    }
    try {
      localStorage.setItem('vs_ext_enabled', state.extEnabled ? 'true' : 'false');
    } catch (e) {}

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
            leftHanded: state.leftHanded,
            lang: state.lang,
            tutorialSeen: state.tutorialSeen,
            shortcuts: state.shortcuts,
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
            showHint: state.showHint,
            windowBounds: state.windowBounds,
            bubblePos: state.bubblePos
          });
        }
      }, 500);
    }

    const shadowHost = document.createElement('div');
    shadowHost.id = 'vs-shadow-host';
    shadowHost.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const $ = (id) => shadow.getElementById(id);

    const style = document.createElement('style');
    style.id = 'vs-studio-styles';
    style.textContent = `
      *, *::before, *::after {
        box-sizing: border-box;
      }
      .vs-ico {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
        display: inline-block;
        vertical-align: middle;
      }
      #vs-floating-bubble {
        pointer-events: auto !important;
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
        width: 580px;
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

      /* RUBAN CONTEXTUEL + ACTIONS FIGÉES (HIDE ALL / UNDO / REDO / CLEAR) */
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

      /* VIEWPORT VIDÉO + MODALES INTERNES (TUTORIEL & RACCOURCIS) */
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
        right: 48px;
        background: rgba(8, 10, 16, 0.86);
        border: 1px solid var(--border);
        padding: 3px 7px;
        font-size: 8.8px;
        color: rgba(255, 255, 255, 0.88);
        pointer-events: none;
        border-radius: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      .vs-hint.open {
        opacity: 1;
        transform: translateY(0);
      }
      #vsHintToggleBtn {
        position: absolute;
        bottom: 5px;
        right: 24px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(14, 16, 21, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: var(--text);
        font-family: Georgia, serif;
        font-style: italic;
        font-weight: 700;
        font-size: 11px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 10;
        padding: 0;
        transition: all 0.14s ease;
      }
      #vsHintToggleBtn:hover {
        border-color: var(--theme-color);
        color: var(--theme-color);
      }
      #vsHintToggleBtn.active {
        background: var(--theme-color);
        border-color: var(--theme-color);
        color: #000;
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
      .vs-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(6, 8, 12, 0.92);
        backdrop-filter: blur(6px);
        display: none;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 14px;
        z-index: 20;
      }
      .vs-modal-overlay.open {
        display: flex;
      }
      .vs-modal-card {
        background: #11141d;
        border: 1px solid var(--theme-color);
        border-radius: 8px;
        padding: 12px 14px;
        max-width: 460px;
        width: 100%;
        color: var(--text);
        font-size: 10px;
        line-height: 1.45;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85);
      }
      .vs-modal-title {
        font-weight: 700;
        font-size: 11px;
        color: var(--theme-color);
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .vs-sc-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin: 8px 0;
      }
      .vs-sc-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.04);
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid var(--border);
      }
      .vs-sc-key {
        background: #08090c;
        color: var(--theme-color);
        border: 1px solid rgba(0, 240, 255, 0.4);
        padding: 2px 6px;
        border-radius: 3px;
        font-family: inherit;
        font-size: 9.5px;
        font-weight: 700;
        cursor: pointer;
      }
      .vs-sc-key.listening {
        background: var(--ar-accent);
        color: #000;
        border-color: var(--ar-accent);
      }
      .vs-tuto-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin: 8px 0 12px;
      }
      .vs-tuto-card {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .vs-tuto-card-head {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--theme-color);
        font-weight: 700;
        font-size: 10px;
      }
      .vs-tuto-card p {
        margin: 0;
        color: var(--muted);
        font-size: 9.2px;
        line-height: 1.4;
      }
      .vs-pinch-meter {
        position: relative;
        width: 44px;
        height: 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
        border: 1px solid var(--border);
      }
      .vs-pinch-fill {
        height: 100%;
        width: 0%;
        background: var(--theme-color);
        transition: width 0.06s linear, background-color 0.1s ease;
      }
      .vs-pinch-fill.pinched {
        background: var(--success);
      }
      .vs-pinch-thresh {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1.5px;
        background: #fff;
        opacity: 0.85;
      }
      #vs-root-overlay, #vs-mini-preview {
        pointer-events: auto !important;
      }
    `;
    shadow.appendChild(style);

    const toastContainer = document.createElement('div');
    toastContainer.id = 'vs-toast-container';
    shadow.appendChild(toastContainer);

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

    const bubble = document.createElement('div');
    bubble.id = 'vs-floating-bubble';
    bubble.title = 'Vision Studio';
    bubble.innerHTML = `${iconSvg('sparkles', 22)}<span class="vs-bubble-dot"></span>`;
    shadow.appendChild(bubble);

    const miniPreview = document.createElement('div');
    miniPreview.id = 'vs-mini-preview';
    miniPreview.title = 'Vision Studio';
    miniPreview.innerHTML = `
      <canvas id="vsMiniPreviewCanvas" width="224" height="126"></canvas>
      <span class="vs-mini-tag" id="vsMiniTagText">APERÇU LOCAL</span>
    `;
    shadow.appendChild(miniPreview);
    const miniPreviewCanvas = miniPreview.querySelector('#vsMiniPreviewCanvas');
    const miniPreviewCtx = miniPreviewCanvas.getContext('2d');

    const root = document.createElement('div');
    root.id = 'vs-root-overlay';
    root.innerHTML = `
      <header class="vs-topbar" id="vsDragHeader">
        <div class="vs-brand">
          <span class="vs-brand-dot"></span>
          <span>VISION</span>
        </div>

        <nav class="vs-tabs" id="vsTabsNav">
          <button class="vs-tab-btn active" data-tab="home" id="vsTabHome"></button>
          <button class="vs-tab-btn" data-tab="insert" id="vsTabInsert"></button>
          <button class="vs-tab-btn" data-tab="style" id="vsTabStyle"></button>
          <button class="vs-tab-btn" data-tab="settings" id="vsTabSettings"></button>
        </nav>

        <div class="vs-status-Cluster">
          <button class="vs-btn active" id="vsExtActiveBtn"></button>
          <div class="vs-led-pill" id="vsClutchBadge">
            <span class="vs-led-dot"></span><span id="vsClutchText">OFF</span>
          </div>
          <div class="vs-led-pill" id="vsAiBadge">
            <span class="vs-led-dot"></span><span id="vsAiText">IA…</span>
          </div>
          <button class="vs-btn" id="vsLangBtn"></button>
          <button class="vs-btn" id="vsTutorialBtn">${iconSvg('help')}</button>
          <button class="vs-btn active" id="vsPreviewToggleBtn">${iconSvg('tv')}</button>
          <button class="vs-btn" id="vsCollapseBtn">${iconSvg('minus')}</button>
        </div>
      </header>

      <div class="vs-ribbon">
        <!-- ONGLET 1 : ACCUEIL -->
        <div class="vs-ribbon-pane active" data-pane="home">
          <button class="vs-btn" id="vsCamBtn"></button>
          <button class="vs-btn vs-btn-danger" id="vsStopCamBtn"></button>
          <button class="vs-btn vs-btn-drawmode" id="vsDrawModeBtn"></button>
          <div class="vs-sep"></div>
          <button class="vs-btn vs-btn-laser" id="vsLaserQuickBtn"></button>
          <button class="vs-btn vs-btn-danger" id="vsEraserBtn"></button>
        </div>

        <!-- ONGLET 2 : INSERTION & RÉALITÉ AUGMENTÉE -->
        <div class="vs-ribbon-pane" data-pane="insert">
          <button class="vs-btn vs-btn-ar" id="vsArWinBtn"></button>
          <button class="vs-btn vs-btn-ar" id="vsArImgBtn"></button>
          <input type="file" id="vsArFileInput" accept="image/*" style="display:none;" />
          <div class="vs-control-group">
            <input type="text" id="vsArTextInput" placeholder="Note Texte AR…" />
            <button class="vs-btn vs-btn-ar" id="vsArTextAddBtn">${iconSvg('plus')}</button>
          </div>
          <div class="vs-sep"></div>
          <button class="vs-btn" id="vsAirMenuToggleBtn"></button>
          <div class="vs-control-group">
            <span id="vsOpacityLabel">Opacité</span>
            <input type="range" id="vsArOpacitySlider" min="0.25" max="1" step="0.05" value="0.92" />
          </div>
          <button class="vs-btn" id="vsArFlipBtn"></button>
        </div>

        <!-- ONGLET 3 : DESSIN & STYLE -->
        <div class="vs-ribbon-pane" data-pane="style">
          <button class="vs-btn vs-btn-laser" id="vsLaserStyleBtn"></button>
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
            <span id="vsStrokeLabel">Trait</span>
            <input type="range" id="vsStrokeSlider" min="1.5" max="12" step="0.5" value="3.5" />
          </div>
          <button class="vs-btn" id="vsSmartBtn"></button>
          <button class="vs-btn" id="vsFillBtn"></button>
        </div>

        <!-- ONGLET 4 : CAMÉRA & IA -->
        <div class="vs-ribbon-pane" data-pane="settings">
          <div class="vs-control-group">
            <span>Cam</span>
            <select id="vsCameraSelect"><option value="">Caméra PC / Tel</option></select>
          </div>
          <div class="vs-control-group">
            <span>Pinch</span>
            <input type="range" id="vsPinchSlider" min="0.35" max="0.85" step="0.02" value="0.58" />
            <div class="vs-pinch-meter" id="vsPinchMeter" title="Pinch live">
              <div class="vs-pinch-fill" id="vsPinchFill"></div>
              <div class="vs-pinch-thresh" id="vsPinchThresh"></div>
            </div>
          </div>
          <div class="vs-sep"></div>
          <button class="vs-btn active" id="vsMirrorBtn"></button>
          <button class="vs-btn" id="vsLeftHandedBtn"></button>
          <button class="vs-btn" id="vsHudMeetBtn"></button>
          <button class="vs-btn" id="vsBwBtn"></button>
          <button class="vs-btn" id="vsEcoBtn"></button>
          <button class="vs-btn" id="vsShortcutsBtn"></button>
        </div>

        <!-- ZONE FIGÉE À DROITE SUR TOUS LES ONGLETS : TOUT MASQUER, UNDO, REDO, CLEAR -->
        <div class="vs-ribbon-pinned">
          <button class="vs-btn" id="vsHideAllBtn"></button>
          <button class="vs-btn" id="vsUndoBtn">${iconSvg('undo')}</button>
          <button class="vs-btn" id="vsRedoBtn">${iconSvg('redo')}</button>
          <button class="vs-btn" id="vsClearBtn"></button>
        </div>
      </div>

      <main class="vs-viewport" id="vsViewport">
        <canvas id="vsMainCanvas"></canvas>
        <div class="vs-hint" id="vsHintText"></div>
        <button type="button" id="vsHintToggleBtn" aria-label="Infos">i</button>
        <div id="vsResizeHandle">◢</div>

        <!-- MODALE TUTORIEL -->
        <div class="vs-modal-overlay" id="vsTutorialModal">
          <div class="vs-modal-card">
            <div class="vs-modal-title">
              <span id="vsTutoTitleText"></span>
            </div>
            <div class="vs-tuto-grid">
              <div class="vs-tuto-card">
                <div class="vs-tuto-card-head">${iconSvg('pen')}<span id="vsTutoCard1Title"></span></div>
                <p id="vsTutoStep1"></p>
              </div>
              <div class="vs-tuto-card">
                <div class="vs-tuto-card-head">${iconSvg('hand')}<span id="vsTutoCard2Title"></span></div>
                <p id="vsTutoStep2"></p>
              </div>
              <div class="vs-tuto-card">
                <div class="vs-tuto-card-head">${iconSvg('layers')}<span id="vsTutoCard3Title"></span></div>
                <p id="vsTutoStep3"></p>
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="vs-btn active" id="vsTutorialCloseBtn"></button>
            </div>
          </div>
        </div>

        <!-- MODALE RACCOURCIS CLAVIER CONFIGURABLES -->
        <div class="vs-modal-overlay" id="vsShortcutsModal">
          <div class="vs-modal-card">
            <div class="vs-modal-title">
              <span id="vsScTitleText"></span>
              <button class="vs-btn" id="vsShortcutsCloseBtn">${iconSvg('close')}</button>
            </div>
            <div class="vs-sc-grid">
              <div class="vs-sc-item"><span id="vsScLblDrawMode"></span><button class="vs-sc-key" data-sc="drawMode"></button></div>
              <div class="vs-sc-item"><span id="vsScLblLaser"></span><button class="vs-sc-key" data-sc="laser"></button></div>
              <div class="vs-sc-item"><span id="vsScLblEraser"></span><button class="vs-sc-key" data-sc="eraser"></button></div>
              <div class="vs-sc-item"><span id="vsScLblHideAll"></span><button class="vs-sc-key" data-sc="hideAll"></button></div>
              <div class="vs-sc-item"><span id="vsScLblUndo"></span><button class="vs-sc-key" data-sc="undo"></button></div>
              <div class="vs-sc-item"><span id="vsScLblRedo"></span><button class="vs-sc-key" data-sc="redo"></button></div>
            </div>
            <div id="vsScHintText" style="color:var(--muted); font-size:9px; margin-top:4px;"></div>
          </div>
        </div>
      </main>
    `;
    shadow.appendChild(root);

    const resizeHandle = $('vsResizeHandle');
    const viewportEl = $('vsViewport');
    const tutorialModal = $('vsTutorialModal');
    const shortcutsModal = $('vsShortcutsModal');
    const clutchBadge = $('vsClutchBadge');
    const clutchText = $('vsClutchText');
    const aiBadge = $('vsAiBadge');
    const aiText = $('vsAiText');
    let aiReady = false;
    let aiStatusKind = 'loading';

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

    function applyLanguageUI() {
      const tr = t();
      setBtn($('vsLangBtn'), 'globe', state.lang === 'en' ? 'EN' : 'FR');
      setBtn($('vsTabHome'), 'home', tr.tabHome);
      setBtn($('vsTabInsert'), 'layers', tr.tabInsert);
      setBtn($('vsTabStyle'), 'palette', tr.tabStyle);
      setBtn($('vsTabSettings'), 'sliders', tr.tabSettings);

      setBtn($('vsCamBtn'), 'video', state.cameraActive ? tr.camOn : tr.startCam);
      setBtn($('vsStopCamBtn'), 'stop', tr.stopCam);
      setBtn($('vsDrawModeBtn'), 'pen', state.drawMode ? tr.drawModeOn : tr.drawModeOff);

      setBtn($('vsLaserQuickBtn'), 'laser', tr.laser);
      setBtn($('vsLaserStyleBtn'), 'laser', tr.laserStyle);
      setBtn($('vsEraserBtn'), 'eraser', tr.eraser);

      setBtn($('vsArWinBtn'), 'monitor', tr.arWin);
      setBtn($('vsArImgBtn'), 'image', tr.arImg);
      $('vsArTextInput').placeholder = tr.arTextPlaceholder;

      setBtn($('vsAirMenuToggleBtn'), 'shapes', state.showAirMenu ? tr.shapesOn : tr.shapesOff);
      setBtn($('vsArFlipBtn'), 'flip', tr.flipAr);

      $('vsOpacityLabel').textContent = tr.opacity;
      $('vsStrokeLabel').textContent = tr.stroke;
      setBtn($('vsSmartBtn'), 'sparkles', tr.smartShape);
      setBtn($('vsFillBtn'), 'square', tr.fill);

      setBtn($('vsMirrorBtn'), 'flip', tr.mirror);
      setBtn($('vsLeftHandedBtn'), 'hand', state.leftHanded ? tr.leftHandedOn : tr.leftHandedOff);
      setBtn($('vsHudMeetBtn'), state.showHudOnMeet ? 'eye' : 'eyeOff', state.showHudOnMeet ? tr.hudMeetOn : tr.hudMeetOff);
      setBtn($('vsBwBtn'), 'contrast', tr.bw);
      setBtn($('vsEcoBtn'), 'leaf', state.ecoMode ? tr.ecoOn : tr.ecoOff);
      setBtn($('vsShortcutsBtn'), 'keyboard', tr.shortcutsBtn);

      setBtn($('vsHideAllBtn'), state.hideAll ? 'eyeOff' : 'eye', state.hideAll ? tr.hideAllOn : tr.hideAllOff);
      setBtn($('vsClearBtn'), 'trash', tr.clear);

      setBtn($('vsExtActiveBtn'), 'power', state.extEnabled ? tr.extOn : tr.extOff);

      $('vsHintText').textContent = tr.hint;
      $('vsHintToggleBtn').title = tr.infoHintTitle;
      $('vsMiniTagText').textContent = tr.localPreview;

      $('vsTutoTitleText').textContent = tr.tutoTitle;
      $('vsTutoCard1Title').textContent = tr.tutoCard1Title;
      $('vsTutoStep1').textContent = tr.tutoStep1;
      $('vsTutoCard2Title').textContent = tr.tutoCard2Title;
      $('vsTutoStep2').textContent = tr.tutoStep2;
      $('vsTutoCard3Title').textContent = tr.tutoCard3Title;
      $('vsTutoStep3').textContent = tr.tutoStep3;
      $('vsTutorialCloseBtn').textContent = tr.tutoClose;

      $('vsScTitleText').textContent = tr.scTitle;
      $('vsScHintText').textContent = tr.scHint;
      $('vsScLblDrawMode').textContent = tr.scDrawMode;
      $('vsScLblLaser').textContent = tr.scLaser;
      $('vsScLblEraser').textContent = tr.scEraser;
      $('vsScLblHideAll').textContent = tr.scHideAll;
      $('vsScLblUndo').textContent = tr.scUndo;
      $('vsScLblRedo').textContent = tr.scRedo;

      if (typeof updateClutchBadge === 'function') updateClutchBadge();
      if (typeof setAiStatus === 'function' && typeof aiStatusKind !== 'undefined') setAiStatus(aiStatusKind);
    }

    function renderShortcutsButtons() {
      root.querySelectorAll('.vs-sc-key').forEach((btn) => {
        const keyName = btn.dataset.sc;
        const code = state.shortcuts[keyName] || '—';
        btn.textContent = code.replace(/^Key/, '').replace(/^Digit/, '');
      });
    }

    function applyStoredControlsToUI() {
      root.style.setProperty('--theme-color', state.color);
      const colorPicker = $('vsColorPicker');
      if (colorPicker) colorPicker.value = state.color;

      root.querySelectorAll('.vs-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === state.color.toLowerCase());
      });

      $('vsStrokeSlider').value = String(state.strokeWidth);
      $('vsArOpacitySlider').value = String(state.arOpacity);
      $('vsPinchSlider').value = String(state.pinchThreshold);

      $('vsDrawModeBtn').classList.toggle('active', state.drawMode);
      $('vsLaserQuickBtn').classList.toggle('active', state.laserMode);
      $('vsLaserStyleBtn').classList.toggle('active', state.laserMode);
      $('vsAirMenuToggleBtn').classList.toggle('active', state.showAirMenu);
      $('vsSmartBtn').classList.toggle('active', state.smartShape);
      $('vsFillBtn').classList.toggle('active', state.filled);
      $('vsMirrorBtn').classList.toggle('active', state.mirror);
      $('vsLeftHandedBtn').classList.toggle('active', state.leftHanded);
      $('vsBwBtn').classList.toggle('active', state.bwFilter);
      $('vsArFlipBtn').classList.toggle('active', state.arFlip);
      $('vsEcoBtn').classList.toggle('active', state.ecoMode);
      $('vsHudMeetBtn').classList.toggle('active', state.showHudOnMeet);
      $('vsHintText').classList.toggle('open', state.showHint);
      $('vsHintToggleBtn').classList.toggle('active', state.showHint);

      renderShortcutsButtons();
      applyLanguageUI();
    }

    applyStoredGeometry();
    applyStoredControlsToUI();

    const tabsNav = $('vsTabsNav');
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

    const SANDBOX_URL = chrome.runtime.getURL('sandbox.html');
    const SANDBOX_ORIGIN = new URL(SANDBOX_URL).origin;
    const sandboxFrame = document.createElement('iframe');
    sandboxFrame.src = SANDBOX_URL;
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

    function updatePinchThreshMarker() {
      const marker = $('vsPinchThresh');
      if (!marker) return;
      // pinchRatio ~ 0 (serré) -> 1.2 (ouvert). Plus la barre est remplie, plus les doigts sont proches.
      const pct = Math.max(0, Math.min(100, (1 - state.pinchThreshold / 1.2) * 100));
      marker.style.left = `${pct.toFixed(1)}%`;
    }

    function updatePinchMeter(domHand) {
      const fill = $('vsPinchFill');
      if (!fill) return;
      if (!domHand) {
        fill.style.width = '0%';
        fill.classList.remove('pinched');
        return;
      }
      const pct = Math.max(0, Math.min(100, (1 - Math.min(1.2, domHand.pinchRatio) / 1.2) * 100));
      fill.style.width = `${pct.toFixed(0)}%`;
      fill.classList.toggle('pinched', Boolean(domHand.isPinching));
    }

    function ensureDomConnected() {
      if (!shadowHost.isConnected) document.body.appendChild(shadowHost);
      if (!sourceVideo.isConnected) document.body.appendChild(sourceVideo);
      if (!sandboxFrame.isConnected) document.body.appendChild(sandboxFrame);
    }

    function syncVisibility() {
      ensureDomConnected();
      root.classList.toggle('vs-open', panelOpen);
      bubble.classList.toggle('vs-hidden', panelOpen);
      positionMiniPreview();
    }

    function openPanel() {
      panelOpen = true;
      syncVisibility();
      if (!state.tutorialSeen) {
        tutorialModal.classList.add('open');
      }
    }

    function collapseToBubble() {
      panelOpen = false;
      syncVisibility();
    }

    miniPreview.addEventListener('click', () => {
      openPanel();
    });

    window.addEventListener('resize', positionMiniPreview);
    setInterval(ensureDomConnected, 1500);
    syncVisibility();
    updatePinchThreshMarker();

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
    const dragHeader = $('vsDragHeader');
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
    let rDrag = { active: false, startX: 0, startY: 0, startW: 580, startH: 270 };

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
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (!path.includes(root) && !path.includes(bubble) && !path.includes(toastContainer)) {
        collapseToBubble();
      }
    }, true);

    $('vsCollapseBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      collapseToBubble();
    });

    $('vsPreviewToggleBtn').addEventListener('click', (e) => {
      const hidden = root.classList.toggle('hide-preview');
      e.currentTarget.classList.toggle('active', !hidden);
      e.currentTarget.blur();
    });

    const hintToggleBtn = $('vsHintToggleBtn');
    hintToggleBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    hintToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.showHint = !state.showHint;
      $('vsHintText').classList.toggle('open', state.showHint);
      hintToggleBtn.classList.toggle('active', state.showHint);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    // ==========================================================================
    // 7. MOTEUR GRAPHIQUE, CACHE HORS-ÉCRAN, RELAIS MINUTEUR N4 & MEDIAPIPE
    // ==========================================================================
    const aiMiniCanvas = document.createElement('canvas');
    aiMiniCanvas.width = 384;
    aiMiniCanvas.height = 216;
    const aiMiniCtx = aiMiniCanvas.getContext('2d');

    let sandboxBusy = false;
    let lastSentTime = 0;
    let bgTimerReady = false;

    // Relais du minuteur d'arrière-plan vers sandbox.html (N4)
    const bgTimerWorker = {
      postMessage(cmd) {
        if (sandboxFrame && sandboxFrame.contentWindow) {
          sandboxFrame.contentWindow.postMessage({ type: 'VS_TIMER', cmd }, SANDBOX_ORIGIN);
        }
      }
    };

    const mainCanvas = $('vsMainCanvas');
    const ctx = mainCanvas.getContext('2d');

    mainCanvas.width = 960;
    mainCanvas.height = 540;

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
    let redoStack = [];
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
      { type: 'line', label: 'LINE' },
      { type: 'arrow', label: 'ARROW' },
      { type: 'diamond', label: 'DIAMOND' }
    ];

    function setAiStatus(kind, msg) {
      aiStatusKind = kind;
      aiReady = kind === 'ready';
      aiBadge.classList.toggle('on', kind === 'ready');
      aiBadge.classList.toggle('err', kind === 'error');
      const tr = t();
      aiText.textContent = kind === 'ready' ? tr.aiReady : (kind === 'error' ? tr.aiError : tr.aiLoading);
      if (msg) aiBadge.title = msg;
    }

    let mediaPipeLoadTimer = null;

    function clearMediaPipeTimeout() {
      if (mediaPipeLoadTimer) {
        clearTimeout(mediaPipeLoadTimer);
        mediaPipeLoadTimer = null;
      }
    }

    function startMediaPipeTimeout() {
      clearMediaPipeTimeout();
      mediaPipeLoadTimer = setTimeout(() => {
        mediaPipeLoadTimer = null;
        if (!aiReady) {
          setAiStatus('error', t().toastMpTimeoutTitle);
          showToast({
            id: 'mp-error',
            title: t().toastMpTimeoutTitle,
            message: t().toastMpTimeoutMsg,
            kind: 'error',
            duration: 12000,
            actionLabel: t().retryBtn,
            onAction: retryMediaPipeSandbox
          });
        }
      }, 10000);
    }

    function retryMediaPipeSandbox() {
      setAiStatus('loading');
      sandboxBusy = false;
      startMediaPipeTimeout();
      sandboxFrame.src = chrome.runtime.getURL('sandbox.html') + '?retry=' + Date.now();
    }

    function setThemeColor(hex) {
      state.color = hex;
      root.style.setProperty('--theme-color', hex);
      const picker = $('vsColorPicker');
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
      const drawBtn = $('vsDrawModeBtn');
      if (drawBtn) {
        drawBtn.classList.toggle('active', state.drawMode);
        setBtn(drawBtn, 'pen', state.drawMode ? t().drawModeOn : t().drawModeOff);
      }
      syncSpaceGuard();
      updateClutchBadge();
      scheduleSaveSettings();
    }

    function toggleLaserMode() {
      state.laserMode = !state.laserMode;
      if (state.laserMode) {
        state.eraser = false;
        $('vsEraserBtn').classList.remove('active');
      }
      $('vsLaserQuickBtn').classList.toggle('active', state.laserMode);
      $('vsLaserStyleBtn').classList.toggle('active', state.laserMode);
      scheduleSaveSettings();
    }

    function toggleHideAll() {
      state.hideAll = !state.hideAll;
      const hideBtn = $('vsHideAllBtn');
      if (hideBtn) {
        hideBtn.classList.toggle('active', state.hideAll);
        setBtn(hideBtn, state.hideAll ? 'eyeOff' : 'eye', state.hideAll ? t().hideAllOn : t().hideAllOff);
      }
    }

    guard.onDown = () => { state.spacePressed = true; updateClutchBadge(); };
    guard.onUp = () => { state.spacePressed = false; updateClutchBadge(); };

    function isClutchEngaged() {
      return (state.drawMode && state.spacePressed) || state.leftHandClutch;
    }

    function updateClutchBadge() {
      const engaged = isClutchEngaged();
      const tr = t();
      clutchBadge.classList.toggle('on', engaged);
      bubble.classList.toggle('clutch-active', engaged);
      if (engaged) {
        const fistLabel = state.leftHanded ? tr.clutchFistR : tr.clutchFistL;
        const src = (state.drawMode && state.spacePressed) ? tr.clutchSpace : fistLabel;
        clutchText.textContent = src;
      } else {
        clutchText.textContent = tr.clutchOff;
      }
    }

    function isArObject(s) {
      return s && (s.type === 'ar-window' || s.type === 'ar-image' || s.type === 'ar-text');
    }

    function cleanupShapeResources(s) {
      if (!s) return;
      if (s.mediaStream) {
        try { s.mediaStream.getTracks().forEach(tr => tr.stop()); } catch (e) {}
      }
      if (s.videoEl && s.videoEl.parentNode) {
        try { s.videoEl.parentNode.removeChild(s.videoEl); } catch (e) {}
      }
      if (s.frameCacheCanvas) {
        s.frameCacheCanvas = null;
        s.frameCacheCtx = null;
      }
    }

    function clearRedoStack() {
      while (redoStack.length > 0) {
        const item = redoStack.pop();
        if (item && !shapes.includes(item)) {
          cleanupShapeResources(item);
        }
      }
    }

    function setArMediaPaused(s, paused) {
      if (!s || s.type !== 'ar-window') return;
      if (s.mediaStream) {
        try {
          s.mediaStream.getVideoTracks().forEach(tr => { tr.enabled = !paused; });
        } catch (e) {}
      }
      if (s.videoEl) {
        try {
          if (paused) s.videoEl.pause();
          else s.videoEl.play().catch(() => {});
        } catch (e) {}
      }
    }

    function performUndo() {
      if (shapes.length === 0) return;
      const removed = shapes.pop();
      if (removed) {
        setArMediaPaused(removed, true);
        redoStack.push(removed);
      }
    }

    function performRedo() {
      if (redoStack.length === 0) return;
      const restored = redoStack.pop();
      if (restored) {
        setArMediaPaused(restored, false);
        shapes.push(restored);
      }
    }

    function checkArObjectCap() {
      const currentArCount = shapes.filter(isArObject).length;
      if (currentArCount >= MAX_AR_OBJECTS) {
        showToast({
          id: 'ar-cap',
          title: t().toastArCapTitle,
          message: t().toastArCapMsg,
          kind: 'warn',
          duration: 4500
        });
        return false;
      }
      return true;
    }

    function pushShapeWithCap(newObj) {
      if (!newObj) return;
      clearRedoStack();
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
          try { mediaStream.getTracks().forEach(tr => tr.stop()); } catch (e) {}
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
          title: t().toastCaptureCancelTitle,
          message: t().toastCaptureCancelMsg,
          kind: 'warn',
          duration: 4000
        });
      }
    }

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

    $('vsArWinBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      startArWindowCapture();
    });

    const arFileInput = $('vsArFileInput');
    $('vsArImgBtn').addEventListener('click', (e) => {
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

    const arTextInput = $('vsArTextInput');
    $('vsArTextAddBtn').addEventListener('click', (e) => {
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

    const EDGE_MARGIN = 0.10;
    const HAND_LOSS_GRACE_MS = 220;
    let lastDomHandSeenMs = 0;
    let lastAuxFistSeenMs = 0;

    function projectCoord(normVal, maxDim) {
      const scaled = (normVal - EDGE_MARGIN) / (1 - EDGE_MARGIN * 2);
      return Math.max(0, Math.min(maxDim, scaled * maxDim));
    }

    window.addEventListener('message', (e) => {
      if (!e.data || !sandboxFrame || e.source !== sandboxFrame.contentWindow || e.origin !== SANDBOX_ORIGIN) return;
      const type = e.data.type;

      if (type === 'VS_TIMER_READY') {
        bgTimerReady = Boolean(e.data.ready);
        return;
      }
      if (type === 'VS_TICK') {
        bgTimerReady = true;
        if (document.hidden && state.cameraActive && state.extEnabled) {
          renderStep(performance.now(), true);
        }
        return;
      }
      if (type === 'VS_SANDBOX_READY') {
        clearMediaPipeTimeout();
        if (e.data.timerReady !== undefined) {
          bgTimerReady = Boolean(e.data.timerReady);
        }
        setAiStatus('ready');
        sandboxBusy = false;
        if (document.hidden && state.cameraActive && state.extEnabled && bgTimerReady) {
          bgTimerWorker.postMessage('start');
        }
        return;
      }
      if (type === 'VS_SANDBOX_ERROR') {
        clearMediaPipeTimeout();
        const errMsg = e.data.message || t().toastMpErrTitle;
        setAiStatus('error', errMsg);
        sandboxBusy = false;
        showToast({
          id: 'mp-error',
          title: t().toastMpErrTitle,
          message: `${errMsg} ${t().toastMpErrSuffix}`,
          kind: 'error',
          duration: 10000,
          actionLabel: t().retryBtn,
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

        if (!state.leftHanded) {
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
        } else {
          if (rawHands.length === 1) {
            const h0 = rawHands[0];
            if (!h0.isAnatomicalLeft && h0.isFist && h0.wristScreenX > w * 0.55) {
              h0.role = 'L';
            } else {
              h0.role = 'R';
            }
          } else if (rawHands.length >= 2) {
            if (rawHands[0].wristScreenX <= rawHands[1].wristScreenX) {
              rawHands[0].role = 'R';
              rawHands[1].role = 'L';
            } else {
              rawHands[0].role = 'L';
              rawHands[1].role = 'R';
            }
          }
        }
      }

      const detected = [];
      let sawDominantHand = false;

      rawHands.forEach((item) => {
        const lm = item.lm;
        const role = item.role;
        if (role === 'R') sawDominantHand = true;

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

      const nowMs = performance.now();
      if (sawDominantHand) {
        lastDomHandSeenMs = nowMs;
      } else if (nowMs - lastDomHandSeenMs > HAND_LOSS_GRACE_MS) {
        prevHandsPinching.R = false;
        smoothIndexCoords.R = { x: 0, y: 0 };
        smoothPinchCoords.R = { x: 0, y: 0 };
      }

      detected.sort((a, b) => (a.id === 'R' ? -1 : 1));
      if (detected.length === 0 && nowMs - lastDomHandSeenMs > HAND_LOSS_GRACE_MS) {
        prevHandsPinching = { R: false, L: false };
      }

      const auxHandObj = detected.find(hd => hd.id === 'L');
      const domHandObj = detected.find(hd => hd.id === 'R');
      updatePinchMeter(domHandObj);

      // Si on dessine déjà au poing, un faux pincement près du bord ne doit pas couper l'embrayage
      const domPinchBlocksClutch = Boolean(!prevWriteActive && domHandObj && domHandObj.isPinching);
      const rawFistNow = Boolean(auxHandObj && auxHandObj.isFist && !domPinchBlocksClutch);
      if (rawFistNow) {
        lastAuxFistSeenMs = nowMs;
      }
      const clutchNow = rawFistNow || (state.leftHandClutch && !domPinchBlocksClutch && (nowMs - lastAuxFistSeenMs <= HAND_LOSS_GRACE_MS));

      if (state.leftHandClutch !== clutchNow) {
        state.leftHandClutch = clutchNow;
        updateClutchBadge();
      }

      handsData = detected;
      processHandInteractions(w, h);
    });

    function findShapeAt(x, y) {
      if (state.hideAll) return null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (isArObject(s) || s.isLaser) continue;
        if ((s.type === 'ink' || s.type === 'freehand') && s.points) {
          const hitPt = s.points.some(pt => Math.hypot(x - (s.x + pt.dx * s.size), y - (s.y + pt.dy * s.size)) < 26);
          if (hitPt) return s;
        } else if (Math.hypot(x - s.x, y - s.y) <= Math.max(42, s.size * 0.6)) {
          return s;
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
            const [removed] = shapes.splice(i, 1);
            redoStack.push(removed);
            return;
          }
        } else if (Math.hypot(x - s.x, y - s.y) <= Math.max(34, s.size * 0.55)) {
          const [removed] = shapes.splice(i, 1);
          redoStack.push(removed);
          return;
        }
      }
    }

    const TRASH_MARGIN = 46;
    function isInTrashEdge(x, y, w, h) {
      return (x < TRASH_MARGIN || x > w - TRASH_MARGIN || y > h - TRASH_MARGIN);
    }

    function getAirMenuRects(w) {
      const itemW = 76, itemH = 32, gap = 6;
      const totalW = AIR_MENU_ITEMS.length * itemW + (AIR_MENU_ITEMS.length - 1) * gap;
      const startX = (w - totalW) / 2;
      return AIR_MENU_ITEMS.map((item, idx) => ({
        ...item, x: startX + idx * (itemW + gap), y: 14, w: itemW, h: itemH
      }));
    }

    function checkAirMenuHit(px, py, w) {
      if (!state.showAirMenu) return null;
      for (const r of getAirMenuRects(w)) {
        if (px >= r.x - 5 && px <= r.x + r.w + 5 && py >= r.y - 5 && py <= r.y + r.h + 10) return r;
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
          const maxAllowed = isArObject(s) ? 920 : 600;
          const minAllowed = isArObject(s) ? 140 : 24;
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
        if (prevWriteActive && writeActive && (now - lastDomHandSeenMs <= HAND_LOSS_GRACE_MS)) {
          return;
        }
        finishActiveInteractions(w, h);
        prevWriteActive = false;
        return;
      }

      // 2. GESTE DESSIN : EMBRAYAGE ACTIF (ESPACE OU POING) + INDEX DOMINANT
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

      // 3. GESTE 1 MAIN : PINCEMENT MAIN DOMINANTE -> DÉPLACER OBJET / TRAIT PAINT / FERMER AR
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
        if (isInTrashEdge(grabbedShape.x, grabbedShape.y, w, h)) {
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
        const maxS = isArObject(hit) ? 920 : 600;
        hit.size = Math.min(maxS, Math.max(24, hit.size * factor));
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

      const isSelected = (s === grabbedShape || s === twoHandStretch.shape);

      targetCtx.save();
      targetCtx.globalAlpha = alpha;
      targetCtx.translate(drawX, s.y);
      targetCtx.rotate(s.rotation);
      targetCtx.strokeStyle = s.isLaser ? '#ff2a85' : (isSelected && !cleanForMeet ? '#39ff14' : s.color);
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
      else if (s.type === 'diamond') {
        targetCtx.moveTo(0, -half);
        targetCtx.lineTo(half * 0.8, 0);
        targetCtx.lineTo(0, half);
        targetCtx.lineTo(-half * 0.8, 0);
        targetCtx.closePath();
      } else if (s.type === 'arrow') {
        const head = Math.max(14, half * 0.45);
        targetCtx.moveTo(-half, 0);
        targetCtx.lineTo(half, 0);
        targetCtx.moveTo(half - head, -head * 0.65);
        targetCtx.lineTo(half, 0);
        targetCtx.lineTo(half - head, head * 0.65);
      } else if (s.type === 'star') {
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

      if (s.filled && s.type !== 'line' && s.type !== 'arrow' && s.type !== 'ink') targetCtx.fill();
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

    function drawTrashEdgeOverlay(targetCtx, w, h) {
      if (!grabbedShape) return;
      const nearEdge = isInTrashEdge(grabbedShape.x, grabbedShape.y, w, h);
      targetCtx.save();
      targetCtx.fillStyle = nearEdge ? 'rgba(255, 51, 75, 0.28)' : 'rgba(255, 51, 75, 0.1)';
      targetCtx.fillRect(0, 0, TRASH_MARGIN, h);
      targetCtx.fillRect(w - TRASH_MARGIN, 0, TRASH_MARGIN, h);
      targetCtx.fillRect(TRASH_MARGIN, h - TRASH_MARGIN, w - TRASH_MARGIN * 2, TRASH_MARGIN);

      targetCtx.strokeStyle = nearEdge ? '#ff334b' : 'rgba(255, 51, 75, 0.5)';
      targetCtx.lineWidth = nearEdge ? 3 : 1.5;
      targetCtx.strokeRect(2, 2, w - 4, h - 4);

      if (nearEdge) {
        targetCtx.fillStyle = 'rgba(255, 51, 75, 0.92)';
        targetCtx.fillRect(w / 2 - 190, h - 38, 380, 26);
        targetCtx.fillStyle = '#ffffff';
        targetCtx.font = 'bold 11px monospace';
        targetCtx.textAlign = 'center';
        targetCtx.fillText(t().trashWarn, w / 2, h - 21);
        targetCtx.textAlign = 'left';
      }
      targetCtx.restore();
    }

    function drawHUDElements(targetCtx, w, h, forStream = false) {
      if (!forStream) {
        drawTrashEdgeOverlay(targetCtx, w, h);
      }

      const mapHudX = (x) => (forStream && state.mirror ? (w - x) : x);
      const rightHand = handsData.find(hd => hd.id === 'R');
      const cx = rightHand ? (rightHand.isPinching ? rightHand.pinchX : rightHand.smoothIndexX) : -999;
      const cy = rightHand ? (rightHand.isPinching ? rightHand.pinchY : rightHand.smoothIndexY) : -999;

      if (state.showAirMenu) {
        const rects = getAirMenuRects(w);
        rects.forEach(r => {
          const hovered = (cx >= r.x - 5 && cx <= r.x + r.w + 5 && cy >= r.y - 5 && cy <= r.y + r.h + 10);
          const rx = forStream && state.mirror ? (w - r.x - r.w) : r.x;
          targetCtx.fillStyle = hovered ? hexToRgba(state.color, 0.35) : 'rgba(10, 12, 18, 0.82)';
          targetCtx.strokeStyle = hovered ? state.color : 'rgba(255, 255, 255, 0.32)';
          targetCtx.lineWidth = hovered ? 2 : 1;
          targetCtx.fillRect(rx, r.y, r.w, r.h);
          targetCtx.strokeRect(rx, r.y, r.w, r.h);
          targetCtx.fillStyle = '#fff';
          targetCtx.font = 'bold 9px monospace';
          targetCtx.textAlign = 'center';
          targetCtx.fillText(`+ ${r.label}`, rx + r.w / 2, r.y + 20);
          targetCtx.textAlign = 'left';
        });
      }

      const clutchOn = isClutchEngaged();
      handsData.forEach(hd => {
        if (hd.id === 'L') {
          const on = hd.isFist || hd.isPinching;
          targetCtx.beginPath();
          targetCtx.arc(mapHudX(hd.landmarks[9].x), hd.landmarks[9].y, 14, 0, Math.PI * 2);
          targetCtx.strokeStyle = on ? '#39ff14' : '#ffffff';
          targetCtx.lineWidth = 2;
          targetCtx.stroke();
          return;
        }
        if (hd.id === 'R') {
          const usePinchPos = hd.isPinching && !clutchOn;
          const rawPx = usePinchPos ? hd.pinchX : hd.smoothIndexX;
          const py = usePinchPos ? hd.pinchY : hd.smoothIndexY;
          const px = mapHudX(rawPx);
          const col = state.eraser ? '#ff334b' : (state.laserMode ? '#ff2a85' : (usePinchPos ? '#39ff14' : state.color));
          targetCtx.beginPath();
          targetCtx.arc(px, py, (clutchOn || hd.isPinching) ? 7 : 9, 0, Math.PI * 2);
          if (clutchOn || hd.isPinching) {
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
        sandboxFrame.contentWindow.postMessage({ type: 'VS_PROCESS_FRAME', bitmap }, SANDBOX_ORIGIN, [bitmap]);
      } catch (e) {
        sandboxBusy = false;
      }
    }

    let streamCanvasNode = null;
    let streamCanvasCtx = null;
    function streamCanvasEl() {
      if (!streamCanvasNode || !streamCanvasNode.isConnected) {
        streamCanvasNode = document.getElementById('vs-meet-stream-canvas');
        streamCanvasCtx = streamCanvasNode ? streamCanvasNode.getContext('2d') : null;
      }
      return streamCanvasNode;
    }

    let lastStreamRenderMs = 0;
    let lastLocalRenderMs = 0;

    function renderStep(nowMs = performance.now(), fromBackgroundWorker = false) {
      if (!state.cameraActive && !panelOpen) return;

      const minStepMs = state.ecoMode ? 48 : 32.5;
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

      // 1. RENDU LOCAL (#vsMainCanvas)
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

        if (!state.hideAll) {
          shapes.forEach(s => {
            if (isArObject(s)) drawShape(ctx, s, false, nowMs, false, w);
          });
          renderNonArShapesWithCache(ctx, false, nowMs, false, w, h);
          drawActiveStroke(ctx, w, false);
        }

        drawHUDElements(ctx, w, h, false);

        if (!panelOpen && state.cameraActive && state.extEnabled) {
          miniPreviewCtx.drawImage(mainCanvas, 0, 0, 224, 126);
        }
      }

      // 2. RENDU DU FLUX SORTANT MEET (#vs-meet-stream-canvas)
      const meetStreamCanvas = streamCanvasEl();
      if (meetStreamCanvas && streamCanvasCtx && state.cameraActive && state.extEnabled && (nowMs - lastStreamRenderMs >= minStepMs)) {
        lastStreamRenderMs = nowMs;
        const mCtx = streamCanvasCtx;
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

        if (!state.hideAll) {
          const cleanForMeet = !state.showHudOnMeet;
          shapes.forEach(s => {
            if (isArObject(s)) drawShape(mCtx, s, cleanForMeet, nowMs, true, mw);
          });
          renderNonArShapesWithCache(mCtx, cleanForMeet, nowMs, true, mw, mh);
          drawActiveStroke(mCtx, mw, true);
        }

        if (state.showHudOnMeet) {
          drawHUDElements(mCtx, mw, mh, true);
        }
      }
    }

    function animate(nowMs) {
      requestAnimationFrame(animate);
      if (!document.hidden) {
        renderStep(nowMs, false);
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        releaseSpace();
        if (state.cameraActive && state.extEnabled) {
          if (bgTimerReady) {
            bgTimerWorker.postMessage('start');
            showToast({
              id: 'bg-tab-warn',
              title: t().toastBgTabTitle,
              message: t().toastBgTabActiveMsg,
              kind: 'warn',
              duration: 5000
            });
          } else {
            showToast({
              id: 'bg-tab-warn',
              title: t().toastBgTabTitle,
              message: t().toastBgTabWarnMsg,
              kind: 'warn',
              duration: 6000
            });
          }
        }
      } else {
        bgTimerWorker.postMessage('stop');
      }
    });

    // ==========================================================================
    // 8. CAMÉRA (N1, N2, N3, N5), RACCOURCIS CLAVIER, TUTORIEL & ÉVÉNEMENTS
    // ==========================================================================
    const cameraSelect = $('vsCameraSelect');

    async function updateCameraList() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput' && d.deviceId !== 'vision-studio-virtual-cam');
        cameraSelect.innerHTML = '';
        videoDevices.forEach((dev, i) => {
          const opt = document.createElement('option');
          opt.value = dev.deviceId;
          opt.textContent = dev.label || `${t().camLabelPrefix} ${i + 1}`;
          if (dev.deviceId === state.selectedDeviceId) opt.selected = true;
          cameraSelect.appendChild(opt);
        });
      } catch (e) {}
    }

    function onCameraEnded() {
      state.cameraActive = false;
      state.spacePressed = false;
      state.leftHandClutch = false;
      bgTimerWorker.postMessage('stop');
      syncSpaceGuard();
      document.documentElement.dataset.vsCamRunning = 'false';
      bubble.classList.remove('cam-on');
      const camBtn = $('vsCamBtn');
      if (camBtn) {
        camBtn.classList.remove('active');
        setBtn(camBtn, 'video', t().startCam);
      }
      positionMiniPreview();
      updateClutchBadge();
    }

    function stopCamera() {
      if (sourceVideo.srcObject) {
        try {
          sourceVideo.srcObject.getTracks().forEach(tr => tr.stop());
        } catch (e) {}
        sourceVideo.srcObject = null;
      }
      onCameraEnded();
    }

    let startingCameraPromise = null;

    async function startCamera(deviceId = '') {
      if (!state.extEnabled) return;
      if (startingCameraPromise) {
        await startingCameraPromise;
      }

      startingCameraPromise = (async () => {
        try {
          if (sourceVideo.srcObject) {
            sourceVideo.srcObject.getTracks().forEach(tr => tr.stop());
          }
          const targetId = (deviceId && deviceId !== 'vision-studio-virtual-cam') ? deviceId : '';
          let stream = null;

          // N2 : Repli automatique si la caméra mémorisée est introuvable (OverconstrainedError / NotFoundError)
          if (targetId) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: targetId }, width: { ideal: 960 }, height: { ideal: 540 } }
              });
            } catch (err) {
              if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
                state.selectedDeviceId = '';
                scheduleSaveSettings();
                showToast({
                  id: 'cam-fallback',
                  title: t().toastCamFallbackTitle,
                  message: t().toastCamFallbackMsg,
                  kind: 'warn',
                  duration: 5000
                });
                stream = await navigator.mediaDevices.getUserMedia({
                  video: { width: { ideal: 960 }, height: { ideal: 540 } }
                });
              } else {
                throw err;
              }
            }
          } else {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 960 }, height: { ideal: 540 } }
            });
          }

          sourceVideo.srcObject = stream;
          await sourceVideo.play();
          state.cameraActive = true;
          if (document.hidden && bgTimerReady) {
            bgTimerWorker.postMessage('start');
          }
          syncSpaceGuard();
          document.documentElement.dataset.vsCamRunning = 'true';
          bubble.classList.add('cam-on');

          const track = stream.getVideoTracks()[0];
          if (track) {
            track.addEventListener('ended', onCameraEnded, { once: true });
            const settings = track.getSettings ? track.getSettings() : {};
            if (settings.deviceId && settings.deviceId !== 'vision-studio-virtual-cam') {
              state.selectedDeviceId = settings.deviceId;
              scheduleSaveSettings();
            } else if (targetId) {
              state.selectedDeviceId = targetId;
              scheduleSaveSettings();
            }
          }
          await updateCameraList();
          const camBtn = $('vsCamBtn');
          if (camBtn) {
            camBtn.classList.add('active');
            setBtn(camBtn, 'video', t().camOn);
            camBtn.blur();
          }
          positionMiniPreview();
        } catch (err) {
          onCameraEnded();
          const isPermDenied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
          const msg = isPermDenied
            ? t().toastCamPermMsg
            : `${t().toastCamErrPrefix} (${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : 'unavailable'}).`;
          showToast({
            id: 'cam-error',
            title: isPermDenied ? t().toastCamPermTitle : t().toastCamErrTitle,
            message: msg,
            kind: 'error',
            duration: 10000,
            actionLabel: t().retryBtn,
            onAction: () => startCamera(state.selectedDeviceId)
          });
        } finally {
          startingCameraPromise = null;
        }
      })();

      return startingCameraPromise;
    }

    function updateExtActiveUI() {
      const extBtn = $('vsExtActiveBtn');
      if (!extBtn) return;
      extBtn.classList.toggle('active', state.extEnabled);
      setBtn(extBtn, 'power', state.extEnabled ? t().extOn : t().extOff);
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
        const isStopBtn = options.reason === 'stopCam';
        showToast({
          id: 'ext-state',
          title: isStopBtn ? t().toastStopCamTitle : t().toastExtOffTitle,
          message: t().toastExtOffMsg,
          kind: 'warn',
          duration: 5500
        });
      } else {
        startCamera(state.selectedDeviceId);
        showToast({
          id: 'ext-state',
          title: t().toastExtOnTitle,
          message: t().toastExtOnMsg,
          kind: 'info',
          duration: 5000
        });
      }
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.extEnabled !== undefined) {
          setExtensionEnabled(changes.extEnabled.newValue !== false, { fromExternal: true });
        }
        if (changes.lang !== undefined) {
          const nextLang = changes.lang.newValue === 'en' ? 'en' : 'fr';
          if (state.lang !== nextLang) {
            state.lang = nextLang;
            applyLanguageUI();
          }
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

    // Gestion des raccourcis clavier configurables
    let listeningShortcutKey = null;

    guard.onShortcut = (e) => {
      if (listeningShortcutKey) {
        swallow(e);
        state.shortcuts[listeningShortcutKey] = e.code;
        listeningShortcutKey = null;
        root.querySelectorAll('.vs-sc-key').forEach(b => b.classList.remove('listening'));
        renderShortcutsButtons();
        scheduleSaveSettings();
        return;
      }
      if (!panelOpen || !state.extEnabled) return;
      const code = e.code;
      if (code === state.shortcuts.drawMode) { swallow(e); setDrawMode(!state.drawMode); }
      else if (code === state.shortcuts.laser) { swallow(e); toggleLaserMode(); }
      else if (code === state.shortcuts.eraser) {
        swallow(e);
        state.eraser = !state.eraser;
        if (state.eraser && state.laserMode) toggleLaserMode();
        $('vsEraserBtn').classList.toggle('active', state.eraser);
      }
      else if (code === state.shortcuts.hideAll) { swallow(e); toggleHideAll(); }
      else if (code === state.shortcuts.undo) { swallow(e); performUndo(); }
      else if (code === state.shortcuts.redo) { swallow(e); performRedo(); }
    };

    root.querySelectorAll('.vs-sc-key').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        root.querySelectorAll('.vs-sc-key').forEach(b => b.classList.remove('listening'));
        listeningShortcutKey = btn.dataset.sc;
        btn.classList.add('listening');
        btn.textContent = '...';
      });
    });

    $('vsShortcutsBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      tutorialModal.classList.remove('open');
      shortcutsModal.classList.toggle('open');
    });

    $('vsShortcutsCloseBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      listeningShortcutKey = null;
      root.querySelectorAll('.vs-sc-key').forEach(b => b.classList.remove('listening'));
      renderShortcutsButtons();
      shortcutsModal.classList.remove('open');
    });

    $('vsTutorialBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      shortcutsModal.classList.remove('open');
      tutorialModal.classList.toggle('open');
    });

    $('vsTutorialCloseBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      tutorialModal.classList.remove('open');
      if (!state.tutorialSeen) {
        state.tutorialSeen = true;
        scheduleSaveSettings();
      }
    });

    $('vsLangBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      state.lang = state.lang === 'fr' ? 'en' : 'fr';
      applyLanguageUI();
      scheduleSaveSettings();
    });

    updateExtActiveUI();
    syncSpaceGuard();
    updateClutchBadge();

    $('vsExtActiveBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      setExtensionEnabled(!state.extEnabled);
    });

    $('vsCamBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (!state.extEnabled) {
        setExtensionEnabled(true);
      } else {
        startCamera(cameraSelect.value || state.selectedDeviceId);
      }
    });

    // N5 : STOP CAM repasse proprement les participants sur la vraie caméra (comme Extension OFF)
    $('vsStopCamBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (state.extEnabled) {
        setExtensionEnabled(false, { reason: 'stopCam' });
      } else {
        stopCamera();
      }
    });

    $('vsDrawModeBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      setDrawMode(!state.drawMode);
    });

    window.addEventListener('vs-audio-error', () => {
      showToast({
        id: 'audio-error',
        title: t().toastAudioErrTitle,
        message: t().toastAudioErrMsg,
        kind: 'warn',
        duration: 7000
      });
    });

    // N1 : Si Meet impose un autre identifiant de caméra, redémarre immédiatement startCamera(reqId)
    window.addEventListener('vs-meet-request-cam', (e) => {
      const reqId = (e.detail && e.detail.deviceId) || '';
      if (!state.extEnabled) return;
      if (reqId && reqId !== state.selectedDeviceId) {
        state.selectedDeviceId = reqId;
        scheduleSaveSettings();
        startCamera(reqId);
      } else if (!state.cameraActive) {
        startCamera(state.selectedDeviceId);
      }
    });

    cameraSelect.addEventListener('change', (e) => {
      e.currentTarget.blur();
      state.selectedDeviceId = e.target.value;
      scheduleSaveSettings();
      if (state.cameraActive) startCamera(e.target.value);
    });

    $('vsLaserQuickBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleLaserMode();
    });

    $('vsLaserStyleBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleLaserMode();
    });

    $('vsAirMenuToggleBtn').addEventListener('click', (e) => {
      state.showAirMenu = !state.showAirMenu;
      e.currentTarget.classList.toggle('active', state.showAirMenu);
      setBtn(e.currentTarget, 'shapes', state.showAirMenu ? t().shapesOn : t().shapesOff);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsArOpacitySlider').addEventListener('input', (e) => {
      state.arOpacity = parseFloat(e.target.value);
      scheduleSaveSettings();
    });

    $('vsHudMeetBtn').addEventListener('click', (e) => {
      state.showHudOnMeet = !state.showHudOnMeet;
      e.currentTarget.classList.toggle('active', state.showHudOnMeet);
      setBtn(e.currentTarget, state.showHudOnMeet ? 'eye' : 'eyeOff', state.showHudOnMeet ? t().hudMeetOn : t().hudMeetOff);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsSmartBtn').addEventListener('click', (e) => {
      state.smartShape = !state.smartShape;
      e.currentTarget.classList.toggle('active', state.smartShape);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsFillBtn').addEventListener('click', (e) => {
      state.filled = !state.filled;
      e.currentTarget.classList.toggle('active', state.filled);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsMirrorBtn').addEventListener('click', (e) => {
      state.mirror = !state.mirror;
      e.currentTarget.classList.toggle('active', state.mirror);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsLeftHandedBtn').addEventListener('click', (e) => {
      state.leftHanded = !state.leftHanded;
      e.currentTarget.classList.toggle('active', state.leftHanded);
      setBtn(e.currentTarget, 'hand', state.leftHanded ? t().leftHandedOn : t().leftHandedOff);
      updateClutchBadge();
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsBwBtn').addEventListener('click', (e) => {
      state.bwFilter = !state.bwFilter;
      e.currentTarget.classList.toggle('active', state.bwFilter);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsEcoBtn').addEventListener('click', (e) => {
      state.ecoMode = !state.ecoMode;
      e.currentTarget.classList.toggle('active', state.ecoMode);
      setBtn(e.currentTarget, 'leaf', state.ecoMode ? t().ecoOn : t().ecoOff);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsArFlipBtn').addEventListener('click', (e) => {
      state.arFlip = !state.arFlip;
      e.currentTarget.classList.toggle('active', state.arFlip);
      scheduleSaveSettings();
      e.currentTarget.blur();
    });

    $('vsEraserBtn').addEventListener('click', (e) => {
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

    $('vsColorPicker').addEventListener('input', (e) => setThemeColor(e.target.value));
    $('vsPinchSlider').addEventListener('input', (e) => {
      state.pinchThreshold = parseFloat(e.target.value);
      updatePinchThreshMarker();
      scheduleSaveSettings();
    });
    $('vsStrokeSlider').addEventListener('input', (e) => {
      state.strokeWidth = parseFloat(e.target.value);
      scheduleSaveSettings();
    });

    $('vsHideAllBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleHideAll();
    });

    $('vsUndoBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      performUndo();
    });

    $('vsRedoBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      performRedo();
    });

    let lastClearedSnapshot = null;
    let lastClearedTimer = null;

    function disposeClearedSnapshot() {
      if (lastClearedTimer) {
        clearTimeout(lastClearedTimer);
        lastClearedTimer = null;
      }
      if (lastClearedSnapshot) {
        lastClearedSnapshot.forEach((item) => {
          if (!shapes.includes(item)) cleanupShapeResources(item);
        });
        lastClearedSnapshot = null;
      }
    }

    $('vsClearBtn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (shapes.length === 0) return;
      disposeClearedSnapshot();
      lastClearedSnapshot = shapes.slice();
      shapes = [];
      clearRedoStack();
      localStaticSignature = '';
      streamStaticSignature = '';

      lastClearedTimer = setTimeout(disposeClearedSnapshot, 6500);
      showToast({
        id: 'clear-undo',
        title: t().toastClearTitle,
        message: t().toastClearMsg,
        kind: 'info',
        duration: 6000,
        actionLabel: t().undoAction,
        onAction: () => {
          if (!lastClearedSnapshot) return;
          shapes = lastClearedSnapshot.concat(shapes);
          lastClearedSnapshot = null;
          if (lastClearedTimer) {
            clearTimeout(lastClearedTimer);
            lastClearedTimer = null;
          }
          localStaticSignature = '';
          streamStaticSignature = '';
        }
      });
    });

    updateCameraList();
    setAiStatus('loading');
    startMediaPipeTimeout();
    requestAnimationFrame(animate);

    const meetAsked = pendingMeetCamRequest || (document.documentElement && document.documentElement.dataset.vsMeetRequestedVideo === 'true');
    const initDevId = pendingRequestedDeviceId || (document.documentElement && document.documentElement.dataset.vsRequestedDeviceId) || '';
    if (meetAsked && state.extEnabled) {
      if (initDevId) state.selectedDeviceId = initDevId;
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