// Salidas en porcentaje para el scalping de 1h (LONG, señales claras, top 25): objetivo +25% / stop −15% de ganancia sobre el margen.
// Con apalancamiento x10 eso es +2,5% / −1,5% de precio; con x5, +5% / −3%; con x20, +1,25% / −0,75%.
// Se compara con la salida actual (stop 2 ATR que sigue al precio) y con un objetivo fijo que se adapta a la volatilidad (ATR).
// Uso: bun lab_pct.ts → lab_resultados_pct.txt
import { writeFileSync } from "fs";
import { join } from "path";
import { load, run, stats, ema, atr, hi, lo, COST, TIER_A, type C, type Strat } from "./lab.ts";
import { adx } from "./lab_top50.ts";

type Exit = { id: string; name: string; lev: number; kind: "trail" | "pct" | "atr"; sl: number; tp: number };
const EXITS: Exit[] = [
  { id: "ACT", name: "Actual: stop 2 ATR que sigue al precio", lev: 10, kind: "trail", sl: 2, tp: 0 },
  { id: "P20", name: "+25% / −15% con x20 (precio +1,25% / −0,75%)", lev: 20, kind: "pct", sl: 0.75, tp: 1.25 },
  { id: "P10", name: "+25% / −15% con x10 (precio +2,5% / −1,5%)", lev: 10, kind: "pct", sl: 1.5, tp: 2.5 },
  { id: "P5", name: "+25% / −15% con x5 (precio +5% / −3%)", lev: 5, kind: "pct", sl: 3, tp: 5 },
  { id: "ATR", name: "Mismo 25:15 pero según volatilidad (stop 2 ATR, objetivo 3,33 ATR)", lev: 10, kind: "atr", sl: 2, tp: 2 * 25 / 15 },
  { id: "ATR2", name: "Stop 2 ATR, objetivo 2 ATR (1:1)", lev: 10, kind: "atr", sl: 2, tp: 2 },
  { id: "ATR3", name: "Stop 2 ATR, objetivo 6 ATR (1:3)", lev: 10, kind: "atr", sl: 2, tp: 6 },
];
const mk = (X: Exit): Strat => ({
  id: X.id, name: X.name, side: 1, tfs: ["1h"], mk: ["c"], params: { sl: X.sl, tp: X.tp },
  make: (k, P) => {
    const c = k.map((x) => x.c), e200 = ema(c, 200), a = atr(k), ax = adx(k);
    return {
      entry: (i) => {
        if (!(c[i] > hi(k, i, 20) && c[i] > e200[i])) return null;
        let va = 0; for (let j = i - 20; j < i; j++) va += k[j].v; va /= 20;
        if (!(va > 0 && k[i].v >= 1.5 * va && ax[i] >= 25)) return null;
        if (X.kind === "trail") return { sl: c[i] - P.sl * a[i] };
        if (X.kind === "pct") return { sl: c[i] * (1 - P.sl / 100), rr: P.tp / P.sl };
        return { sl: c[i] - P.sl * a[i], rr: P.tp / P.sl };
      },
      trail: X.kind === "trail" ? (_p, j) => lo(k, j + 1, 10) : undefined,
      maxBars: X.kind === "trail" ? 400 : 72, // objetivos fijos: se cierra a mercado si en 3 días no llega a ninguno
    };
  },
});
const DATA: Record<string, C[]> = {};
for (const s of TIER_A) { const k = await load(s, "1h"); if (k.length > 1500) DATA[s] = k; }
const syms = Object.keys(DATA), f2 = (x: number) => x.toFixed(2);
const rep = [`SALIDAS EN % · scalping 1h LONG (señales claras) · ${syms.length} criptos · costes ${(COST * 100).toFixed(2)}% · ${new Date().toISOString().slice(0, 10)}`,
  `"% sobre margen" = ganancia o pérdida de la operación con el apalancamiento indicado (incluye comisiones).`, ""];
for (const X of EXITS) {
  const S = mk(X);
  const trades = (cost = COST, P = S.params) => syms.flatMap((s) => run(DATA[s], S, P, "1h", s, cost));
  // % de precio de cada operación (para pasarlo a % sobre margen)
  const tr = trades(), b = stats(tr), o = stats(tr.filter((x) => x.t >= DATA[x.sym][Math.floor(DATA[x.sym].length * 0.7)].t)), d2 = stats(trades(2 * COST));
  const rest = [...tr].sort((x, z) => z.r - x.r).slice(Math.ceil(tr.length * 0.05)).reduce((x, t) => x + t.r, 0);
  const sens = [0.8, 1.2].flatMap((m) => Object.keys(S.params).filter((kk) => S.params[kk] > 0).map((kk) => stats(trades(COST, { ...S.params, [kk]: S.params[kk] * m })).pf));
  const checks: [string, boolean][] = [["≥100 ops", b.n >= 100], ["PF≥1,15", b.pf >= 1.15], ["no vistos PF≥1,1", o.n >= 30 && o.pf >= 1.1], ["costes dobles PF≥1", d2.pf >= 1], ["sin 5% mejores >0", rest > 0], ["sensibilidad", sens.every((x) => x >= 1)]];
  const ts = tr.map((x) => x.t), days = (Math.max(...ts) - Math.min(...ts)) / 86400_000;
  // riesgo medio en % de precio: para "pct" es fijo; para ATR se estima con el stop medio
  const riskPct = X.kind === "pct" ? X.sl : (() => { let s = 0, n = 0; for (const sym of syms) { const k = DATA[sym], a = atr(k); for (let i = 300; i < k.length; i += 5) { s += (X.sl * a[i]) / k[i].c * 100; n++; } } return s / n; })();
  const avgMargin = b.avg * riskPct * X.lev, w = tr.filter((x) => x.r > 0), l = tr.filter((x) => x.r <= 0);
  const winM = (w.reduce((s, x) => s + x.r, 0) / Math.max(w.length, 1)) * riskPct * X.lev, lossM = (l.reduce((s, x) => s + x.r, 0) / Math.max(l.length, 1)) * riskPct * X.lev;
  rep.push(`${checks.every((c) => c[1]) ? "✅" : checks.filter((c) => !c[1]).length === 1 && rest <= 0 ? "🟡" : "❌"} ${X.name}`,
    `     ${b.n} ops (${(b.n / days).toFixed(1)}/día) · acierto ${b.win.toFixed(0)}% · PF ${f2(b.pf)} · no vistos PF ${f2(o.pf)} · costes dobles PF ${f2(d2.pf)} · caída ${b.dd.toFixed(0)}R`,
    `     con x${X.lev}: ganadora media ${winM >= 0 ? "+" : ""}${winM.toFixed(1)}% · perdedora media ${lossM.toFixed(1)}% · media por operación ${avgMargin >= 0 ? "+" : ""}${avgMargin.toFixed(2)}% sobre margen`,
    `     falla: ${checks.filter((c) => !c[1]).map((c) => c[0]).join(", ") || "nada"}`, "");
}
const txt = rep.join("\n"); writeFileSync(join(import.meta.dir, "lab_resultados_pct.txt"), txt); console.log(txt);
