#### Fichier 3 : `PRIVACY.md` (Politique de confidentialité prête à publier — 1 page)
```markdown
# Politique de Confidentialité — Vision Studio for Google Meet™
*Dernière mise à jour : Octobre 2026*

## 1. Principe fondamental : Traitement 100 % local
L'extension **Vision Studio for Google Meet™** fonctionne exclusivement en local à l'intérieur de votre navigateur web sur votre ordinateur. **Aucune donnée personnelle, aucun flux vidéo, aucune image de caméra, aucune capture d'écran et aucune donnée biométrique (positions des mains) ne quittent votre appareil.**

## 2. Données traitées localement et finalité
Pour assurer ses fonctionnalités de caméra virtuelle et de dessin aérien sur `https://meet.google.com/*`, l'extension traite de manière éphémère en mémoire vive (RAM) :
1. **Flux vidéo de la webcam et captures de fenêtres (`getUserMedia` / `getDisplayMedia`) :** Utilisés uniquement en temps réel pour composer l'image de la caméra virtuelle dans un élément HTML5 `<canvas>` local transmis à votre session Google Meet™.
2. **Détection des points clés de la main (MediaPipe `HandLandmarker`) :** L'analyse vidéo permettant de détecter les gestes des doigts est exécutée localement sur votre machine via WebAssembly/WebGL (fichiers embarqués dans le paquet de l'extension sous `vendor/`). Les coordonnées des mains sont immédiatement détruites après chaque image calculée et ne sont jamais enregistrées.
3. **Préférences d'interface (`chrome.storage.local` et `localStorage`) :** Vos réglages techniques (couleur du trait, épaisseur, opacité AR, position de la fenêtre, identifiant de caméra choisie et état actif/inactif de l'extension) sont stockés uniquement sur votre navigateur local afin d'être conservés entre deux réunions.

## 3. Absence de collecte, de partage et de code distant
* **Aucune collecte de données :** Nous ne possédons aucun serveur de collecte et n'utilisons aucun outil d'analyse d'audience (zéro Google Analytics, zéro télémétrie, zéro pisteur).
* **Aucun transfert à des tiers :** Aucune donnée n'est vendue, louée, transférée ou communiquée à des tiers.
* **Aucune requête réseau externe :** Toutes les bibliothèques logicielles et modèles d'intelligence artificielle nécessaires au fonctionnement de l'extension sont inclus dans l'archive de l'extension.

## 4. Contrôle de l'utilisateur et suppression des données
* Vous pouvez interrompre le traitement vidéo à tout moment via le bouton **STOP CAM** ou en basculant l'interrupteur **Extension active** sur **OFF**.
* La désinstallation de l'extension depuis `chrome://extensions` supprime immédiatement et définitivement l'ensemble des préférences enregistrées dans `chrome.storage.local`.

## 5. Contact
Pour toute question relative à cette politique de confidentialité, vous pouvez contacter le développeur via la section « Assistance » de la fiche officielle sur le Chrome Web Store.

---
*Google Meet est une marque de Google LLC.*