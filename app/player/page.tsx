import { Suspense } from "react";
import PlayerPage from "../components/PlayerPage";

export const metadata = { title: "Player | Samalytics NFL Engine" };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-s-muted text-sm">Loading…</p>}>
      <PlayerPage />
    </Suspense>
  );
}
