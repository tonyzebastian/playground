import AppHeader from "@/components/shared/AppHeader";
import Turtle from "@/features/turtle/Turtle";

export const metadata = { title: "Happy turtle | UiGlow", robots: { index: false, follow: false } };

export default function TurtleExperimentPage() {
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 [&_a]:pointer-events-auto">
        <AppHeader title="Happy Turtle" />
      </div>
      <Turtle showHint />
    </main>
  );
}
