"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import AppHeader from "@/components/shared/AppHeader";
import Meadow from "./Meadow";
import { DEFAULT_LOGO, MEADOW_ASPECTS, MEADOW_CONFIG } from "./meadowConfig";
import styles from "./MeadowStudio.module.css";

export default function MeadowStudio() {
  const noticeTimerRef = useRef(null);
  const logoInputRef = useRef(null);
  const textureInputRef = useRef(null);
  const objectUrlsRef = useRef({ logo: null, texture: null });
  const [showControls, setShowControls] = useState(false);
  const [notice, setNotice] = useState("");
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO);
  const [stoneUrl, setStoneUrl] = useState(null);
  const [dragging, setDragging] = useState(false);

  const showNotice = useCallback((message) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2200);
  }, []);

  // Uploaded files become object URLs; the previous one is released when it's replaced.
  const adopt = useCallback((kind, file, set) => {
    if (!file || !file.type.startsWith("image/")) {
      if (file) showNotice("That isn't an image");
      return;
    }
    if (objectUrlsRef.current[kind]) URL.revokeObjectURL(objectUrlsRef.current[kind]);
    const url = URL.createObjectURL(file);
    objectUrlsRef.current[kind] = url;
    set(url);
  }, [showNotice]);

  const clearUpload = useCallback((kind, set, fallback) => {
    if (objectUrlsRef.current[kind]) URL.revokeObjectURL(objectUrlsRef.current[kind]);
    objectUrlsRef.current[kind] = null;
    set(fallback);
  }, []);

  const handleAction = useCallback((path) => {
    if (path === "rock.uploadLogo") logoInputRef.current?.click();
    if (path === "rock.resetLogo") clearUpload("logo", setLogoUrl, DEFAULT_LOGO);
    if (path === "rock.uploadTexture") textureInputRef.current?.click();
    if (path === "rock.removeTexture") clearUpload("texture", setStoneUrl, null);
  }, [clearUpload]);

  // The panel is hidden by default (like Evening Window). The controller keeps every value alive while it is hidden.
  const dial = useDialKitController("Windy Meadow", MEADOW_CONFIG, { id: "meadow", onAction: handleAction });
  const values = dial.values;
  const aspect = MEADOW_ASPECTS[values.canvas.orientation] ?? MEADOW_ASPECTS.portrait;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyM") {
        event.preventDefault();
        setShowControls((visible) => !visible);
      } else if (event.key === "Escape") {
        setShowControls(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    Object.values(objectUrlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
  }, []);

  const onPick = (kind, set) => (e) => {
    adopt(kind, e.target.files?.[0], set);
    e.target.value = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    adopt("logo", e.dataTransfer.files?.[0], setLogoUrl);
  };

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <AppHeader title="Windy Meadow" />
      </div>

      <div className={`${styles.layout} ${showControls ? styles.open : ""}`}>
        <div className={styles.content}>
          <div className={styles.gallery} style={{ "--aspect": aspect }}>
            <section
              className={styles.stage}
              aria-label="Windy Meadow"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={logoInputRef} type="file" accept="image/*" onChange={onPick("logo", setLogoUrl)} hidden />
              <input ref={textureInputRef} type="file" accept="image/*" onChange={onPick("texture", setStoneUrl)} hidden />
              <Meadow values={values} logoUrl={logoUrl} stoneUrl={stoneUrl} onNotice={showNotice} />
              {dragging && <div className={styles.drop}>Drop an image to turn it into the rock</div>}
              {notice && <div role="status" className={styles.notice}>{notice}</div>}
            </section>

            <section className={styles.caption} aria-labelledby="windy-meadow-title">
              <h1 id="windy-meadow-title">Windy Meadow, October 2026</h1>
              <p>
                Long grass combed by travelling gusts, with small yellow flowers
                and a stone logo resting in the field.
              </p>

              <div className={styles.section}>
                <h2>Dev notes.</h2>
                <p>
                  Built with instanced WebGL grass blades, a wind field baked to a
                  texture every frame, a logo turned into a height-field boulder,
                  and a painterly Kuwahara finish. Press{" "}
                  <span className={styles.keys}>
                    <kbd>Control</kbd> + <kbd>Option / Alt</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd>
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
