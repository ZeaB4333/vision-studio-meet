let intervalId = null;

self.onmessage = (e) => {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 33);
  } else if (e.data === 'stop') {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};