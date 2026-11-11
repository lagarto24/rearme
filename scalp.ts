// Bot de señales de SCALPING (aparte de Tanatabot Señales). NO es asesoría financiera.
// Uso:  bun scalp.ts --once     una pasada (en GitHub se repite cada 5 minutos)
//       bun scalp.ts --dry      una pasada sin enviar nada a Telegram ni guardar estado (prueba)
//       bun scalp.ts --replay   repite el historial guardado de 1h con esta misma lógica (verificación contra el laboratorio)
//       bun scalp.ts --summary  resumen de resultados (lo envía al grupo si está configurado)
//
// Estrategia EN PRUEBA: ruptura Donchian 20 LONG a favor de la EMA200, en tres temporalidades (top 25 cripto):
//   · 1h: solo rupturas CLARAS (volumen ≥ 1,5 × la media de 20 velas y ADX(14) ≥ 25).
//   · 2h y 4h: regla básica (ruptura + EMA200).
//   Stop inicial 2 × ATR(14); después sube al mínimo de las últimas 10 velas (nunca baja). Sin objetivo fijo.
// Backtest 1h+2h+4h juntos (lab_mas.ts, 3 años, costes 0,14%): ~8 señales/día, PF 1,34, datos no vistos 1,34, último año 1,29.
//   Solo 1h claras: 3,1/día, PF 1,25. No pasa "sin el 5% de las mejores" (depende de pocas operaciones grandes): va en prueba.
// Probado y descartado (pierde con costes reales): velas de 15 y 30 min, todos los SHORT y objetivos fijos tipo +25% / −15%.
// Puestos 26–50 del ranking: no ganan ni con señales claras → solo se vigilan en papel (1h) y salen en el resumen semanal.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ema, atr, hi, lo, TIER_A, TIER_B, HYPERLIQUID, type C } from "./lab.ts";
import { adx } from "./lab_top50.ts";

type TFX = "1h" | "2h" | "4h";
const TF_MS: Record<TFX, number> = { "1h": 3600_000, "2h": 2 * 3600_000, "4h": 4 * 3600_000 };
// Qué temporalidades se envían y con qué regla. Los puestos 26–50 solo se vigilan en 1h (no se envían).
const PLAN: { tf: TFX; clear: boolean }[] = [{ tf: "1h", clear: true }, { tf: "2h", clear: false }, { tf: "4h", clear: false }];
const N = 20, SL_ATR = 2, TRAIL = 10, MAX_BARS = 200, VOL_X = 1.5, ADX_MIN = 25;
const COST = 0.0014, LEV = 10; // apalancamiento de referencia para mostrar los porcentajes
const SEND_TIER = new Set(TIER_A);
// Privados extra (ID de Telegram). Vacío: el socio del proyecto ya está dentro del grupo "Tanatabot Scalping".
const PARTNERS: string[] = [];
const DIR = import.meta.dir, STATE = join(DIR, process.env.SCALP_STATE || "scalp_state.json"); // en GitHub: estado_nube.json
const args = process.argv.slice(2), DRY = args.includes("--dry");

// ───────── Telegram (mismo bot @Tanatabot, otro grupo) ─────────
function token(): string | null {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();
  try { const m = readFileSync(join(homedir(), ".claude", "channels", "telegram", ".env"), "utf8").match(/^TELEGRAM_BOT_TOKEN=(.+)$/m); return m ? m[1].trim() : null; } catch { return null; }
}
function groups(): string[] {
  const env = process.env.SCALP_CHAT_IDS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (env?.length) return env;
  try { return (JSON.parse(readFileSync(join(DIR, "scalp_config.json"), "utf8")).chats ?? []).map(String); } catch { return []; }
}
const TOKEN = token(), GROUPS = groups();
const PAPER = !TOKEN || !GROUPS.length; // sin grupo configurado: modo papel (solo registra, no envía a nadie)
const CHATS = [...new Set([...GROUPS, ...PARTNERS])];
async function send(text: string): Promise<boolean> {
  if (DRY || PAPER) { console.log("— mensaje (no enviado) —\n" + text.replace(/<[^>]+>/g, "")); return true; }
  let okGroup = true;
  for (const chat of CHATS) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }) });
      if (!r.ok) { if (GROUPS.includes(chat)) okGroup = false; console.error("Telegram", chat, r.status, await r.text()); }
    } catch (e) { if (GROUPS.includes(chat)) okGroup = false; console.error("Telegram", chat, (e as Error).message); }
  }
  return okGroup; // un fallo en un privado no hace repetir la señal en el grupo
}

// ───────── Datos ─────────
async function candles(sym: string, tf: TFX): Promise<C[]> {
  const now = Date.now();
  if (HYPERLIQUID[sym]) {
    const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: HYPERLIQUID[sym], interval: tf, startTime: now - 600 * TF_MS[tf], endTime: now } }) });
    if (!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}`);
    return ((await r.json()) as any[]).filter((x) => x.T < now).map((x) => ({ t: x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v }));
  }
  let last: unknown;
  for (const h of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const r = await fetch(`${h}/api/v3/klines?symbol=${sym}&interval=${tf}&limit=600`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()) as any[]).filter((x) => x[6] < now).map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
    } catch (e) { last = e; }
  }
  throw last;
}

// ───────── Lógica (la misma que lab_top50.ts / lab_mas.ts) ─────────
type Pos = { sym: string; tf?: TFX; entry: number; sl: number; stop: number; t: number; lastBar: number; bars: number; obs?: boolean };
type Closed = { sym: string; tf?: TFX; entry: number; exit: number; sl: number; R: number; pct: number; opened: number; closed: number; obs?: boolean };
type State = { open: Record<string, Pos>; last: Record<string, number>; history: Closed[]; lastWeekly?: string; modo?: string };
function loadState(): State {
  const st: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { open: {}, last: {}, history: [] };
  // migración: antes las claves eran solo el símbolo (todo era 1h)
  for (const obj of [st.open, st.last] as Record<string, any>[]) for (const k of Object.keys(obj)) if (!k.includes("|")) { obj[`${k}|1h`] = obj[k]; delete obj[k]; }
  return st;
}

function signal(k: C[], clear: boolean): { price: number; sl: number; t: number; hh: number; vx: number; adx: number } | null {
  const i = k.length - 1; if (i < 210) return null;
  const c = k.map((x) => x.c), e200 = ema(c, 200), a = atr(k), hh = hi(k, i, N);
  if (!(c[i] > hh && c[i] > e200[i])) return null;
  let va = 0; for (let j = i - 20; j < i; j++) va += k[j].v; va /= 20;
  const ax = adx(k)[i], vx = va > 0 ? k[i].v / va : 0;
  if (clear && !(vx >= VOL_X && ax >= ADX_MIN)) return null;
  return { price: c[i], sl: c[i] - SL_ATR * a[i], t: k[i].t, hh, vx, adx: ax };
}
// procesa las velas cerradas nuevas; devuelve el precio de salida si se cerró
function track(p: Pos, k: C[]): number | null {
  for (let m = k.findIndex((x) => x.t > p.lastBar); m >= 0 && m < k.length; m++) {
    const x = k[m]; p.lastBar = x.t; p.bars++;
    if (x.o <= p.stop) return x.o;
    if (x.l <= p.stop) return p.stop;
    if (p.bars >= MAX_BARS) return x.c;
    p.stop = Math.max(p.stop, lo(k, m + 1, TRAIL));
  }
  return null;
}

const name = (s: string) => (s === "GRAMUSDT" ? "GRAM (antes TON)" : s.replace("USDT", ""));
const fmt = (n: number) => (n >= 1000 ? n.toFixed(1) : n >= 1 ? n.toFixed(n >= 100 ? 2 : 3) : n.toPrecision(4));
const pctNum = (a: number, b: number) => ((b - a) / a) * 100;
const sgn = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`;
const entryMsg = (sym: string, tf: TFX, s: NonNullable<ReturnType<typeof signal>>) => {
  const slp = pctNum(s.price, s.sl);
  return [
    `⚡ <b>SCALPING · LONG · ${name(sym)}</b> (${tf.toUpperCase()})`,
    `<i>Estrategia en prueba: usa la mitad de tamaño.</i>`,
    ``,
    `Entrada: <b>${fmt(s.price)} ${HYPERLIQUID[sym] ? "USDC" : "USDT"}</b>`,
    `Stop loss: <b>${fmt(s.sl)}</b> (${sgn(slp)} · con x${LEV}: ${sgn(slp * LEV, 0)})`,
    `Objetivo: sin objetivo fijo, el stop sube con el precio. Te avisamos para cerrar.`,
    ``,
    `Motivo: rompió el máximo de las últimas 20 velas (${fmt(s.hh)}) en tendencia alcista · volumen ${s.vx.toFixed(1)}× · ADX ${s.adx.toFixed(0)}.`,
    `<i>No es asesoramiento financiero.</i>`,
  ].join("\n");
};
const exitMsg = (p: Pos, x: number) => { const r = pctNum(p.entry, x); return `⚡ <b>CERRAR POSICIÓN · ${name(p.sym)}</b> (scalping ${(p.tf ?? "1h").toUpperCase()}) · ${sgn(r)} (con x${LEV}: ${sgn(r * LEV, 0)})`; };

function summary(st: State, days = 7) {
  const since = Date.now() - days * 86400_000, h = st.history.filter((x) => x.closed >= since);
  const line = (hh: Closed[]) => { const w = hh.filter((x) => x.R > 0).length, sum = hh.reduce((a, x) => a + x.pct - COST * 100, 0); return `${hh.length} operaciones · ${w} ganadoras · ${sgn(sum)} de precio sumado (con x${LEV}: ${sgn(sum * LEV, 0)})`; };
  return [`⚡ <b>Scalping · últimos ${days} días</b> (en prueba)`,
    ...PLAN.map((p) => `${p.tf.toUpperCase()}: ${line(h.filter((x) => !x.obs && (x.tf ?? "1h") === p.tf))}`),
    `Vigilancia puestos 26–50 (no enviadas): ${line(h.filter((x) => x.obs))}`,
    `Abiertas ahora: ${Object.values(st.open).filter((p) => !p.obs).length}`, `<i>Resultados con comisiones. Suma de todas las operaciones, cada una con el mismo tamaño.</i>`].join("\n");
}

async function pass() {
  const st = loadState(); const lines: string[] = [];
  const jobs: [string, TFX, boolean, boolean][] = [];
  for (const sym of TIER_A) for (const p of PLAN) jobs.push([sym, p.tf, p.clear, false]);
  for (const sym of TIER_B) jobs.push([sym, "1h", true, true]); // vigilancia, no se envía
  for (const [sym, tf, clear, obs] of jobs) {
    const key = `${sym}|${tf}`, say = (m: string) => (obs ? Promise.resolve(true) : send(m));
    try {
      const k = await candles(sym, tf); if (k.length < 220) { lines.push(`${key}: pocos datos`); continue; }
      const p = st.open[key];
      if (p) {
        const x = track(p, k);
        if (x !== null) {
          if (await say(exitMsg(p, x))) {
            st.history.push({ sym, tf, entry: p.entry, exit: x, sl: p.sl, R: (x - p.entry - COST * p.entry) / (p.entry - p.sl), pct: pctNum(p.entry, x), opened: p.t, closed: Date.now(), ...(obs ? { obs } : {}) });
            delete st.open[key]; lines.push(`${key}: CERRADA en ${fmt(x)}${obs ? " (vigilancia)" : ""}`);
          }
        } else lines.push(`${key}: abierta · stop ${fmt(p.stop)}${obs ? " (vigilancia)" : ""}`);
        continue;
      }
      const last = k[k.length - 1];
      if (st.last[key] === last.t) continue;
      const s = signal(k, clear);
      if (s && (await say(entryMsg(sym, tf, s)))) {
        st.open[key] = { sym, tf, entry: s.price, sl: s.sl, stop: s.sl, t: s.t, lastBar: s.t, bars: 0, ...(obs ? { obs } : {}) };
        lines.push(`${key}: NUEVA LONG en ${fmt(s.price)}${obs ? " (vigilancia, no enviada)" : ""}`);
      }
      st.last[key] = last.t;
    } catch (e) { lines.push(`${key}: error ${(e as Error).message}`); }
  }
  // resumen semanal: domingo a partir de las 19:00 (Madrid), una vez
  const now = new Date(), wd = now.toLocaleDateString("en-GB", { timeZone: "Europe/Madrid", weekday: "short" }), hr = +now.toLocaleString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false });
  const day = now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  if (wd === "Sun" && hr >= 19 && st.lastWeekly !== day && (await send(summary(st)))) st.lastWeekly = day;
  st.modo = PAPER ? "papel (no envía: falta el token o el grupo)" : `envía a ${CHATS.length} chat(s)`; // se ve en el estado publicado
  if (!DRY) writeFileSync(STATE, JSON.stringify(st, null, 2));
  console.log(new Date().toISOString(), PAPER ? "· MODO PAPEL (sin grupo configurado: no se envía nada)" : `· enviando a ${CHATS.length} chat(s)`, DRY ? "· prueba en seco" : "", `· ${jobs.length} revisiones`);
  console.log(lines.join("\n") || "sin cambios");
}

// Verificación: repite el historial guardado de 1h vela a vela con ESTA lógica y compara con el laboratorio
async function replay() {
  let n = 0, R = 0, gw = 0, gl = 0;
  for (const sym of TIER_A) {
    const f = join(DIR, "_cache", `${sym}_1h.json`); if (!existsSync(f)) continue;
    const all: C[] = JSON.parse(readFileSync(f, "utf8")); let p: Pos | null = null;
    for (let i = 260; i < all.length - 1; i++) {
      const k = all.slice(Math.max(0, i - 599), i + 1);
      if (p) { const x = track(p, k); if (x !== null) { const r = (x - p.entry - COST * p.entry) / (p.entry - p.sl); n++; R += r; r > 0 ? (gw += r) : (gl -= r); p = null; } continue; }
      const s = signal(k, true); if (!s) continue;
      const e = all[i + 1].o; if (!(e > s.sl)) continue;
      p = { sym, entry: e, sl: s.sl, stop: s.sl, t: all[i + 1].t, lastBar: all[i].t, bars: 0 };
    }
  }
  console.log(`Replay 1h señales claras (top 25): ${n} ops · PF ${(gw / gl).toFixed(2)} · neto ${R.toFixed(1)}R (laboratorio: 3404 ops · PF 1.25 · 466.3R)`);
}

if (args.includes("--replay")) await replay();
else if (args.includes("--summary")) { const st = loadState(); await send(summary(st)); }
else await pass();
