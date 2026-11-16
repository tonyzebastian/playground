"use client";

import { useEffect, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import Sea from "./Sea";
import { SEA_ASPECT, SEA_CONFIG } from "./seaConfig";
import styles from "./SeaStudio.module.css";

export default function SeaStudio() {
  const [showControls, setShowControls] = useState(false);

  // The panel is hidden by default (like Frosted Glass). The controller keeps every value alive while it is hidden.
  const dial = useDialKitController("Evening Sea", SEA_CONFIG, { id: "sea" });
  const values = dial.values;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyS") {
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
        <AppHeader title="Evening Sea" />
      </div>

      <div className={`${styles.layout} ${showControls ? styles.open : ""}`}>
        <div className={styles.content}>
          <div className={styles.gallery} style={{ "--aspect": SEA_ASPECT }}>
            <section className={styles.stage} aria-label="Calm sea water at sunset, seen close through a long lens">
              <Sea values={values} />
            </section>

            <section className={styles.caption} aria-labelledby="sea-title">
              <h1 id="sea-title">Evening Sea, November 2026</h1>
              <p>
                The last light on the water at Calicut, a little way out from the shore.
                There is no sky in the picture, only the sea handing it back in pieces:
                cream, rose, slate, and now and then the sun itself.
              </p>

              <div className={styles.section}>
                <h2>Dev notes.</h2>
                <p>
                  Built in WebGL: a few dozen small waves, each moving at the speed real
                  water gives it, mirroring a painted sunset. Press{" "}
                  <span className={styles.keys}>
                    <kbd>Control</kbd> + <kbd>Option / Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>
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
