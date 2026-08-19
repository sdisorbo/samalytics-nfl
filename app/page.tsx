import StandingsView from "./components/StandingsView";

export const metadata = { title: "Standings | Samalytics NFL Engine" };

export default function Page() {
  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-black tracking-tight">Standings</h1>
        <p className="text-sm text-s-muted mt-1 max-w-2xl leading-relaxed">
          Records, games back, and Elo ratings for every team — toggle between league, division,
          and wild-card views. Elo carries across seasons (regressed 30% toward 1500 each offseason).
          Playoff odds through each round are a Monte-Carlo of the bracket from each team&apos;s
          end-of-season Elo.
        </p>
      </div>
      <StandingsView />
    </>
  );
}
