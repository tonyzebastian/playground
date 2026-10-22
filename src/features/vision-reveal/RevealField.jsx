"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useInView, useScroll } from "motion/react";
import { REVEAL_DEFAULTS, RevealRenderer } from "./reveal-renderer";

const SCROLL_ORBIT = true;
const ORBIT_START_AT = 0.5;
const REVEAL_IMAGE = "/vision-reveal/vision_02.png";

function useMatchMedia(query) {
  const subscribe = useMemo(
    () => (callback) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", callback);
      return () => mediaQuery.removeEventListener("change", callback);
    },
    [query],
  );
  const getSnapshot = useMemo(() => () => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function RevealField({ children, className }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);

  const hasHover = useMatchMedia("(hover: hover) and (pointer: fine)");
  const reduced = useMatchMedia("(prefers-reduced-motion: reduce)");
  const inView = useInView(containerRef, { amount: 0.2, once: false });
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end 0.9"],
  });

  const webgl2Supported = useMemo(() => {
    if (typeof window === "undefined") return true;
    try {
      return Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      return false;
    }
  }, []);

  // Gate on input capability, not viewport width: this page also renders inside
  // the home split panel, where the iframe is narrower than 1024px on desktop.
  const canvasActive = hasHover && webgl2Supported && !reduced;

  useEffect(() => {
    if (!canvasActive || !canvasRef.current) return undefined;
    let renderer;
    try {
      renderer = new RevealRenderer(canvasRef.current, { ...REVEAL_DEFAULTS }, REVEAL_IMAGE);
    } catch {
      return undefined;
    }
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [canvasActive]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (inView) renderer.start();
    else renderer.stop();
  }, [inView, canvasActive]);

  useEffect(() => {
    if (!canvasActive || !SCROLL_ORBIT) return undefined;
    const apply = (progress) => {
      const phase = (progress - ORBIT_START_AT) / (1 - ORBIT_START_AT);
      rendererRef.current?.setPhase(Math.max(0, Math.min(1, phase)));
    };
    apply(scrollYProgress.get());
    return scrollYProgress.on("change", apply);
  }, [canvasActive, scrollYProgress]);

  const handlePointerMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    rendererRef.current?.setMouse(event.clientX - bounds.left, event.clientY - bounds.top, true);
  };

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-white ${className ?? ""}`}>
      {canvasActive ? (
        <canvas
          ref={canvasRef}
          aria-hidden
          onPointerMove={handlePointerMove}
          onPointerLeave={() => rendererRef.current?.setMouse(0, 0, false)}
          className="absolute inset-0 block h-full w-full"
        />
      ) : null}
      <div className="pointer-events-none relative z-10 flex h-full flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
