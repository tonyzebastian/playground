'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GalleryCard from './GalleryCard';
import GalleryPanel from './GalleryPanel';
import GallerySheet from './GallerySheet';

const MIN_COLUMN_WIDTH = 280;
const MAX_COLUMNS = 4;
const MIN_PANEL = 360;
const MIN_GALLERY = 300;
const KEY_STEP = 24;
const SPLIT_BREAKPOINT = 900; // below this the detail view is a bottom sheet
const HALF_SPLIT_FROM = 1440; // from here the panel opens 50/50
const GRID_GAP = 8;

const getColumnCount = (width) => Math.min(MAX_COLUMNS, Math.max(1, Math.floor(width / MIN_COLUMN_WIDTH)));

// This follows the reference site's approach: real column elements are filled
// in JavaScript rather than relying on CSS multi-columns. That preserves the
// intended reading order and balances the visual height of each column.
function distributeCards(cards, count) {
  const columns = Array.from({ length: count }, () => ({ cards: [], height: 0 }));

  cards.forEach((card) => {
    const target = columns.reduce((shortest, column) => column.height < shortest.height ? column : shortest);
    const ratio = card.size.height / card.size.width;
    target.cards.push(card);
    target.height += ratio + 0.03; // account for the row gap while balancing
  });

  return columns.map((column) => column.cards);
}

// Wide screens split 50/50. Below that the panel gets the larger share and the
// grid is held to two columns.
function defaultPanelWidth(total) {
  if (total >= HALF_SPLIT_FROM) return total / 2;
  return total - (2 * MIN_COLUMN_WIDTH + 5 * GRID_GAP);
}

export default function MasonryGallery({ cards }) {
  const rootRef = useRef(null);
  const galleryRef = useRef(null);
  const [columnCount, setColumnCount] = useState(1);
  const [activeCard, setActiveCard] = useState(null);
  const [panelWidth, setPanelWidth] = useState(null); // null until first open
  const [dragging, setDragging] = useState(false);
  const [isSplit, setIsSplit] = useState(true); // false on narrow screens: panel becomes an overlay

  const clampPanel = useCallback((width) => {
    const total = rootRef.current?.clientWidth ?? window.innerWidth;
    return Math.round(Math.min(Math.max(width, MIN_PANEL), Math.max(MIN_PANEL, total - MIN_GALLERY)));
  }, []);

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${SPLIT_BREAKPOINT}px)`);
    const update = () => setIsSplit(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Column count follows the width the gallery actually has, not the window.
  useEffect(() => {
    const element = galleryRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setColumnCount(getColumnCount(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeCard) return undefined;
    const handleEscape = (event) => { if (event.key === 'Escape') setActiveCard(null); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [activeCard]);

  const openCard = useCallback((card) => {
    setPanelWidth((current) => current ?? clampPanel(defaultPanelWidth(rootRef.current?.clientWidth ?? window.innerWidth)));
    setActiveCard(card);
  }, [clampPanel]);

  // Keep the panel inside its limits when the window itself is resized.
  useEffect(() => {
    const handleResize = () => setPanelWidth((current) => (current == null ? current : clampPanel(current)));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPanel]);

  const startDrag = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event) => {
    if (!dragging) return;
    const bounds = rootRef.current.getBoundingClientRect();
    setPanelWidth(clampPanel(bounds.right - event.clientX));
  };

  const endDrag = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const handleKey = (event) => {
    if (event.key === 'ArrowLeft') setPanelWidth((w) => clampPanel(w + KEY_STEP));
    else if (event.key === 'ArrowRight') setPanelWidth((w) => clampPanel(w - KEY_STEP));
    else return;
    event.preventDefault();
  };

  const columns = useMemo(() => distributeCards(cards, columnCount), [cards, columnCount]);
  const panelOpen = Boolean(activeCard);
  const splitWidth = panelOpen && isSplit ? panelWidth : 0;

  return (
    <div ref={rootRef} className="flex h-dvh w-full overflow-hidden">
      <section
        ref={galleryRef}
        aria-label="UiGlow projects"
        className="h-full min-w-0 flex-1 scrollbar-minimal overflow-y-auto pb-24 pl-2 pr-0 pt-2"
      >
        <div className="-ml-2 flex w-auto" data-columns={columnCount}>
          {columns.map((column, index) => (
            <div key={index} className="min-w-0 flex-1 pl-2">
              <div className="space-y-2">
                {column.map((card) => (
                  <GalleryCard key={card.id} card={card} active={card.id === activeCard?.id} onOpen={openCard} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {panelOpen && isSplit && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={splitWidth}
          aria-valuemin={MIN_PANEL}
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKey}
          onDoubleClick={() => setPanelWidth(clampPanel(defaultPanelWidth(rootRef.current.clientWidth)))}
          className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none"
        >
          <span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${dragging ? 'bg-slate-400' : 'bg-transparent group-hover:bg-slate-300 group-focus-visible:bg-slate-400'}`} />
        </div>
      )}

      {panelOpen && isSplit && (
        <aside
          aria-label={`${activeCard.title} preview`}
          style={{ width: splitWidth }}
          className="my-2 mr-2 h-[calc(100%-1rem)] shrink-0 overflow-hidden rounded-xl border border-slate-200 shadow-[0_8px_30px_-8px_rgba(15,23,42,0.18)]"
        >
          <GalleryPanel item={activeCard} dragging={dragging} onClose={() => setActiveCard(null)} />
        </aside>
      )}

      <GallerySheet item={isSplit ? null : activeCard} onClose={() => setActiveCard(null)} />
    </div>
  );
}
