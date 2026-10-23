// Hand-inked isometric illustrations (Colorfigures pages in /public). Add a new one by dropping its
// standalone .html into /public (it must listen for the `figure-controls` message, see the other two) and listing it here.
export const ILLUSTRATIONS = [
  {
    id: 'physio-studio',
    title: 'Physiotherapy Studio',
    src: '/physiotherapy-studio.html',
    aspect: 1.3,
  },
  {
    id: 'swimming-pool',
    title: 'Swimming Pool',
    src: '/swimming-pool.html',
    aspect: 1.2,
  },
  {
    id: 'tennis-stadium',
    title: 'Centre Court',
    src: '/tennis-stadium.html',
    aspect: 1.2,
  },
];

// One DialKit panel drives every illustration. Numeric controls are [default, min, max, step].
export const ILLUSTRATIONS_CONFIG = {
  playback: {
    playing: true,
    speed: [1, 0.25, 3, 0.25],
    restart: { type: 'action', label: 'Restart' },
  },
  look: {
    wobble: [2.4, 0, 7, 0.1],
    colour: {
      type: 'select',
      options: [
        { value: 'default', label: 'Per illustration' },
        { value: 'mustard', label: 'Yellow' },
        { value: 'tomato', label: 'Red' },
        { value: 'mint', label: 'Green' },
        { value: 'cobalt', label: 'Blue' },
        { value: 'blush', label: 'Pink' },
      ],
      default: 'default',
    },
  },
};
