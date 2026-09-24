# Play ✦ Tony

My playground for expressing ideas through code. I use this space to explore visual design, build small interactive experiences, try out components, and follow interesting technical questions wherever they lead. Some pieces are polished; others are experiments in progress.

**Explore the live site:** [play.tonyzeb.com](https://play.tonyzeb.com)

**More about me:** [tonyzeb.com](https://www.tonyzeb.com)

## What lives here

The home page is a gallery of things I have made and things I am still figuring out. It brings together:

- **Interactive experiences** such as a school of fish, a world clock, a car configurator, and an atmospheric evening window.
- **Visual interactions** that explore image reveals, lighting, layering, loading, and motion.
- **Creative tools** including a drawing canvas and the Mosaic Image Lab, where image treatments can be mixed and exported.
- **Animation studies** built with SVG, CSS, React, and WebGL.
- **References and work in progress** in the vault, including a link library and shader experiments.

The point of this project is to keep making things. An experiment can be a single interaction, a reusable component, an art-directed scene, or a larger idea that grows over time.

## A few places to start

| Experiment | What I am exploring |
| --- | --- |
| [A School of Fish](https://play.tonyzeb.com/experiences/fish) | Motion and the feeling of life in a browser scene. |
| [Evening Window](https://play.tonyzeb.com/feelings/window-01) | Atmosphere, layered visuals, sound, and a slower kind of interaction. |
| [Mosaic Image Lab](https://play.tonyzeb.com/tools/img-mosaic) | A hands-on editor for image treatments, color, texture, and export. |
| [Vision Reveal](https://play.tonyzeb.com/ui-interactions/vision-reveal) | Revealing an image through a responsive visual field. |
| [Draw Canvas](https://play.tonyzeb.com/tools/draw-canvas) | An open surface for drawing and experimenting with tools. |
| [Coin Flip](https://play.tonyzeb.com/svg-animations/coinflip) | A small interaction shaped by timing and motion. |

## Explore the code

| Area | Where to look |
| --- | --- |
| Pages and routes | `src/app/` |
| Home gallery and its card data | `src/features/gallery/` |
| Feature-specific UI and rendering | `src/features/` |
| Shared UI and components | `src/components/` |
| Static images, video, and audio | `public/` |
| Cloudflare Function for the link library | `functions/api/bookmarks/` |

The gallery is a useful starting point: `src/features/gallery/galleryData.js` defines the visible cards and links to their routes. Individual experiments can use their own styles and rendering approaches, so the code reflects the idea being explored rather than one rigid component system.

## Built with

- Next.js 15 App Router and React 18
- JavaScript, Tailwind CSS, and shadcn/ui components
- Motion for interface animation
- Canvas, SVG, and WebGL for visual experiments
- Cloudflare Pages for the static site, with a Cloudflare Function and D1 for the link library

## Run locally

Node.js 20 is specified in `.nvmrc`.

```bash
git clone https://github.com/tonyzebastian/playground.git
cd playground
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Most experiments run locally with the app. The vault's link library needs its Cloudflare D1 binding to load live bookmarks.

To create the static site:

```bash
npm run build
```

Next.js exports the site to `out/`. Cloudflare Pages serves that output; the bookmark endpoint is handled separately by the Function in `functions/`.

## A note on the work

This is a personal creative space, so expect ideas to change, older experiments to remain as references, and different approaches to sit next to each other. Browse the live pieces, inspect the code, and follow what interests you.
