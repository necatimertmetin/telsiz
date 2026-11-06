// public/icon.svg'den tüm platform ikonlarını üretir.
import {chromium} from 'playwright-core'
import {mkdirSync, readFileSync} from 'node:fs'
const svg = readFileSync('public/icon.svg', 'utf8')
const fg = svg.replace(/<rect[^>]*\/>/, '').replace('viewBox="0 0 512 512"', 'viewBox="-128 -128 768 768"')
const b = await chromium.launch({channel: 'chrome', headless: true})
const shot = async (src, size, path, transparent = true) => {
  const p = await (await b.newContext({viewport: {width: size, height: size}})).newPage()
  await p.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${src}`)
  await p.screenshot({path, omitBackground: transparent})
}
await shot(svg, 192, 'public/icon-192.png')
await shot(svg, 512, 'public/icon-512.png')
mkdirSync('desktop', {recursive: true})
await shot(svg, 512, 'desktop/icon.png')
if (process.argv[2] === 'android') for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  const dir = `android/app/src/main/res/mipmap-${d}`
  await shot(svg, s, `${dir}/ic_launcher.png`); await shot(svg, s, `${dir}/ic_launcher_round.png`)
  await shot(fg, Math.round(s * 108 / 48), `${dir}/ic_launcher_foreground.png`)
}
await b.close()
