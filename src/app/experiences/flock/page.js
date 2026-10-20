import AppHeader from "@/components/shared/AppHeader";
import Flock from "./Flock";

export const metadata = {
  title: "Flock in Flight - UiGlow",
  description: "A flock of birds gliding over ever-changing landscapes. Press and hold to fly faster.",
};

export default function FlockPage() {
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 [&_a]:pointer-events-auto">
        <AppHeader title="Flock in Flight" tone="light" />
      </div>
      <Flock showHint />
    </main>
  );
}
