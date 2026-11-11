// Prueba de la estrategia de scalping en 15 min, 30 min y 1 h, en LONG y en SHORT (top 25 cripto).
// Uso: bun lab_tf.ts   → lab_resultados_tf.txt
// Estrategia: ruptura Donchian 20 a favor de la EMA200, stop 2 ATR que sigue al precio (extremo de 10 velas).
// "Clara": volumen ≥ 1,5× la media de 20 velas y ADX(14) ≥ 25. Filtro de mercado: BTC sobre (LONG) / bajo (SHORT) su media de 200 días.
import { writeFileSync } from "fs";
import { join } from "path";
import { load, run, stats, ema, atr, hi, lo, COST, TIER_A, type C, type Strat, type Trade, type TF } from "./lab.ts";
import { adx } from "./lab_top50.ts";

const BTCD: Partial<Record<TF, Map<number, number>>> = {}; // vela → 1 alcista / -1 bajista (BTC vs media de 200 días)
const mk = (side: 1 | -1, clear: boolean, mkt: boolean, tf: TF): Strat => ({
  id: `${side === 1 ? "L" : "S"}${clear ? "c" : ""}${mkt ? "m" : ""}`, name: "", side, tfs: [tf], mk: ["c"], params: { n: 20, sl: 2 },
  make: (k, P, sd) => {
    const c = k.map((x) => x.c), e200 = ema(c, 200), a = atr(k), ax = clear ? adx(k) : [], n = Math.round(P.n), tN = Math.max(2, Math.round(n / 2));
    return {
      entry: (i) => {
        const brk = sd === 1 ? c[i] > hi(k, i, n) && c[i] > e200[i] : c[i] < lo(k, i, n) && c[i] < e200[i];
        if (!brk) return null;
        if (clear) { let va = 0; for (let j = i - 20; j < i; j++) va += k[j].v; va /= 20; if (!(va > 0 && k[i].v >= 1.5 * va && ax[i] >= 25)) return null; }
        if (mkt && BTCD[tf]!.get(k[i].t) !== sd) return null;
        return { sl: c[i] - sd * P.sl * a[i] };
      },
      trail: (_p, j) => (sd === 1 ? lo(k, j + 1, tN) : hi(k, j + 1, tN)), maxBars: 400,
    };
  },
});

const DATA: Partial<Record<TF, Record<string, C[]>>> = {};
for (const tf of ["15m", "30m", "1h"] as TF[]) for (const s of TIER_A) {
  try { const k = await load(s, tf); if (k.length > 1500) (DATA[tf] ??= {})[s] = k; } catch (e) { console.error("✗", s, tf, (e as Error).message); }
  console.error("✓", s, tf);
}
for (const tf of ["15m", "30m", "1h"] as TF[]) {
  const bk = DATA[tf]!.BTCUSDT, per = tf === "15m" ? 96 : tf === "30m" ? 48 : 24, e = ema(bk.map((x) => x.c), 200 * per);
  BTCD[tf] = new Map(bk.map((x, i) => [x.t, i < 200 * per ? 0 : x.c > e[i] ? 1 : -1]));
}
const f2 = (x: number) => x.toFixed(2), rep: string[] = [`SCALPING POR TEMPORALIDAD · top 25 cripto · costes ${(COST * 100).toFixed(2)}% · ${new Date().toISOString().slice(0, 10)}`, ""];
for (const tf of ["15m", "30m", "1h"] as TF[]) {
  const syms = Object.keys(DATA[tf]!);
  const first = Math.min(...syms.map((s) => DATA[tf]![s][0].t));
  rep.push(`══ ${tf} · ${syms.length} criptos · desde ${new Date(first).toISOString().slice(0, 10)} ══`);
  for (const side of [1, -1] as const) for (const [clear, mkt, label] of [[false, false, "regla básica"], [true, false, "solo señales claras"], [true, true, "claras + filtro BTC"]] as const) {
    const S = mk(side, clear, mkt, tf);
    const go = (cost = COST, P = S.params) => syms.flatMap((s) => run(DATA[tf]![s], S, P, tf, s, cost));
    const tr = go(), b = stats(tr), o = stats(tr.filter((x) => x.t >= DATA[tf]![x.sym][Math.floor(DATA[tf]![x.sym].length * 0.7)].t)), d2 = stats(go(2 * COST));
    const rest = [...tr].sort((x, z) => z.r - x.r).slice(Math.ceil(tr.length * 0.05)).reduce((x, t) => x + t.r, 0);
    const sens = [0.8, 1.2].flatMap((m) => ["n", "sl"].map((kk) => stats(go(COST, { ...S.params, [kk]: S.params[kk] * m })).pf));
    const ts = tr.map((x) => x.t), days = tr.length ? (Math.max(...ts) - Math.min(...ts)) / 86400_000 : 1;
    const checks: [string, boolean][] = [["≥100 ops", b.n >= 100], ["PF≥1,15", b.pf >= 1.15], ["no vistos PF≥1,1", o.n >= 30 && o.pf >= 1.1], ["costes dobles PF≥1", d2.pf >= 1], ["sin 5% mejores >0", rest > 0], ["sensibilidad", sens.every((x) => x >= 1)]];
    const pass = checks.every((c) => c[1]), near = checks.filter((c) => !c[1]).length === 1 && !checks[5][1] === false && rest <= 0;
    rep.push(`${pass ? "✅" : near ? "🟡" : "❌"} ${(side === 1 ? "LONG " : "SHORT") + " · " + label.padEnd(20)} ${String(b.n).padStart(5)} ops (${(b.n / Math.max(days, 1)).toFixed(1)}/día) · acierto ${b.win.toFixed(0)}% · PF ${f2(b.pf)} · neto ${b.total.toFixed(0)}R · caída ${b.dd.toFixed(0)}R`,
      `     no vistos PF ${f2(o.pf)} (${o.n}) · costes dobles PF ${f2(d2.pf)} · sin 5% mejores ${rest.toFixed(0)}R · sensibilidad ${sens.map(f2).join("/")} · falla: ${checks.filter((c) => !c[1]).map((c) => c[0]).join(", ") || "nada"}`);
  }
  rep.push("");
}
const txt = rep.join("\n"); writeFileSync(join(import.meta.dir, "lab_resultados_tf.txt"), txt); console.log(txt);
