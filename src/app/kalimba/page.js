import { Inter, EB_Garamond } from 'next/font/google';
import KalimbaApp from '@/features/kalimba/KalimbaApp';
import art from '@/features/kalimba/instrument-art.json';
import '@/features/kalimba/kalimba.css';

const inter = Inter({ subsets: ['latin'], variable: '--kalimba-sans', display: 'swap' });
const garamond = EB_Garamond({ subsets: ['latin'], variable: '--kalimba-serif', display: 'swap' });

export const metadata = {
  title: 'Kalimba · A little practice',
  description: 'Meet your nine-key kalimba. Record its notes, listen, and learn a little melody. Everything stays in your browser.',
  alternates: { canonical: 'https://play.tonyzeb.com/kalimba' },
};

export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, userScalable: true };

export default function KalimbaPage() {
  return <div className={`${inter.variable} ${garamond.variable} kalimba-root`}><KalimbaApp art={art} /></div>;
}
