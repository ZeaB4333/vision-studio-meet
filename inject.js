(function () {
  const streamCanvas = document.createElement('canvas');
  streamCanvas.id = 'vs-meet-stream-canvas';
  streamCanvas.width = 960;
  streamCanvas.height = 540;
  streamCanvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:960px;height:540px;pointer-events:none;opacity:0;';

  const sCtx = streamCanvas.getContext('2d');
  sCtx.fillStyle = '#06070a';
  sCtx.fillRect(0, 0, 960, 540);

  const attachCanvas = () => {
    if (!document.getElementById('vs-meet-stream-canvas') && document.documentElement) {
      document.documentElement.appendChild(streamCanvas);
    }
  };
  attachCanvas();
  window.addEventListener('DOMContentLoaded', attachCanvas);

  function isExtensionEnabled() {
    const attr = document.documentElement && document.documentElement.dataset.vsExtEnabled;
    if (attr === 'false') return false;
    if (attr === 'true') return true;
    try {
      const saved = localStorage.getItem('vs_ext_enabled');
      if (saved === 'false') return false;
    } catch (e) {}
    return true;
  }

  function extractRequestedDeviceId(videoConstraint) {
    if (!videoConstraint || typeof videoConstraint !== 'object') return '';
    const dev = videoConstraint.deviceId;
    if (!dev) return '';
    if (typeof dev === 'string') return dev;
    if (typeof dev === 'object') return dev.exact || dev.ideal || '';
    return '';
  }

  function sanitizeConstraintsForPassthrough(constraints) {
    if (!constraints || typeof constraints !== 'object' || !constraints.video || typeof constraints.video !== 'object') {
      return constraints;
    }
    const reqId = extractRequestedDeviceId(constraints.video);
    if (reqId !== 'vision-studio-virtual-cam') {
      return constraints;
    }
    const clonedVideo = { ...constraints.video };
    delete clonedVideo.deviceId;
    return {
      ...constraints,
      video: Object.keys(clonedVideo).length > 0 ? clonedVideo : true
    };
  }

  const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const origEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  const activeVirtualTracks = new Set();
  const videoRtpSenders = new Map(); // sender -> RTCPeerConnection
  let fallbackHardwareTracks = new Set();
  let lastKnownHardwareDeviceId = '';

  function pruneClosedSenders() {
    for (const [sender, pc] of videoRtpSenders.entries()) {
      if (!sender || typeof sender.replaceTrack !== 'function' || !pc || pc.signalingState === 'closed' || pc.connectionState === 'closed') {
        videoRtpSenders.delete(sender);
      }
    }
  }

  function trackVideoSender(pc, sender) {
    if (!pc || !sender) return;
    videoRtpSenders.set(sender, pc);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.signalingState === 'closed') {
        videoRtpSenders.delete(sender);
      }
    });
  }

  // Suivi des RTCRtpSender vidéo pour remplacer la piste à chaud (replaceTrack) lors d'un OFF / ON en plein appel
  if (typeof RTCPeerConnection !== 'undefined' && RTCPeerConnection.prototype) {
    const origAddTrack = RTCPeerConnection.prototype.addTrack;
    if (typeof origAddTrack === 'function') {
      RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
        const sender = origAddTrack.apply(this, [track, ...streams]);
        if (sender && track && track.kind === 'video') {
          trackVideoSender(this, sender);
        }
        return sender;
      };
    }

    const origAddTransceiver = RTCPeerConnection.prototype.addTransceiver;
    if (typeof origAddTransceiver === 'function') {
      RTCPeerConnection.prototype.addTransceiver = function (trackOrKind, init) {
        const transceiver = origAddTransceiver.apply(this, [trackOrKind, init]);
        if (transceiver && transceiver.sender) {
          const isVideo = trackOrKind === 'video' || (trackOrKind && trackOrKind.kind === 'video');
          if (isVideo) {
            trackVideoSender(this, transceiver.sender);
          }
        }
        return transceiver;
      };
    }

    const origClose = RTCPeerConnection.prototype.close;
    if (typeof origClose === 'function') {
      RTCPeerConnection.prototype.close = function () {
        for (const [sender, pc] of videoRtpSenders.entries()) {
          if (pc === this) videoRtpSenders.delete(sender);
        }
        return origClose.apply(this, arguments);
      };
    }
  }

  function createConfiguredVirtualTrack() {
    attachCanvas();
    const cStream = streamCanvas.captureStream(30);
    const vTrack = cStream.getVideoTracks()[0];
    if (vTrack) {
      activeVirtualTracks.add(vTrack);
      vTrack.addEventListener('ended', () => activeVirtualTracks.delete(vTrack), { once: true });

      const origGetSettings = vTrack.getSettings.bind(vTrack);
      vTrack.getSettings = () => ({
        ...origGetSettings(),
        deviceId: 'vision-studio-virtual-cam',
        width: 960,
        height: 540,
        frameRate: 30
      });
    }
    return { cStream, vTrack };
  }

  function stopFallbackHardwareTracks() {
    fallbackHardwareTracks.forEach((t) => {
      try { t.stop(); } catch (_) {}
    });
    fallbackHardwareTracks.clear();
  }

  async function swapSendersToHardwareCamera() {
    pruneClosedSenders();
    const liveSenders = Array.from(videoRtpSenders.keys());
    if (liveSenders.length === 0) return false;
    try {
      const videoConstraint = lastKnownHardwareDeviceId
        ? { deviceId: { ideal: lastKnownHardwareDeviceId }, width: { ideal: 960 }, height: { ideal: 540 } }
        : { width: { ideal: 960 }, height: { ideal: 540 } };
      const hwStream = await origGetUserMedia({ video: videoConstraint, audio: false });
      const hwTrack = hwStream.getVideoTracks()[0];
      if (!hwTrack) return false;
      fallbackHardwareTracks.add(hwTrack);
      await Promise.all(liveSenders.map(s => s.replaceTrack(hwTrack).catch(() => {})));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function swapSendersToVirtualCamera() {
    pruneClosedSenders();
    const liveSenders = Array.from(videoRtpSenders.keys());
    if (liveSenders.length === 0) return false;
    try {
      const { vTrack } = createConfiguredVirtualTrack();
      if (!vTrack) return false;
      await Promise.all(liveSenders.map(s => s.replaceTrack(vTrack).catch(() => {})));
      stopFallbackHardwareTracks();
      return true;
    } catch (_) {
      return false;
    }
  }

  window.addEventListener('vs-ext-state-changed', async (e) => {
    const enabled = Boolean(e.detail && e.detail.enabled);
    if (!enabled) {
      // 1. Remplace à chaud la piste dans les RTCPeerConnection actifs si présents
      await swapSendersToHardwareCamera();
      // 2. Arrête les pistes virtuelles ET déclenche explicitement l'événement 'ended' pour prévenir Meet (N3)
      activeVirtualTracks.forEach((track) => {
        try {
          track.stop();
          track.dispatchEvent(new Event('ended'));
        } catch (_) {}
      });
      activeVirtualTracks.clear();
    } else {
      await swapSendersToVirtualCamera();
    }
    try {
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    } catch (_) {}
  });

  navigator.mediaDevices.enumerateDevices = async function () {
    const devices = await origEnumerateDevices();
    if (!isExtensionEnabled()) {
      return devices;
    }
    const virtualCam = {
      deviceId: 'vision-studio-virtual-cam',
      groupId: 'vision-studio-group',
      kind: 'videoinput',
      label: '✨ Vision Studio (Air Paint & Shapes)',
      toJSON() { return this; }
    };
    return [virtualCam, ...devices];
  };

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (!isExtensionEnabled()) {
      stopFallbackHardwareTracks();
      return origGetUserMedia(sanitizeConstraintsForPassthrough(constraints));
    }

    if (constraints && constraints.video) {
      stopFallbackHardwareTracks();

      const reqDeviceId = extractRequestedDeviceId(constraints.video);
      const hardwareDeviceId = reqDeviceId !== 'vision-studio-virtual-cam' ? reqDeviceId : '';
      if (hardwareDeviceId) {
        lastKnownHardwareDeviceId = hardwareDeviceId;
      }

      if (document.documentElement) {
        document.documentElement.dataset.vsMeetRequestedVideo = 'true';
        if (hardwareDeviceId) {
          document.documentElement.dataset.vsRequestedDeviceId = hardwareDeviceId;
        }
      }

      window.dispatchEvent(new CustomEvent('vs-meet-request-cam', {
        detail: { deviceId: hardwareDeviceId }
      }));

      const { cStream } = createConfiguredVirtualTrack();

      if (constraints.audio) {
        try {
          const audioStream = await origGetUserMedia({ audio: constraints.audio, video: false });
          audioStream.getAudioTracks().forEach(t => cStream.addTrack(t));
        } catch (audioErr) {
          console.warn('[Vision Studio] Échec de capture audio :', audioErr);
          window.dispatchEvent(new CustomEvent('vs-audio-error', {
            detail: {
              name: (audioErr && audioErr.name) || 'Error',
              message: (audioErr && audioErr.message) || ''
            }
          }));
        }
      }
      return cStream;
    }

    return origGetUserMedia(constraints);
  };
})();