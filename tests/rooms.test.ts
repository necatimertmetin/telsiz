import {describe, expect, it} from 'vitest'
import {can, canAccept, canKick, materialize, validEvent, validStreamUrl} from '../src/lib/history'
import {playable} from '../src/lib/radio'
import {isTeamCommand, makeTeams} from '../src/lib/bot'
import {sameRoom} from '../src/lib/call'
import type {Ev} from '../src/lib/types'

const b = (id: string, ts: number, uid = 'a') => ({id, ts, uid, name: uid.toUpperCase(), sig: 's'})
const group = (): Ev => ({...b('g', 1), t: 'group', title: 'G'})
const admin = (uid: string, ts = 2): Ev => ({...b('r' + uid, ts), t: 'role', target: uid, role: 'admin'})
const room = (id: string, ts: number, uid: string, title = 'Oda', on = true, kind?: 'voice' | 'radio' | 'music'): Ev =>
  ({...b(id, ts, uid), t: 'vroom', rid: 'x' + id, title, on, ...(kind ? {kind} : {})})
const perm = (id: string, ts: number, uid: string, key: 'rooms' | 'teams' | 'radio' | 'kick', who: 'all' | 'admin' | 'owner'): Ev =>
  ({...b(id, ts, uid), t: 'perm', key, who})

describe('ses odaları', () => {
  it('yönetici oda kurar, üye kuramaz', () => {
    const v = materialize([group(), admin('y'), room('1', 3, 'y', 'Takım 3'), room('2', 4, 'u', 'Gizli')])
    expect(v.rooms.map(r => r.title)).toEqual(['Takım 3'])
    expect(v.rooms[0].kind).toBe('voice')
  })
  it('tablo herkes derse üye de kurar', () => {
    const v = materialize([group(), perm('p', 2, 'a', 'rooms', 'all'), room('1', 3, 'u')])
    expect(v.rooms).toHaveLength(1)
  })
  it('takım dağıtan üye sadece Takım N odası kurabilir, silemez', () => {
    const v = materialize([group(), room('1', 3, 'u', 'Takım 1'), room('2', 4, 'u', 'Sohbet'), {...room('1', 5, 'u', 'Takım 1', false), id: '9'}])
    expect(v.rooms.map(r => r.title)).toEqual(['Takım 1'])
  })
  it('silinen oda listeden kalkar, tür yeniden adlandırmada korunur', () => {
    const v = materialize([group(), room('1', 2, 'a', 'Radyo', true, 'radio'), {...room('1', 3, 'a', 'Pop'), id: '7'}, room('2', 4, 'a', 'B'), {...room('2', 5, 'a', 'B', false), id: '8'}])
    expect(v.rooms).toEqual([{id: 'x1', title: 'Pop', kind: 'radio'}])
  })
  it('tabloyu sadece kurucu değiştirir', () => {
    const v = materialize([group(), admin('y'), perm('p', 3, 'y', 'rooms', 'all'), perm('q', 4, 'a', 'teams', 'owner')])
    expect(v.perms).toMatchObject({rooms: 'admin', teams: 'owner'})
    expect(can(v, 'u', 'teams')).toBe(false)
    expect(can(v, 'a', 'teams')).toBe(true)
  })
  it('üye atmayı herkese açmak mümkün değil, sadece kurucuya kısılır', () => {
    const v = materialize([group(), admin('y'), perm('p', 3, 'a', 'kick', 'all')])
    expect(v.perms.kick).toBe('admin')
    const w = materialize([group(), admin('y'), perm('p', 3, 'a', 'kick', 'owner')])
    expect(canKick(w, 'y', 'u')).toBe(false)
    expect(canKick(w, 'a', 'u')).toBe(true)
    const k = materialize([group(), admin('y'), perm('p', 3, 'a', 'kick', 'owner'), {...b('k', 4, 'y'), t: 'kick', target: 'u', prev: 'h', box: {iv: 'i', ct: 'c', keys: {}}}])
    expect(k.banned.has('u')).toBe(false)
  })
  it('imzasız oda ve yetki olayı kabul edilmez', () => {
    const {sig: _, ...plain} = room('1', 1, 'a') as Ev & {sig: string}
    expect(canAccept(plain as Ev)).toBe(false)
  })
  it('bozuk olaylar düşer', () => {
    expect(validEvent({...b('1', 1), t: 'vroom', rid: 'r', title: 'x', on: true, kind: 'tv'})).toBe(false)
    expect(validEvent({...b('1', 1), t: 'perm', key: 'admins', who: 'all'})).toBe(false)
    expect(validEvent({...b('1', 1), t: 'msg', ch: 'genel', text: 'x', teams: [['a']]})).toBe(false)
    expect(validEvent({...b('1', 1), t: 'msg', ch: 'genel', text: 'x', teams: [['a'], ['b']]})).toBe(true)
  })
  it('eski sürüm oda yazmaz, ana odada sayılır', () => {
    const v = {in: true, muted: false, deaf: false, cam: false, screen: false}
    expect(sameRoom(v, {...v, room: ''})).toBe(true)
    expect(sameRoom(v, {...v, room: 'x'})).toBe(false)
    expect(sameRoom({...v, in: false}, v)).toBe(false)
  })
})

describe('radyo', () => {
  const st = (id: string, ts: number, uid: string, url = 'https://r.example/stream', on = true): Ev =>
    ({...b(id, ts, uid), t: 'station', sid: 's' + id, title: 'Pop', url, tag: 'pop', on})
  it('istasyonu yetkili ekler, odada çalan herkesçe seçilir', () => {
    const v = materialize([group(), room('1', 2, 'a', 'Radyo', true, 'radio'), st('2', 3, 'a'), st('3', 4, 'u'), {...b('4', 5, 'u'), t: 'tune', rid: 'x1', sid: 's2'}])
    expect(v.stations.map(s => s.id)).toEqual(['s2'])
    expect(v.rooms[0]).toMatchObject({sid: 's2', tunedBy: 'U'})
  })
  it('listede olmayan ya da silinen istasyon çalmaz', () => {
    const v = materialize([group(), room('1', 2, 'a', 'Radyo', true, 'radio'), st('2', 3, 'a'), {...b('4', 4, 'u'), t: 'tune', rid: 'x1', sid: 's2'}, {...st('2', 5, 'a', undefined, false), id: '5'}])
    expect(v.rooms[0].sid).toBeUndefined()
  })
  it('ses odasında istasyon seçilmez', () => {
    const v = materialize([group(), room('1', 2, 'a'), st('2', 3, 'a'), {...b('4', 4, 'u'), t: 'tune', rid: 'x1', sid: 's2'}])
    expect(v.rooms[0].sid).toBeUndefined()
  })
  it('sadece https ve tırnaksız adres', () => {
    expect(validStreamUrl('https://a.b/s.mp3')).toBe(true)
    expect(validStreamUrl('http://a.b/s.mp3')).toBe(false)
    expect(validStreamUrl('javascript:alert(1)')).toBe(false)
    expect(validStreamUrl('https://a.b/"onerror')).toBe(false)
  })
  it('m3u8 ve pls listeye girmez', () => {
    expect(playable({url_resolved: 'https://a.b/live.m3u8'})).toBeNull()
    expect(playable({url_resolved: 'https://a.b/x', hls: 1})).toBeNull()
    expect(playable({url_resolved: 'https://a.b/list.pls'})).toBeNull()
    expect(playable({url_resolved: 'https://a.b/stream', hls: 0})).toBe('https://a.b/stream')
  })
})

describe('takım', () => {
  it('komutu tanır', () => {
    expect(isTeamCommand('/takim')).toBe(true)
    expect(isTeamCommand('/takım ')).toBe(true)
    expect(isTeamCommand('/takimlar')).toBe(false)
  })
  it('herkesi bir kez, kimliğiyle dağıtır', () => {
    const people = ['a', 'b', 'c', 'd', 'e'].map(uid => ({uid, name: 'Ali'}))
    const t = makeTeams(people, () => .3)!
    expect(t.teams.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(t.teams[0]).toHaveLength(3)
    expect(t.text.split('\n')[0]).toMatch(/^Takım 1: /)
    expect(makeTeams(people.slice(0, 1))).toBeNull()
  })
})
