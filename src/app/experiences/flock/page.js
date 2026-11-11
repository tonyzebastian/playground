import AppHeader from "@/components/shared/AppHeader";
import Flock from "./Flock";

export const metadata = {
  title: "Flock in Flight - UiGlow",
  description: "Lead a flock of birds across a painted 3D landscape. Steer around aircraft, balloons and hawks, and dive under storms.",
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
