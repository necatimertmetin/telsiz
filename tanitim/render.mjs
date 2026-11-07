// anim.html'i kare kare çekip mp4 yapar. Kullanım: node tanitim/render.mjs [--dikey]
// Çıktı: tanitim/out/anim-yatay.mp4 ya da anim-dikey.mp4 (ffmpeg gerekir).
import {chromium} from 'playwright-core'
import {mkdirSync, rmSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'

const v = process.argv.includes('--dikey')
const [w, h] = v ? [1080, 1920] : [1920, 1080]
const FPS = 30
const dir = join('tanitim', 'out', v ? 'kare-dikey' : 'kare-yatay')
rmSync(dir, {recursive: true, force: true}); mkdirSync(dir, {recursive: true})

const browser = await chromium.launch({channel: 'chrome', headless: true})
const p = await browser.newPage({viewport: {width: w, height: h}})
await p.goto(pathToFileURL(join('tanitim', 'anim.html')).href + (v ? '?dikey=1&t=0' : '?t=0'))
await p.evaluate(() => document.fonts.ready)
const dur = await p.evaluate(() => window.DUR)
for (let i = 0; i < dur * FPS; i++) {
  await p.evaluate(t => window.render(t), i / FPS)
  await p.screenshot({path: join(dir, `${String(i).padStart(4, '0')}.png`)})
}
await browser.close()
const out = join('tanitim', 'out', v ? 'anim-dikey.mp4' : 'anim-yatay.mp4')
execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out])
rmSync(dir, {recursive: true, force: true})
console.log('hazır:', out)
