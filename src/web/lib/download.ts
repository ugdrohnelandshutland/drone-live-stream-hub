/** Saves a blob as a file (desktop: download folder; iPad/Android: download prompt). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
