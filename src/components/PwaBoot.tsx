"use client";
import {useEffect} from 'react';
export default function PwaBoot() {
 useEffect(() => {
  const update = () => {
   const viewport = window.visualViewport;
   document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
  };
  update(); window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); };
 }, []);
 return null;
}
