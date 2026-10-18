/** Still image of the current video frame with a caption strip below the picture. */

const FOOTER_BG = "#0b0f14";
const FOOTER_TEXT = "#e8edf2";
const FOOTER_MUTED = "#8b98a5";
const BRAND = "Drone Live Stream Hub";
const JPEG_QUALITY = 0.92;

/**
 * Draws the current frame at its native resolution and appends a footer (the picture itself
 * stays uncovered). Throws if no frame is available yet.
 */
export function captureSnapshot(video: HTMLVideoElement, caption: string): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.reject(new Error("no video frame available"));
  }
  const footer = Math.max(28, Math.round(height * 0.05));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + footer;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas not available"));

  ctx.drawImage(video, 0, 0, width, height);
  ctx.fillStyle = FOOTER_BG;
  ctx.fillRect(0, height, width, footer);

  const padding = Math.round(footer * 0.4);
  let size = Math.round(footer * 0.5);
  const font = (px: number, weight: number) => `${weight} ${px}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  const y = height + footer / 2;

  // Shrink the caption until it fits (narrow thermal images); the brand only if there is room.
  ctx.font = font(size, 600);
  while (size > 10 && ctx.measureText(caption).width > width - 2 * padding) {
    size -= 1;
    ctx.font = font(size, 600);
  }
  const captionWidth = ctx.measureText(caption).width;
  ctx.fillStyle = FOOTER_TEXT;
  ctx.textAlign = "left";
  ctx.fillText(caption, padding, y, width - 2 * padding);

  ctx.font = font(size, 400);
  if (captionWidth + ctx.measureText(BRAND).width + 3 * padding <= width) {
    ctx.fillStyle = FOOTER_MUTED;
    ctx.textAlign = "right";
    ctx.fillText(BRAND, width - padding, y);
  }

  // JPEG, not PNG: a lossless PNG of a decoded H.264 frame is ~4 MB at 1080p and only preserves
  // the stream's own compression artefacts; JPEG at 0.92 looks the same at a fraction of the size.
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
