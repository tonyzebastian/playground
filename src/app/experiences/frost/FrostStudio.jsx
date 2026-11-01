"use client";

import { useEffect, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import Frost from "./Frost";
import { FROST_ASPECT, FROST_CONFIG } from "./frostConfig";
import styles from "./FrostStudio.module.css";

export default function FrostStudio() {
  const [showControls, setShowControls] = useState(false);

  // The panel is hidden by default (like Evening Window). The controller keeps every value alive while it is hidden.
  const dial = useDialKitController("Frosted Glass", FROST_CONFIG, { id: "frost" });
  const values = dial.values;

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
          <div className={styles.gallery} style={{ "--aspect": FROST_ASPECT }}>
            <section className={styles.stage} aria-label="A night street seen from a skywalk through a rainy window">
              <Frost values={values} />
            </section>

            <section className={styles.caption} aria-labelledby="frost-title">
              <h1 id="frost-title">Frosted Glass, November 2026</h1>
              <p>
                A wet night, seen through a fogged window on a skywalk above the road.
                Cars stop for the light below, and every drop on the glass holds its own
                small upside-down street.
              </p>

              <div className={styles.section}>
                <h2>Dev notes.</h2>
                <p>
                  Built in WebGL: a blurred street of lights behind fogged glass and
                  drops. Press{" "}
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
