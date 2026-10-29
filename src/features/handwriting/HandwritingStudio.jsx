"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import { Pause, Play, ArrowCounterClockwise } from "@phosphor-icons/react";
import AppHeader from "@/components/shared/AppHeader";
import { HandWrite } from "./engine/HandWrite";
import { fontToStrokes } from "./engine/fontToStrokes";
import { DEFAULT_TEXT, exportSettings, HANDWRITING_CONFIG, UPLOADED_FONT } from "./handwritingConfig";
import styles from "./HandwritingStudio.module.css";

const FPS = 30;
const W = 1920;
const H = 1080;
const FIRST_WORD = 6;
// Rough time for the text to leave after the exit starts.
const EXIT_FRAMES = 45;

export default function HandwritingStudio() {
  const fileRef = useRef(null);
  const stageRef = useRef(null);
  const noticeTimer = useRef(null);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [customFont, setCustomFont] = useState(null);
  const [notice, setNotice] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(0.5);

  const showNotice = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2600);
  }, []);

  // The panel's action buttons fire before this render's values are in
  // scope, so the export reads the latest state through refs.
  const latest = useRef({ text: DEFAULT_TEXT, customFont: null, values: null });

  const downloadSettings = useCallback(() => {
    const { text: current, customFont: font, values } = latest.current;
    if (!values) return;
    const settings = exportSettings(values, current, font);
    const slug =
      current
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "text";
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `handwriting-${slug}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice(`Saved handwriting-${slug}.json — render it in Motion with npm run handwriting`);
  }, [showNotice]);

  const handleAction = useCallback(
    (path) => {
      if (path === "type.uploadFont") fileRef.current?.click();
      if (path === "export.download") downloadSettings();
    },
    [downloadSettings],
  );

  const dial = useDialKitController("Handwriting", HANDWRITING_CONFIG, {
    id: "handwriting",
    onAction: handleAction,
  });
  const v = dial.values;
  latest.current = { text, customFont, values: v };

  // A dropped or picked font file is traced into pen strokes here.
  const adoptFont = useCallback(
    async (file) => {
      if (!file) return;
      if (!/\.(ttf|otf|woff)$/i.test(file.name)) {
        showNotice("Use a .ttf, .otf or .woff font file");
        return;
      }
      showNotice(`Tracing ${file.name}…`);
      try {
        // Let the notice paint before the (blocking) trace starts.
        await new Promise((r) => setTimeout(r, 30));
        const font = fontToStrokes(await file.arrayBuffer(), file.name.replace(/\.\w+$/, ""));
        setCustomFont(font);
        dial.setValue("type.font", UPLOADED_FONT);
        showNotice(`Using ${font.name}`);
      } catch (error) {
        console.error(error);
        showNotice("Couldn't read that font");
      }
    },
    [dial, showNotice],
  );

  // Lines of words, each word timed one after another.
  const lines = useMemo(() => {
    let n = 0;
    return text
      .split("\n")
      .map((line) => line.split(/\s+/).filter(Boolean))
      .filter((words) => words.length > 0)
      .map((words) => words.map((word) => ({ text: word, frame: FIRST_WORD + n++ * v.timing.wordGap })));
  }, [text, v.timing.wordGap]);

  const wordCount = lines.reduce((sum, line) => sum + line.length, 0);
  const exitFrame = FIRST_WORD + Math.max(0, wordCount - 1) * v.timing.wordGap + 20 + v.timing.hold;
  const duration = v.timing.exit === "none" ? exitFrame + 10 : exitFrame + EXIT_FRAMES;

  // Playback at 30 fps.
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      // Advance by fractions of a frame so fast pens still move smoothly on
      // high refresh-rate screens (the timeline is still in 30 fps frames).
      const step = Math.min(((now - last) / 1000) * FPS, 2);
      last = now;
      setFrame((f) => {
        const next = f + step;
        if (next < duration) return next;
        if (v.timing.loop) return 0;
        setPlaying(false);
        return duration;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, v.timing.loop]);

  // Fit the 1920×1080 stage into its box.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space" || e.target.closest("textarea, input, [contenteditable]")) return;
      e.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const restart = () => {
    setFrame(0);
    setPlaying(true);
  };

  const font = v.type.font === UPLOADED_FONT ? customFont ?? "reenieBeanie" : v.type.font;
  const size = v.type.size;
  const lineH = size * v.type.lineHeight;
  const x = v.type.align === "left" ? 160 : v.type.align === "right" ? W - 160 : W / 2;
  const top = H / 2 - ((lines.length - 1) * lineH) / 2 + size * 0.2;
  const exit = v.timing.exit === "none" ? undefined : { type: v.timing.exit, frame: exitFrame };

  return (
    <main className={styles.page}>
      <AppHeader title="Handwriting" />
      <div className={styles.layout}>
        <section className={styles.main}>
          <div
            ref={stageRef}
            className={styles.stage}
            style={{ background: v.colors.background }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              adoptFont(e.dataTransfer.files?.[0]);
            }}
          >
            <div className={styles.canvas} style={{ width: W, height: H, transform: `scale(${scale})` }}>
              {lines.map((words, i) => (
                <HandWrite
                  key={`${i}-${words.map((w) => w.text).join(" ")}`}
                  frame={frame}
                  words={words}
                  x={x}
                  y={top + i * lineH}
                  align={v.type.align}
                  size={size}
                  font={font}
                  color={v.colors.ink}
                  weight={v.type.weight > 0 ? v.type.weight : undefined}
                  speed={v.timing.speed}
                  connect={v.pen.connect}
                  wordConnect={v.pen.wordConnect}
                  lead={i === 0 ? v.pen.lead : 0}
                  leadStyle={v.pen.leadStyle}
                  tail={{ length: i === lines.length - 1 ? v.pen.tail : 0, style: v.pen.tailStyle }}
                  wiggle={v.wobble.wiggle}
                  boil={v.wobble.boil}
                  texture={v.wobble.texture}
                  exit={exit}
                  shadow={v.colors.shadow ? undefined : "drop-shadow(0 0 0 transparent)"}
                  seed={`line-${i}-v${v.pen.variation}`}
                />
              ))}
            </div>
            {notice && (
              <div role="status" className={styles.notice}>
                {notice}
              </div>
            )}
          </div>

          <div className={styles.transport}>
            <button type="button" className={styles.button} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause weight="bold" /> : <Play weight="bold" />}
            </button>
            <button type="button" className={styles.button} onClick={restart} aria-label="Restart">
              <ArrowCounterClockwise weight="bold" />
            </button>
            <input
              className={styles.scrub}
              type="range"
              min={0}
              max={duration}
              value={Math.min(frame, duration)}
              onChange={(e) => {
                setPlaying(false);
                setFrame(Number(e.target.value));
              }}
              aria-label="Timeline"
            />
            <span className={styles.time}>
              {Math.floor(Math.min(frame, duration))} / {duration}
            </span>
          </div>

          <label className={styles.textLabel}>
            <span>Text — one line per row. Words write one after another.</span>
            <textarea
              className={styles.text}
              value={text}
              rows={4}
              onChange={(e) => {
                setText(e.target.value);
                setFrame(0);
                setPlaying(true);
              }}
            />
          </label>

          <p className={styles.note}>
            Each letter is a pen path traced from a handwriting font. Pick a built-in font or drop any .ttf / .otf on the
            stage; monoline scripts trace best. Space plays and pauses. To use it in a video, press Export for video,
            then run <code>npm run handwriting -- file.json</code> in the Motion repo for a transparent ProRes .mov.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".ttf,.otf,.woff"
            hidden
            onChange={(e) => {
              adoptFont(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </section>

        <aside className={styles.panel} aria-label="Settings">
          <DialRoot mode="inline" theme="light" productionEnabled />
        </aside>
      </div>
    </main>
  );
}
