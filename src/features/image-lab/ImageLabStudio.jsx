'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialRoot, useDialKitController } from 'dialkit';
import BrushPainterCanvas from './BrushPainterCanvas';
import ImageLabCanvas from './ImageLabCanvas';
import {
  IMAGE_LAB_ASPECTS,
  IMAGE_LAB_CONFIG,
  IMAGE_LAB_PALETTES,
  IMAGE_LAB_SAMPLES,
} from './imageLabConfig';

export default function ImageLabStudio() {
  const canvasApiRef = useRef(null);
  const dialRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadedUrlRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const previousPresetRef = useRef('rose');
  const previousSampleRef = useRef('mosaic');
  const [imageUrl, setImageUrl] = useState(IMAGE_LAB_SAMPLES.mosaic.src);
  const [hasCustomImage, setHasCustomImage] = useState(false);
  const [rendererError, setRendererError] = useState('');
  const [notice, setNotice] = useState('');

  const showNotice = useCallback((message) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 2200);
  }, []);

  const useSample = useCallback((sampleName) => {
    const sample = IMAGE_LAB_SAMPLES[sampleName] || IMAGE_LAB_SAMPLES.mosaic;
    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current);
      uploadedUrlRef.current = null;
    }
    setImageUrl(sample.src);
    setHasCustomImage(false);
    setRendererError('');
  }, []);

  const removePhoto = useCallback(() => {
    const sampleName = dialRef.current?.getValues().image.sample || 'mosaic';
    useSample(sampleName);
  }, [useSample]);

  const handleUpload = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    uploadedUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
    setHasCustomImage(true);
    setRendererError('');
    event.target.value = '';
  }, []);

  const handleDialAction = useCallback((path) => {
    if (path === 'image.chooseImage') fileInputRef.current?.click();
    if (path === 'image.removePhoto') removePhoto();
  }, [removePhoto]);

  const handleDownload = useCallback(async () => {
    const downloaded = await canvasApiRef.current?.download();
    showNotice(downloaded ? 'PNG download started' : 'Preview is still loading');
  }, [showNotice]);

  const handleReset = useCallback(() => {
    dialRef.current?.resetValues();
    showNotice('Settings reset');
  }, [showNotice]);

  const dialConfig = useMemo(() => ({
    ...IMAGE_LAB_CONFIG,
    image: hasCustomImage
      ? {
        sample: IMAGE_LAB_CONFIG.image.sample,
        removePhoto: { type: 'action', label: 'Remove photo' },
        chooseImage: IMAGE_LAB_CONFIG.image.chooseImage,
      }
      : IMAGE_LAB_CONFIG.image,
  }), [hasCustomImage]);

  const dial = useDialKitController('Mosaic Image Lab', dialConfig, {
    id: 'image-lab',
    onAction: handleDialAction,
  });
  dialRef.current = dial;
  const values = dial.values;

  useEffect(() => {
    const sampleName = values.image.sample;
    if (sampleName !== previousSampleRef.current) {
      previousSampleRef.current = sampleName;
      useSample(sampleName);
      dial.setValues({
        output: {
          aspect: IMAGE_LAB_SAMPLES[sampleName]?.aspect || 'landscape',
        },
      });
    }
  }, [dial, useSample, values.image.sample]);

  useEffect(() => {
    const presetName = values.palette.preset;
    if (presetName === previousPresetRef.current) return;
    previousPresetRef.current = presetName;
    const preset = IMAGE_LAB_PALETTES[presetName];
    if (!preset) return;
    dial.setValues({
      palette: {
        inkOne: preset.colors[0],
        inkTwo: preset.colors[1],
        inkThree: preset.colors[2],
        inkFour: preset.colors[3],
      },
    });
  }, [dial, values.palette.preset]);

  useEffect(() => () => {
    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  return (
    <div className="mx-auto h-[calc(100dvh-56px)] w-full max-w-[1500px] overflow-hidden px-4 pb-4 sm:px-6">
      <div className="grid h-full min-h-0 grid-rows-[minmax(180px,42%)_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section
          className="relative grid min-h-0 min-w-0 place-items-center overflow-hidden"
          style={{ containerType: 'size' }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} hidden />

          {notice && (
            <div
              role="status"
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              {notice}
            </div>
          )}

          <div
            className="relative overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm"
            style={{
              aspectRatio: IMAGE_LAB_ASPECTS[values.output.aspect],
              width: `min(100cqw, calc(100cqh * ${IMAGE_LAB_ASPECTS[values.output.aspect]}))`,
            }}
          >
            {values.brush.enabled ? (
              <BrushPainterCanvas
                ref={canvasApiRef}
                imageUrl={imageUrl}
                values={values}
                aspectRatio={IMAGE_LAB_ASPECTS[values.output.aspect]}
                onError={setRendererError}
              />
            ) : (
              <ImageLabCanvas
                ref={canvasApiRef}
                imageUrl={imageUrl}
                values={values}
                aspectRatio={IMAGE_LAB_ASPECTS[values.output.aspect]}
                onError={setRendererError}
              />
            )}
            {rendererError && (
              <div className="absolute inset-0 grid place-items-center bg-slate-950 p-8 text-center text-sm text-white">
                {rendererError}
              </div>
            )}
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
              onClick={handleDownload}
            >
              Download PNG
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
