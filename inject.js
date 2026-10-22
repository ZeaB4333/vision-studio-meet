(function () {
  const streamCanvas = document.createElement('canvas');
  streamCanvas.id = 'vs-meet-stream-canvas';
  streamCanvas.width = 960;
  streamCanvas.height = 540;
  streamCanvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:960px;height:540px;pointer-events:none;opacity:0;';

  const attachCanvas = () => {
    if (!document.getElementById('vs-meet-stream-canvas') && document.documentElement) {
      document.documentElement.appendChild(streamCanvas);
    }
  };
  attachCanvas();
  window.addEventListener('DOMContentLoaded', attachCanvas);

  const sCtx = streamCanvas.getContext('2d');
  setInterval(() => {
    if (document.documentElement.dataset.vsCamRunning !== 'true') {
      sCtx.fillStyle = '#08090c';
      sCtx.fillRect(0, 0, 960, 540);
      sCtx.strokeStyle = '#00f0ff';
      sCtx.lineWidth = 2;
      sCtx.strokeRect(30, 30, 900, 480);
      sCtx.fillStyle = '#00f0ff';
      sCtx.font = 'bold 22px monospace';
      sCtx.textAlign = 'center';
      sCtx.fillText('VISION · STUDIO — CAMÉRA VIRTUELLE PRÊTE', 480, 250);
      sCtx.fillStyle = '#e8ecf2';
      sCtx.font = '14px monospace';
      sCtx.fillText('Cliquez sur la bulle flottante ✦ puis sur [📷 START CAM]', 480, 290);
    }
  }, 600);

  const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const origEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

  navigator.mediaDevices.enumerateDevices = async function () {
    const devices = await origEnumerateDevices();
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
    if (constraints && constraints.video) {
      attachCanvas();
      const cStream = streamCanvas.captureStream(30);
      const vTrack = cStream.getVideoTracks()[0];

      if (vTrack) {
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