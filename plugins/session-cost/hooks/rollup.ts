import type { AgentMeta, AgentRollup, RequestRow, RollupBucket, SessionRollup } from '../types'
import type { Share } from './ledger'

/** The type label of a subagent the mod never saw spawned (one started before it loaded). */
export const UNKNOWN_AGENT_TYPE = 'subagent'

export function emptyBucket(): RollupBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, estUsd: 0, ledgerUsd: 0, durationMs: 0 }
}

export function emptyRollup(): SessionRollup {
  return {
    firstAt: 0,
    lastAt: 0,
    durationMs: 0,
    byKind: { main: emptyBucket(), subagent: emptyBucket(), compact: emptyBucket() },
    byModel: {},
    byAgent: {},
  }
}

/** How many requests the rollup counts. */
export function rollupRequests(r: SessionRollup): number {
  return r.byKind.main.requests + r.byKind.subagent.requests + r.byKind.compact.requests
}

/** `a` with `b` added (`sign` 1) or taken away (`sign` -1), field by field; any other field of `a` kept. */
function combine<T extends RollupBucket>(a: T, b: RollupBucket, sign: 1 | -1): T {
  return {
    ...a,
    input: a.input + sign * b.input,
    output: a.output + sign * b.output,
    cacheRead: a.cacheRead + sign * b.cacheRead,
    cacheWrite: a.cacheWrite + sign * b.cacheWrite,
    requests: a.requests + sign * b.requests,
    estUsd: a.estUsd + sign * b.estUsd,
    ledgerUsd: a.ledgerUsd + sign * b.ledgerUsd,
    durationMs: a.durationMs + sign * b.durationMs,
  }
}

/** Two buckets summed; any other field of `a` (an agent's type) kept. */
export function addBuckets<T extends RollupBucket>(a: T, b: RollupBucket): T {
  return combine(a, b, 1)
}

/** `b` taken from `a`; any other field of `a` kept. */
export function subtractBuckets<T extends RollupBucket>(a: T, b: RollupBucket): T {
  return combine(a, b, -1)
}

/** One request as a bucket of its own. */
function rowBucket(row: RequestRow): RollupBucket {
  return {
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
    requests: 1,
    estUsd: row.estUsd ?? 0,
    ledgerUsd: row.ledgerUsd ?? 0,
    durationMs: row.durationMs,
  }
}

function plusRow<T extends RollupBucket>(b: T, row: RequestRow): T {
  return addBuckets(b, rowBucket(row))
}

function plusUsd<T extends RollupBucket>(b: T, usd: number): T {
  return addBuckets(b, { ...emptyBucket(), ledgerUsd: usd })
}

/** An agent's entry, made with an unknown type when the rollup has none yet. */
function agentOf(r: SessionRollup, id: string): AgentRollup {
  return r.byAgent[id] ?? { ...emptyBucket(), type: UNKNOWN_AGENT_TYPE }
}

/** Notes what a subagent was spawned as, keeping what it already counted. */
export function setAgentMeta(r: SessionRollup, id: string, meta: AgentMeta): SessionRollup {
  const a = agentOf(r, id)
  return {
    ...r,
    byAgent: { ...r.byAgent, [id]: { ...a, type: meta.type, ...(meta.parentId === undefined ? {} : { parentId: meta.parentId }) } },
  }
}

/** Counts a recorded row (any ledger share it holds included) by kind, model and, for a subagent's, its agent. */
export function addRowToRollup(r: SessionRollup, row: RequestRow): SessionRollup {
  const startedAt = row.at - row.durationMs
  const isFirst = rollupRequests(r) === 0
  return {
    firstAt: isFirst ? startedAt : Math.min(r.firstAt, startedAt),
    lastAt: isFirst ? row.at : Math.max(r.lastAt, row.at),
    durationMs: r.durationMs + row.durationMs,
    byKind: { ...r.byKind, [row.kind]: plusRow(r.byKind[row.kind], row) },
    byModel: { ...r.byModel, [row.model]: plusRow(r.byModel[row.model] ?? emptyBucket(), row) },
    byAgent: row.agentId === undefined ? r.byAgent : { ...r.byAgent, [row.agentId]: plusRow(agentOf(r, row.agentId), row) },
  }
}

/** Adds each ledger share to the buckets of the row that took it. */
export function addSharesToRollup(r: SessionRollup, rows: readonly RequestRow[], shares: readonly Share[]): SessionRollup {
  let next = r
  for (const s of shares) {
    const row = rows.find(x => x.seq === s.seq)
    if (!row) continue
    next = {
      ...next,
      byKind: { ...next.byKind, [row.kind]: plusUsd(next.byKind[row.kind], s.usd) },
      byModel: { ...next.byModel, [row.model]: plusUsd(next.byModel[row.model] ?? emptyBucket(), s.usd) },
      byAgent: row.agentId === undefined ? next.byAgent : { ...next.byAgent, [row.agentId]: plusUsd(agentOf(next, row.agentId), s.usd) },
    }
  }
  return next
}

/** Rebuilds the rollup from the kept rows, as a session recorded before rollups were kept starts one. */
export function rollupFromRows(rows: readonly RequestRow[]): SessionRollup {
  return rows.reduce(addRowToRollup, emptyRollup())
}
