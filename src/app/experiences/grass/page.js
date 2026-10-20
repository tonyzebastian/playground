import AppHeader from "@/components/shared/AppHeader";
import Grass from "./Grass";

export const metadata = {
  title: "Grass Study - UiGlow",
  description: "Tens of thousands of instanced grass blades bending in travelling gusts over a height-field.",
};

export default function GrassPage() {
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 [&_a]:pointer-events-auto">
        <AppHeader title="Grass Study" tone="light" />
      </div>
      <Grass />
    </main>
  );
}
