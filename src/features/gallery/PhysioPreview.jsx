'use client';

// Live, chrome-free preview of the Physiotherapy Studio figure (a standalone page in /public).
export default function PhysioPreview() {
  return (
    <iframe
      src="/physiotherapy-studio.html?embed=1"
      title="Physiotherapy Studio preview"
      loading="lazy"
      tabIndex={-1}
      aria-hidden="true"
      className="pointer-events-none h-full w-full border-0 bg-white"
    />
  );
}
