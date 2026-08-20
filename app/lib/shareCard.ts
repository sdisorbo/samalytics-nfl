// Renders a branded, shareable PNG of a single matchup on a canvas, so a game
// box can be copied to the clipboard (or saved) and sent. Team logos load with
// CORS so the canvas stays exportable; the Samalytics mark is local.
import { logoUrl, teamColor, TEAMS } from "./teams";
import type { Game } from "./games";
import { fmtTime, fmtDay } from "./games";

const teamName = (a: string) => TEAMS[a]?.name ?? a;

const BG = "#0C1A11", TXT = "#E7F0E9", MUT = "#8CA795", GRN = "#37C065", TRACK = "#24382B", BORDER = "#25402E";

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// draw an image contained in a box, centered
function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, box: number) {
  const r = Math.min(box / img.width, box / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, x + (box - w) / 2, y + (box - h) / 2, w, h);
}

async function renderCard(g: Game): Promise<HTMLCanvasElement> {
  const W = 620, H = 312, S = 2, pad = 26;
  const canvas = document.createElement("canvas");
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S);

  // background
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const played = g.hs != null && g.as != null;
  const homeTop = played ? (g.hs as number) >= (g.as as number) : g.hwp >= 0.5;
  const homePct = Math.round(g.hwp * 100), awayPct = 100 - homePct;

  const [away, home, mark] = await Promise.all([
    loadImg(logoUrl(g.away)), loadImg(logoUrl(g.home)), loadImg("/samalytics_nfl_logo.png"),
  ]);

  // header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = MUT; ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`NFL · ${g.wk === 1 ? "Week 1" : "Week " + g.wk}`, pad, 34);
  ctx.textAlign = "right";
  ctx.fillText(`${fmtDay(g.date, g.day)}${g.time ? " · " + fmtTime(g.time) : ""}${g.neutral ? " · neutral" : ""}`, W - pad, 34);
  ctx.strokeStyle = BORDER; ctx.beginPath(); ctx.moveTo(pad, 48); ctx.lineTo(W - pad, 48); ctx.stroke();

  // a team row centered on cy
  function row(logo: HTMLImageElement, abbr: string, elo: number, win: number, loss: number,
    pct: number, score: number | null, isHome: boolean, isTop: boolean, cy: number) {
    drawContain(ctx, logo, pad, cy - 27, 54);
    const tx = pad + 70;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = TXT; ctx.font = "700 22px Inter, system-ui, sans-serif";
    const name = teamName(abbr);
    ctx.fillText(name, tx, cy - 4);
    if (isHome) {
      const nw = ctx.measureText(name).width;
      ctx.fillStyle = MUT; ctx.font = "500 12px Inter, system-ui, sans-serif";
      ctx.fillText("(home)", tx + nw + 8, cy - 4);
    }
    // sub line: Elo · W +x / L -y  (colored segments)
    let sx = tx; const subY = cy + 17;
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillStyle = MUT; ctx.fillText(`Elo ${elo.toFixed(0)}   `, sx, subY); sx += ctx.measureText(`Elo ${elo.toFixed(0)}   `).width;
    ctx.fillStyle = GRN; const wt = `W ${win >= 0 ? "+" : ""}${win}`; ctx.fillText(wt, sx, subY); sx += ctx.measureText(wt).width;
    ctx.fillStyle = MUT; ctx.fillText(` / L ${loss}`, sx, subY);
    // right: pct or score
    ctx.textAlign = "right";
    if (played) {
      ctx.fillStyle = isTop ? GRN : MUT; ctx.font = "800 32px Inter, system-ui, sans-serif";
      ctx.fillText(String(score), W - pad, cy + 8);
    } else {
      ctx.fillStyle = isTop ? GRN : TXT; ctx.font = "800 28px Inter, system-ui, sans-serif";
      ctx.fillText(`${pct}%`, W - pad, cy + 6);
    }
  }

  row(away, g.away, g.ae, g.aWin, g.aLoss, awayPct, g.as, false, !homeTop, 96);

  // win-prob bar (upcoming only), favored slice in team color
  if (!played) {
    const by = 150, bw = W - 2 * pad, bh = 6;
    const fav = teamColor(homeTop ? g.home : g.away);
    ctx.fillStyle = TRACK; ctx.fillRect(pad, by, bw, bh);
    const awW = bw * awayPct / 100;
    ctx.fillStyle = homeTop ? TRACK : fav; ctx.fillRect(pad, by, awW, bh);
    ctx.fillStyle = homeTop ? fav : TRACK; ctx.fillRect(pad + awW, by, bw - awW, bh);
  }

  row(home, g.home, g.he, g.hWin, g.hLoss, homePct, g.hs, true, homeTop, played ? 200 : 214);

  // branding, bottom-right
  const by = H - 34;
  ctx.textAlign = "right";
  ctx.fillStyle = GRN; ctx.font = "900 15px Inter, system-ui, sans-serif";
  ctx.fillText("SAMALYTICS", W - pad, by + 4);
  ctx.fillStyle = MUT; ctx.font = "700 8.5px Inter, system-ui, sans-serif";
  ctx.fillText("N F L   E N G I N E", W - pad, by + 16);
  const lw = ctx.measureText("SAMALYTICS").width;
  drawContain(ctx, mark, W - pad - lw - 40, by - 16, 32);

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => canvas.toBlob((b) => res(b as Blob), "image/png"));
}

/** Copy the matchup PNG to the clipboard; fall back to a download if the
 *  browser won't allow clipboard image writes. Returns what happened. */
export async function copyGameCard(g: Game): Promise<"copied" | "saved"> {
  const canvas = await renderCard(g);
  const blob = await toBlob(canvas);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    saveBlob(blob, g);
    return "saved";
  }
}

export async function downloadGameCard(g: Game): Promise<void> {
  const canvas = await renderCard(g);
  saveBlob(await toBlob(canvas), g);
}

function saveBlob(blob: Blob, g: Game) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `samalytics-${g.away}-${g.home}-wk${g.wk}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
