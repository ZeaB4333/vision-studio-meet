✨ Vision Studio for Google Meet™

Vision Studio for Google Meet™ est une extension Chrome (Manifest V3) de réalité augmentée (AR) et d'annotation gestuelle propulsée localement par MediaPipe Tasks Vision (HandLandmarker). Elle remplace ou enrichit votre webcam dans Google Meet™ grâce à une caméra virtuelle HTML5 Canvas (captureStream), vous permettant d'écrire dans les airs, d'utiliser un pointeur laser éphémère et de projeter des fenêtres ou notes interactives pilotées avec vos doigts.

🚀 FONCTIONNALITÉS PRINCIPALES
======================================================================

✍️ 1. Gestes Unifiés Automatiques (Dessin, Manipulation 1 main & Zoom 2 mains)
- Écriture aérienne fluide : Le curseur suit la pointe de l'index droit avec un lissage par courbes de Bézier (quadraticCurveTo) et une simplification géométrique Ramer-Douglas-Peucker.
- Double Embrayage d'écriture (Dual-Clutch) :
  • Geste Main Gauche : Fermez le poing gauche pour poser le stylo dans les airs, ouvrez la main pour lever le stylo.
  • Clavier (en option) : Activez le bouton [✍️ Mode dessin: ON] et maintenez la Barre Espace pour dessiner. Lorsque Mode dessin est sur OFF (par défaut), la barre Espace est intégralement laissée à Google Meet™ (Push-to-Talk fonctionnel).
- Manipulation automatique au pincement :
  • Pincer à 1 main (droite) : Saisissez et déplacez n'importe quelle forme ou fenêtre AR, ou pincez son bouton [✕] pour la fermer.
  • Pincer à 2 mains (gauche + droite) : Écartez ou rapprochez vos deux mains pour agrandir, rétrécir ou pivoter un objet.
- Pointeur Laser (☄️ Laser) & Gomme (🧽 Gomme) : Tracez des annotations lumineuses qui s'effacent automatiquement après 2 secondes, ou gommez vos traits du bout du doigt sans affecter vos fenêtres AR.

🖥️ 2. Réalité Augmentée Interactive (Fenêtre AR, Image & Note Texte AR)
- Capture de fenêtres en direct (🖥️ Fenêtre AR) : Projetez jusqu'à 3 écrans ou applications (Excel, VS Code, navigateur) sous forme de panneaux flottants dans votre vidéo via getDisplayMedia (cadencé à 15 images/s max pour préserver le CPU).
- Import d'images & Copier-Coller (🖼️ Image / Ctrl + V) : Collez ou importez instantanément un graphique ou une capture d'écran dans votre flux vidéo.
- Cartes de notes (Note Texte AR) : Générez des cartes de texte lisibles en direct et ajustez leur transparence (Opacité).
- Ancrage des annotations : Tout trait ou forme dessiné par-dessus une fenêtre AR s'y attache automatiquement et suit ses déplacements et son redimensionnement.

🎥 3. Double Rendu (Aperçu Miroir Privé vs Flux Sortant Lisible)
- Aperçu local naturel : Dans la fenêtre Vision Studio (ou dans le mini-aperçu de 224×126 px affiché à côté de la bulle flottante ✦), votre retour vidéo est affiché en miroir avec votre curseur de visée et vos menus aériens.
- Flux sortant propre et non inversé pour les participants :
  • Le flux envoyé à Google Meet™ contient la vidéo non inversée.
  • Les dessins et fenêtres AR sont positionnés aux coordonnées correspondantes (x' = largeur - x) sans inverser leur géométrie, afin que tout texte ou tableau reste parfaitement lisible à l'endroit pour vos interlocuteurs.
  • Votre curseur de visée et l'interface ne sont jamais dessinés dans le flux sortant (sauf si vous activez volontairement [👁️ HUD Meet: ON]).
- Passthrough natif (🟢 Ext: ON / OFF) : Basculez l'interrupteur sur OFF (depuis le ruban ou le popup de l'extension) pour désactiver la caméra virtuelle et laisser Google Meet™ utiliser directement votre caméra matérielle.

⚡ 4. Exécution 100 % Locale, Cache Statique & Maintien en Arrière-plan
- Confidentialité totale & Zéro CDN : Le moteur @mediapipe/tasks-vision (WebAssembly + modèle hand_landmarker.task) est embarqué dans le dossier vendor/. Aucune image, vidéo ou donnée personnelle ne quitte votre navigateur.
- Architecture Ping-Pong sans file d'attente : Une seule miniature 384×216 est envoyée à la fois au moteur d'inférence (GPU avec repli automatique CPU), évitant toute accumulation de retard.
- Optimisation & Mode Économie (🍃 Éco) : Mise en cache hors-écran des formes statiques, maintien du flux vidéo à 30 FPS par Web Worker lorsque l'onglet Meet passe en arrière-plan (document.hidden), et mode économie réduisant la charge CPU/GPU sur les ordinateurs portables.

📁 STRUCTURE DU PROJET
======================================================================

vision-studio-meet/
├── manifest.json       Configuration Chrome MV3, permissions minimales & CSP locale
├── inject.js           Monde MAIN : interception getUserMedia / enumerateDevices & passthrough
├── content.js          Monde ISOLATED : UI ruban, garde-clavier Espace, double rendu Canvas & AR
├── sandbox.html        Page d'inférence interne hébergeant le module MediaPipe local
├── sandbox.js          Moteur @mediapipe/tasks-vision (HandLandmarker GPU/CPU) en ping-pong
├── popup.html          Popup de contrôle rapide (Interrupteur ON/OFF, statut, version & aide)
├── popup.js            Logique du popup synchronisée via chrome.storage.local
├── icons/              Icônes de l'extension (16, 32, 48, 128 px)
└── vendor/             Binaires locaux MediaPipe (vision_bundle.mjs, hand_landmarker.task, wasm/)

🛠️ INSTALLATION (MODE DÉVELOPPEUR CHROME / EDGE / BRAVE ≥ 111)
======================================================================

1. Clonez ou téléchargez ce dépôt sur votre ordinateur.
2. Ouvrez votre navigateur Chromium (version 111 ou supérieure) et accédez à chrome://extensions/.
3. Activez le Mode développeur (en haut à droite).
4. Cliquez sur Charger l'extension non empaquetée (Load unpacked) et sélectionnez le dossier vision-studio-meet.
5. Ouvrez https://meet.google.com/ : votre caméra démarre automatiquement. Cliquez sur la bulle flottante ✦ pour accéder au ruban d'outils.

🎮 RÉSUMÉ DES COMMANDES & GESTES
======================================================================

- Dessiner / Écrire dans les airs : Fermer le poing gauche (ou activer [✍️ Mode dessin: ON] + maintenir Espace) et pointer l'index droit.
- Déplacer une forme ou fenêtre AR : Pincer à 1 main (pouce + index de la main droite) sur l'objet.
- Agrandir / Rétrécir (Zoom AR) : Pincer avec les 2 mains simultanément et écarter / rapprocher (ou molette souris).
- Coller une image en AR : Ctrl + V directement sur la page ou bouton [🖼️ Image].
- Fermer une fenêtre AR / Supprimer : Pincer ou cliquer sur le bouton [✕] de la fenêtre AR, glisser une forme au bord, ou cliquer sur ↩.
- Utiliser le Push-to-Talk de Meet : Laisser [✍️ Mode dessin: OFF] (réglage par défaut) et maintenir Espace.
- Revenir à la webcam normale : Basculer [🟢 Ext: ON] sur OFF (dans le ruban ou dans le popup de l'extension).

📜 ATTRIBUTION

Google Meet est une marque de Google LLC. Cette extension est un projet indépendant et n'est ni affiliée à, ni approuvée par Google LLC.