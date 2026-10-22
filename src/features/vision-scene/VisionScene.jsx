"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useInView, cubicBezier } from "motion/react";
import { PHASE_FADE_END, PHASE_HOLD_END, VisionRenderer } from "./renderer";
const RESOLVED_FRAME_TIME = 9.6;
const LOGO_FADE_START = 4.6;
const LOGO_FADE_END = 5.6;
const LOGO_OPACITY_THRESHOLD = 0.02;
const easeInOutCubic = cubicBezier(0.65, 0, 0.35, 1);
function useMatchMedia(query) {
    const subscribe = useMemo(() => (cb) => {
        const mq = window.matchMedia(query);
        mq.addEventListener("change", cb);
        return () => mq.removeEventListener("change", cb);
    }, [query]);
    const getSnapshot = useMemo(() => () => window.matchMedia(query).matches, [query]);
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
export function VisionScene({ className }) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const rendererRef = useRef(null);
    const lastLogoOpacityRef = useRef(0);
    const [logoOpacity, setLogoOpacity] = useState(0);
    const [sceneOpacity, setSceneOpacity] = useState(1);
    const [mounted, setMounted] = useState(false);
    // Input capability rather than width, so it still runs inside the home split panel.
    const hasFinePointer = useMatchMedia("(hover: hover) and (pointer: fine)");
    const reduced = useMatchMedia("(prefers-reduced-motion: reduce)");
    const inView = useInView(containerRef, { amount: 0.3, once: false });
    const webglSupported = useMemo(() => {
        if (typeof window === "undefined")
            return true;
        try {
            const test = document.createElement("canvas");
            return !!test.getContext("webgl2");
        }
        catch {
            return false;
        }
    }, []);
    const shouldMountCanvas = mounted && hasFinePointer && webglSupported;
    useEffect(() => {
        setMounted(true);
    }, []);
    useEffect(() => {
        if (!shouldMountCanvas)
            return;
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        let renderer;
        try {
            renderer = new VisionRenderer(canvas);
        }
        catch (error) {
            console.error("Vision scene could not initialize", error);
            return;
        }
        rendererRef.current = renderer;
        renderer.onProgress = (t) => {
            const k = Math.min(1, Math.max(0, (t - LOGO_FADE_START) / (LOGO_FADE_END - LOGO_FADE_START)));
            const next = easeInOutCubic(k);
            if (Math.abs(next - lastLogoOpacityRef.current) >= LOGO_OPACITY_THRESHOLD || next === 0 || next === 1) {
                lastLogoOpacityRef.current = next;
                setLogoOpacity(next);
            }
            // Loop cycle: hold at resolved state → fade scene out → reset to t=0.
            // CSS opacity on the wrapper does the visible fade; the rise phase at
            // t=0 starts from a flat dot grid so the snap-back to opacity 1 reads
            // as nothing happening for a frame, then mountains begin building.
            if (t >= PHASE_FADE_END) {
                renderer.resetTime();
                lastLogoOpacityRef.current = 0;
                setLogoOpacity(0);
                setSceneOpacity(1);
            }
            else if (t >= PHASE_HOLD_END) {
                setSceneOpacity(0);
            }
            else {
                setSceneOpacity(1);
            }
        };
        requestAnimationFrame(() => renderer.renderStaticAt(reduced ? RESOLVED_FRAME_TIME : 2.8));
        return () => {
            renderer.dispose();
            rendererRef.current = null;
        };
    }, [shouldMountCanvas, reduced]);
    useEffect(() => {
        const renderer = rendererRef.current;
        if (!renderer || reduced)
            return;
        if (inView)
            renderer.start();
        else
            renderer.stop();
    }, [inView, reduced]);
    return (<div ref={containerRef} aria-hidden className={"block h-full w-full " + (className ?? "")}>
      {shouldMountCanvas ? (<div className="relative h-full w-full">
          <div className="absolute inset-0 transition-opacity duration-700 ease-out" style={{ opacity: sceneOpacity }}>
            <canvas ref={canvasRef} className="block h-full w-full"/>
            <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[13.5%] rounded-[20%] shadow-[0_8px_14px_rgba(255,93,57,0.10)]" style={{
                opacity: logoOpacity,
                transform: `translate(-50%, -50%) scale(${0.78 + logoOpacity * 0.22})`,
            }}>
              <img src="/vision-scene/Sundial_logo.png" alt="" className="h-full w-full" />
            </div>
          </div>
        </div>) : null}
    </div>);
}
export default VisionScene;
