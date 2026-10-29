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

  window.addEventListener('vs-ext-state-changed', (e) => {
    const enabled = e.detail && e.detail.enabled;
    if (!enabled) {
      activeVirtualTracks.forEach((track) => {
        try { track.stop(); } catch (_) {}
      });
      activeVirtualTracks.clear();
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
      return origGetUserMedia(sanitizeConstraintsForPassthrough(constraints));
    }

    if (constraints && constraints.video) {
      attachCanvas();

      const reqDeviceId = extractRequestedDeviceId(constraints.video);
      const hardwareDeviceId = reqDeviceId !== 'vision-studio-virtual-cam' ? reqDeviceId : '';

      if (document.documentElement) {
        document.documentElement.dataset.vsMeetRequestedVideo = 'true';
        if (hardwareDeviceId) {
          document.documentElement.dataset.vsRequestedDeviceId = hardwareDeviceId;
        }
      }

      window.dispatchEvent(new CustomEvent('vs-meet-request-cam', {
        detail: { deviceId: hardwareDeviceId }
      }));

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

      if (constraints.audio) {
        try {
          const audioStream = await origGetUserMedia({ audio: constraints.audio, video: false });
          audioStream.getAudioTracks().forEach(t => cStream.addTrack(t));
        } catch (e) {}
      }
      return cStream;
    }

    return origGetUserMedia(constraints);
  };
})();