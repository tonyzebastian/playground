"use client";

import { CaretDown, LinkSimple, CircleNotch, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import styles from "./LinkLibrary.module.css";

export default function LinkLibrary() {
  const [bookmarks, setBookmarks] = useState([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/bookmarks");
        if (!response.ok) throw new Error("Could not load the link library.");
        setBookmarks(await response.json());
      } catch (cause) {
        setMessage(cause.message);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const tags = useMemo(() => {
    const counts = new Map();
    bookmarks.forEach((bookmark) => bookmark.tags.forEach((tag) => {
      counts.set(tag.name, { ...tag, count: (counts.get(tag.name)?.count || 0) + 1 });
    }));
    return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [bookmarks]);

  const filteredBookmarks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookmarks.filter((bookmark) => {
      const matchesTag = activeTag === "all" || bookmark.tags.some((tag) => tag.name === activeTag);
      const haystack = [bookmark.name, bookmark.url, bookmark.hostname, bookmark.page_title, bookmark.description, bookmark.site_name, ...bookmark.tags.map((tag) => tag.label)].filter(Boolean).join(" ").toLowerCase();
      return matchesTag && (!needle || haystack.includes(needle));
    });
  }, [activeTag, bookmarks, query]);

  return <main className={styles.page}>
    <header className={styles.header}>
      <h1>Library</h1>
      <section className={styles.controls} aria-label="Link filters">
        <label className={styles.search}><MagnifyingGlass weight="bold" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search links and notes" /></label>
        <label className={styles.tagSelect}><span className={styles.srOnly}>Filter by tag</span><select value={activeTag} onChange={(event) => setActiveTag(event.target.value)}><option value="all">All tags ({bookmarks.length})</option>{tags.map((tag) => <option key={tag.id} value={tag.name}>{tag.label} ({tag.count})</option>)}</select><CaretDown weight="bold" className={styles.selectIcon} size={18} aria-hidden="true" /></label>
      </section>
    </header>

    {message && <p className={styles.message}>{message}<button onClick={() => setMessage("")} aria-label="Dismiss message"><X weight="bold" size={15} /></button></p>}
    {isLoading ? <div className={styles.empty}><CircleNotch weight="bold" className={styles.spin} size={22} /> Loading your library…</div> : filteredBookmarks.length ? <section className={styles.list}>{filteredBookmarks.map((bookmark) => <BookmarkRow key={bookmark.id} bookmark={bookmark} />)}</section> : <div className={styles.empty}><LinkSimple weight="bold" size={26} /><h2>{bookmarks.length ? "Nothing matches that filter." : "Your library is waiting."}</h2><p>{bookmarks.length ? "Try another tag or search term." : "Add references through the D1 library."}</p></div>}
  </main>;
}

function BookmarkRow({ bookmark }) {
  const previewSrc = bookmark.image_url || "/library-fallback.png";

  return <article className={styles.row}>
    <a className={styles.rowLink} href={bookmark.url} target="_blank" rel="noreferrer" aria-label={`Open ${bookmark.name}`}>
      <div><h2>{bookmark.name}</h2>{bookmark.description && <p>{bookmark.description}</p>}</div>
      <img className={styles.preview} src={previewSrc} alt="" onError={(event) => { event.currentTarget.src = "/library-fallback.png"; }} />
    </a>
  </article>;
}
