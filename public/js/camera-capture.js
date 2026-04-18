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
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });

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
    captureBtn.textContent = 'Capture';

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

    captureBtn.addEventListener('click', async () => {
      const w = Math.max(1, video.videoWidth || 1280);
      const h = Math.max(1, video.videoHeight || 720);
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
