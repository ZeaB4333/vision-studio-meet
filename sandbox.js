import { FilesetResolver, HandLandmarker } from './vendor/vision_bundle.mjs';

// Reçoit UNE miniature 384x216 à la fois (ping-pong), l'analyse en local via
// @mediapipe/tasks-vision (HandLandmarker GPU avec repli CPU) et renvoie VS_HANDS_RESULTS.
const SIZE_W = 384;
const SIZE_H = 216;

const workCanvas = document.createElement('canvas');
workCanvas.width = SIZE_W;
workCanvas.height = SIZE_H;
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

const post = (msg) => window.parent.postMessage(msg, '*');

let handLandmarker = null;
let busy = false;
let busySince = 0;
let lastTimestampMs = 0;

function nextMonotonicTimestamp() {
  const now = Math.floor(performance.now());
  lastTimestampMs = now > lastTimestampMs ? now : lastTimestampMs + 1;
  return lastTimestampMs;
}

async function createLandmarkerWithFallback(vision) {
  const modelPath = chrome.runtime.getURL('vendor/hand_landmarker.task');
  const commonOptions = {
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3
  };

  try {
    const gpuInstance = await HandLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: 'GPU'
      }
    });
    return { instance: gpuInstance, delegate: 'GPU' };
  } catch (gpuErr) {
    console.warn('[Vision Studio] Délégué GPU indisponible, repli automatique sur CPU :', gpuErr);
    const cpuInstance = await HandLandmarker.createFromOptions(vision, {
      ...commonOptions,
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: 'CPU'
      }
    });
    return { instance: cpuInstance, delegate: 'CPU' };
  }
}

async function initHands() {
  try {
    const wasmRoot = chrome.runtime.getURL('vendor/wasm');
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    const { instance, delegate } = await createLandmarkerWithFallback(vision);
    handLandmarker = instance;

    // Préchauffage du modèle sur une frame vide pour éviter tout gel à la 1re image caméra
    workCtx.fillStyle = '#000000';
    workCtx.fillRect(0, 0, SIZE_W, SIZE_H);
    handLandmarker.detectForVideo(workCanvas, nextMonotonicTimestamp());

    post({ type: 'VS_SANDBOX_READY', delegate });
  } catch (err) {
    handLandmarker = null;
    post({
      type: 'VS_SANDBOX_ERROR',
      message: `Échec d'initialisation locale MediaPipe Tasks Vision (${(err && err.message) || err}). Vérifiez le dossier vendor/.`
    });
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || !e.data || e.data.type !== 'VS_PROCESS_FRAME') return;
  const bitmap = e.data.bitmap;
  const now = performance.now();

  if (busy && now - busySince > 1500) {
    busy = false; // Filet de sécurité : jamais bloqué indéfiniment
  }

  if (!handLandmarker || busy) {
    if (bitmap) {
      try { bitmap.close(); } catch (_) {}
    }
    post({ type: 'VS_HANDS_BUSY' });
    return;
  }

  busy = true;
  busySince = now;

  try {
    workCtx.drawImage(bitmap, 0, 0, SIZE_W, SIZE_H);
    bitmap.close();

    const results = handLandmarker.detectForVideo(workCanvas, nextMonotonicTimestamp());

    const multiHandLandmarks = results.landmarks || [];
    const rawHandedness = results.handednesses || results.handedness || [];
    const multiHandedness = rawHandedness.map((entry) => {
      const top = Array.isArray(entry) ? entry[0] : entry;
      const rawCat = (top && (top.categoryName || top.displayName || top.label)) || 'Right';
      // Harmonisation de la latéralité avec le format legacy attendu par content.js :
      // Dans HandLandmarker (tasks-vision), categoryName renvoie la latéralité anatomique ('Left' pour main gauche),
      // alors que @mediapipe/hands legacy renvoyait l'inverse ('Right' pour main gauche sur flux non inversé).
      const compatLabel = rawCat === 'Left' ? 'Right' : (rawCat === 'Right' ? 'Left' : rawCat);
      return {
        label: compatLabel,
        score: (top && typeof top.score === 'number') ? top.score : 1
      };
    });

    busy = false;
    post({
      type: 'VS_HANDS_RESULTS',
      multiHandLandmarks,
      multiHandedness
    });
  } catch (err) {
    try { if (bitmap) bitmap.close(); } catch (_) {}
    busy = false;
    post({ type: 'VS_HANDS_BUSY' });
  }
});

initHands();