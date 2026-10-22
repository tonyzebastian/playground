import { Merriweather, Raleway } from "next/font/google";
import "./globals.css";
import "dialkit/styles.css";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import DockNavigation from "@/components/shared/DockNavigation";

const merriweather = Merriweather({
  variable: "--font-merriweather",
  subsets: ["latin"],
  // Typically for headings you might only need a few weights
  weight: ["400", "700", "900"],
  display: 'swap',
});

const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
  // Full range of weights for body text
  weight: ["300", "400", "500", "600", "700"],
  display: 'swap',
});

export const viewport = {
  width: 'device-width',
  initialScale: 1.0,
  maximumScale: 1.0,
  userScalable: false,
};

export const metadata = {
  title: 'Play ✦ Tony',
  description: 'A visual product designer | Love to code | always tinkering with a side project',
  keywords: 'design, UI, animations, interactions, canvas, creative coding',
  author: 'Tony Sebastian',
  robots: 'index,follow',
  'mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-title': 'Play ✦ Tony',
  'apple-mobile-web-app-status-bar-style': 'black-translucent',
  alternates: {
    canonical: 'https://play.tonyzeb.com',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@tonyzebastian',
    creator: '@tonyzebastian',
    title: 'Play ✦ Tony',
    description: 'A visual product designer | Love to code | always tinkering with a side project',
    image: 'https://play.tonyzeb.com/thumbnails/preview.png',
    imageAlt: 'Play ✦ Tony - UI Experiments & Interactions',
  },
  openGraph: {
    title: 'Play ✦ Tony',
    description: 'A visual product designer | Love to code | always tinkering with a side project',
    url: 'https://play.tonyzeb.com/',
    siteName: 'Play ✦ Tony',
    images: [{
      url: 'https://play.tonyzeb.com/thumbnails/preview.png',
      alt: 'Play ✦ Tony - UI Experiments & Interactions',
      width: 1200,
      height: 630,
    }],
    locale: 'en_US',
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${merriweather.variable} ${raleway.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Ensure light mode is set immediately (before React hydration)
              document.documentElement.classList.remove('dark');

              // Pages shown inside the home split panel drop their own
              // breadcrumb header; the panel renders it instead.
              if (window.self !== window.top) document.documentElement.dataset.embed = '';

              // A pathname beginning with // is parsed by Next's client router as
              // a protocol-relative URL (for example, //vault/links becomes
              // https://vault/links). Normalize accidental duplicate slashes
              // before hydration so navigation remains on this origin.
              if (window.location.pathname.startsWith('//')) {
                const normalizedPathname = window.location.pathname.replace(/^\\/+/, '/');
                window.history.replaceState(
                  window.history.state,
                  '',
                  normalizedPathname + window.location.search + window.location.hash
                );
              }
            `,
          }}
        />
      </head>
      <body>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <DockNavigation />
      </body>
    </html>
  );
}
