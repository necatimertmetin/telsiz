// Komut botu sunucusuz çalışır: komutu yazanın cihazı sonucu üretir, sonuç herkese normal mesaj olarak gider.
export const MAPS = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust II', 'Vertigo', 'Train']

const pick = <T,>(list: T[], r: () => number) => list[Math.floor(r() * list.length)]

function shuffle<T>(list: T[], r: () => number) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const HELP = 'Komutlar: /zar, /zar 20, /yazitura, /harita, /takim, /sec Ali Veli'

// Komut değilse null döner, metin olduğu gibi gönderilir.
export function runCommand(text: string, people: string[], r: () => number = Math.random): string | null {
  const m = text.trim().match(/^\/(\S+)\s*(.*)$/s)
  if (!m) return null
  const arg = m[2].trim()
  switch (m[1].toLocaleLowerCase('tr').replace(/ı/g, 'i')) {
    case 'zar': {
      const n = /^\d{1,6}$/.test(arg) && +arg >= 2 ? +arg : 6
      return `Zar (1-${n}): ${1 + Math.floor(r() * n)}`
    }
    case 'yazitura': return `Para: ${r() < .5 ? 'Yazı' : 'Tura'}`
    case 'harita': return `Harita: ${pick(MAPS, r)}`
    case 'sec': {
      const opts = arg.split(/[\s,]+/).filter(Boolean)
      return opts.length >= 2 ? `Seçilen: ${pick(opts, r)}` : HELP
    }
    case 'takim': {
      if (people.length < 2) return 'Takım için en az iki kişi gerekli'
      const a = shuffle(people, r), half = Math.ceil(a.length / 2)
      return `Takım 1: ${a.slice(0, half).join(', ')}\nTakım 2: ${a.slice(half).join(', ')}`
    }
    case 'yardim': return HELP
    default: return null
  }
}
