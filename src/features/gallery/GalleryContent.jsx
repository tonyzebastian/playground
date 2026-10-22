'use client';

import { memo, Suspense, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

const ComponentSkeleton = () => (
  <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-100 animate-pulse">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600" />
  </div>
);

const componentMap = {
  Clock: dynamic(() => import('@/app/experiences/clock/Clock')),
  Flock: dynamic(() => import('@/app/experiences/flock/Flock')),
  PhysioStudio: dynamic(() => import('@/features/gallery/PhysioPreview')),
  CoinFlip: dynamic(() => import('@/app/svg-animations/coinflip/CoinFlip')),
};

// Thumbnails only play while on screen, so a long gallery doesn't decode every
// video at once.
function PreviewVideo({ src }) {
  const ref = useRef(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { rootMargin: '200px' });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={ref} src={src} className="h-full w-full object-cover" preload="metadata" muted loop playsInline />;
}

function GalleryContent({ contentType, content, component, componentProps, title, objectPosition }) {
  if (contentType === 'image') {
    return (
      <img
        src={content}
        alt={title}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        style={objectPosition ? { objectPosition } : undefined}
      />
    );
  }

  if (contentType === 'video') {
    return <PreviewVideo src={content} />;
  }

  if (contentType === 'component') {
    const Component = componentMap[component];

    if (!Component) {
      return <p className="flex h-full items-center justify-center text-sm text-slate-500">Component not found</p>;
    }

    return (
      <div className="flex h-full w-full items-center justify-center" suppressHydrationWarning>
        <ErrorBoundary>
          <Suspense fallback={<ComponentSkeleton />}>
            <Component {...(componentProps || {})} />
          </Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  return null;
}

export default memo(GalleryContent);
