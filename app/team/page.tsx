import { Suspense } from "react";
import TeamPage from "../components/TeamPage";

export const metadata = { title: "Team | Samalytics NFL Engine" };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-s-muted text-sm">Loading…</p>}>
      <TeamPage />
    </Suspense>
  );
}
