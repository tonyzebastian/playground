'use client';

import { X, ArrowsOutSimple } from '@phosphor-icons/react';
import AppHeader from '@/components/shared/AppHeader';

const actionClassName = 'flex h-8 w-8 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950';

// Static HTML pages in /public read ?embed=1 to hide their own chrome; app
// routes detect the iframe themselves.
const embedSrc = (link) => (link.endsWith('.html') ? `${link}?embed=1` : link);

// Right-hand detail pane for the split view. The iframe is blocked from
// capturing the pointer while the divider is being dragged, otherwise it
// swallows the mouse events and the drag stalls.
export default function GalleryPanel({ item, onClose, dragging }) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[#fafaf9]">
      <AppHeader
        title={item.title}
        titleOnly
        actions={(
          <>
            <a href={item.link} target="_blank" rel="noopener noreferrer" className={actionClassName} aria-label={`Open ${item.title} in a new tab`} title="Open in a new tab">
              <ArrowsOutSimple weight="bold" className="h-4 w-4" aria-hidden="true" />
            </a>
            <button type="button" onClick={onClose} className={actionClassName} aria-label="Close panel" title="Close (Esc)">
              <X weight="bold" className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      />
      <iframe
        key={item.id}
        src={embedSrc(item.link)}
        title={item.title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        className={`min-h-0 w-full flex-1 border-0 bg-white ${dragging ? 'pointer-events-none' : ''}`}
      />
    </div>
  );
}
