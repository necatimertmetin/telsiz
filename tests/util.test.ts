import {describe, expect, it} from 'vitest'
import {fmtDay, fmtSize, linkify, lowLatencySdp, newRoomCode, parseInvite, previewKind} from '../src/lib/util'

describe('invites', () => {
  it('parses a raw code and a full link', () => {
    const c = newRoomCode()
    expect(parseInvite(c)).toBe(c)
    expect(parseInvite(`  https://x.io/telsiz/#/katil/${c}\n`)).toBe(c)
    expect(parseInvite('selam')).toBeNull()
  })
  it('does not repeat codes', () => {
    expect(new Set(Array.from({length: 200}, newRoomCode)).size).toBe(200)
  })
})
describe('format', () => {
  it('sizes', () => {
    expect(fmtSize(500)).toBe('500 B')
    expect(fmtSize(1536)).toBe('1,5 KB')
    expect(fmtSize(5 * 1024 ** 3)).toBe('5,0 GB')
  })
  it('days', () => {
    const now = new Date(2026, 10, 7, 12).getTime()
    expect(fmtDay(now, now)).toBe('Bugün')
    expect(fmtDay(now - 864e5, now)).toBe('Dün')
    expect(fmtDay(new Date(2026, 0, 2).getTime(), now)).toBe('2 Ocak 2026')
  })
})
describe('previewKind', () => {
  it('never previews active content', () => {
    expect(previewKind({type: 'image/svg+xml', name: 'a.svg'})).toBeNull()
    expect(previewKind({type: 'text/html', name: 'a.html'})).toBeNull()
    expect(previewKind({type: '', name: 'demo.dem'})).toBeNull()
    expect(previewKind({type: 'image/png', name: 'a.png'})).toBe('image')
    expect(previewKind({type: '', name: 'komik.gif'})).toBe('image')
    expect(previewKind({type: '', name: 'not.m4a'})).toBe('audio')
  })
})
describe('linkify', () => {
  it('only links http(s) and drops trailing punctuation', () => {
    expect(linkify('bak https://a.co/x. tamam')).toEqual([{text: 'bak '}, {text: 'https://a.co/x', url: 'https://a.co/x'}, {text: '. tamam'}])
    expect(linkify('javascript:alert(1)')).toEqual([{text: 'javascript:alert(1)'}])
  })
})

describe('lowLatencySdp', () => {
  it('adds ptime once, right after the opus line', () => {
    const sdp = 'm=audio 9\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:9 G722/8000\r\n'
    const out = lowLatencySdp(sdp)
    expect(out).toContain('useinbandfec=1\r\na=ptime:10\r\na=rtpmap')
    expect(lowLatencySdp(out)).toBe(out)
  })
})
