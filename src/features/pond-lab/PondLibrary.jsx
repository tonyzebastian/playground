"use client";

import AppHeader from "@/components/shared/AppHeader";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { PondCanvas, waterFragmentShader } from "./PondShaderGallery";

const entries = [
  ["water", "WebGL shader", "Seascape water", "Five rotated sea octaves become a height field; normals provide water colour, Fresnel and specular light.", "waterFragmentShader"],
  ["ripple", "WebGL shader", "Slope-aware ripples", "Twelve pixel-position ripple uniforms warp with the water gradient and decay after four seconds.", "u_ripples"],
  ["texture", "2D canvas", "Paper overlay", "A one-off grain and warm edge treatment. Regenerate only after resizing.", "drawTexture"],
  ["reeds", "2D canvas", "Reed canopy", "Fine, independently swaying stems drawn in a transparent canvas above the pond.", "drawReeds"],
];

export default function PondLibrary() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(waterFragmentShader);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <AppHeader title="Shaders" />
    <main className="mx-auto w-full max-w-5xl px-6 pb-20 pt-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[.18em] text-slate-400">Vault / Shaders</p>
          <h1 className="mt-2 font-[family-name:var(--font-merriweather)] text-2xl font-bold tracking-tight">Reusable visual pieces</h1>
        </div>
        <nav className="flex gap-4 text-sm text-slate-500"><a className="hover:text-slate-900" href="/vault">Vault</a><a className="hover:text-slate-900" href="/vault/experiments/pond">Experiment</a></nav>
      </div>
      <p className="mb-7 max-w-2xl text-sm leading-6 text-slate-500">Keep additions small and standalone. Each entry below has one responsibility, a preview, and an implementation contract. The source notes live alongside the code in <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">src/features/pond-lab/README.md</code>.</p>
      <section className="grid gap-5 sm:grid-cols-2">
        {entries.map(([id, kind, title, description, api]) => <article key={id} className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="relative h-44 overflow-hidden bg-[#183e68]"><PondCanvas layer={id} /></div><div className="p-5"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{kind}</p><h2 className="mt-2 font-[family-name:var(--font-merriweather)] text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p><code className="mt-4 inline-block rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{api}</code></div></article>)}
      </section>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-[family-name:var(--font-merriweather)] text-lg font-bold">Water shader source</h2><p className="mt-1 text-sm text-slate-500">Copy the fragment shader, then supply <code>u_time</code>, <code>u_resolution</code>, and twelve <code>u_ripples</code> entries.</p></div><button onClick={copy} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy shader"}</button></div>
      </section>
      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Scene study / Three.js</p>
        <h2 className="mt-2 font-[family-name:var(--font-merriweather)] text-lg font-bold">Hoshi-no-Tani — The Valley of Stars</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">A complete procedural landscape reference: shared wind-field rendering, distance-tiered instanced grass, generated terrain and landmarks, then a painterly post-processing composite.</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm"><a className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50" href="/vault/shaders/hoshi-no-tani">Read scene study</a><a className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50" href="/vault/shaders/hoshi-no-tani/index.html">Open complete source</a></div>
      </section>
    </main>
  </div>;
}
