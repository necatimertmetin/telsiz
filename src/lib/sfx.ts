// Sentezlenmiş kısa sesler: dosya taşımaz, her cihaz kendi üretir.
export const SFX: Record<string, {label: string; notes: [number, number][]; type: OscillatorType}> = {
  bomb: {label: 'Bomba', notes: [[880, .08], [880, .08], [880, .08], [1320, .25]], type: 'square'},
  ace: {label: 'Ace', notes: [[523, .1], [659, .1], [784, .1], [1047, .3]], type: 'triangle'},
  noob: {label: 'Hata', notes: [[392, .18], [370, .18], [349, .18], [311, .45]], type: 'sawtooth'},
  rush: {label: 'Rush', notes: [[220, .07], [330, .07], [440, .07], [660, .07], [880, .15]], type: 'square'},
  wait: {label: 'Bekle', notes: [[440, .3], [330, .4]], type: 'sine'},
  air: {label: 'Korna', notes: [[466, .35], [466, .1], [466, .45]], type: 'sawtooth'},
  ding: {label: 'Ding', notes: [[1568, .5]], type: 'sine'},
  gg: {label: 'GG', notes: [[659, .12], [784, .12], [659, .12], [784, .3]], type: 'triangle'},
}

// Dalga türüne göre tepe düzeyi: kare ve testere aynı tepede kulağa çok daha yüksek gelir.
const LEVEL: Record<OscillatorType, number> = {sine: .55, triangle: .5, square: .22, sawtooth: .25, custom: .3}

// sink: konuşmaların çıktığı hoparlör, efekt de oradan çıksın.
export function playSfx(id: string, sink = '') {
  const s = SFX[id]
  if (!s) return
  try {
    const c = new AudioContext() as AudioContext & {setSinkId?: (i: string) => Promise<void>}
    const play = () => {
      const vol = LEVEL[s.type]
      let t = c.currentTime
      for (const [f, d] of s.notes) {
        const o = c.createOscillator(), g = c.createGain()
        o.type = s.type; o.frequency.value = f
        // Nota boyunca düzey korunur, sadece sonu söner; yoksa ses daha başında kaybolur.
        g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + d * .7); g.gain.exponentialRampToValueAtTime(0.001, t + d)
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + d)
        t += d
      }
      setTimeout(() => c.close(), (t - c.currentTime) * 1000 + 500)
    }
    if (sink && c.setSinkId) void c.setSinkId(sink).catch(() => {}).then(play); else play()
  } catch { /* ses yok */ }
}
