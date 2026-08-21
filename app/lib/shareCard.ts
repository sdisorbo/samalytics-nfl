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

// ── field-plot share cards ───────────────────────────────────────────────────
import { GAP_ORDER, GAP_LABEL } from "./players";

export type FieldCardSpec = {
  name: string; pos: string; team: string; hs: string;
  title: string; subtitle: string;
  defense: boolean; kind: "field" | "rush";
  metricLabel: string; keyLow: string; keyHigh: string;
  summary: { label: string; value: string; sign?: number }[];
  dmin?: number; dmax?: number;
  zones?: { lane: number; bin: number; t: number; text?: string }[];
  dots?: { lane: number; ay: number; complete: number }[];
  gaps?: { gap: string; t: number; att: number; text: string }[];
};

const F_GRASS = "#16281D", HG: [number, number, number] = [0x37, 0xc0, 0x65], HP: [number, number, number] = [0xba, 0x61, 0xda];
const F_BINS = [-100, 0, 5, 10, 15, 20, 30, 100];
const LOS_B = "#2f6fed", FD_G = "#ecc94b";

function heat(t: number): string {
  const base = [0x16, 0x28, 0x1d], tgt = t >= 0 ? HG : HP, a = Math.min(1, Math.abs(t)) * 0.85;
  const c = base.map((g, i) => Math.round(g + (tgt[i] - g) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

async function renderFieldCard(s: FieldCardSpec): Promise<HTMLCanvasElement> {
  const W = 720, SCALE = 2, pad = 26;
  const H = s.kind === "field" ? 596 : 430;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = BORDER; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const [logo, mark, head] = await Promise.all([
    loadImg(logoUrl(s.team)).catch(() => null),
    loadImg("/samalytics_nfl_logo.png"),
    s.hs ? loadImg(s.hs).catch(() => null) : Promise.resolve(null),
  ]);

  // header
  const hx = pad, hy = pad;
  if (head) { ctx.save(); ctx.beginPath(); ctx.arc(hx + 24, hy + 24, 24, 0, 7); ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.clip(); ctx.drawImage(head, hx, hy, 48, 48); ctx.restore(); }
  else if (logo) drawContain(ctx, logo, hx, hy, 48);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TXT; ctx.font = "800 21px Inter, system-ui, sans-serif";
  ctx.fillText(s.name, hx + 60, hy + 20);
  ctx.fillStyle = MUT; ctx.font = "600 12px Inter, system-ui, sans-serif";
  let sx = hx + 60;
  ctx.fillText(s.pos, sx, hy + 40); sx += ctx.measureText(s.pos).width + 8;
  if (logo && s.hs) { drawContain(ctx, logo, sx, hy + 29, 15); sx += 19; }
  ctx.fillText(s.team, sx, hy + 40);
  // title / subtitle (right)
  ctx.textAlign = "right";
  ctx.fillStyle = GRN; ctx.font = "800 15px Inter, system-ui, sans-serif";
  ctx.fillText(s.title, W - pad, hy + 16);
  ctx.fillStyle = MUT; ctx.font = "500 12px Inter, system-ui, sans-serif";
  ctx.fillText(s.subtitle, W - pad, hy + 34);
  ctx.strokeStyle = BORDER; ctx.beginPath(); ctx.moveTo(pad, hy + 58); ctx.lineTo(W - pad, hy + 58); ctx.stroke();

  const bodyY = hy + 74;

  if (s.kind === "field") {
    const fw = 322, fh = 452, fx = pad, fy = bodyY, ftop = 14, fbot = fh - 22;
    const dmin = s.dmin!, dmax = s.dmax!;
    const yOf = (d: number) => fy + fbot - ((d - dmin) / (dmax - dmin || 1)) * (fbot - ftop);
    const band = (l: number): [number, number] => [fx + (l / 3) * fw, fx + ((l + 1) / 3) * fw];
    ctx.fillStyle = F_GRASS; ctx.fillRect(fx, fy, fw, fh);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (const z of s.zones ?? []) {
      const [x0, x1] = band(z.lane);
      const y1 = yOf(Math.max(F_BINS[z.bin], dmin)), y0 = yOf(Math.min(F_BINS[z.bin + 1], dmax));
      ctx.fillStyle = heat(z.t); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (z.text) { ctx.fillStyle = TXT; ctx.font = "700 11px Inter, system-ui, sans-serif"; ctx.fillText(z.text, (x0 + x1) / 2, (y0 + y1) / 2 + 4); }
    }
    // yard lines
    ctx.textAlign = "left"; ctx.font = "9px Inter, system-ui, sans-serif";
    for (let d = Math.ceil(dmin / 5) * 5; d <= dmax; d += 5) {
      if (d === 0 || d === 10) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.beginPath(); ctx.moveTo(fx, yOf(d)); ctx.lineTo(fx + fw, yOf(d)); ctx.stroke();
      ctx.fillStyle = MUT; ctx.fillText(d > 0 ? `+${d}` : `${d}`, fx + 3, yOf(d) - 3);
    }
    ctx.strokeStyle = LOS_B; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(fx, yOf(0)); ctx.lineTo(fx + fw, yOf(0)); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillStyle = LOS_B; ctx.font = "700 9px Inter, system-ui, sans-serif"; ctx.fillText("LOS", fx + fw - 2, yOf(0) - 3);
    if (dmax >= 10) { ctx.strokeStyle = FD_G; ctx.beginPath(); ctx.moveTo(fx, yOf(10)); ctx.lineTo(fx + fw, yOf(10)); ctx.stroke(); ctx.fillStyle = FD_G; ctx.fillText("1ST", fx + fw - 2, yOf(10) - 3); }
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.setLineDash([2, 5]);
    for (const l of [1, 2]) { ctx.beginPath(); ctx.moveTo(band(l)[0], fy + ftop); ctx.lineTo(band(l)[0], fy + fbot); ctx.stroke(); }
    ctx.setLineDash([]);
    // dots
    (s.dots ?? []).forEach((dt, i) => {
      const [x0, x1] = band(dt.lane);
      const jx = x0 + 6 + ((i * 2654435761) % 1000) / 1000 * (x1 - x0 - 12);
      ctx.beginPath(); ctx.arc(jx, yOf(dt.ay), 2.7, 0, 7);
      ctx.fillStyle = dt.complete ? GRN : MUT; ctx.globalAlpha = dt.complete ? 0.9 : 0.5; ctx.fill(); ctx.globalAlpha = 1;
    });
    ctx.textAlign = "center"; ctx.fillStyle = MUT; ctx.font = "700 9px Inter, system-ui, sans-serif";
    ["LEFT", "MIDDLE", "RIGHT"].forEach((l, i) => ctx.fillText(l, (band(i)[0] + band(i)[1]) / 2, fy + fh - 4));

    drawSummaryKey(ctx, s, fx + fw + 30, bodyY, W - pad - (fx + fw + 30));
  } else {
    // rush strip
    const rw = W - 2 * pad, rx = pad, ry = bodyY, rh = 150, n = 7, gw = rw / n;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    (s.gaps ?? []).forEach((g, i) => {
      const cx = rx + i * gw;
      ctx.fillStyle = g.att ? heat(g.t) : F_GRASS; rr(ctx, cx + 2, ry, gw - 4, rh - 22, 6); ctx.fill();
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = MUT; ctx.font = "700 11px Inter, system-ui, sans-serif"; ctx.fillText(g.gap, cx + gw / 2, ry + 18);
      if (g.att) {
        ctx.fillStyle = TXT; ctx.font = "800 18px Inter, system-ui, sans-serif"; ctx.fillText(g.text, cx + gw / 2, ry + (rh - 22) / 2 + 8);
        ctx.fillStyle = MUT; ctx.font = "10px Inter, system-ui, sans-serif"; ctx.fillText(`${g.att} att`, cx + gw / 2, ry + rh - 30);
      }
      ctx.fillStyle = MUT; ctx.font = "9px Inter, system-ui, sans-serif"; ctx.fillText(GAP_LABEL[g.gap].replace("Left ", "L ").replace("Right ", "R "), cx + gw / 2, ry + rh - 6);
    });
    ctx.strokeStyle = LOS_B; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(rx, ry + rh + 4); ctx.lineTo(rx + rw, ry + rh + 4); ctx.stroke();
    ctx.fillStyle = LOS_B; ctx.textAlign = "center"; ctx.font = "9px Inter, system-ui, sans-serif"; ctx.fillText("line of scrimmage", W / 2, ry + rh + 18);
    drawSummaryKey(ctx, s, pad, ry + rh + 34, rw, true);
  }

  // branding bottom-right
  const by = H - 32;
  ctx.textAlign = "right"; ctx.fillStyle = GRN; ctx.font = "900 15px Inter, system-ui, sans-serif";
  ctx.fillText("SAMALYTICS", W - pad, by + 4);
  ctx.fillStyle = MUT; ctx.font = "700 8.5px Inter, system-ui, sans-serif";
  ctx.fillText("N F L   E N G I N E", W - pad, by + 16);
  const lw = ctx.measureText("SAMALYTICS").width;
  drawContain(ctx, mark, W - pad - lw - 42, by - 16, 32);
  return canvas;
}

function drawSummaryKey(ctx: CanvasRenderingContext2D, s: FieldCardSpec, x: number, y: number, w: number, horizontal = false) {
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  if (horizontal) {
    let cx = x;
    for (const st of s.summary) {
      ctx.fillStyle = MUT; ctx.font = "600 10px Inter, system-ui, sans-serif"; ctx.fillText(st.label.toUpperCase(), cx, y + 10);
      ctx.fillStyle = st.sign != null ? (st.sign >= 0 ? GRN : "#c98cff") : TXT; ctx.font = "800 20px Inter, system-ui, sans-serif"; ctx.fillText(st.value, cx, y + 32);
      cx += Math.max(96, ctx.measureText(st.value).width + 40);
    }
    drawKey(ctx, x, y + 52, Math.min(300, w), s);
  } else {
    let cy = y + 6;
    for (const st of s.summary) {
      ctx.fillStyle = MUT; ctx.font = "600 10px Inter, system-ui, sans-serif"; ctx.fillText(st.label.toUpperCase(), x, cy);
      ctx.fillStyle = st.sign != null ? (st.sign >= 0 ? GRN : "#c98cff") : TXT; ctx.font = "800 22px Inter, system-ui, sans-serif"; ctx.fillText(st.value, x, cy + 22);
      cy += 52;
    }
    drawKey(ctx, x, cy + 6, Math.min(220, w), s);
  }
}

function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, s: FieldCardSpec) {
  ctx.textAlign = "left"; ctx.fillStyle = MUT; ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.fillText(`${s.metricLabel} · vs league`, x, y);
  const by = y + 8, bh = 10;
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, `rgb(${HP[0]},${HP[1]},${HP[2]})`); grad.addColorStop(0.5, F_GRASS); grad.addColorStop(1, `rgb(${HG[0]},${HG[1]},${HG[2]})`);
  ctx.fillStyle = grad; rr(ctx, x, by, w, bh, 3); ctx.fill();
  ctx.fillStyle = MUT; ctx.font = "9px Inter, system-ui, sans-serif";
  ctx.textAlign = "left"; ctx.fillText(s.keyLow, x, by + bh + 12);
  ctx.textAlign = "right"; ctx.fillText(s.keyHigh, x + w, by + bh + 12);
}

function saveNamed(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyFieldCard(s: FieldCardSpec): Promise<"copied" | "saved"> {
  const blob = await toBlob(await renderFieldCard(s));
  const fname = `samalytics-${s.name.replace(/\s+/g, "-")}-${s.title.replace(/\s+/g, "-")}.png`;
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return "copied"; }
  catch { saveNamed(blob, fname); return "saved"; }
}
