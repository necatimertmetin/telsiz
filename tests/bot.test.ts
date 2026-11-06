import {describe, expect, it} from 'vitest'
import {HELP, MAPS, runCommand} from '../src/lib/bot'

describe('command bot', () => {
  it('leaves normal text alone', () => {
    expect(runCommand('selam', [])).toBeNull()
    expect(runCommand('/bilinmeyen', [])).toBeNull()
  })
  it('rolls within the given range', () => {
    expect(runCommand('/zar', [], () => 0)).toBe('Zar (1-6): 1')
    expect(runCommand('/zar 20', [], () => .999)).toBe('Zar (1-20): 20')
    expect(runCommand('/zar abc', [], () => 0)).toBe('Zar (1-6): 1')
  })
  it('accepts Turkish spelling', () => {
    expect(runCommand('/takım', ['a', 'b'], () => 0)).toContain('Takım 1')
    expect(runCommand('/YAZITURA', [], () => 0)).toBe('Para: Yazı')
    expect(runCommand('/yardım', [])).toBe(HELP)
  })
  it('picks a map from the pool', () => {
    expect(MAPS).toContain(runCommand('/harita', [], () => .5)!.replace('Harita: ', ''))
  })
  it('splits everyone into two even teams', () => {
    const out = runCommand('/takim', ['a', 'b', 'c', 'd'], () => .3)!
    const [t1, t2] = out.split('\n').map(l => l.split(': ')[1].split(', '))
    expect(t1).toHaveLength(2)
    expect(t2).toHaveLength(2)
    expect([...t1, ...t2].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('needs at least two people or options', () => {
    expect(runCommand('/takim', ['a'])).toContain('en az iki')
    expect(runCommand('/sec tek', [])).toBe(HELP)
    expect(runCommand('/sec ali, veli', [], () => .9)).toBe('Seçilen: veli')
  })
})
