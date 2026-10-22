import { ArrowUpRight } from '@phosphor-icons/react/ssr';
import styles from './physio.module.css';

export const metadata = {
  title: 'Movewell Physio | Move with confidence',
  description: 'Personalised physiotherapy care for confident, everyday movement.',
};

function MovewellMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles.logoMark}
      viewBox="0 0 48 48"
      fill="none"
    >
      <path d="M8 33C14 33 16.5 15 24 15s10 18 16 18" />
      <path d="M8 24c6 0 8.5 9 16 9s10-18 16-18" />
    </svg>
  );
}

export default function PhysioPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand} aria-label="Movewell Physio">
            <MovewellMark />
            <span>movewell</span><small>physio</small>
          </div>

          <nav className={styles.navigation} aria-label="Preview navigation">
            <span>Care</span>
            <span>Services</span>
            <span>Specialties</span>
            <span>Stories</span>
            <span>Guides</span>
            <span>Insights</span>
            <span>About</span>
          </nav>

          <button className={styles.headerCta} type="button" disabled>
            Book a visit
            <ArrowUpRight weight="bold" size={16} />
          </button>
        </header>

        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.copy}>
            <h1 id="hero-title">
              <span>Every movement</span>
              <span>is a step toward</span>
              <span>a stronger return.</span>
            </h1>
            <p className={styles.intro}>
              One-to-one treatment plans for pain relief, recovery, and moving with more ease in everyday life.
            </p>
            <button className={styles.primaryCta} type="button" disabled>
              Book a visit
              <ArrowUpRight weight="bold" size={17} />
            </button>
          </div>

          <div className={styles.mediaWrap}>
            <div className={styles.mediaFrame}>
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Illustrated Movewell physiotherapy clinic"
              >
                <source src="/client/physio/physio_main.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
