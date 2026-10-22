import styles from "./Vault.module.css";

export const metadata = { title: "Vault | UiGlow", robots: { index: false, follow: false } };

const sections = [
  { href: "/vault/links", title: "Library", description: "A living index of visual references and websites worth returning to." },
  { href: "/vault/shaders", title: "Shaders", description: "Reusable visual pieces, their source, previews, contracts, and notes." },
  { href: "/vault/experiments/pond", title: "Layered pond", description: "A complete interactive experiment composed from shader and canvas pieces." },
  { href: "/vault/experiments/turtle", title: "Happy turtle", description: "A cartoon sea turtle you can spin in 3D, drawn as pure SVG with no 3D library." },
];

export default function VaultPage() {
  return <main className={styles.page}>
    <header className={styles.header}><h1>Vault</h1></header>
    <section className={styles.list} aria-label="Vault sections">{sections.map((section) => <a key={section.href} className={styles.row} href={section.href}><h2>{section.title}</h2><p>{section.description}</p></a>)}</section>
  </main>;
}
