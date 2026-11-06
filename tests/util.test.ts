import {describe, expect, it} from 'vitest'
import {decodeBackup, encodeBackup, fmtDay, fmtScreenStat, fmtSize, isNewer, isVirtualMic, linkify, lowLatencySdp, mentions, newRoomCode, orderCodecs, parseInvite, previewKind, worstStat} from '../src/lib/util'

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
describe('orderCodecs', () => {
  it('seçileni öne alır, diğerlerini korur', () => {
    const c = [{mimeType: 'video/VP8'}, {mimeType: 'video/rtx'}, {mimeType: 'video/H264'}, {mimeType: 'video/H264'}]
    expect(orderCodecs(c, 'video/h264').map(x => x.mimeType)).toEqual(['video/H264', 'video/H264', 'video/VP8', 'video/rtx'])
  })
})

describe('fmtScreenStat', () => {
  it('yayın bilgisini yazar, darboğazı söyler', () => {
    expect(fmtScreenStat({w: 1920, h: 1080, fps: 58.4, mbps: 5.92})).toBe('1920×1080 · 58 fps · 5,9 Mb/sn')
    expect(fmtScreenStat({w: 1280, h: 720, fps: 30, mbps: 2, limit: 'bandwidth'})).toContain('hat yetmiyor')
  })
  it('en kötü izleyiciyi seçer', () => {
    const a = {w: 1920, h: 1080, fps: 60, mbps: 6}, b = {w: 1920, h: 1080, fps: 20, mbps: 2}, c = {w: 1280, h: 720, fps: 60, mbps: 4}
    expect(worstStat([a, b, c])).toBe(c)
    expect(worstStat([a, b])).toBe(b)
  })
})

describe('isVirtualMic', () => {
  it('sanal kabloyu tanır, gerçek mikrofonu karıştırmaz', () => {
    expect(isVirtualMic('CABLE Output (VB-Audio Virtual Cable)')).toBe(true)
    expect(isVirtualMic('Default - Voicemeeter Out B1')).toBe(true)
    expect(isVirtualMic('Mikrofon (HyperX Cloud II)')).toBe(false)
    expect(isVirtualMic('Microphone (USB Cable Audio)')).toBe(true)
  })
})

describe('isNewer', () => {
  it('compares versions numerically', () => {
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('v1.1.0', '1.1.0')).toBe(false)
    expect(isNewer('1.0.9', '1.1')).toBe(false)
  })
})
describe('mentions', () => {
  it('finds a name or everyone, ignoring Turkish case', () => {
    expect(mentions('@Elif gel', 'elif')).toBe(true)
    expect(mentions('@herkes maç', 'Mert')).toBe(true)
    expect(mentions('selam', 'Mert')).toBe(false)
  })
})
describe('backup code', () => {
  const b = {uid: 'abcd2345efgh6789', name: 'Şükrü', groups: [{code: 'abcd-efgh-jkmn-pqrs', title: 'Hafta Sonu ÇS'}]}
  it('round-trips Turkish text and survives surrounding text', () => {
    expect(decodeBackup(encodeBackup(b))).toEqual(b)
    expect(decodeBackup(`kodum: ${encodeBackup(b)} \n`)).toEqual(b)
  })
  it('keeps a valid color and drops a broken one', () => {
    expect(decodeBackup(encodeBackup({...b, color: '#aa22cc'}))?.color).toBe('#aa22cc')
    expect(decodeBackup(encodeBackup({...b, color: 'url(x)'}))).toEqual(b)
  })
  it('rejects junk and drops bad group codes', () => {
    expect(decodeBackup('selam')).toBeNull()
    expect(decodeBackup('telsiz1.@@@')).toBeNull()
    expect(decodeBackup(encodeBackup({...b, groups: [{code: 'x', title: 'y'}]}))?.groups).toEqual([])
  })
})
