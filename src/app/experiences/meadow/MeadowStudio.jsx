"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DialRoot, useDialKitController } from "dialkit";
import Meadow from "./Meadow";
import { MEADOW_ASPECTS, MEADOW_CONFIG } from "./meadowConfig";

export default function MeadowStudio() {
  const meadowRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const [notice, setNotice] = useState("");

  const dial = useDialKitController("Windy Meadow", MEADOW_CONFIG, { id: "meadow" });
  const values = dial.values;
  const aspect = MEADOW_ASPECTS[values.canvas.orientation] ?? MEADOW_ASPECTS.portrait;

  const showNotice = useCallback((message) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2200);
  }, []);

  const handleReset = useCallback(() => {
    dial.resetValues();
    showNotice("Settings reset");
  }, [dial, showNotice]);

  const handleSave = useCallback(async () => {
    const blob = await meadowRef.current?.snapshot();
    if (!blob) {
      showNotice("Could not capture the frame");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "windy-meadow.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice("PNG download started");
  }, [showNotice]);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  return (
    <div className="mx-auto h-[calc(100dvh-56px)] w-full max-w-[1500px] overflow-hidden px-4 pb-24 sm:px-6">
      <div className="grid h-full min-h-0 grid-rows-[minmax(220px,52%)_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="relative grid min-h-0 min-w-0 place-items-center overflow-hidden" style={{ containerType: "size" }}>
          {notice && (
            <div
              role="status"
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              {notice}
            </div>
          )}
          <div
            className="relative overflow-hidden rounded-lg border border-black/10 bg-[#0a240a] shadow-sm"
            style={{ aspectRatio: aspect, width: `min(100cqw, calc(100cqh * ${aspect}))` }}
          >
            <Meadow ref={meadowRef} values={values} />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex gap-2 border-b border-slate-200 p-3">
            <button
              type="button"
              className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              onClick={handleReset}
            >
              Reset
            </button>
            <button
              type="button"
              className="flex-1 rounded-md bg-slate-950 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              onClick={handleSave}
            >
              Save PNG
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <DialRoot mode="inline" theme="light" productionEnabled />
          </div>
        </aside>
      </div>
    </div>
  );
}
