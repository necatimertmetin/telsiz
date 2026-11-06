import {describe, expect, it} from 'vitest'
import {loadIdentity, newIdentity, openBox, sealBox, signEvent, signText, validJwk, validPk, verifyEvent, verifyText} from '../src/lib/identity'
import {canAccept, pinResult, shouldPurge} from '../src/lib/history'
import type {Ev} from '../src/lib/types'

const msg = (over: Partial<Ev> = {}) => ({id: 'm1', ts: 1, uid: 'a', name: 'Ali', t: 'msg', ch: 'genel', text: 'selam', ...over}) as Ev

describe('signatures', () => {
  it('accepts a signed event and rejects any change', async () => {
    const id = await newIdentity()
    const e = await signEvent(id, msg())
    expect(await verifyEvent(e)).toBe(true)
    expect(await verifyEvent({...e, text: 'değişti'} as Ev)).toBe(false)
    expect(await verifyEvent({...e, uid: 'b'} as Ev)).toBe(false)
  })
  it('does not depend on field order or empty fields', async () => {
    const id = await newIdentity()
    const e = await signEvent(id, msg())
    const shuffled = Object.fromEntries(Object.entries(e).reverse().concat([['re', undefined]])) as Ev
    expect(await verifyEvent(JSON.parse(JSON.stringify(shuffled)))).toBe(true)
  })
  it('rejects another key claiming the signature', async () => {
    const [a, b] = [await newIdentity(), await newIdentity()]
    const e = await signEvent(a, msg())
    expect(await verifyEvent({...e, pk: b.pk} as Ev)).toBe(false)
  })
  it('signs plain text for the connection proof', async () => {
    const id = await newIdentity()
    const sig = await signText(id, 'a|b')
    expect(await verifyText(id.pk, 'a|b', sig)).toBe(true)
    expect(await verifyText(id.pk, 'a|c', sig)).toBe(false)
  })
  it('keeps the same key after a backup round trip', async () => {
    const id = await newIdentity()
    expect(validJwk(JSON.parse(JSON.stringify(id.jwk)))).toBe(true)
    expect(validJwk({sign: {}, dh: {}})).toBe(false)
    const back = await loadIdentity(JSON.parse(JSON.stringify(id.jwk)))
    expect(back.pk).toBe(id.pk)
    expect(validPk(id.pk)).toBe(true)
    expect(await verifyEvent(await signEvent(back, msg()))).toBe(true)
  })
})

describe('pinning', () => {
  it('trusts the first key and refuses a different one', () => {
    expect(pinResult(undefined, 'k1')).toBe('new')
    expect(pinResult('k1', 'k1')).toBe('same')
    expect(pinResult('k1', 'k2')).toBe('conflict')
  })
  it('allows unsigned events only from before the change', () => {
    expect(canAccept(msg({ts: 1}))).toBe(true)
    expect(canAccept(msg({ts: Date.UTC(2030, 0, 1)}))).toBe(false)
    expect(canAccept(msg({ts: Date.UTC(2030, 0, 1), sig: 'x', pk: 'y'}))).toBe(true)
  })
  it('refuses a private message from someone outside it', () => {
    expect(canAccept(msg({ch: 'dm:b:c', sig: 'x', pk: 'y'}))).toBe(false)
    expect(canAccept(msg({ch: 'dm:a:c', sig: 'x', pk: 'y'}))).toBe(true)
  })
})

describe('private message boxes', () => {
  it('opens for members and nobody else', async () => {
    const [a, b, c] = [await newIdentity(), await newIdentity(), await newIdentity()]
    const box = await sealBox(a, {t: 'msg', text: 'gizli'}, {a: a.pk, b: b.pk})
    expect(JSON.stringify(box)).not.toContain('gizli')
    expect(await openBox(b, box, 'b', a.pk)).toEqual({t: 'msg', text: 'gizli'})
    expect(await openBox(a, box, 'a', a.pk)).toEqual({t: 'msg', text: 'gizli'})
    await expect(openBox(c, box, 'c', a.pk)).rejects.toThrow()
    await expect(openBox(c, box, 'b', a.pk)).rejects.toThrow()
  })
})

describe('real delete', () => {
  const del = (over: Partial<Ev> = {}) => ({id: 'd1', ts: 5, uid: 'a', name: 'Ali', t: 'del', target: 'm1', ...over}) as Ev
  it('removes only the author message', () => {
    expect(shouldPurge(msg(), del())).toBe(true)
    expect(shouldPurge(msg(), del({uid: 'b'}))).toBe(false)
  })
  it('ignores a delete dated before the message', () => {
    expect(shouldPurge(msg({ts: 9}), del({ts: 5}))).toBe(false)
  })
})
