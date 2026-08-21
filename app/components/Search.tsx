"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadIndex, type IndexPlayer } from "../lib/players";
import { logoUrl, TEAMS } from "../lib/teams";

type Result =
  | { kind: "team"; abbr: string; name: string }
  | { kind: "player"; p: IndexPlayer };

export default function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState<IndexPlayer[] | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !idx) loadIndex().then((d) => { setIdx(d.players); setTeams(d.teams); });
  }, [open, idx]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (e.key === "/" && /input|textarea/i.test((e.target as HTMLElement)?.tagName)) return;
        e.preventDefault(); setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query || !idx) return [];
    const out: Result[] = [];
    for (const abbr of teams) {
      const nm = TEAMS[abbr]?.name ?? abbr;
      if (abbr.toLowerCase().includes(query) || nm.toLowerCase().includes(query))
        out.push({ kind: "team", abbr, name: nm });
    }
    const pl = idx
      .filter((p) => p.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.toLowerCase().indexOf(query) - b.name.toLowerCase().indexOf(query))
      .slice(0, 12);
    for (const p of pl) out.push({ kind: "player", p });
    return out.slice(0, 16);
  }, [q, idx, teams]);

  useEffect(() => { setSel(0); }, [q]);

  function go(r: Result) {
    setOpen(false); setQ("");
    if (r.kind === "team") router.push(`/team?abbr=${r.abbr}`);
    else router.push(`/player?id=${r.p.id}`);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && results[sel]) go(results[sel]);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search players and teams"
        className="w-8 h-8 flex items-center justify-center rounded-full text-s-muted hover:text-s-text hover:bg-s-hover transition-colors">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
          style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg stat-card !p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 border-b border-s-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Search any player or team…"
                className="flex-1 bg-transparent py-3 text-sm outline-none text-s-text" />
              <kbd className="text-2xs text-s-muted border border-s-border rounded px-1.5 py-0.5">esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto">
              {results.map((r, i) => (
                <button key={r.kind === "team" ? "t" + r.abbr : "p" + r.p.id}
                  onMouseEnter={() => setSel(i)} onClick={() => go(r)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left"
                  style={{ background: i === sel ? "var(--color-hover)" : "transparent" }}>
                  <img src={logoUrl(r.kind === "team" ? r.abbr : r.p.team)} alt="" width={22} height={22}
                    className="object-contain shrink-0" style={{ width: 22, height: 22 }} />
                  <span className="font-semibold text-sm truncate">{r.kind === "team" ? r.name : r.p.name}</span>
                  <span className="ml-auto text-2xs text-s-muted shrink-0">
                    {r.kind === "team" ? "Team" : `${r.p.pos}${r.p.team ? " · " + r.p.team : ""}`}
                  </span>
                </button>
              ))}
              {q && results.length === 0 && idx && (
                <div className="px-3 py-6 text-sm text-s-muted text-center">No matches.</div>
              )}
              {!q && (
                <div className="px-3 py-6 text-xs text-s-muted text-center">
                  Search any player or team. <span className="hidden sm:inline">Try ⌘K or /.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
