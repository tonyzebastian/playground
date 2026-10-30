'use client';

import { useEffect, useRef } from 'react';
import { createFrameLoop } from '@/lib/frame-loop';

// Soft, layered sound waves that follow the microphone level while listening.
// `level` is a ref (0–1) updated by the audio callback, so the wave can move
// every frame without re-rendering React.
const LINES = [
  { speed: 1.6, freq: 1.4, phase: 0, alpha: 0.95, width: 1.6 },
  { speed: -1.1, freq: 2.1, phase: 1.7, alpha: 0.45, width: 1.2 },
  { speed: 2.3, freq: 0.9, phase: 3.1, alpha: 0.3, width: 1 },
];

export default function ListeningWave({ level, active, waiting }) {
  const canvas = useRef(null);
  const state = useRef({ active, waiting });
  state.current.active = active;
  state.current.waiting = waiting;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const context = element.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let time = 0, amplitude = 0, presence = 0;

    return createFrameLoop(element, dt => {
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth, height = element.clientHeight;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      const { active: on, waiting: hold } = state.current;
      // A quiet "breathing" wave while listening, swelling with each pluck.
      // Square root so soft plucks still show clearly.
      const target = on ? 0.08 + Math.sqrt(Math.min(1, level.current)) * 0.92 : hold ? 0.05 : 0;
      amplitude += (target - amplitude) * Math.min(1, dt * (target > amplitude ? 18 : 3.5));
      presence += ((on || hold ? 1 : 0) - presence) * Math.min(1, dt * 4);
      if (!reduced) time += dt;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const mid = height / 2;
      // Resting line, always visible so the strip never jumps in and out.
      context.strokeStyle = 'rgba(132,148,119,.28)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, mid);
      context.lineTo(width, mid);
      context.stroke();
      if (presence < 0.01) return;

      const steps = Math.max(48, Math.round(width / 4));
      for (const line of LINES) {
        context.strokeStyle = `rgba(101,122,87,${line.alpha * presence})`;
        context.lineWidth = line.width;
        context.beginPath();
        for (let i = 0; i <= steps; i++) {
          const x = i / steps;
          // Taper both ends so the wave rises from the centre of the strip.
          const envelope = Math.sin(Math.PI * x) ** 2;
          const wave = Math.sin(x * Math.PI * 2 * line.freq * 2 + time * line.speed * 3 + line.phase);
          const y = mid + wave * envelope * amplitude * (mid - 3);
          if (i) context.lineTo(x * width, y); else context.moveTo(0, y);
        }
        context.stroke();
      }
    });
  }, [level]);

  return <canvas ref={canvas} className="kalimba-listening-wave" aria-hidden="true" />;
}
