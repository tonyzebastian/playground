import AppHeader from "@/components/shared/AppHeader";
import MeadowStudio from "./MeadowStudio";

export const metadata = {
  title: "Windy Meadow - UiGlow",
  description: "Long grass combed by travelling gusts, with every look and motion parameter tweakable.",
};

export default function MeadowPage() {
  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <AppHeader title="Windy Meadow" />
      <MeadowStudio />
    </main>
  );
}
