import EloView from "../components/EloView";

export const metadata = { title: "Elo Ratings | Samalytics NFL Engine" };

export default function Page() {
  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-black tracking-tight">Elo Ratings</h1>
        <p className="text-sm text-s-muted mt-1 max-w-2xl leading-relaxed">
          Every team&apos;s end-of-season Elo, and its path across the season. All teams open 2021 at
          1500; ratings move on margin-of-victory-adjusted game results and regress 30% toward the
          mean each offseason. The shaded band is the league&apos;s min–max range.
        </p>
      </div>
      <EloView />
    </>
  );
}
