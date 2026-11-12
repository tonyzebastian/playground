import AppHeader from "@/components/shared/AppHeader";
import Flock from "./Flock";

const socialPreview = {
  url: "https://play.tonyzeb.com/thumbnails/flock-social-preview.png",
  width: 1200,
  height: 630,
  alt: "Flock in Flight title over a flock flying above a riverside village",
};

const title = "Flock in Flight - UiGlow";
const description = "Lead a flock of birds across a painted 3D landscape. Steer around aircraft, balloons and hawks, and dive under storms.";
const url = "https://play.tonyzeb.com/experiences/flock";

export const metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: "Play ✦ Tony",
    type: "website",
    images: [socialPreview],
  },
  twitter: {
    card: "summary_large_image",
    site: "@tonyzebastian",
    creator: "@tonyzebastian",
    title,
    description,
    images: [socialPreview],
  },
};

export default function FlockPage() {
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 [&_a]:pointer-events-auto">
        <AppHeader title="Flock in Flight" tone="light" />
      </div>
      <Flock game />
    </main>
  );
}
