'use client';
import { useEffect } from 'react';
export default function PwaBoot() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Keyboard/browser bars resize the visual viewport at scale 1. Pinch zoom
      // must not collapse the underlying app layout or fight accessibility zoom.
      const followsViewport = viewport && Math.abs(viewport.scale - 1) < 0.01;
      const height = followsViewport && viewport.height > 0 ? viewport.height : window.innerHeight;
      // A keyboard can pan the visual viewport without resizing it. Keep the
      // compact shell in that visible area rather than at layout-viewport top.
      const top = followsViewport ? Math.max(0, viewport.offsetTop) : 0;
      root.style.setProperty('--app-height', `${height}px`);
      root.style.setProperty('--app-offset-top', `${top}px`);
      root.dataset.shortViewport = height < 320 ? 'true' : 'false';
    };
    const scheduleUpdate = () => {
      // Read the final height and offset together after resize/scroll bursts.
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('scroll', scheduleUpdate);
    if ('serviceWorker' in navigator && window.isSecureContext)
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, []);
  return null;
}
