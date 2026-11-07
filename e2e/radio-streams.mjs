// Radio Browser listesindeki Türk yayınlarından ilk onunun tarayıcıda gerçekten çalıp çalmadığını dener.
import {chromium} from 'playwright-core'
const b = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']})
const p = await b.newPage()
await p.goto('http://localhost:4173/')
const res = await p.evaluate(async () => {
  const q = new URLSearchParams({limit: '25', hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true', countrycode: 'TR'})
  const list = await (await fetch('https://de1.api.radio-browser.info/json/stations/search?' + q)).json()
  const ok = list.filter(x => x.hls !== 1 && !/\.m3u8?(\?|$)|\.pls(\?|$)/i.test(x.url_resolved)).slice(0, 10)
  const out = []
  for (const x of ok) {
    const a = new Audio(x.url_resolved)
    const r = await new Promise(res => {
      const t = setTimeout(() => res('zaman aşımı'), 8000)
      a.onerror = () => { clearTimeout(t); res('hata') }
      a.ontimeupdate = () => { if (a.currentTime > 1) { clearTimeout(t); res('çalıyor') } }
      a.play().catch(e => { clearTimeout(t); res('play: ' + e.name) })
    })
    a.pause(); a.src = ''
    out.push(x.name + ' => ' + r)
  }
  return out
})
console.log(res.join('\n'))
await b.close()
