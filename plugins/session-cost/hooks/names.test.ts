import { expect, test } from 'claude-code/testing'

import { sessionName, titlesIn } from './names'

const line = (row: object) => JSON.stringify(row)

test('a stretch of transcript gives its last custom and last generated title, and skips every other row', async () => {
  const text = [
    line({ type: 'user', message: { role: 'user', content: 'talk about "custom-title" here' } }),
    line({ type: 'ai-title', aiTitle: 'First guess' }),
    line({ type: 'custom-title', customTitle: 'mine' }),
    line({ type: 'ai-title', aiTitle: 'Second guess' }),
  ].join('\n')
  expect(titlesIn(text)).toEqual({ custom: 'mine', ai: 'Second guess' })
})

test('a row cut at either end of the stretch, or a title that is no string, is skipped', async () => {
  const whole = line({ type: 'ai-title', aiTitle: 'Kept' })
  const text = ['"type":"custom-title","customTitle":"cut"}', whole, line({ type: 'custom-title', customTitle: 42 }), whole.slice(0, 20)].join('\n')
  expect(titlesIn(text)).toEqual({ ai: 'Kept' })
  expect(titlesIn('')).toEqual({})
})

test('a session is named by its custom title, else its generated one, else its first prompt; a blank one does not count', async () => {
  expect(sessionName({ custom: 'mine', ai: 'generated', prompt: 'hello' })).toBe('mine')
  expect(sessionName({ custom: '  ', ai: 'generated', prompt: 'hello' })).toBe('generated')
  expect(sessionName({ prompt: 'hello' })).toBe('hello')
  expect(sessionName({ scanned: 100 })).toBeUndefined()
})
