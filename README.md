# ✨ Vision Studio — AR Hand Tracking & Virtual Cam for Google Meet

**Vision Studio** est une application web interactive et une extension Chrome (Manifest V3) propulsée par **MediaPipe Hands**. Elle transforme votre webcam en un studio de **Réalité Augmentée (AR)** et de dessin aérien directement intégré dans **Google Meet**, permettant d'écrire dans les airs, de manipuler des formes géométriques avec la gravité et de projeter des fenêtres ou tableaux de bord interactifs avec vos doigts.

---

## 🚀 Fonctionnalités Principales

### ✍️ 1. Air Paint & Écriture Libre (`03 · PAINT`)
* **Suivi de précision :** Le curseur suit la pointe de l'index droit en temps réel avec un lissage par courbes de Bézier (`quadraticCurveTo`) pour une écriture fluide dans les airs.
* **Système à Double Embrayage (Dual-Clutch) :** Gardez la main droite détendue pour écrire et activez l'encre uniquement quand vous le souhaitez :
  * **Main Gauche :** Fermez le poing gauche (ou pincez) pour poser le stylo, ouvrez la main pour lever le stylo.
  * **Clavier :** Maintenez la **Barre Espace** enfoncée pour écrire (avec garde-clavier intelligent qui empêche Google Meet de couper votre micro tout en laissant le chat fonctionnel).
* **Gomme intelligente (`🧽 GOMME`) :** Effacez vos traits et formes d'un simple passage du doigt sans supprimer vos fenêtres AR.

### 🖥️ 2. Réalité Augmentée Interactive (`FENÊTRE AR` & `IMAGE AR`)
* **Capture de fenêtres en direct (`🖥️ FENÊTRE AR`) :** Projetez n'importe quel logiciel ouvert sur votre PC (Excel, PowerBI, VS Code, navigateur) sous forme d'écran holographique flottant dans votre webcam via `getDisplayMedia`.
* **Import d'images & Copier-Coller (`🖼️ IMAGE AR` / `Ctrl + V`) :** Collez instantanément une capture d'écran ou un graphique dans votre flux vidéo.
* **Manipulation & Zoom à 2 mains (`Pinch Stretch`) :** Déplacez vos fenêtres AR à une main et écartez vos deux mains pour zoomer en direct sur vos chiffres (avec maintien automatique de l'horizontalité).
* **Annotation AR :** Dessinez et entourez des éléments directement par-dessus vos fenêtres flottantes.

### 📐 3. Formes Géométriques & Moteur Physique 2D (`01 · FIXE` & `02 · GRAVITÉ`)
* **Menu Aérien & Smart Shape :** Générez des formes (`CIRCLE`, `RECT`, `TRIANGLE`, `STAR`, `HEXAGON`, `LINE`) depuis le menu virtuel ou activez la reconnaissance automatique des tracés à main levée.
* **Physique & Collisions :** Activez la gravité pour faire tomber les formes, les faire rebondir entre elles et interagir physiquement avec vos mains.

### 🎥 4. Caméra Virtuelle Google Meet & Double Rendu (HUD Privé)
* **Injection WebRTC transparente :** Remplace le flux de la caméra par un flux composite (`captureStream(30)`) sans logiciel tiers (pas besoin d'OBS).
* **Double Rendu Intelligent (`👁️ HUD: OFF/ON`) :** Vous seul voyez vos menus aériens et vos repères de visée dans l'interface rétractable (bulle flottante `✦`), tandis que les participants de la réunion voient uniquement votre vidéo propre, vos dessins et vos fenêtres AR.
* **Architecture Ping-Pong Zéro Latence :** Exécute MediaPipe Hands dans une capsule `sandbox.html` isolée sur des miniatures `384x216` avec le modèle Lite (`modelComplexity: 0`) pour garantir 0 ms de file d'attente.

---

## 📁 Structure du Projet

```text
vision-studio-meet/
├── manifest.json       # Configuration de l'extension Chrome (Manifest V3 & CSP Sandbox)
├── inject.js           # Interception de getUserMedia / enumerateDevices (Caméra Virtuelle Meet)
├── content.js          # Moteur graphique Canvas, physique 2D, AR, garde-clavier & UI flottante
├── sandbox.html        # Capsule isolée exécutant MediaPipe Hands en temps réel



🛠️ Installation (Mode Développeur Chrome / Brave / Edge)

Téléchargez ou clonez ce dépôt sur votre ordinateur.

Ouvrez votre navigateur et accédez à chrome://extensions/.

Activez le Mode développeur (bouton en haut à droite).

Cliquez sur Charger l'extension non empaquetée (Load unpacked) en haut à gauche.

Sélectionnez le dossier du projet (vision-studio-meet).

Rejoignez une réunion sur Google Meet : cliquez sur la bulle flottante ✦ en bas à droite, puis sur [📷 START CAM].


Action,Geste / Commande

Écrire / Dessiner (Mode Paint),Index droit pointé + Maintenir Espace (ou Fermer le poing gauche)

Déplacer une fenêtre AR / forme,Mode 01·MANIPULER AR + Pincer à 1 main (ou Espace)

Agrandir / Rétrécir (Zoom AR),Mode 01·MANIPULER AR + Pincer avec les 2 mains et écarter (ou molette souris)

Coller une capture d'écran en AR,Ctrl + V directement pendant la réunion

Supprimer un objet / Fermer AR,Glisser l'objet jusqu'au bord de l'écran (zone rouge) ou bouton ↩ (Undo)

Réduire l'interface en bulle ✦,Cliquer n'importe où en dehors de la fenêtre Vision Studio



💻 Technologies Utilisées

JavaScript (ES6+) & HTML5 Canvas API

MediaPipe Hands (@mediapipe/hands) — Computer Vision & Hand Landmark Tracking

WebRTC / MediaStream API (captureStream, getUserMedia, getDisplayMedia)

Chrome Extension API (Manifest V3, Isolated & Main Worlds, CSP Sandboxing)