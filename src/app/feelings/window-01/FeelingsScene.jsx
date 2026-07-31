"use client";

import { useEffect, useRef, useState } from "react";
import { DialRoot, DialStore, useDialKit } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import WebGLBackground from "./WebGLBackground";
import WallBackground from "./WallBackground";
import styles from "./FeelingsScene.module.css";

export default function FeelingsScene() {
  const [showControls, setShowControls] = useState(false);
  const windAudioRef = useRef(null);
  const controls = useDialKit(
    "Window 01 — art direction",
    {
      master: {
        enabled: true,
        artworkOpacity: [1, 0, 1, .01],
        projectionScale: [1.4, .5, 2, .01],
      },
      light: {
        _collapsed: false,
        enabled: true,
        intensity: [2.4, 0, 2.4, .01],
        coreDefinition: [1, 0, 1, .01],
        coreFeather: [6.85, 0, 8, .05],
        warmth: [.38, 0, 1.5, .01],
        textureRelief: [2, 0, 2, .01],
      },
      shadows: {
        _collapsed: true,
        branches: [.5, 0, 1, .01],
        branchCoreFeather: [4.65, 0, 8, .05],
        leavesBehind: [.85, 0, 1, .01],
        leavesInFront: [.7, 0, 1, .01],
        leafCoreFeather: [5.75, 0, 8, .05],
        secondShadow: true,
        secondShadowOpacity: [.39, 0, .6, .01],
        secondShadowPanels: true,
        secondShadowPanelOpacity: [.3, 0, .6, .01],
        secondShadowX: [8, -30, 30, 1],
        secondShadowY: [-10, -30, 30, 1],
      },
      wall: {
        _collapsed: true,
        exposure: [.91, .35, 1.25, .01],
        texture: [2, 0, 2, .01],
        pores: [1.57, 0, 2, .01],
        roomVariation: [.67, 0, 2, .01],
        cornerShadow: [2, 0, 2, .01],
        wallWarmth: [.20, 0, 1.5, .01],
      },
      ambientCanopy: {
        _collapsed: true,
        enabled: true,
        intensity: [1, 0, 1, .01],
        movement: [1, 0, 1, .01],
        scale: [.59, .5, 2.5, .01],
        horizontalSpread: [1.5, .15, 1.5, .01],
        verticalReach: [1, .12, 1, .01],
        softness: [1, 0, 1, .01],
      },
      reflectedFlecks: {
        _collapsed: true,
        enabled: true,
        intensity: [.5, 0, 1, .01],
        movement: [.59, 0, 1, .01],
        size: [1.1, .5, 2, .01],
        spread: [.69, 0, 1, .01],
      },
      postProduction: {
        _collapsed: true,
        kuwahara: true,
        kuwaharaStrength: [3, 0, 3, .01],
        grain: [3, 0, 3, .01],
        warmWash: [3, 0, 3, .01],
      },
      animation: {
        _collapsed: true,
        enabled: true,
        branchSway: [2, 0, 2, .01],
        lightDrift: [.98, 0, 2, .01],
      },
      sound: {
        _collapsed: true,
        muted: false,
        volume: [.18, 0, 1, .01],
      },
    },
    // Adds the reflected-light layer while retaining the approved branch rig.
    { id: "window-01-art-direction-v10", persist: true }
  );

  // Stable DialKit ids intentionally keep a panel alive during Fast Refresh.
  // Remove the superseded schemas so retired sliders cannot remain selectable
  // beside the current art-direction controls.
  useEffect(() => {
    DialStore.unregisterPanel("window-01-art-direction-v2");
    DialStore.unregisterPanel("window-01-art-direction-v3");
    DialStore.unregisterPanel("window-01-art-direction-v4");
    DialStore.unregisterPanel("window-01-art-direction-v5");
    DialStore.unregisterPanel("window-01-art-direction-v6");
    DialStore.unregisterPanel("window-01-art-direction-v7");
    DialStore.unregisterPanel("window-01-art-direction-v8");
    DialStore.unregisterPanel("window-01-art-direction-v9");
  }, []);

  useEffect(() => {
    const windAudio = windAudioRef.current;
    if (!windAudio) return;

    windAudio.muted = controls.sound.muted;
    windAudio.volume = controls.sound.volume;
  }, [controls.sound.muted, controls.sound.volume]);

  useEffect(() => {
    const beginWind = () => {
      const windAudio = windAudioRef.current;
      if (!windAudio) return;

      windAudio.play().catch(() => {
        // A browser may still reject playback; a later interaction retries it.
      });
    };

    window.addEventListener("pointerdown", beginWind, { once: true });
    window.addEventListener("keydown", beginWind, { once: true });

    return () => {
      window.removeEventListener("pointerdown", beginWind);
      window.removeEventListener("keydown", beginWind);
      windAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const togglesControls = (
        event.ctrlKey
        && event.altKey
        && event.shiftKey
        && event.code === "KeyW"
      );

      if (togglesControls) {
        event.preventDefault();
        setShowControls((visible) => !visible);
      } else if (event.key === "Escape") {
        setShowControls(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className={styles.page}>
      <audio
        ref={windAudioRef}
        src="/feelings/window%2001/wind.mp3"
        loop
        preload="metadata"
      />
      <div className={styles.header}>
        <AppHeader title="Evening Window" />
      </div>

      <div className={styles.gallery}>
        <section className={styles.stage} aria-label="Evening Window shadow study">
          <WallBackground
            controls={controls.wall}
            canopyControls={controls.ambientCanopy}
            reflectedFlecksControls={controls.reflectedFlecks}
          />
          <div className={styles.artworkColumn}>
            <div
              className={styles.artwork}
              style={{
                opacity: controls.master.enabled ? controls.master.artworkOpacity : 0,
                transform: `scale(${controls.master.projectionScale})`,
              }}
            >
              <WebGLBackground controls={controls} />
            </div>
          </div>
        </section>
        <section className={styles.caption} aria-labelledby="evening-window-title">
          <h1 id="evening-window-title">Evening Window, July 2026</h1>
          <p>
            Late light drifts across a quiet wall, carrying the soft movement
            of leaves beyond the window.
          </p>
          <div className={styles.devNotes}>
            <h2>Dev notes.</h2>
            <p>
              Built with layered WebGL materials, animated shadow masks, and a
              restrained Kuwahara finish.
            </p>
          </div>
        </section>
      </div>
      {showControls && <DialRoot productionEnabled position="top-right" />}
    </main>
  );
}
