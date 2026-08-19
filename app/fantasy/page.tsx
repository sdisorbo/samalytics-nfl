import FantasyView from "../components/FantasyView";

export const metadata = { title: "Fantasy WAR | Samalytics NFL Engine" };

export default function Page() {
  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-black tracking-tight">Fantasy WAR</h1>
        <p className="text-sm text-s-muted mt-1 max-w-2xl leading-relaxed">
          Wins Above Replacement for fantasy football — every position plus K and D/ST, back to 2021.
          Enter your own league settings and scoring; the whole board re-ranks live. Defaults are a
          12-team, half-PPR league (1 QB · 2 RB · 2 WR · 1 TE · 2 FLEX · 1 K · 1 D/ST, pass TD = 4).
        </p>
      </div>
      <FantasyView />
    </>
  );
}
