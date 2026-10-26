"use client";

import { useSyncExternalStore } from "react";

export type WebGLSupport = "unknown" | "yes" | "no";

let cached: WebGLSupport | null = null;

function detect(): WebGLSupport {
  if (cached) return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    cached = gl ? "yes" : "no";
    // release the probe context immediately
    const lose = gl?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  } catch {
    cached = "no";
  }
  return cached;
}

const subscribe = () => () => {};

/** "unknown" during prerender / first hydration pass, then "yes" | "no". */
export function useWebGLSupport(): WebGLSupport {
  return useSyncExternalStore(subscribe, detect, () => "unknown");
}

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
