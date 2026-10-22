'use client';

import { AnimatePresence, motion, useDragControls } from 'motion/react';
import GalleryPanel from './GalleryPanel';

// Bottom sheet used below the split breakpoint: slides up over a dimmed page
// and can be pulled down by its handle to dismiss.
export default function GallerySheet({ item, onClose }) {
  const controls = useDragControls();

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          key="sheet"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`${item.title} preview`}
            className="absolute inset-x-0 bottom-0 top-3 flex flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-[0_-8px_30px_rgba(15,23,42,0.18)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 320 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
          >
            <div className="flex h-5 shrink-0 cursor-grab touch-none items-end justify-center pb-1 active:cursor-grabbing" onPointerDown={(event) => controls.start(event)}>
              <span className="h-1 w-9 rounded-full bg-slate-300" />
            </div>
            <div className="min-h-0 flex-1">
              <GalleryPanel item={item} onClose={onClose} />
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
