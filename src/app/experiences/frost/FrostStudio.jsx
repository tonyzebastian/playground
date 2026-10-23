"use client";

import { useEffect, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import Frost from "./Frost";
import { FROST_ASPECTS, FROST_CONFIG } from "./frostConfig";
import styles from "./FrostStudio.module.css";

export default function FrostStudio() {
  const [showControls, setShowControls] = useState(false);

  // The panel is hidden by default (like Evening Window). The controller keeps every value alive while it is hidden.
  const dial = useDialKitController("Frosted Glass", FROST_CONFIG, { id: "frost" });
  const values = dial.values;
  const aspect = FROST_ASPECTS[values.canvas.format] ?? FROST_ASPECTS.portrait;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyF") {
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
      <div className={styles.header}>
        <AppHeader title="Frosted Glass" />
      </div>

      <div className={`${styles.layout} ${showControls ? styles.open : ""}`}>
        <div className={styles.content}>
          <div className={styles.gallery} style={{ "--aspect": aspect }}>
            <section className={styles.stage} aria-label="Plants moving behind frosted glass">
              <Frost values={values} />
            </section>

            <section className={styles.caption} aria-labelledby="frost-title">
              <h1 id="frost-title">Frosted Glass, October 2026</h1>
              <p>
                Bamboo sways in a slow breeze on the far side of a pane of frosted
                glass.
              </p>

              <div className={styles.section}>
                <h2>Dev notes.</h2>
                <p>
                  Built with three WebGL depth layers of procedural stems and
                  leaves, each blurred by its own distance from the glass, then
                  warped by a frost refraction, fogged, and finished with film
                  grain. Press{" "}
                  <span className={styles.keys}>
                    <kbd>Control</kbd> + <kbd>Option / Alt</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>
                  </span>{" "}
                  to show or hide the settings.
                </p>
              </div>
            </section>
          </div>
        </div>

        <aside className={styles.panel} aria-label="Settings" aria-hidden={!showControls}>
          <div className={styles.panelScroll}>
            {showControls && <DialRoot mode="inline" theme="light" productionEnabled />}
          </div>
        </aside>
      </div>
    </main>
  );
}
