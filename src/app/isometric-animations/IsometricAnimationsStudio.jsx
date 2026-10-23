"use client";

import { useCallback, useEffect, useRef } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import { ISOMETRIC_ANIMATIONS, ISOMETRIC_ANIMATIONS_CONFIG } from "./isometricAnimationsConfig";
import styles from "./IsometricAnimationsStudio.module.css";

export default function IsometricAnimationsStudio() {
  const frames = useRef({});

  // Minimal scrollbar for the page (it also shows inside the gallery's side panel).
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollbarWidth = "thin";
    root.style.scrollbarColor = "rgb(15 23 42 / 0.2) transparent";
    return () => { root.style.scrollbarWidth = ""; root.style.scrollbarColor = ""; };
  }, []);

  const send = useCallback((message) => {
    Object.values(frames.current).forEach((frame) => frame?.contentWindow?.postMessage({ type: "figure-controls", ...message }, "*"));
  }, []);

  const dial = useDialKitController("Isometric Animations", ISOMETRIC_ANIMATIONS_CONFIG, {
    id: "isometric-animations",
    onAction: (path) => { if (path === "playback.restart") send({ restart: true }); },
  });
  const { playback, look } = dial.values;

  const state = { paused: !playback.playing, speed: playback.speed, wobble: look.wobble, pal: look.colour };
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { send(state); }, [send, playback.playing, playback.speed, look.wobble, look.colour]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <AppHeader title="Isometric Animations" />
      </div>

      <div className={styles.list}>
        {ISOMETRIC_ANIMATIONS.map((item, i) => (
          <section key={item.id} className={styles.item} aria-labelledby={`${item.id}-title`}>
            <div className={styles.frame} style={{ aspectRatio: item.aspect }}>
              <iframe
                ref={(el) => { frames.current[item.id] = el; }}
                src={`${item.src}?embed=1`}
                title={item.title}
                loading="lazy"
                onLoad={() => send(stateRef.current)}
              />
            </div>
            <h2 id={`${item.id}-title`} className={styles.title}>{String(i + 1).padStart(2, "0")} - {item.title}</h2>
          </section>
        ))}
      </div>

      <DialRoot theme="light" defaultOpen={false} productionEnabled />
    </main>
  );
}
