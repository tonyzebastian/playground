'use client';

import { memo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

const ComponentSkeleton = () => (
  <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-100 animate-pulse">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600" />
  </div>
);

const componentMap = {
  Clock: dynamic(() => import('@/app/experiences/clock/Clock')),
  CoinFlip: dynamic(() => import('@/app/svg-animations/coinflip/CoinFlip')),
};

function GalleryContent({ contentType, content, component, componentProps, title, objectPosition }) {
  if (contentType === 'image') {
    return (
      <img
        src={content}
        alt={title}
        className="h-full w-full object-cover"
        style={objectPosition ? { objectPosition } : undefined}
      />
    );
  }

  if (contentType === 'video') {
    return (
      <video
        src={content}
        className="h-full w-full object-cover"
        style={objectPosition ? { objectPosition } : undefined}
        autoPlay
        muted
        loop
        playsInline
      />
    );
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
