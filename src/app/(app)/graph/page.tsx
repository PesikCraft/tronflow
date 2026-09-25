import { Suspense } from "react";
import { GraphExplorer } from "@/components/GraphExplorer";

export default function GraphPage() {
  return (
    <div className="mx-auto max-w-[1600px]">
      <Suspense>
        <GraphExplorer />
      </Suspense>
    </div>
  );
}
