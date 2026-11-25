import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { lockHashes } from '../src/main/shortme/clips/engines/v3/runtime'

const h = (s: string): string => createHash('sha256').update(s).digest('hex')
describe('Lock-Prüfsumme unabhängig von Zeilenenden', () => {
  it('LF- und CRLF-Marker gelten beide, geschrieben wird LF', () => {
    const lf = 'torch==2.8.0\nnumpy==2.1\n'
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(lockHashes(crlf).lf).toBe(h(lf))
    expect(lockHashes(lf).accepted).toContain(h(crlf))
    expect(lockHashes(crlf).accepted).toContain(h(lf))
    expect(lockHashes(lf).accepted).not.toContain(h('torch==2.9.0\n'))
  })
})
