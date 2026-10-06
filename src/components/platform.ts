// Layout follows available space and touch input, rather than a browser name.
export const COMPACT_VIEWPORT =
  "(max-width: 799px), (max-width: 1000px) and (max-height: 500px) and (pointer: coarse)";
export function isCompactViewport() {
  return window.matchMedia(COMPACT_VIEWPORT).matches;
}
export type InstallPlatform =
  | "ios-safari"
  | "ios-other"
  | "android"
  | "mac-safari"
  | "desktop";
export function installPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios)
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
      ? "ios-safari"
      : "ios-other";
  if (/Android/.test(ua)) return "android";
  if (
    /Macintosh/.test(ua) &&
    /Safari/.test(ua) &&
    !/Chrome|Chromium|Edg/.test(ua)
  )
    return "mac-safari";
  return "desktop";
}
export function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
