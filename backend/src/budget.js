// Keeps the Worker inside D1's free plan (100,000 rows written per UTC day).
// Every statement's result reports how many rows it wrote (indexes
// included); a wrapped DB adds those up, and each invocation saves its total
// to usage_daily with one extra write. Work is gated on the day's total:
//   below SOFT_LIMIT  everything runs
//   SOFT..HARD        optional work (re-processing, backfills, clean-up)
//                     pauses; scans and attack alerts keep running
//   above HARD_LIMIT  nothing is written until the next UTC day
export const DAILY_WRITE_LIMIT = 100000;
export const SOFT_LIMIT = 60000;
export const HARD_LIMIT = 85000;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function countingEnv(env) {
  const counter = { written: 0 };
  const raw = new WeakMap();
  const count = (result) => {
    counter.written += Number(result?.meta?.rows_written || 0);
    return result;
  };
  const wrapStatement = (statement) => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind") return (...args) => wrapStatement(target.bind(...args));
        if (prop === "run" || prop === "all") return async (...args) => count(await target[prop](...args));
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    raw.set(proxy, statement);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") return (sql) => wrapStatement(target.prepare(sql));
      if (prop === "batch") {
        return async (statements) => {
          const results = await target.batch(statements.map((statement) => raw.get(statement) || statement));
          results.forEach(count);
          return results;
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { env: { ...env, DB: db }, counter };
}

export async function usageToday(env) {
  const row = await env.DB.prepare(`SELECT rows_written FROM usage_daily WHERE day = ?`).bind(today()).first();
  return Number(row?.rows_written || 0);
}

export async function recordUsage(env, written) {
  if (!written) return;
  await env.DB.prepare(`
    INSERT INTO usage_daily (day, rows_written) VALUES (?, ?)
    ON CONFLICT (day) DO UPDATE SET rows_written = usage_daily.rows_written + excluded.rows_written
  `).bind(today(), written + 1).run();
}

export function budgetState(used) {
  return used >= HARD_LIMIT ? "paused_all" : used >= SOFT_LIMIT ? "paused_optional" : "ok";
}
