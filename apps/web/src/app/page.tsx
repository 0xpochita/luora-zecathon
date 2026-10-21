import { Suspense } from "react";
import { InspectorApp } from "@/components/inspector-app";

function ShellFallback() {
  return <div className="min-h-dvh dot-grid" aria-busy="true" />;
}

export default function Home() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <InspectorApp />
    </Suspense>
  );
}
