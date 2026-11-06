// Emülatördeki uygulamayı WebView hata ayıklama kanalından sürer.
const list = await (await fetch('http://localhost:9333/json')).json()
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (method, params = {}) => new Promise(r => { pend.set(++id, r); ws.send(JSON.stringify({id, method, params})) })
export const ev = async expr => {
  const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true, userGesture: true})
  if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)
  return r.result?.result?.value
}
console.log(list[0].url)
console.log(await ev(`JSON.stringify({url:location.href,cap:!!window.Capacitor,plat:window.Capacitor?.getPlatform?.(),plugin:!!window.Capacitor?.Plugins?.Telsiz,me:window.telsiz?.me?.name,body:document.body.innerText.slice(0,60)})`))
const script = process.argv[2]
if (script) console.log(await ev(script))
process.exit(0)
