// ¿Cómo sacar MÁS señales sin perder dinero? Prueba de la misma ruptura en velas de 2h y 4h (además de la de 1h actual).
// Las velas de 2h y 4h se construyen juntando las de 1h. Top 25 cripto, costes 0,14%. Uso: bun lab_mas.ts → lab_resultados_mas.txt
import { writeFileSync } from "fs";
import { join } from "path";
import { load, run, stats, ema, atr, hi, lo, COST, TIER_A, type C, type Strat, type Trade } from "./lab.ts";
import { adx } from "./lab_top50.ts";

const group = (k: C[], n: number): C[] => { const out: C[] = []; for (const x of k) { const b = Math.floor(x.t / (n * 3600_000)); const last = out[out.length - 1] as any; if (last && last._b === b) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; last.v += x.v; last._n++; } else out.push({ ...x, _b: b, _n: 1 } as any); } return out.filter((x: any) => x._n === n); };
const mk = (side: 1 | -1, clear: boolean): Strat => ({ id: "", name: "", side, tfs: ["1h"], mk: ["c"], params: { n: 20, sl: 2 },
  make: (k, P, sd) => { const c = k.map((x) => x.c), e200 = ema(c, 200), a = atr(k), ax = clear ? adx(k) : [], n = Math.round(P.n);
    return { entry: (i) => { const brk = sd === 1 ? c[i] > hi(k, i, n) && c[i] > e200[i] : c[i] < lo(k, i, n) && c[i] < e200[i]; if (!brk) return null;
        if (clear) { let va = 0; for (let j = i - 20; j < i; j++) va += k[j].v; va /= 20; if (!(va > 0 && k[i].v >= 1.5 * va && ax[i] >= 25)) return null; }
        return { sl: c[i] - sd * P.sl * a[i] }; },
      trail: (_p, j) => (sd === 1 ? lo(k, j + 1, 10) : hi(k, j + 1, 10)), maxBars: 400 }; } });
const H1: Record<string, C[]> = {}; for (const s of TIER_A) { const k = await load(s, "1h"); if (k.length > 1500) H1[s] = k; }
const f2 = (x: number) => x.toFixed(2), rep = [`MÁS SEÑALES · ruptura Donchian 20, stop 2 ATR que sigue al precio · top 25 cripto · costes ${(COST * 100).toFixed(2)}%`, ""];
const all: Record<string, Trade[]> = {};
for (const [tfn, mult] of [["1h", 1], ["2h", 2], ["4h", 4]] as const) {
  const D: Record<string, C[]> = {}; for (const s of Object.keys(H1)) { const k = mult === 1 ? H1[s] : group(H1[s], mult); if (k.length > 600) D[s] = k; }
  rep.push(`══ velas de ${tfn} ══`);
  for (const side of [1, -1] as const) for (const clear of [true, false]) {
    const S = mk(side, clear), go = (cost = COST, P = S.params) => Object.keys(D).flatMap((s) => run(D[s], S, P, "1h", s, cost));
    const tr = go(), b = stats(tr), o = stats(tr.filter((x) => x.t >= D[x.sym][Math.floor(D[x.sym].length * 0.7)].t)), d2 = stats(go(2 * COST));
    const rest = [...tr].sort((x, z) => z.r - x.r).slice(Math.ceil(tr.length * 0.05)).reduce((x, t) => x + t.r, 0);
    const sens = [0.8, 1.2].flatMap((m) => ["n", "sl"].map((kk) => stats(go(COST, { ...S.params, [kk]: S.params[kk] * m })).pf));
    const ts = tr.map((x) => x.t), days = (Math.max(...ts) - Math.min(...ts)) / 86400_000;
    const checks: [string, boolean][] = [["≥100 ops", b.n >= 100], ["PF≥1,15", b.pf >= 1.15], ["no vistos PF≥1,1", o.n >= 30 && o.pf >= 1.1], ["costes dobles PF≥1", d2.pf >= 1], ["sin 5% mejores >0", rest > 0], ["sensibilidad", sens.every((x) => x >= 1)]];
    const nf = checks.filter((c) => !c[1]);
    if (side === 1 && clear) all[tfn] = tr;
    rep.push(`${nf.length === 0 ? "✅" : nf.length === 1 && nf[0][0].startsWith("sin 5%") ? "🟡" : "❌"} ${side === 1 ? "LONG " : "SHORT"} ${clear ? "señales claras" : "regla básica  "}  ${String(b.n).padStart(5)} ops (${(b.n / days).toFixed(1)}/día) · acierto ${b.win.toFixed(0)}% · PF ${f2(b.pf)} · no vistos ${f2(o.pf)} · costes dobles ${f2(d2.pf)} · caída ${b.dd.toFixed(0)}R · falla: ${nf.map((c) => c[0]).join(", ") || "nada"}`);
  }
  rep.push("");
}
// combinación: 1h + 4h (LONG, señales claras) — más señales en total
const comb = [...all["1h"], ...all["4h"]], cs = stats(comb), cts = comb.map((x) => x.t), cd = (Math.max(...cts) - Math.min(...cts)) / 86400_000;
rep.push(`COMBINADO 1h + 4h (LONG, señales claras): ${cs.n} ops (${(cs.n / cd).toFixed(1)}/día) · PF ${f2(cs.pf)} · neto ${cs.total.toFixed(0)}R · caída ${cs.dd.toFixed(0)}R`);
const comb2 = [...all["1h"], ...all["2h"], ...all["4h"]], cs2 = stats(comb2);
rep.push(`COMBINADO 1h + 2h + 4h (LONG, señales claras): ${cs2.n} ops (${(cs2.n / cd).toFixed(1)}/día) · PF ${f2(cs2.pf)} · neto ${cs2.total.toFixed(0)}R · caída ${cs2.dd.toFixed(0)}R`);
const txt = rep.join("\n"); writeFileSync(join(import.meta.dir, "lab_resultados_mas.txt"), txt); console.log(txt);
