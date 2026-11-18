import { expect, test } from 'claude-code/testing'

import type { RequestRow, RollupBucket } from '../types'
import { addBuckets, addEstToRollup, addRowToRollup, addSharesToRollup, emptyBucket, emptyRollup, rollupFromRows, rollupRequests, setAgentMeta, subtractBuckets, UNKNOWN_AGENT_TYPE } from './rollup'

/** Rounded to a millionth, so sums of dollar floats compare exactly. */
const near = (x: number | undefined) => Math.round((x ?? Number.NaN) * 1e6) / 1e6

function row(seq: number, over: Partial<RequestRow> = {}): RequestRow {
  return {
    seq, at: 10_000 * seq, durationMs: 1000, turnId: 't', index: seq, kind: 'main', model: 'claude-opus-5-5',
    input: 100, output: 10, cacheRead: 50, cacheWrite: 5, estUsd: 0.01, ledgerUsd: null, isApprox: false, stopReason: 'end_turn',
    ...over,
  }
}

const b = (requests: number, usd: number): RollupBucket => ({ input: 10, output: 2, cacheRead: 3, cacheWrite: 1, requests, estUsd: usd, ledgerUsd: usd, durationMs: 500 })

test('buckets add and subtract field by field, and an agent keeps its type through either', async () => {
  expect(addBuckets(b(1, 0.5), b(2, 0.25))).toEqual({ input: 20, output: 4, cacheRead: 6, cacheWrite: 2, requests: 3, estUsd: 0.75, ledgerUsd: 0.75, durationMs: 1000 })
  expect(subtractBuckets(b(3, 0.75), b(1, 0.25))).toEqual({ ...emptyBucket(), requests: 2, estUsd: 0.5, ledgerUsd: 0.5 })
  expect(addBuckets({ ...b(1, 0.5), type: 'Explore' }, b(1, 0.5)).type).toBe('Explore')
})

test('a row counts by kind, by model and, for a subagent, by its agent; the span runs from the first start to the last end', async () => {
  let r = addRowToRollup(emptyRollup(), row(1))
  r = addRowToRollup(r, row(2, { kind: 'subagent', agentId: 'agent-1', model: 'claude-haiku-5-5', estUsd: null }))
  expect(rollupRequests(r)).toBe(2)
  expect(r.byKind.main.requests).toBe(1)
  expect(r.byKind.subagent.input).toBe(100)
  expect(r.byModel['claude-haiku-5-5']?.estUsd).toBe(0)
  expect(r.byAgent['agent-1']).toMatchObject({ type: UNKNOWN_AGENT_TYPE, requests: 1 })
  expect(r.firstAt).toBe(9_000)
  expect(r.lastAt).toBe(20_000)
  expect(r.durationMs).toBe(2000)
})

test('what an agent was spawned as is kept when its requests come, and theirs are kept when it is labelled late', async () => {
  const early = addRowToRollup(setAgentMeta(emptyRollup(), 'agent-1', { type: 'Plan', parentId: 'agent-0' }), row(1, { kind: 'subagent', agentId: 'agent-1' }))
  expect(early.byAgent['agent-1']).toMatchObject({ type: 'Plan', parentId: 'agent-0', requests: 1 })
  const late = setAgentMeta(addRowToRollup(emptyRollup(), row(1, { kind: 'subagent', agentId: 'agent-1' })), 'agent-1', { type: 'Explore' })
  expect(late.byAgent['agent-1']).toMatchObject({ type: 'Explore', requests: 1 })
  expect(late.byAgent['agent-1']?.parentId).toBeUndefined()
})

test('a ledger share lands in its row\'s kind, model and agent; a share for a row no longer held is dropped', async () => {
  const rows = [row(1), row(2, { kind: 'subagent', agentId: 'agent-1' })]
  const r = addSharesToRollup(rollupFromRows(rows), rows, [{ seq: 1, usd: 0.02, isApprox: false }, { seq: 2, usd: 0.004, isApprox: false }, { seq: 99, usd: 1, isApprox: false }])
  expect(r.byKind.main.ledgerUsd).toBe(0.02)
  expect(r.byKind.subagent.ledgerUsd).toBe(0.004)
  expect(near(r.byModel['claude-opus-5-5']?.ledgerUsd)).toBe(0.024)
  expect(r.byAgent['agent-1']?.ledgerUsd).toBe(0.004)
  expect(r.byAgent['agent-1']?.requests).toBe(1)
})

test('a re-priced row moves only the estimate of its kind, model and agent', async () => {
  const sub = row(2, { kind: 'subagent', agentId: 'agent-1' })
  const before = addRowToRollup(addRowToRollup(emptyRollup(), row(1)), sub)
  const after = addEstToRollup(before, sub, 0.004)
  expect(near(after.byKind.subagent.estUsd)).toBe(0.014)
  expect(near(after.byModel['claude-opus-5-5']?.estUsd)).toBe(0.024)
  expect(near(after.byAgent['agent-1']?.estUsd)).toBe(0.014)
  expect(after.byKind.main).toEqual(before.byKind.main)
  expect(after.byAgent['agent-1']).toMatchObject({ type: UNKNOWN_AGENT_TYPE, requests: 1, ledgerUsd: 0 })
})
