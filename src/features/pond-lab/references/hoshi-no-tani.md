# Hoshi-no-Tani — The Valley of Stars

**Reference:** https://codepen.io/editor/lentils801/pen/019f9b4b-10d7-7f77-817f-f4eb83fdb289  
**Source snapshot:** 2026-07-27  
**Original title:** `Hoshi-no-Tani — The Valley of Stars`

The source Pen is public on CodePen and is distributed under its [MIT license](/vault/shaders/hoshi-no-tani/LICENSE.md). The copy here retains the original author credit and license notice.

The complete, unmodified source snapshot is available as a static three-file CodePen project:

- [index.html](/vault/shaders/hoshi-no-tani/index.html)
- [package.json](/vault/shaders/hoshi-no-tani/package.json)
- [style.css](/vault/shaders/hoshi-no-tani/style.css)

`index.html` is deliberately kept standalone. It imports Three.js from an import map at version `0.180.0`; the accompanying CodePen package declaration requests `^0.185.1`. Use one version consistently before turning this into an app feature.

## What it is doing

This is a first-person procedural world rather than one large shader. JavaScript creates the world data and draw topology; RawShaderMaterial programs do the high-frequency visual work; a final render-target chain applies the film look.

| Layer | Main technique | Reusable idea |
| --- | --- | --- |
| Terrain | CPU-baked height/splat/meadow `DataTexture`s plus a displaced terrain shader | Keep world-shaping deterministic and sample the same height field for render, collision, and placement. |
| Grass | Four overlapping instanced rings, CPU chunk thinning, per-blade shader LOD | Use different tessellation near and far, while preserving a continuous density law. |
| Wind | A fullscreen render-target pass feeds grass, tree, cloud, and particle motion | Treat wind as shared field data, not independent sine waves per object. |
| River/sky/clouds | Custom geometry and fragment shading with procedural variation | Let geometry define a strong silhouette; reserve noise for surface detail and breakup. |
| Structures/life | Generated meshes, instanced stones, train, billboards, WebAudio synthesis | Procedural detail reads best when concentrated around authored landmarks. |
| Film finish | Shadow map, reflection/puff/cloud targets, bloom, grading, grain/FXAA composite | Make the painterly finish a post-process contract with tunable uniforms. |

## Scene flow

```text
noise + paths → baked world textures → terrain / placement / collisions
                                      ↓
camera + time → wind field target → grass / trees / clouds / particles
                                      ↓
scene + shadows + reflection → scene target → bloom / grading / grain / FXAA → canvas
```

## Shader-oriented adaptation plan

Do not start by porting the entire 5,000+ line world into UiGlow. Extract the visual systems in this order:

1. **Wind field** — a fullscreen fragment pass returning a 2D flow vector and gust strength. Feed its texture to one small instanced grass/reed experiment.
2. **Painterly composite** — take a normal scene color target and add the source’s warm grade, vignette, subtle grain, bloom threshold, and luma FXAA.
3. **Terrain material** — use a compact height/splat texture pair and one terrain shader before adding world generation or collision.
4. **Distance-field placement** — reuse the river/track/path distance-field idea to keep grass, stones, and trees out of paths.
5. **Grass rings** — only after profiling: its density and LOD strategy is the scene’s most expensive and most valuable rendering lesson.

The source is an excellent reference for a large desktop-first experiment. For a UiGlow vault piece, isolate passes with explicit input/output uniforms and keep each preview small enough to load independently.
