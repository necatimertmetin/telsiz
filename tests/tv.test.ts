import {describe, expect, it} from 'vitest'
import {TV_EMPTY, tvApply, tvCurrent, tvNewer, tvPos, validTv, ytId, type TvAction, type TvState} from '../src/lib/tv'

const item = (k: string) => ({k, id: 'abcdefghijk', title: 't', by: 'Ali'})
const run = (s: TvState, a: TvAction, now = 0) => tvApply(s, a, 'u', now)!
const two = () => run(run(TV_EMPTY, {a: 'add', item: item('1')}), {a: 'add', item: item('2')})

describe('youtube links', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=5', 'dQw4w9WgXcQ'],
    ['şuna bak https://m.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=1 güzel', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('finds the video in %s', (url, id) => expect(ytId(url)).toBe(id))
  it('ignores other text', () => {
    expect(ytId('selam')).toBeNull()
    expect(ytId('https://youtube.com/watch?v=kisa')).toBeNull()
    expect(ytId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('queue', () => {
  it('starts the first video and queues the rest', () => {
    const s = two()
    expect(s.playing).toBe(true)
    expect(tvCurrent(s)?.k).toBe('1')
    expect(s.queue).toHaveLength(2)
  })
  it('moves on and stops after the last', () => {
    const s = run(two(), {a: 'next'})
    expect(tvCurrent(s)?.k).toBe('2')
    const end = run(s, {a: 'next'})
    expect(end.playing).toBe(false)
    expect(tvCurrent(end)).toBeNull()
  })
  it('plays a link added after the list finished', () => {
    const end = run(run(two(), {a: 'next'}), {a: 'next'})
    const s = run(end, {a: 'add', item: item('3')})
    expect(tvCurrent(s)?.k).toBe('3')
    expect(s.playing).toBe(true)
  })
  it('advances once when two people finish together', () => {
    const s = two()
    const once = run(s, {a: 'ended', k: '1'})
    expect(tvCurrent(once)?.k).toBe('2')
    expect(tvApply(once, {a: 'ended', k: '1'}, 'v', 0)).toBeNull()
  })
  it('keeps the current video when an earlier one is removed', () => {
    const s = run(run(two(), {a: 'next'}), {a: 'remove', k: '1'})
    expect(tvCurrent(s)?.k).toBe('2')
    expect(s.idx).toBe(0)
  })
  it('moves to the next when the current one is removed', () => {
    const s = run(two(), {a: 'remove', k: '1'})
    expect(tvCurrent(s)?.k).toBe('2')
    expect(s.pos).toBe(0)
  })
  it('stops when the only video is removed', () => {
    const s = run(run(TV_EMPTY, {a: 'add', item: item('1')}), {a: 'remove', k: '1'})
    expect(s.playing).toBe(false)
    expect(tvCurrent(s)).toBeNull()
  })
})

describe('position', () => {
  it('runs while playing and freezes on pause', () => {
    const s = run(TV_EMPTY, {a: 'add', item: item('1')}, 1000)
    expect(tvPos(s, 11000)).toBe(10)
    const p = run(s, {a: 'pause'}, 11000)
    expect(p.pos).toBe(10)
    expect(tvPos(p, 99000)).toBe(10)
  })
  it('jumps on seek and restarts on previous after a few seconds', () => {
    const s = run(run(TV_EMPTY, {a: 'add', item: item('1')}, 0), {a: 'seek', pos: 60}, 0)
    expect(tvPos(s, 0)).toBe(60)
    expect(run(s, {a: 'prev'}, 0).pos).toBe(0)
  })
  it('sends nothing when nothing changes', () => {
    expect(tvApply(TV_EMPTY, {a: 'pause'}, 'u', 0)).toBeNull()
    expect(tvApply(TV_EMPTY, {a: 'next'}, 'u', 0)).toBeNull()
  })
})

describe('sync', () => {
  it('picks the same winner everywhere', () => {
    expect(tvNewer([2, 'a'], [1, 'z'])).toBe(true)
    expect(tvNewer([2, 'b'], [2, 'a'])).toBe(true)
    expect(tvNewer([2, 'a'], [2, 'b'])).toBe(false)
    expect(tvNewer([2, 'a'], [2, 'a'])).toBe(false)
  })
  it('accepts valid state and rejects bad input', () => {
    expect(validTv(two())).toBe(true)
    expect(validTv({...two(), pos: -1})).toBe(false)
    expect(validTv({...two(), idx: 9})).toBe(false)
    expect(validTv({...two(), queue: [{...item('1'), id: '"><script>'}]})).toBe(false)
    expect(validTv(null)).toBe(false)
  })
})
