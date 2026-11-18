import { expect, test } from 'claude-code/testing'

import type { AgentRollup, RequestRow, RollupBucket, SessionRollup } from '../types'
import { agentTree, ancestry, mainOwn, rollupTotal, SAVED_ROWS, savedRows, subtreeTotal } from './drill'

/** Rounded to a millionth, so sums of dollar floats compare exactly. */
const near = (x: number | undefined) => Math.round((x ?? Number.NaN) * 1e6) / 1e6

const bucket = (requests: number, usd: number): RollupBucket => ({ input: 100 * requests, output: 10 * requests, cacheRead: 0, cacheWrite: 0, requests, estUsd: usd, ledgerUsd: usd, durationMs: 1000 * requests })
const agent = (requests: number, usd: number, type: string, parentId?: string): AgentRollup => ({ ...bucket(requests, usd), type, ...(parentId === undefined ? {} : { parentId }) })

/** main 2 req $0.30; Explore 1 req $0.05 with a Plan under it (1 req $0.10); a second Explore 1 req $0.20. */
function nested(byAgent: Record<string, AgentRollup> = {
  e1: agent(1, 0.05, 'Explore'),
  p1: agent(1, 0.1, 'Plan', 'e1'),
  e2: agent(1, 0.2, 'Explore'),
}): SessionRollup {
  const sub = Object.values(byAgent).reduce((s, a) => ({ ...s, requests: s.requests + a.requests, ledgerUsd: s.ledgerUsd + a.ledgerUsd, estUsd: s.estUsd + a.estUsd, input: s.input + a.input, output: s.output + a.output, durationMs: s.durationMs + a.durationMs }), bucket(0, 0))
  return { firstAt: 0, lastAt: 1, durationMs: 0, byKind: { main: bucket(2, 0.3), subagent: sub, compact: bucket(0, 0) }, byModel: {}, byAgent }
}

const shape = (r: SessionRollup, root?: string) => agentTree(r, root).map(n => `${n.depth}:${n.id}`)

test('the tree lists subagents depth first under the agent that spawned them, the costliest sibling first', async () => {
  const r = nested()
  expect(shape(r)).toEqual(['1:e2', '1:e1', '2:p1'])
  expect(shape(r, 'e1')).toEqual(['1:p1'])
  expect(shape(r, 'p1')).toEqual([])
  expect(ancestry(r, 'p1')).toEqual(['e1', 'p1'])
})

test('main\'s own spend and every agent in the tree add up to the rollup\'s total', async () => {
  const r = nested()
  const own = mainOwn(r)
  expect(own.requests).toBe(2)
  expect(near(own.ledgerUsd)).toBe(0.3)
  const listed = agentTree(r).reduce((s, n) => s + n.agent.ledgerUsd, own.ledgerUsd)
  expect(near(listed)).toBe(near(rollupTotal(r).ledgerUsd))
})

test('a subagent\'s total counts it and every subagent under it', async () => {
  const r = nested()
  expect(subtreeTotal(r, 'e1')).toMatchObject({ requests: 2, input: 200 })
  expect(near(subtreeTotal(r, 'e1').ledgerUsd)).toBe(0.15)
  expect(subtreeTotal(r, 'missing')).toMatchObject({ requests: 0, ledgerUsd: 0 })
})

test('an agent whose parent the rollup lacks hangs off main; a loop of parents is broken at its first agent by id', async () => {
  const r = nested({
    orphan: agent(1, 0.05, 'Explore', 'gone'),
    self: agent(1, 0.05, 'Explore', 'self'),
    l2: agent(1, 0.1, 'Plan', 'l1'),
    l1: agent(1, 0.05, 'Explore', 'l2'),
  })
  expect(shape(r)).toEqual(['1:l1', '2:l2', '1:orphan', '1:self'])
  expect(ancestry(r, 'l2')).toEqual(['l1', 'l2'])
  // Every agent is listed once, so the lines still add up and main's own never goes below zero.
  expect(near(mainOwn(r).ledgerUsd)).toBe(0.3)
  expect(near(agentTree(r).reduce((s, n) => s + n.agent.ledgerUsd, mainOwn(r).ledgerUsd))).toBe(near(rollupTotal(r).ledgerUsd))
})

test('history keeps the newest rows as numbers only', async () => {
  const rows: RequestRow[] = Array.from({ length: SAVED_ROWS + 3 }, (_, i) => ({
    seq: i + 1, at: i, durationMs: 1, turnId: 't', index: i, kind: 'main', model: 'm', effort: 'high', tools: ['Bash'],
    input: 1, output: 1, cacheRead: 0, cacheWrite: 0, estUsd: 0.01, ledgerUsd: null, isApprox: false, stopReason: 'end_turn',
  }))
  const kept = savedRows(rows)
  expect(kept).toHaveLength(SAVED_ROWS)
  expect(kept[0]?.seq).toBe(4)
  expect(Object.keys(kept[0]!).sort()).toEqual(['at', 'cacheRead', 'cacheWrite', 'durationMs', 'estUsd', 'input', 'isApprox', 'kind', 'ledgerUsd', 'model', 'output', 'seq'])
})
