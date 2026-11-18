import type { AgentRollup, RequestRow, RollupBucket, SavedRequest, SessionRollup } from '../types'
import { emptyBucket } from './rollup'

/** The most requests a saved session keeps for its details view; its totals and rollup count every one. */
export const SAVED_ROWS = 200

/** The newest kept rows as history stores them: numbers only, no turn ids, stop reasons, effort or tool names. */
export function savedRows(rows: readonly RequestRow[]): SavedRequest[] {
  return rows.slice(-SAVED_ROWS).map(r => ({
    seq: r.seq,
    at: r.at,
    durationMs: r.durationMs,
    kind: r.kind,
    ...(r.agentId === undefined ? {} : { agentId: r.agentId }),
    model: r.model,
    input: r.input,
    output: r.output,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    estUsd: r.estUsd,
    ledgerUsd: r.ledgerUsd,
    isApprox: r.isApprox,
  }))
}

/** An agent's parent within the rollup; one whose parent the rollup does not hold hangs off the main loop. */
function parentOf(r: SessionRollup, id: string): string | undefined {
  const p = r.byAgent[id]?.parentId
  return p !== undefined && p !== id && r.byAgent[p] !== undefined ? p : undefined
}

export type TreeNode = { id: string; depth: number; agent: AgentRollup }

/** The subagents under `root` (the main loop when undefined), depth first, the costliest sibling first; depth 1 is a direct child. */
export function agentTree(r: SessionRollup, root?: string): TreeNode[] {
  const out: TreeNode[] = []
  const seen = new Set<string>()
  const walk = (parent: string | undefined, depth: number) => {
    const kids = Object.entries(r.byAgent)
      .filter(([id]) => parentOf(r, id) === parent && !seen.has(id))
      .sort((a, b) => b[1].ledgerUsd - a[1].ledgerUsd || a[0].localeCompare(b[0]))
    for (const [id, agent] of kids) {
      seen.add(id)
      out.push({ id, depth, agent })
      walk(id, depth + 1)
    }
  }
  walk(root, 1)
  return out
}

/** The agents from the main loop's child down to `id`, for the way back up. */
export function ancestry(r: SessionRollup, id: string): string[] {
  const path: string[] = []
  for (let at: string | undefined = id; at !== undefined && !path.includes(at); at = parentOf(r, at)) path.unshift(at)
  return path
}

function minus(a: RollupBucket, b: RollupBucket): RollupBucket {
  return {
    input: a.input - b.input,
    output: a.output - b.output,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheWrite: a.cacheWrite - b.cacheWrite,
    requests: a.requests - b.requests,
    estUsd: a.estUsd - b.estUsd,
    ledgerUsd: a.ledgerUsd - b.ledgerUsd,
    durationMs: a.durationMs - b.durationMs,
  }
}

function plus(a: RollupBucket, b: RollupBucket): RollupBucket {
  return minus(a, minus(emptyBucket(), b))
}

/** Every request the rollup counts, summed. */
export function rollupTotal(r: SessionRollup): RollupBucket {
  return plus(plus(r.byKind.main, r.byKind.subagent), r.byKind.compact)
}

/** What the main loop spent itself: everything no subagent did, a compaction of the main loop's included. */
export function mainOwn(r: SessionRollup): RollupBucket {
  return Object.values(r.byAgent).reduce(minus, rollupTotal(r))
}
