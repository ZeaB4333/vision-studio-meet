# Vision Studio for Google Meet™

**Vision Studio for Google Meet™** est une extension Chrome (Manifest V3) de réalité augmentée (AR) et d'annotation gestuelle propulsée 100 % localement par MediaPipe Tasks Vision (`HandLandmarker`). Elle enrichit votre webcam dans Google Meet™ grâce à une caméra virtuelle HTML5 Canvas (`captureStream`), vous permettant d'écrire dans les airs, d'utiliser un pointeur laser éphémère et de projeter des fenêtres ou notes interactives pilotées avec vos doigts.

---

## Fonctionnalités principales

### 1. Gestes unifiés automatiques (Dessin, Manipulation 1 main & Zoom 2 mains)
* **Écriture aérienne fluide** : le curseur suit la pointe de l'index dominant avec lissage par courbes de Bézier (`quadraticCurveTo`), simplification Ramer-Douglas-Peucker et reconnaissance de formes optionnelle (**Smart Shape**).
* **Double embrayage d'écriture (Dual-Clutch)** :
  * **Geste poing auxiliaire** : fermez le poing gauche (ou droit en mode Gaucher) pour poser le stylo dans les airs, ouvrez la main pour lever le stylo.
  * **Clavier (en option)** : activez `Mode dessin: ON` et maintenez `Espace` pour dessiner. Lorsque `Mode dessin` est sur `OFF` (par défaut), la barre `Espace` est laissée à Google Meet™ (Push-to-Talk fonctionnel).
* **Suivi renforcé près des bords** : marge de projection (`10 %`), délai de grâce de `220 ms` sur micro-pertes de détection et protection anti-faux pincement pour dessiner jusqu'aux bords de l'écran.
* **Manipulation au pincement** :
  * **Pincer à 1 main** : saisir et déplacer une forme ou une fenêtre AR, ou pincer son bouton `✕` pour la fermer (ou la glisser vers le bord rouge).
  * **Pincer à 2 mains** : écarter ou rapprocher les deux mains pour agrandir, rétrécir ou pivoter un objet.
* **Pointeur Laser (2 s) & Gomme** : annotations lumineuses éphémères ou gommage au doigt sans affecter vos fenêtres AR.
* **Mode Gaucher & Jauge Pinch** : inversez main dominante / main auxiliaire en un clic, et calibrez la sensibilité du pincement grâce à la jauge temps réel dans l'onglet *Caméra & IA*.

### 2. Réalité augmentée interactive (Fenêtres Live, Images & Notes texte)
* **Capture de fenêtres en direct (`Fenêtre AR`)** : projetez jusqu'à 3 écrans ou applications (tableurs, IDE, navigateur) sous forme de panneaux flottants via `getDisplayMedia` (cadencé à 15 FPS max pour préserver le CPU).
* **Import d'images & Copier-Coller (`Image` / `Ctrl + V`)** : collez ou importez instantanément un graphique ou une capture d'écran dans votre flux vidéo.
* **Cartes de notes (`Note Texte AR`)** : créez des cartes lisibles en direct et réglez leur transparence (`Opacité`).
* **Ancrage des annotations** : tout trait ou forme dessiné par-dessus une fenêtre AR s'y attache automatiquement et suit ses déplacements et son redimensionnement.

### 3. Double rendu intelligent (Aperçu miroir privé vs Flux sortant lisible)
* **Aperçu local naturel** : dans le panneau Vision Studio (ou dans le mini-aperçu de 224×126 px à côté de la bulle flottante), votre retour vidéo est affiché en miroir avec votre curseur de visée.
* **Flux sortant propre pour les participants** : vidéo non inversée, dessins et fenêtres AR repositionnés pour rester lisibles à l'endroit, sans jamais montrer votre curseur ni les menus (sauf si `HUD Meet: ON` est activé).
* **Passthrough à chaud (`Ext: ON / OFF`)** : basculez sur votre webcam matérielle normale en un clic depuis le panneau ou le popup de l'extension (via `RTCRtpSender.replaceTrack`).

### 4. Ergonomie, UI isolée & Confidentialité 100 % locale
* **Interface isolée (Shadow DOM)** : aucune collision CSS avec Google Meet, icônes SVG uniformes, bilingue **FR / EN** (synchronisé entre le panneau et le popup), tutoriel rapide en 3 cartes et barre d'aide gestuelle rétractable via le bouton **`i`** en bas à droite.
* **Productivité en réunion** : bouton `Visible / Masqué` temporaire, `Undo / Redo` (mettant automatiquement en pause les captures AR annulées), protection sur `Clear` avec toast **Annuler (6 s)**, et **raccourcis clavier configurables** (`D`, `L`, `E`, `H`, `Z`, `Y` par défaut).
* **Zéro serveur, zéro CDN** : `@mediapipe/tasks-vision` (WebAssembly + modèle `hand_landmarker.task`) est embarqué dans `vendor/`. Aucune vidéo ni donnée ne quitte votre ordinateur.
* **Performances** : cache hors-écran des formes statiques, mode **Éco**, et maintien du flux vidéo en arrière-plan (`document.hidden`) via Web Worker (`bg-timer.js`).

---

## Structure du projet

```text
vision-studio-meet/
├── manifest.json       Configuration Chrome MV3, permissions minimales & CSP locale
├── inject.js           Monde MAIN : interception getUserMedia / enumerateDevices / WebRTC & passthrough
├── content.js          Monde ISOLATED : UI Shadow DOM, garde-clavier, gestes, double rendu Canvas & AR
├── sandbox.html        Page d'inférence interne hébergeant le module MediaPipe local
├── sandbox.js          Moteur @mediapipe/tasks-vision (HandLandmarker GPU/CPU) en ping-pong
├── bg-timer.js         Web Worker maintenant le rendu vidéo lorsque l'onglet Meet est en arrière-plan
├── popup.html          Popup de contrôle rapide (ON/OFF, langue FR/EN, statut, version & aide)
├── popup.js            Logique du popup synchronisée via chrome.storage.local
├── icons/              Icônes de l'extension (16, 32, 48, 128 px)
├── vendor/             Binaires locaux MediaPipe (vision_bundle.mjs, hand_landmarker.task, wasm/)
├── PRIVACY.md          Politique de confidentialité prête à publier
├── STORE_LISTING.md    Textes FR/EN pour la fiche Chrome Web Store
└── build-store-zip.ps1 Script PowerShell générant le package .zip propre dans dist/
```

---

## Installation (Mode développeur Chrome / Edge / Brave ≥ 111)

1. Téléchargez ou clonez ce dossier sur votre ordinateur.
2. Ouvrez `chrome://extensions/` dans votre navigateur Chromium (version 111 ou supérieure).
3. Activez le **Mode développeur** (en haut à droite).
4. Cliquez sur **Charger l'extension non empaquetée** et sélectionnez le dossier `vision-studio-meet`.
5. Ouvrez `https://meet.google.com/` : votre caméra démarre automatiquement. Cliquez sur la bulle flottante pour ouvrir le panneau.

## Packaging pour le Chrome Web Store

Exécutez le script PowerShell à la racine du projet :

```powershell
.\build-store-zip.ps1
```

Il génère automatiquement `dist/vision-studio-meet-v<version>.zip` contenant uniquement les fichiers de production (sans le dossier `video/` ni les fichiers Markdown).

---

## Résumé des commandes & raccourcis

| Action | Geste / Commande | Raccourci par défaut (panneau ouvert) |
| :--- | :--- | :---: |
| **Dessiner** | Poing auxiliaire fermé (ou `Mode dessin: ON` + maintenir `Espace`) + index dominant | `D` (Mode dessin) |
| **Pointeur Laser (2 s)** | Bouton `Laser` dans le ruban | `L` |
| **Gomme au doigt** | Bouton `Gomme` dans le ruban | `E` |
| **Tout masquer / afficher** | Bouton `Visible / Masqué` | `H` |
| **Annuler / Rétablir** | Boutons `Undo` / `Redo` | `Z` / `Y` |
| **Déplacer un élément** | Pincer à 1 main (pouce + index) sur l'objet | — |
| **Zoomer / Pivoter** | Pincer à 2 mains simultanément et écarter / rapprocher (ou molette souris) | — |
| **Coller une image AR** | `Ctrl + V` sur la page ou bouton `Image` | `Ctrl + V` |
| **Aide gestuelle** | Bouton **`i`** en bas à droite de l'aperçu | — |
| **Revenir à la webcam normale** | Interrupteur `Ext: ON / OFF` (panneau ou popup) | — |

---

*Google Meet est une marque de Google LLC. Cette extension est un projet indépendant et n'est ni affiliée à, ni approuvée par Google LLC.*
