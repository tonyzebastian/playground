'use client';
import { useEffect, useRef } from 'react';
import { createSvgScene, view } from './svg3d';
import { createTurtle } from './turtleModel';

// A cartoon sea turtle drawn as pure SVG: every frame the model is rotated, projected and
// shaded in JS (see svg3d.js) and written straight into <path> elements. `showHint` marks the
// full page: it turns on drag-to-rotate, the hint pill and the hand-drawn wobble. Without it
// (a small preview) the turtle just turns slowly.

const BACKGROUND = '#ffffff';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function Turtle({ showHint = false }) {
  const rootRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    if (!root || !svg) return undefined;

    const turtle = createTurtle();
    const scene = createSvgScene(svg, turtle.parts, { ground: turtle.ground, hand: showHint });
    const s = { yaw: 0.5, pitch: 0.28, vyaw: 0, vpitch: 0, auto: true, drag: null };

    let raf = 0;
    let last = 0;
    let visible = true;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      if (s.auto) {
        s.yaw += dt * (showHint ? 0.35 : 0.6);
      } else if (!s.drag) {
        s.yaw += s.vyaw;
        s.pitch = clamp(s.pitch + s.vpitch, -0.7, 1.25);
        s.vyaw *= 0.94;
        s.vpitch *= 0.94;
      }
      turtle.update(now / 1000);
      scene.render(view(s.pitch, s.yaw, turtle.pivot));
    };
    const start = () => {
      if (!raf && visible) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(root);

    const down = (e) => {
      s.auto = false;
      s.drag = { x: e.clientX, y: e.clientY };
      s.vyaw = 0;
      s.vpitch = 0;
      svg.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!s.drag) return;
      const dx = e.clientX - s.drag.x;
      const dy = e.clientY - s.drag.y;
      s.drag = { x: e.clientX, y: e.clientY };
      s.yaw += dx * 0.009;
      s.pitch = clamp(s.pitch + dy * 0.006, -0.7, 1.25);
      s.vyaw = dx * 0.009;
      s.vpitch = dy * 0.006;
    };
    const up = () => {
      s.drag = null;
    };
    if (showHint) {
      svg.addEventListener('pointerdown', down);
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    }
    start();

    return () => {
      stop();
      io.disconnect();
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
      scene.destroy();
    };
  }, [showHint]);

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full select-none overflow-hidden"
      style={{ background: BACKGROUND }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1000 670"
        preserveAspectRatio="xMidYMid meet"
        className={`absolute inset-0 h-full w-full ${showHint ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
        style={{ touchAction: showHint ? 'none' : 'auto' }}
        role="img"
        aria-label="A happy cartoon sea turtle swimming, rotatable in 3D"
      />
      {showHint && (
        <p className="pointer-events-none absolute right-4 top-14 z-40 rounded-full bg-black/25 px-3 py-1.5 text-[11px] font-medium tracking-widest text-white backdrop-blur-sm sm:right-6 sm:top-4">
          DRAG TO ROTATE
        </p>
      )}
    </div>
  );
}
