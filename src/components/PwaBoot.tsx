"use client";
import { useEffect } from "react";
export default function PwaBoot() {
  useEffect(() => {
    const update = () => {
      const viewport = window.visualViewport;
      // Keyboard/browser bars resize the visual viewport at scale 1. Pinch zoom
      // must not collapse the underlying app layout or fight accessibility zoom.
      const height =
        viewport && Math.abs(viewport.scale - 1) < 0.01
          ? viewport.height
          : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      document.documentElement.dataset.shortViewport =
        height < 320 ? "true" : "false";
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    if ("serviceWorker" in navigator && window.isSecureContext)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  return null;
}
