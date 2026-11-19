import type { AgentRollup, RequestRow, RollupBucket, SavedRequest, SessionRollup } from '../types'
import { addBuckets, emptyBucket, subtractBuckets } from './rollup'

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

/**
 * Each subagent's parent as the tree draws it, undefined for the main loop. One whose parent
 * the rollup does not hold hangs off the main loop; so does the first (by id) of agents whose
 * parents loop, the rest of the loop under it. Every agent of the rollup is placed once.
 */
function treeParents(r: SessionRollup): Map<string, string | undefined> {
  const ids = Object.keys(r.byAgent).sort()
  const declared = (id: string) => {
    const p = r.byAgent[id]?.parentId
    return p !== undefined && p !== id && r.byAgent[p] !== undefined ? p : undefined
  }
  const kids = new Map<string | undefined, string[]>()
  for (const id of ids) kids.set(declared(id), [...(kids.get(declared(id)) ?? []), id])
  const placed = new Map<string, string | undefined>()
  const place = (id: string, parent: string | undefined) => {
    if (placed.has(id)) return
    placed.set(id, parent)
    for (const kid of kids.get(id) ?? []) place(kid, id)
  }
  for (const id of kids.get(undefined) ?? []) place(id, undefined)
  for (const id of ids) place(id, undefined)
  return placed
}

export type TreeNode = { id: string; depth: number; agent: AgentRollup }

/** The subagents under `root` (the main loop when undefined), depth first, the costliest sibling first; depth 1 is a direct child. */
export function agentTree(r: SessionRollup, root?: string): TreeNode[] {
  const parents = treeParents(r)
  const out: TreeNode[] = []
  const walk = (parent: string | undefined, depth: number) => {
    const kids = Object.entries(r.byAgent)
      .filter(([id]) => parents.get(id) === parent)
      .sort((a, b) => b[1].ledgerUsd - a[1].ledgerUsd || a[0].localeCompare(b[0]))
    for (const [id, agent] of kids) {
      out.push({ id, depth, agent })
      walk(id, depth + 1)
    }
  }
  walk(root, 1)
  return out
}

/** The agents from the main loop's child down to `id`, for the way back up. */
export function ancestry(r: SessionRollup, id: string): string[] {
  const parents = treeParents(r)
  const path: string[] = []
  for (let at: string | undefined = id; at !== undefined && parents.has(at); at = parents.get(at)) path.unshift(at)
  return path
}

/** Every request the rollup counts, summed. */
export function rollupTotal(r: SessionRollup): RollupBucket {
  return addBuckets(addBuckets(r.byKind.main, r.byKind.subagent), r.byKind.compact)
}

/** What the main loop spent itself: everything no subagent did, a compaction of the main loop's included. */
export function mainOwn(r: SessionRollup): RollupBucket {
  return Object.values(r.byAgent).reduce<RollupBucket>(subtractBuckets, rollupTotal(r))
}

/** A subagent and every subagent under it, summed: what its details view totals. */
export function subtreeTotal(r: SessionRollup, id: string): RollupBucket {
  const own = r.byAgent[id]
  if (own === undefined) return emptyBucket()
  return agentTree(r, id).reduce<RollupBucket>((sum, n) => addBuckets(sum, n.agent), addBuckets(emptyBucket(), own))
}
