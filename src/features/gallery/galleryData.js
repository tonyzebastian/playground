// The gallery deliberately keeps content and interaction separate from layout.
// `size` supplies a stable preview aspect ratio and is also used to balance the
// masonry columns before cards are painted.
const createGalleryCard = (id, overrides) => ({
  id,
  interactive: true,
  archived: false,
  ...overrides,
});

const imageCard = (id, options) => createGalleryCard(id, {
  contentType: 'image',
  ...options,
});

const videoCard = (id, options) => createGalleryCard(id, {
  contentType: 'video',
  ...options,
});

const componentCard = (id, component, options) => createGalleryCard(id, {
  contentType: 'component',
  component,
  ...options,
});

const galleryCatalog = [
  videoCard('evening-window', {
    content: '/thumbnails/evening_window.mp4',
    title: 'Evening Window, July 2026',
    size: { width: 280, height: 200 },
    zoom: 1.32, // the render has white margins baked in; crop them out
    link: '/feelings/window-01',
  }),
  componentCard('frost', 'Frost', {
    title: 'Frosted Glass',
    size: { width: 240, height: 330 },
    link: '/experiences/frost',
    backgroundColor: '#eef4ec',
  }),
  componentCard('flock', 'Flock', {
    title: 'Flock in Flight',
    size: { width: 280, height: 200 },
    link: '/experiences/flock',
    backgroundColor: '#3f5f86',
  }),
  componentCard('physio-studio', 'PhysioStudio', {
    title: 'Physiotherapy Studio',
    size: { width: 300, height: 210 },
    link: '/physiotherapy-studio.html',
    backgroundColor: '#ffffff',
  }),
  videoCard('vision-reveal', {
    content: '/thumbnails/vision_reveal.mp4',
    title: 'Vision Reveal',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/vision-reveal',
  }),
  imageCard('fish', {
    content: '/thumbnails/fish.gif',
    title: 'A School of Fish',
    size: { width: 280, height: 200 },
    link: '/experiences/fish',
  }),
  componentCard('clock', 'Clock', {
    componentProps: { size: 180, timeZoneOffset: 0 },
    title: 'World Clock',
    size: { width: 220, height: 220 },
    link: '/experiences/clock',
    backgroundColor: '#006045',
  }),
  videoCard('cars', {
    content: '/thumbnails/slate_config.mp4',
    title: 'Car Configuration',
    size: { width: 280, height: 200 },
    link: '/experiences/slate-cars',
  }),
  imageCard('mosaic', {
    content: '/thumbnails/mosaic.jpg',
    title: 'Mosaic Image Lab',
    size: { width: 250, height: 180 },
    link: '/tools/img-mosaic',
  }),
  videoCard('writing', {
    content: '/thumbnails/drawing%20canvas.mp4',
    title: 'Draw Canvas',
    size: { width: 250, height: 180 },
    link: '/tools/draw-canvas',
  }),
  videoCard('img-stack', {
    content: '/thumbnails/image_stack.mp4',
    title: 'Image Stack',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/img-stack',
  }),
  videoCard('img-sphere', {
    content: '/thumbnails/image_sphere.mp4',
    title: 'Image Sphere',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/img-sphere',
  }),
  videoCard('img-tiles', {
    content: '/thumbnails/imgtile.mp4',
    title: 'Image Tiles',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/img-tiles',
  }),
  videoCard('img-loading', {
    content: '/thumbnails/img-loading.mp4',
    title: 'Image Loading',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/img-loading',
  }),
  videoCard('img-light', {
    content: '/thumbnails/image_spotlight.mp4',
    title: 'Image Light',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/img-light',
  }),
  videoCard('chat-interface', {
    content: '/thumbnails/chat.mp4',
    title: 'Chat Interface',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/chat-interface',
    archived: true,
  }),
  componentCard('vision-scene', 'VisionScene', {
    title: 'Vision Scene',
    size: { width: 240, height: 170 },
    link: '/ui-interactions/vision-scene',
    backgroundColor: '#faf5ff',
    archived: true,
  }),
  componentCard('coinflip', 'CoinFlip', {
    title: 'Coin Flip',
    size: { width: 240, height: 170 },
    link: '/svg-animations/coinflip',
    backgroundColor: '#f8fafc',
    archived: true,
  }),
  videoCard('comet', {
    content: '/thumbnails/comet.mp4',
    title: 'Comet Hero',
    size: { width: 240, height: 170 },
    link: '/svg-animations/comethero',
  }),
];

// Archived entries keep their route and gallery metadata for reference, but
// are intentionally excluded from the public home gallery.
export const galleryCards = galleryCatalog.filter((card) => !card.archived);
export const archivedGalleryCards = galleryCatalog.filter((card) => card.archived);
