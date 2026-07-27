import AppHeader from "@/components/shared/AppHeader";

export const metadata = {
  title: "Hoshi-no-Tani scene study | UiGlow",
  robots: { index: false, follow: false },
};

const systems = [
  ["Terrain", "CPU noise bakes height, splat, and meadow textures. The terrain shader samples the same source used by placement and collision, keeping the world coherent."],
  ["Vegetation", "Four overlapping instanced grass rings trade blade tessellation and density by distance. A shared flow texture supplies wind to grass, trees, clouds, and particles."],
  ["Landmarks", "The river, bridge, track, village, trees, train, smoke, and wildlife are generated from geometry and procedural placement rather than loaded models."],
  ["Film finish", "Dedicated shadow, reflection, cloud-shadow, and puff targets feed bloom, colour grading, grain, vignette, and luma FXAA in the final composite."],
];

export default function HoshiNoTaniStudyPage() {
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <AppHeader title="Shaders" />
    <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-8">
      <a className="text-sm text-slate-500 hover:text-slate-900" href="/vault/shaders">← Shaders</a>
      <p className="mt-8 text-xs font-medium uppercase tracking-[.18em] text-slate-400">Vault / Scene study / Three.js</p>
      <h1 className="mt-2 font-[family-name:var(--font-merriweather)] text-3xl font-bold tracking-tight">Hoshi-no-Tani — The Valley of Stars</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">A large procedural-world reference whose strongest idea is architectural: JavaScript builds deterministic world data and draw topology, shaders animate and shade it, then post-processing turns a conventional 3D scene into a painterly frame.</p>

      <section className="mt-9 grid gap-4 sm:grid-cols-2">
        {systems.map(([title, body]) => <article key={title} className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-[family-name:var(--font-merriweather)] text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>)}
      </section>

      <section className="mt-7 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-[family-name:var(--font-merriweather)] text-lg font-bold">Best pieces to extract first</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>A fullscreen wind-field pass with a small instanced grass or reed preview.</li><li>The painterly composite as a reusable scene-colour post-process.</li><li>A compact terrain material driven by height and splat textures.</li><li>Distance-field masking for clean river, path, and track placement.</li></ol>
      </section>

      <section className="mt-7 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-[family-name:var(--font-merriweather)] text-lg font-bold">Original snapshot</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">The source is preserved as the original self-contained CodePen project. The HTML imports Three.js 0.180.0 from an import map; the project package declaration specifies <code>^0.185.1</code>, so normalize the version before integrating it elsewhere.</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm"><a className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50" href="/vault/shaders/hoshi-no-tani/index.html">index.html</a><a className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50" href="/vault/shaders/hoshi-no-tani/package.json">package.json</a><a className="rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50" href="/vault/shaders/hoshi-no-tani/style.css">style.css</a></div>
      </section>
    </main>
  </div>;
}
