// Paketlenmiş eski sürüm: güncellemeyi buluyor ve indiriyor mu, bas-konuş tuşu okunuyor mu.
// Uygulama güncelleme inince kapanırken kurulum başlatmasın diye süreç sert öldürülür.
import {_electron as electron} from 'playwright-core'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const exe = path.resolve('desktop/release/win-unpacked/Telsiz.exe')
const data = path.join(os.tmpdir(), 'telsiz-packaged-test')
const app = await electron.launch({executablePath: exe, args: [`--user-data-dir=${data}`], env: {...process.env, TELSIZ_URL: 'http://localhost:4173/'}})
const log = []
const out = d => { for (const l of String(d).split('\n')) if (/update|ptt/.test(l)) { log.push(l.trim()); console.log('log:', l.trim()) } }
app.process().stdout.on('data', out)
app.process().stderr.on('data', out)
const w = await app.firstWindow()
await w.waitForFunction(() => window.telsiz)
console.log('surum', await app.evaluate(({app}) => app.getVersion()))

await w.evaluate(() => {
  window.__ptt = []
  window.telsizDesktop.onPtt(d => window.__ptt.push(d))
  window.telsizDesktop.setPtt(0x87)
})
// F24 hiçbir uygulamada iş yapmaz, açık pencerelere yazı düşmez.
execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);'
[W.K]::keybd_event(0x87, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 300
[W.K]::keybd_event(0x87, 0, 2, [System.UIntPtr]::Zero)`])
await w.waitForTimeout(400)
console.log('tus durumu okundu')
console.log('ptt', await w.evaluate(() => window.__ptt))
await w.evaluate(() => window.telsizDesktop.setPtt(0))

const end = Date.now() + 15_000
while (Date.now() < end && !log.some(l => /update-downloaded|update-error|update-not-available/.test(l))) await new Promise(r => setTimeout(r, 1000))
console.log(log.some(l => l.includes('update-downloaded')) ? 'GUNCELLEME INDI' : 'GUNCELLEME INMEDI')
app.process().kill('SIGKILL')
process.exit(0)
