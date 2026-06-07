/* ============================================================
   camera-capture.js — Browser camera still-capture helper
   Opens a lightweight live-camera modal and returns a JPEG File.
   ============================================================ */

/**
 * Open a live camera modal and capture one still image.
 * Returns null when the user cancels.
 * @param {{ title?: string }} opts
 * @returns {Promise<File|null>}
 */
export async function captureStillFromCamera(opts = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API is not available in this browser.');
  }

  const titleText = opts.title || 'Take Photo';

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('Camera permission denied. Please allow camera access and try again.');
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No camera found on this device.');
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      throw new Error('Camera is in use by another app. Please close it and try again.');
    }
    throw new Error('Could not start camera: ' + (err.message || err.name));
  }

  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'wm-camera-overlay';

    const modal = document.createElement('div');
    modal.className = 'wm-camera-modal';

    const title = document.createElement('div');
    title.className = 'wm-camera-title';
    title.textContent = titleText;

    const videoWrap = document.createElement('div');
    videoWrap.className = 'wm-camera-video-wrap';

    const video = document.createElement('video');
    video.className = 'wm-camera-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;

    videoWrap.appendChild(video);

    const actions = document.createElement('div');
    actions.className = 'wm-camera-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wm-camera-btn wm-camera-btn-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const captureBtn = document.createElement('button');
    captureBtn.className = 'wm-camera-btn wm-camera-btn-capture';
    captureBtn.type = 'button';
    captureBtn.textContent = 'Loading…';
    captureBtn.disabled = true;

    actions.appendChild(cancelBtn);
    actions.appendChild(captureBtn);

    modal.appendChild(title);
    modal.appendChild(videoWrap);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const stopStream = () => {
      stream.getTracks().forEach(track => track.stop());
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      stopStream();
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    const fail = (err) => {
      cleanup();
      reject(err);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') cancel();
    };

    document.addEventListener('keydown', onKeyDown);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cancel();
    });

    cancelBtn.addEventListener('click', cancel);

    // Enable the capture button only once the camera feed is actually streaming.
    // Without this, videoWidth/videoHeight are 0 and we capture a blank image.
    video.addEventListener('loadedmetadata', () => {
      captureBtn.textContent = 'Capture';
      captureBtn.disabled = false;
    });

    // Fallback: if loadedmetadata already fired before listener attached (e.g. fast desktop).
    if (video.readyState >= 1 /* HAVE_METADATA */) {
      captureBtn.textContent = 'Capture';
      captureBtn.disabled = false;
    }

    captureBtn.addEventListener('click', async () => {
      const w = video.videoWidth;
      const h = video.videoHeight;

      if (!w || !h) {
        fail(new Error('Camera stream is not ready yet. Please wait a moment.'));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        fail(new Error('Could not access camera frame renderer.'));
        return;
      }

      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) {
          fail(new Error('Could not capture photo.'));
          return;
        }
        const fileName = `capture_${Date.now()}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        cleanup();
        resolve(file);
      }, 'image/jpeg', 0.92);
    });
  });
}
