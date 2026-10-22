'use client';

import { memo } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight } from '@phosphor-icons/react';
import GalleryContent from './GalleryContent';

// Memoised: the grid re-renders on every pointer move while the panel divider
// is dragged, but a card only changes when its own `active` flag flips.
function GalleryCard({ card, onOpen, active = false }) {
  const previewStyle = {
    aspectRatio: `${card.size.width} / ${card.size.height}`,
    backgroundColor: card.backgroundColor,
  };
  const opensModal = card.interactive && card.link;
  const previewClassName = 'relative block w-full overflow-hidden rounded-[9px] bg-slate-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2';

  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
      <article className={`group w-full overflow-hidden rounded-xl border p-1 transition-colors duration-200 ${active ? 'border-slate-300 bg-white shadow-[0_6px_18px_-4px_rgba(15,23,42,0.22)]' : 'border-slate-200 bg-white'}`}>
        {opensModal ? (
          <button
            type="button"
            className={previewClassName}
            style={previewStyle}
            aria-label={`Open ${card.title}`}
            onClick={() => onOpen(card)}
          >
            <Preview card={card} />
          </button>
        ) : (
          <div className="relative overflow-hidden rounded-[9px] bg-slate-100" style={previewStyle}>
            <Preview card={card} />
          </div>
        )}
      </article>
    </motion.div>
  );
}

function Preview({ card }) {
  return (
    <>
          <div className="h-full w-full pointer-events-none">
            <GalleryContent
              contentType={card.contentType}
              content={card.content}
              component={card.component}
              componentProps={card.componentProps}
              title={card.title}
              objectPosition={card.objectPosition}
              zoom={card.zoom}
            />
          </div>
          {card.interactive && card.link && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-2 items-end justify-between gap-3 bg-[linear-gradient(to_top,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0.28)_45%,rgba(255,255,255,0)_100%)] px-4 pb-3 pt-20 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
              <p className="text-sm font-normal tracking-tight text-slate-950">{card.title}</p>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm">
                <ArrowUpRight weight="bold" className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
          )}
    </>
  );
}

export default memo(GalleryCard);
