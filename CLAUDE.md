# UiGlow - Project Context

Modern Next.js showcase platform for UI components, animations, and interactive experiences.

**Version**: 0.1.0 | **Framework**: Next.js 15.5.9 (App Router) | **Language**: JavaScript
**Deployment**: Cloudflare Pages (Static Export) | **Build Output**: `out/`

---

## Tech Stack

### Core
- **Next.js 15.5.9** + React 18.3.1
- **Tailwind CSS 3.4.1** - Utility-first styling
- **shadcn/ui on Base UI** (`@base-ui/react`) - Component library. All UI primitives in `components/ui/` are built on Base UI, not Radix. Add new components the same way (`Select.Root`, `Tooltip.Popup`, ...); compose with `render={<el />}` instead of `asChild`. Animate open/close with `data-[starting-style]` / `data-[ending-style]` and a CSS transition
- **Motion 12.22.0** - Animation library
- **three.js** - 3D rendering (Flock in Flight)

### Icons & UI
- **Phosphor** (`@phosphor-icons/react`) - The only icon library. Use `weight="bold"`; import from `@phosphor-icons/react/ssr` in files without `"use client"`

### Deployment & Hosting
- **Cloudflare Pages** - Static hosting with global CDN
- **Node.js 20** - Build environment (specified in `.nvmrc`)
- **Static Export** - Pre-rendered HTML (`output: 'export'`)

### Tools
- **Turbopack** - Fast bundler (dev mode)
- **ESLint** - Code linting

---

## Deployment Architecture (Cloudflare Pages)

### Build Configuration
```javascript
// next.config.mjs
output: 'export'           // Static HTML export
images: { unoptimized: true }  // Standard <img> tags (no optimization)
```

### Cloudflare Pages Settings
- **Build command**: `npm run build`
- **Build output directory**: `out`
- **Node version**: 20 (from `.nvmrc`)
- **Framework preset**: Next.js (Static HTML Export)

### What Works on Cloudflare Pages ✅
- ✅ Static site generation (SSG)
- ✅ Client-side routing
- ✅ Standard `<img>` tags (no Next.js Image optimization)
- ✅ Dynamic imports with Suspense
- ✅ Client-side state management
- ✅ CSS/Tailwind styling
- ✅ Public assets (images, videos, fonts)
- ✅ Custom headers (`public/_headers`)
- ✅ Redirects (`public/_redirects`)

### What Doesn't Work on Cloudflare Pages ❌
- ❌ Server-side rendering (SSR) - `getServerSideProps`
- ❌ Incremental static regeneration (ISR) - `revalidate`
- ❌ API routes (`/api/*`) - use Cloudflare Workers/Functions instead
- ❌ Middleware (unless using Cloudflare Workers)
- ❌ Next.js Image optimization (`next/image` with optimization)
- ❌ Dynamic routes with fallback (`fallback: true`)
- ❌ On-demand revalidation
- ❌ Edge runtime features

### Migration Changes from Vercel
1. **Removed**: `next/image` → Replaced with standard `<img>` tags
2. **Removed**: Vercel Analytics → Can use Cloudflare Web Analytics instead
3. **Added**: `output: 'export'` in `next.config.mjs`
4. **Added**: `images.unoptimized: true`
5. **Added**: `.nvmrc` file (Node 20)

### Performance Considerations
- **No automatic image optimization** - Manually optimize images before deployment
  - Convert to WebP/AVIF for better compression
  - Use tools like ImageOptim, Squoosh, or Sharp
  - Add `loading="lazy"` for off-screen images
- **No CDN image resizing** - Serve appropriately sized images
- **Static assets cached via Cloudflare CDN** - Excellent global performance

---

## Project Structure

```
src/
├── app/                          # Next.js App Router: routes, layouts, metadata
├── components/
│   ├── shared/                   # App-wide UI (header, dock, logo, boundary)
│   ├── ui/                       # shadcn primitives
│   ├── archive/                  # Inactive reference components
│   └── unused/                   # Deprecated components kept unchanged
├── features/                     # Feature-owned UI and rendering code
│   ├── gallery/
│   ├── handwriting/              # Handwriting tool (write-on text, video export)
│   ├── link-library/
│   ├── pond-lab/
│   ├── vision-reveal/
│   └── vision-scene/
└── lib/                          # Shared utilities (cn, frame-loop)
```

---

## Design System

### Typography
- **Body**: Raleway (300-700)
- **Headings**: Merriweather (400, 700, 900)
- **Loading**: `display: 'swap'` for optimal performance

### Theme
- **Colors**: Tailwind slate palette; light only (there is no dark theme)
- **Tokens**: CSS variables in `app/globals.css` (`--canvas` is the page background behind cards and panels), exposed as Tailwind colors (`bg-canvas`). CSS modules take neutrals from the Tailwind palette with `theme('colors.slate.500')`, not hex
- **Body font**: Raleway via `font-sans` on `body`

### Layout
- **Canvas**: 60%-120% responsive scaling (1440px base)
- **Content**: 700-900px fixed width
- **Approach**: Mobile-first responsive

---

## Key Features

### 1. Draggable Canvas (Home Page)
Interactive infinite canvas showcasing all projects:
- **Pan/Drag**: Click-drag to navigate, mouse wheel to scroll
- **Debounced Resize**: Optimized performance (150ms debounce)
- **4 Visual Groups**: Experiments, Tools, Interactions, SVG Animations
- **Content Types**: Images, videos (autoplay), live React components
- **Hover Effects**: Tilt rotation + title overlay
- **Error Handling**: Individual items wrapped in ErrorBoundary

**Performance:**
- Standard `<img>` tags for images (Cloudflare Pages compatibility)
- Suspense boundaries for dynamic components
- 10000px canvas boundary

### 2. Content Sections
- **Experiences**: Fish school, World clock, Car configurator, Flock in Flight
- **UI Interactions**: Interactive visual demos + chat interface
- **SVG Animations**: Coin flip, Comet hero, Unlock
- **Tools**: Drawing canvas, Mosaic Image Lab and Handwriting
- **Mosaic Image Lab**: One GPU editor for mosaic, dither, water, cursor, print, palette, and export controls

- **Handwriting** (`/tools/handwriting`, `features/handwriting/`): type text and watch it get handwritten stroke by stroke. See "Handwriting Tool" below

### 3. Component Architecture
- **Reusable**: Modular design with factory functions
- **Dynamic Loading**: Next.js dynamic imports + Suspense
- **Error Boundaries**: Global + component-level protection
- **SSR-Safe**: Proper window/localStorage checks

---

## Development Standards

### File Naming
- **Components**: PascalCase (`.jsx`) - `AppHeader.js`, `CoinFlip.jsx`
- **Directories**: kebab-case - `ui-interactions`, `slate-cars`
- **Pages**: `page.js`, `layout.js` (Next.js convention)
- **Configs**: kebab-case - `navigation-config.js`

### Code Conventions
- **Language**: 100% JavaScript (no TypeScript)
- **Client Components**: `"use client"` directive where needed
- **Imports**: `@/` path alias for clean imports
- **Styling**: Tailwind utility classes, CSS variables for theming

### Performance Best Practices
- **Debouncing**: Resize handlers (150ms)
- **Image Loading**: Standard `<img>` tags with `loading="lazy"` attribute
- **Code Splitting**: Dynamic imports for heavy components
- **Error Handling**: ErrorBoundary at root + critical components
- **Hydration**: `suppressHydrationWarning` for time-based components
- **Static Export**: All pages pre-rendered at build time for Cloudflare Pages

---

## Notable Patterns

### Logo Component (`components/shared/UIGlowLogo.jsx`)
Single component with variants:
```javascript
<UIGlowLogo />               // Full logo (default)
<UIGlowLogo variant="mini" /> // Mini icon
```

### Frame Loop (`lib/frame-loop.js`)
Shared render loop for canvas experiments:
```javascript
const stop = createFrameLoop(canvas, (dt) => { /* draw */ });
```
- Pauses while off-screen or the tab is hidden; `dt` is clamped seconds
- Used by Grass and Flock in Flight; new experiments should use it instead of hand-rolling rAF + IntersectionObserver

### Handwriting Tool (`features/handwriting/`)
Type a line and it is handwritten one pen stroke at a time. Used to make text overlays for videos. The web tool is standalone: it previews and exports settings (JSON) but doesn't make video. Video is made by the internal Mac tool in the Motion repo (`tools/handwriting/`: Handwriting Studio, renderer, DaVinci Resolve menu entry), whose README documents the whole system, its dependencies and plans for a standalone version.
- **Engine** (`engine/`): a plain-JS copy of the `HandWrite` engine in the Motion repo (`src/scenes/JunyStudios/shared/handwriting/`), with Remotion's helpers swapped for `engine/anim.js`. When the engine changes in Motion, port it here
  - `geometry.js` lays out letters as pen strokes and builds the lead-in, tail and wobble
  - `HandWrite.jsx` draws one line as SVG for a given (fractional) frame
  - `fonts/` holds built-in fonts as stroke data
  - `fontToStrokes.js` traces an uploaded `.ttf`/`.otf` into strokes in the browser (opentype.js)
- **Studio** (`HandwritingStudio.jsx`): stage (1920×1080 canvas, scaled), text box, transport, and a DialKit panel configured in `handwritingConfig.js`
- **Export to video**: the panel's **Export for video (.json)…** button saves the text and settings with `exportSettings()` in `handwritingConfig.js`. In the Motion repo, `npm run handwriting -- file.json` renders that as a transparent ProRes 4444 `.mov` for DaVinci Resolve (Motion's `tools/handwriting/README.md`)
  - Keep `exportSettings()` keys in step with `handwritingClipSchema` in Motion's `HandwritingClip.tsx`
  - Every export starts with an `instructions` field (`EXPORT_INSTRUCTIONS`) saying how to render it, so the file can be handed to an agent and rendered straight away; Motion's AGENTS.md has the matching rule
- Timing is in 30 fps frames. Lead-ins go on the first line only and tails on the last line only; `variation` seeds their shapes (`line-<n>-v<variation>`)

### Split Panel (`features/gallery/`)
- Every gallery card opens in a resizable right panel (`GalleryPanel`); below 900px it is a bottom sheet (`GallerySheet`)
- Pages render inside an iframe. Pages in an iframe get `data-embed` on `<html>`, which hides `AppHeader` (the panel shows the name instead). Gate features on input capability (`hover: hover`), never on viewport width, because media queries inside the iframe see the panel's width
- Expand opens the page in a new tab with the full breadcrumb

### Gallery Data (`features/gallery/galleryData.js`)
The home gallery keeps its presentation data separate from its layout:
```javascript
imageCard('fish', {
  content: '/thumbnails/fish.gif',
  title: 'A School of Fish',
  size: { width: 280, height: 200 },
  link: '/experiences/fish',
});
```

- `imageCard()`, `videoCard()`, and `componentCard()` define preview content.
- `MasonryGallery` balances cards by declared aspect ratio.
- Feature previews are dynamically imported by `GalleryContent`.

### AppHeader Component
Two variants via `variant` prop:
- **Primary**: Rounded pill, fixed top-center (home page)
- **Secondary**: Full-width, bottom border (sub-pages with title)

### Flock in Flight (`/experiences/flock`)
An endless 3D flying game (three.js). The cursor steers a flock of white birds; A and D (or Left and Right) steer too; press and hold (or W, Up, Space) to dive low, right-click and hold (or S, Down, Shift) to climb far above everything. Enter starts a run. On touch one finger drags to steer and a two-finger swipe steps the altitude: up for lower, down for higher. The camera looks down on the flock while it cruises and swings in behind it as it dives. Each hit costs a bird; glowing strays can be gathered; the run ends when no birds are left.
- `Flock.jsx` is the React shell (start / game-over cards, score, edge warnings, input). `<Flock game />` is the playable page; without the prop it is the calm gallery preview. Everything else is in `game/`:
  - `engine.js` renderer, camera, frame loop, game state. `flock.js` birds, strays, fallen birds. `threats.js` every hazard plus the director that schedules them by distance and level.
  - `ground.js` the land as pure functions of position (zones with noise-warped borders, never a crossfade). `world.js` builds terrain chunks a slice per frame and scatters props. `sky.js` time of day, clouds, storms, rain, lightning. `materials.js` all shaders (shared light / fog uniforms, painterly finish pass). `fx.js` particles and ground shadows. `audio.js` synthesised sound.
- `tuning.js` holds every look-and-feel number worth turning by hand: `FLOCK_DIALS` is the DialKit panel, `TUNE` the live values the game reads each frame. The panel is hidden; `Control + Alt/Option + Shift + F` toggles it, `Escape` hides it. The title card lists that shortcut with the other keys (`CONTROLS` in `Flock.jsx`: keep it in step with the key handler); there is no button for it. Add a control by adding it to `FLOCK_DIALS` and reading `TUNE.<group>.<name>` where it applies.
- `C` (or the camera button) cycles the views in `CAMERAS` (`engine.js`): Chase (the default), Far chase, Overhead, Follow (overhead, swinging behind in a dive; the gallery card uses it). The last view, Cine (`cine.js`), films the flock behind the title and game-over cards, and in play is a watch mode: composed shots that cut by themselves under letterbox bars while the flock flies itself and cannot be hurt. Add a shot to `SHOTS` there. The chase views, their roll with the bank and the wake a low flock stirs up (`wake` in `flock.js`) follow Petalwake (MIT, Jacob Miller, github.com/jjcm/petalwake); keep that credit.
- Aircraft come one at a time, from ahead, across, or overtaking from behind (flagged at the bottom edge). Very rarely two collide in mid-air: the blast kills every bird within `BLAST` units, so the answer is distance.
- Air threats (aircraft, balloons, hawks, storm cells) are dodged sideways or by diving; ground threats (hunters, power lines, turbines, trees, hills) only reach a flock flying low. Add a threat as a factory in `threats.js` returning `{ kind, warn, update, test, remove }` and list it in `airEvent` or `groundEvent`.
- Aircraft are rare except around an airport (`BIOME.AIRPORT`, laid out by `AIRFIELD` in `ground.js`), where `traffic` in `threats.js` sends landings and take-offs by turns along the runway.
- A basin (`BIOME.BASIN`) is country lying `BASIN.drop` below the rest, entered and left over cliffs with waterfalls. `sampleGround` gives `h` (height), `level` (the water's height there) and `rel` (height above that water): plant and colour by `rel`, place by `h`, and use `floorAt` for the top of land or water. The water shader in `materials.js` repeats the cliff arithmetic of `sunk` in `ground.js`; change them together.
- Flyers stay out of the sun shadow map and drop a shadow in their own outline through `fx.shadow(kind, …)`, baked from the models at start-up. The shadow softens with height: a vague shape from cruising height, every feather when skimming the ground.
- The run opens at `START_Z` (`ground.js`), in the last of a meadow with the first basin and its waterfalls just ahead, and the day opens on the evening light (`EVENING` in `sky.js`).
- Add a region with a `BIOME` id plus `relief` and `tint` cases in `ground.js`, its prop rules in `scatter` (`world.js`), and its ground threats in `groundEvent`.
- Trees and bushes are baked from EZ-Tree (dev dependency) by `node scripts/flock/bake_trees.mjs` into `public/models/flock/trees.bin` + `trees.json`, with bark, leaf, grass and soil textures in `tex/`. Each tree is a bark mesh plus alpha-tested leaf cards; leaves take their hue from the per-instance tint.
- Sound lives in `public/sounds/flock/` and is built by `python3 scripts/flock/build_sounds.py`: CC0 field recordings found through Openverse plus designed cues from the earshot bank. `CREDITS.md` there lists every source. `audio.js` loops the beds by crossfading and runs everything through a limiter.
- Models are built by `scripts/flock/build_models.py` (run inside Blender) and exported to `public/models/flock/flock-kit.glb`. Colour is a vertex attribute; tree foliage, bushes, grass tufts and cows are greyscale and tinted per instance. Trees, bushes and grass sway in the vertex shader (`sway` material). Wings flap in the vertex shader, so wing vertices must lie beyond the `shoulder` distance from the body axis.
- Frame (desktop): the scene is drawn in HDR with a readable depth, then `engine.js` adds bloom, god rays, camera motion blur and depth of field (shaders at the end of `materials.js`, strengths under Grade in the tuning panel). The grade ends with a film look from `LOOKS` in `tuning.js` (split toning plus saturation, contrast and warmth); Film is the default. Materials made with `sharp: true` (birds, hawks, aircraft) write a low alpha and stay out of the blur. The `lite` path skips all three.
- Camera moments (`engine.js`): the world holds still for an instant when a bird is lost, slows and pushes in on a near miss (`G.moment('near')` from `threats.js`), pulls back where the land drops into a basin, and shakes under a passing jet. All are skipped under reduced motion.
- The day (`DAY` in `sky.js`) gives each moment a `span`: morning, sunset and dawn are held about three times as long as noon and night, and the sun is kept low for long shadows and a warm rim on the birds.
- Performance: the game is bound by the GPU, not by its own code (under a millisecond a frame). What keeps it fast: plants more than `FAR_FROM_ROUTE` from the route use the low-detail `_far` meshes; the scene is never drawn at more than `MAX_PIXELS` and `adapt` in `engine.js` drops a step of resolution when frames run long; the sun shadow map is redrawn every other frame; threat shaders are compiled at load. In development `window.__flock.perf` (set `.on = true`) records frame gaps, script time, draw calls and triangles: measure with it before and after any change that adds geometry or a pass.
- Lighting: the painter shader adds direct sun on top of a sky / ground ambient, and reads a sun shadow map that `engine.js` renders each frame from everything on layer 1 (`mesh.layers.enable(1)` makes something cast). Shadows are desktop only; the `lite` path keeps the soft blob shadows.
- Client-only and static-export safe. Phones (`pointer: coarse` or < 600px) and the gallery preview use the `lite` path. In development `window.__flock` exposes the running game.
- `AppHeader` takes `tone="light"` for pages with a full-bleed picture behind the breadcrumb.

### Window 01 DialKit
- `/feelings/window-01` keeps its art-direction DialKit hidden by default.
- Toggle it with `Control + Alt/Option + Shift + W`; press the shortcut again or `Escape` to hide it.
- Do not add a visible public affordance for these controls unless explicitly requested.
- Keep this shortcut and `src/app/feelings/window-01/README.md` synchronized if the behavior changes.

### Kalimba accuracy captures
- `/kalimba` has a hidden capture mode (`Control + Alt/Option + Shift + K`, or `?capture`) that saves raw mic audio with cue times.
- `node scripts/kalimba/replay.mjs <capture.json>` replays a capture through the current recognition code and prints a confusion table. Use real captures to judge recognition changes; synthetic tests alone don't establish real-world accuracy.
- Keep the shortcut and `src/features/kalimba/README.md` in sync.

### Error Boundary
Locations:
1. Root layout (`app/layout.js`) - catches all errors
2. Gallery preview components - isolates dynamic component failures

Shows user-friendly error UI with reload button (dev mode shows error details).

---

## Gallery System

### Content Types
- `image` - Standard `<img>` tags (Cloudflare Pages compatible)
- `video` - Autoplay, muted, loop, playsInline
- `component` - Dynamic import with Suspense fallback

### Adding New Gallery Items
1. Add an item to `features/gallery/galleryData.js`:
   ```javascript
   imageCard('my-item', {
     content: '/thumbnails/my-item.gif',
     title: 'My Item',
     size: { width: 240, height: 170 },
     link: '/my-route',
   })
   ```
2. Add thumbnail to `public/thumbnails/`
3. For component previews: add the dynamic import to `features/gallery/GalleryContent.jsx`

### Performance Features
- **Responsive masonry**: recalculates columns on viewport resize
- **Suspense**: Loading skeleton for dynamic components
- **Error isolation**: Failed previews do not crash the gallery

---

## Common Tasks

### Add a New Experience
1. Create directory: `src/app/experiences/my-experience/`
2. Add `page.js` and component files
3. Add to `navigation-config.js` only if it is part of an existing navigation group
4. Add a gallery item in `features/gallery/galleryData.js`
5. Add thumbnail to `public/thumbnails/`

### Add a New Tool
1. Create: `src/app/tools/my-tool/page.js`
2. Use `AppHeader` with `variant="secondary"` and custom title
3. Add a gallery item in `features/gallery/galleryData.js`
4. Tools don't need navigation config (standalone)

### Modify Theme
- CSS variables in `app/globals.css`
- Tailwind config in `tailwind.config.mjs`

### Add Utility Function
Add to `lib/utils.js` - current utilities:
- `cn()` - className merger (clsx + tailwind-merge)

---

## Scripts

```bash
npm run dev    # Development with Turbopack
npm run build  # Production static export (outputs to /out)
npm run start  # Production server (for local testing only)
npm run lint   # ESLint check
```

**Note for Cloudflare Pages**:
- Use `npm run build` to generate static export
- Output directory: `out/` (configured in Cloudflare Pages)
- Preview locally: `npx serve out`

---

## Asset Guidelines

### Images
- **Thumbnails**: GIF or PNG in `public/thumbnails/`
- **Implementation**: Standard `<img>` tags (Cloudflare Pages compatible)
- **Optimization**: Manually optimize before deployment (WebP/AVIF recommended)
- **Lazy Loading**: Add `loading="lazy"` for off-screen images
- **Sizing**: Use CSS/Tailwind classes for responsive sizing

### Videos
- Format: MP4
- Location: `public/thumbnails/`
- Attributes: autoplay, muted, loop, playsInline

### Icons
- **Library**: Phosphor, `weight="bold"`
- **Usage**: Import only what you need

---

## Performance Checklist

✅ **Implemented:**
- Debounced resize handlers
- Standard `<img>` tags (Cloudflare Pages compatible)
- Dynamic imports with Suspense
- Error boundaries
- SSR-safe code
- Removed duplicate files
- Consolidated components
- Factory functions for DRY code
- Static export for Cloudflare Pages
- Node.js 20 build environment

⏳ **Future Optimizations:**
- Bundle analyzer (track bundle size)
- Intersection observer (canvas items)
- Image optimization (convert to WebP/AVIF)
- Add `loading="lazy"` to off-screen images
- Additional utility functions
- Cloudflare Web Analytics integration

---

## Troubleshooting

### Hydration Errors
- Check for `suppressHydrationWarning` on time-based components
- Ensure SSR checks: `typeof window === 'undefined'`
- Initial state should match server render

### Canvas Performance
- Resize lag? Check debounce is working (150ms delay)
- Too many items? Consider intersection observer
- Animations janky? Verify GPU acceleration (`will-change` CSS)

### Component Not Loading
- Check `componentMap` in `features/gallery/GalleryContent.jsx`
- Verify dynamic import path is correct
- Look for errors in ErrorBoundary UI

---

## Notes for AI Agents

- **100% JavaScript codebase** - no TypeScript
- **Motion library** (not Framer Motion) - import from `motion/react`
- **Phosphor icons** (bold weight) - the only icon library
- **Factory functions** - use for canvas items (DRY principle)
- **Error boundaries** - wrap risky components
- **SSR awareness** - always check `typeof window` before browser APIs
- **Path alias**: `@/` = `src/`
- **Cloudflare Pages deployment** - Static export only, no SSR/ISR/API routes
- **Image handling** - Use standard `<img>` tags, NOT `next/image`
- **Build command** - `npm run build` outputs to `out/` directory
- **Next.js version** - 15.5.9 (latest stable 15.x)
- **React version** - 18.3.1 (not React 19 yet)
