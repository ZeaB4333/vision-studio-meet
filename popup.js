(function () {
  const toggleEl = document.getElementById('vsPopupToggle');
  const statusDot = document.getElementById('vsPopupStatusDot');
  const statusText = document.getElementById('vsPopupStatusText');
  const versionEl = document.getElementById('vsPopupVersion');
  const helpBtn = document.getElementById('vsPopupHelpBtn');
  const helpBox = document.getElementById('vsPopupHelpBox');

  // 1. Afficher la version du manifest
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      versionEl.textContent = `v${manifest.version}`;
    }
  } catch (e) {}

  // 2. Mettre à jour l'affichage de l'état
  function renderStatus(enabled, customNote = '') {
    const isOn = enabled !== false;
    toggleEl.checked = isOn;
    statusDot.classList.toggle('on', isOn);
    if (customNote) {
      statusText.textContent = customNote;
      return;
    }
    statusText.textContent = isOn
      ? 'Active — Caméra virtuelle prête sur Meet'
      : 'Désactivée — Vraie caméra directe (Passthrough)';
  }

  // 3. Lire l'état initial depuis chrome.storage.local
  chrome.storage.local.get({ extEnabled: true }, (res) => {
    renderStatus(res.extEnabled);
  });

  // 4. Sauvegarder ET envoyer l'ordre en direct aux onglets Google Meet ouverts
  toggleEl.addEventListener('change', () => {
    const enabled = toggleEl.checked;
    renderStatus(enabled);

    chrome.storage.local.set({ extEnabled: enabled });

    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { type: 'VS_POPUP_TOGGLE_EXT', enabled }, () => {
            if (chrome.runtime.lastError) {
              // L'onglet Meet était ouvert avant le rechargement de l'extension
              renderStatus(enabled, '⚠️ Faites F5 sur l’onglet Meet pour appliquer');
            }
          });
        });
      });
    }
  });

  // 5. Écouter les changements venant de l'onglet Google Meet
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.extEnabled !== undefined) {
      renderStatus(changes.extEnabled.newValue);
    }
  });

  // 6. Ouvrir / Fermer l'aide rapide
  helpBtn.addEventListener('click', () => {
    helpBox.classList.toggle('open');
  });
})();