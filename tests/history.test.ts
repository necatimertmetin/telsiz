import {describe, expect, it} from 'vitest'
import {dmId, dmMembers, dmOthers, dmPartner, materialize, missingFor, validEvent, visibleTo} from '../src/lib/history'
import type {Ev} from '../src/lib/types'

const b = (id: string, ts: number, uid = 'a') => ({id, ts, uid, name: uid.toUpperCase()})
const msg = (id: string, ts: number, uid = 'a', text = 'x'): Ev => ({...b(id, ts, uid), t: 'msg', ch: 'genel', text})

describe('materialize', () => {
  it('gives the same result in any delivery order', () => {
    const evs: Ev[] = [msg('1', 1), {...b('2', 2), t: 'edit', target: '1', text: 'y'}, {...b('3', 3, 'b'), t: 'react', target: '1', emoji: '👍', on: true}, msg('4', 4, 'b')]
    const x = materialize(evs)
    const y = materialize([...evs].reverse())
    expect(y.msgs.get('genel')).toEqual(x.msgs.get('genel'))
    expect(x.byId.get('1')).toMatchObject({text: 'y', edited: true, reacts: {'👍': ['b']}})
  })
  it('ignores edits and deletes from someone else', () => {
    const v = materialize([msg('1', 1), {...b('2', 2, 'b'), t: 'edit', target: '1', text: 'hack'}, {...b('3', 3, 'b'), t: 'del', target: '1'}])
    expect(v.byId.get('1')?.text).toBe('x')
  })
  it('removes a message deleted by its author', () => {
    expect(materialize([msg('1', 1), {...b('2', 2), t: 'del', target: '1'}]).byId.size).toBe(0)
  })
  it('toggles reactions and keeps last state per user', () => {
    const r = (id: string, ts: number, on: boolean): Ev => ({...b(id, ts), t: 'react', target: '1', emoji: '🔥', on})
    expect(materialize([msg('1', 1), r('2', 2, true), r('3', 3, false)]).byId.get('1')?.reacts).toEqual({})
  })
  it('has a default channel, added channels and group title', () => {
    const v = materialize([{...b('1', 1), t: 'chan', chId: 'c', title: 'taktik'}, {...b('2', 2), t: 'group', title: 'Kankalar'}])
    expect(v.channels.map(c => c.title)).toEqual(['genel', 'taktik'])
    expect(v.title).toBe('Kankalar')
  })
})

describe('validEvent', () => {
  it('accepts a good message and a file-only message', () => {
    expect(validEvent(msg('1', 1))).toBe(true)
    expect(validEvent({...msg('1', 1), text: '', file: {id: 'f', name: 'demo.dem', size: 10, type: ''}})).toBe(true)
  })
  it('rejects junk', () => {
    for (const x of [null, 5, {}, {...msg('1', 1), text: ''}, {...msg('1', 1), t: 'hack'}, {...msg('1', 1), ts: 'x'}, {...msg('1', 1), text: 'a'.repeat(5000)}, {...msg('1', 1), file: {id: 'f', name: 'a', size: -1, type: ''}}])
      expect(validEvent(x)).toBe(false)
  })
})

describe('missingFor', () => {
  it('returns only events the other side lacks', () => {
    const mine = new Map([['1', msg('1', 1)], ['2', msg('2', 2)]])
    expect(missingFor(mine, ['1']).map(e => e.id)).toEqual(['2'])
  })
})

describe('private chats', () => {
  const ch = dmId('b', 'a')
  const dm: Ev = {...b('1', 1), t: 'msg', ch, text: 'gizli'}
  it('uses the same id from both sides', () => {
    expect(ch).toBe(dmId('a', 'b'))
    expect(dmPartner(ch, 'a')).toBe('b')
  })
  it('is visible only to the two people', () => {
    expect(visibleTo(dm, 'a')).toBe(true)
    expect(visibleTo(dm, 'b')).toBe(true)
    expect(visibleTo(dm, 'c')).toBe(false)
    expect(visibleTo({...b('2', 2), t: 'edit', target: '1', text: 'y', ch}, 'c')).toBe(false)
    expect(visibleTo(msg('3', 3), 'c')).toBe(true)
  })
  it('keeps an edit of a private message valid', () => {
    expect(validEvent({...b('2', 2), t: 'edit', target: '1', text: 'y', ch})).toBe(true)
  })
})

describe('pins', () => {
  it('pins and unpins, last state wins', () => {
    const p = (id: string, ts: number, on: boolean): Ev => ({...b(id, ts), t: 'pin', target: '1', on})
    expect(materialize([msg('1', 1), p('2', 2, true)]).byId.get('1')?.pinned).toBe(true)
    expect(materialize([msg('1', 1), p('2', 2, true), p('3', 3, false)]).byId.get('1')?.pinned).toBe(false)
  })
})

describe('private groups', () => {
  it('keeps every member and hides from the rest', () => {
    const ch = dmId('c', 'a', 'b', 'a')
    expect(dmMembers(ch)).toEqual(['a', 'b', 'c'])
    expect(dmOthers(ch, 'a')).toEqual(['b', 'c'])
    const m: Ev = {...b('1', 1), t: 'msg', ch, text: 'x'}
    expect(validEvent(m)).toBe(true)
    expect(visibleTo(m, 'c')).toBe(true)
    expect(visibleTo(m, 'd')).toBe(false)
  })
})

describe('polls', () => {
  const poll: Ev = {...b('1', 1), t: 'msg', ch: 'genel', text: '', poll: {q: 'Kaçta?', opts: ['21', '22']}}
  const v = (id: string, ts: number, uid: string, opt: number, on = true): Ev => ({...b(id, ts, uid), t: 'vote', target: '1', opt, on})
  it('accepts valid and rejects broken polls', () => {
    expect(validEvent(poll)).toBe(true)
    expect(validEvent({...poll, poll: {q: 'x', opts: ['tek']}})).toBe(false)
  })
  it('gives each person one vote, last one wins', () => {
    const m = materialize([poll, v('2', 2, 'a', 0), v('3', 3, 'a', 1), v('4', 4, 'b', 1)]).byId.get('1')
    expect(m?.votes).toEqual({0: [], 1: ['a', 'b']})
  })
  it('allows taking a vote back and ignores bad options', () => {
    expect(materialize([poll, v('2', 2, 'a', 0), v('3', 3, 'a', 0, false)]).byId.get('1')?.votes[0]).toEqual([])
    expect(materialize([poll, v('2', 2, 'a', 9)]).byId.get('1')?.votes).toEqual({})
  })
})

describe('schedule', () => {
  it('keeps the last setting', () => {
    const s = (id: string, ts: number, time: string): Ev => ({...b(id, ts), t: 'sched', days: [6], time, on: true})
    expect(materialize([s('1', 1, '20:00'), s('2', 2, '21:30')]).sched?.time).toBe('21:30')
    expect(validEvent({...b('1', 1), t: 'sched', days: [9], time: '20:00', on: true})).toBe(false)
  })
})
