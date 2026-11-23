(function () {
  const toggleEl = document.getElementById('vsPopupToggle');
  const toggleLabel = document.getElementById('vsPopupToggleLabel');
  const statusDot = document.getElementById('vsPopupStatusDot');
  const statusText = document.getElementById('vsPopupStatusText');
  const versionEl = document.getElementById('vsPopupVersion');
  const langBtn = document.getElementById('vsPopupLangBtn');
  const helpBtn = document.getElementById('vsPopupHelpBtn');
  const helpBox = document.getElementById('vsPopupHelpBox');
  const helpTitle = document.getElementById('vsPopupHelpTitle');
  const helpItems = [
    document.getElementById('vsPopupHelp1'),
    document.getElementById('vsPopupHelp2'),
    document.getElementById('vsPopupHelp3'),
    document.getElementById('vsPopupHelp4')
  ];

  const POPUP_I18N = {
    fr: {
      toggleLabel: 'Extension active',
      statusOn: 'Active — Caméra virtuelle prête sur Meet',
      statusOff: 'Désactivée — Vraie caméra directe (Passthrough)',
      helpBtn: 'Aide & Gestes rapides',
      helpTitle: 'Guide rapide sur Google Meet :',
      help: [
        'Dessiner : Fermez le poing gauche (ou Mode dessin + Espace) et pointez l’index droit.',
        'Déplacer (1 main) : Pincez pouce + index sur une forme ou fenêtre AR.',
        'Zoomer (2 mains) : Pincez avec les 2 mains simultanément et écartez-les.',
        'Vraie caméra : Basculez l’interrupteur ci-dessus sur OFF pour désactiver Vision Studio.'
      ]
    },
    en: {
      toggleLabel: 'Extension active',
      statusOn: 'Active — Virtual camera ready on Meet',
      statusOff: 'Disabled — Direct hardware webcam (Passthrough)',
      helpBtn: 'Help & Quick Gestures',
      helpTitle: 'Quick Guide for Google Meet:',
      help: [
        'Draw: Close your left fist (or Draw Mode + Spacebar) and move your right index finger.',
        'Move (1 hand): Pinch thumb + index on any shape or AR window.',
        'Zoom (2 hands): Pinch with both hands simultaneously and spread them.',
        'Hardware camera: Flip the switch above OFF to disable Vision Studio.'
      ]
    }
  };

  let currentLang = 'fr';
  let currentEnabled = true;

  // 1. Afficher la version du manifest
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      versionEl.textContent = `v${manifest.version}`;
    }
  } catch (e) {}

  function applyPopupLang() {
    const tr = POPUP_I18N[currentLang] || POPUP_I18N.fr;
    document.documentElement.lang = currentLang;
    langBtn.textContent = currentLang.toUpperCase();
    toggleLabel.textContent = tr.toggleLabel;
    helpBtn.textContent = tr.helpBtn;
    helpTitle.textContent = tr.helpTitle;
    helpItems.forEach((el, i) => {
      if (el && tr.help[i]) el.textContent = tr.help[i];
    });
    renderStatus(currentEnabled);
  }

  // 2. Mettre à jour l'affichage de l'état
  function renderStatus(enabled) {
    currentEnabled = enabled !== false;
    const tr = POPUP_I18N[currentLang] || POPUP_I18N.fr;
    toggleEl.checked = currentEnabled;
    statusDot.classList.toggle('on', currentEnabled);
    statusText.textContent = currentEnabled ? tr.statusOn : tr.statusOff;
  }

  // 3. Lire l'état initial depuis chrome.storage.local
  chrome.storage.local.get({ extEnabled: true, lang: 'fr' }, (res) => {
    currentLang = res.lang === 'en' ? 'en' : 'fr';
    currentEnabled = res.extEnabled !== false;
    applyPopupLang();
  });

  // 4. Sauvegarder dans chrome.storage.local (synchronisé en direct via storage.onChanged dans content.js)
  toggleEl.addEventListener('change', () => {
    const enabled = toggleEl.checked;
    renderStatus(enabled);
    chrome.storage.local.set({ extEnabled: enabled });
  });

  langBtn.addEventListener('click', () => {
    currentLang = currentLang === 'fr' ? 'en' : 'fr';
    applyPopupLang();
    chrome.storage.local.set({ lang: currentLang });
  });

  // 5. Écouter les changements venant de l'onglet Google Meet
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.extEnabled !== undefined) {
      renderStatus(changes.extEnabled.newValue);
    }
    if (changes.lang !== undefined) {
      currentLang = changes.lang.newValue === 'en' ? 'en' : 'fr';
      applyPopupLang();
    }
  });

  // 6. Ouvrir / Fermer l'aide rapide
  helpBtn.addEventListener('click', () => {
    helpBox.classList.toggle('open');
  });
})();