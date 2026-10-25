/**
 * Short label for a browser, e.g. "Chrome · Android", so an unnamed device can be told apart
 * in the admin list. A guess from the user agent, nothing depends on it. iPadOS asks for
 * desktop pages and reports itself as a Mac. Empty if nothing is known.
 */
export function describeUserAgent(userAgent: string | undefined): string {
  if (!userAgent) return "";
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPad|iPhone|iPod/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac/iPad"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : undefined;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /CriOS|Chrome\//.test(userAgent)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : undefined;
  if (!system && !browser) return userAgent.slice(0, 40);
  return [browser, system].filter(Boolean).join(" · ");
}

/** "::ffff:10.0.0.7" → "10.0.0.7" (IPv4 clients on a dual-stack socket). */
export function displayAddress(address: string | undefined): string {
  return (address ?? "?").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
}
