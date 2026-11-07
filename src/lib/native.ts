// Masaüstü (Electron) ve Android (Capacitor) kabuklarının web koduna açtığı köprü.
type TelsizPlugin = {
  callStart(): Promise<void>
  callStop(): Promise<void>
  setSpeaker(o: {on: boolean}): Promise<void>
  fileOpen(o: {name: string; type: string}): Promise<{handle: string}>
  fileWrite(o: {handle: string; b64: string}): Promise<void>
  fileClose(o: {handle: string}): Promise<void>
  appVersion?(): Promise<{version: string}>
  installUpdate?(o: {url: string}): Promise<void>
  radioTitle?(o: {url: string}): Promise<{title?: string}>
}
export type DesktopBridge = {
  onHotkey(cb: (k: 'mute' | 'deaf' | 'clip') => void): void
  listSources(): Promise<{id: string; name: string; thumb: string}[]>
  pickSource(id: string | null, audio: boolean): Promise<void>
  flash(): void
  setPtt?(vk: number): void
  onPtt?(cb: (down: boolean) => void): void
  onUpdate?(cb: () => void): void
  installUpdate?(): void
  appVersion?(): Promise<string>
  checkUpdate?(): Promise<boolean>
  setOverlay?(people: {name: string; talk: boolean; muted: boolean}[] | null): void
  setAdblock?(on: boolean): Promise<boolean>
  adblockOn?(): Promise<boolean>
  setPipAvail?(on: boolean): void
  exitPip?(): void
  onPipMode?(cb: (on: boolean) => void): void
  radioTitle?(url: string): Promise<string | null>
  setTitleBar?(o: {color: string; symbolColor: string}): void
}
declare global {
  interface Window {
    Capacitor?: {getPlatform?: () => string; Plugins?: {Telsiz?: TelsizPlugin}}
    telsizDesktop?: DesktopBridge
  }
}

export const desktop = () => window.telsizDesktop
export const androidPlugin = () => window.Capacitor?.Plugins?.Telsiz
const plugin = () => window.Capacitor?.Plugins?.Telsiz
// Eski masaüstü kabuğunda köprü yok, Electron sürümü tarayıcı kimliğine de yazar.
export async function shellVersion(): Promise<string | null> {
  const p = androidPlugin()
  if (p?.appVersion) return (await p.appVersion()).version
  return await desktop()?.appVersion?.() ?? navigator.userAgent.match(/telsiz(?:-desktop)?\/(\d+\.\d+\.\d+)/i)?.[1] ?? null
}
// Ölçüm: 6 Mb/sn'de VP8 1080p'yi tutamıyor. Donanımlı H264 üç izleyicide de 1080p verip işlemciyi yormuyor,
// donanım yoksa yazılımda en iyi sonucu VP9 verdi.
export let screenCodec = 'video/VP9'
export async function pickScreenCodec() {
  try {
    // mediaCapabilities'in powerEfficient değeri donanım varken de false dönüyor, bu yüzden doğrudan sorulur.
    const r = await VideoEncoder.isConfigSupported({codec: 'avc1.42E033', width: 1920, height: 1080, bitrate: 6_000_000, framerate: 60, hardwareAcceleration: 'prefer-hardware'})
    screenCodec = r.supported ? 'video/H264' : 'video/VP9'
  } catch { /* eski tarayıcı, varsayılan kalır */ }
}
export const isAndroidApp = () => window.Capacitor?.getPlatform?.() === 'android'
export const canShareScreen = () => !isAndroidApp() && !!navigator.mediaDevices?.getDisplayMedia

export async function callStarted() {
  await plugin()?.callStart().catch(() => {})
}
export async function callStopped() {
  await plugin()?.callStop().catch(() => {})
}
export let speakerOn = true
export const setSpeaker = (on: boolean) => { speakerOn = on; return plugin()?.setSpeaker({on}).catch(() => {}) }
// WebView ses başlayınca yolu kendi seçebiliyor; seçimimizi tekrar uygularız.
export const reapplySpeaker = () => plugin()?.setSpeaker({on: speakerOn}).catch(() => {})

function toB64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// Android WebView blob indirmesini desteklemez: dosya parça parça İndirilenler'e yazılır.
export async function saveBlob(blob: Blob, name: string, type: string) {
  const p = plugin()
  if (isAndroidApp() && p) {
    const {handle} = await p.fileOpen({name, type: type || 'application/octet-stream'})
    const step = 3 * 256 * 1024
    for (let off = 0; off < blob.size; off += step)
      await p.fileWrite({handle, b64: toB64(await blob.slice(off, off + step).arrayBuffer())})
    await p.fileClose({handle})
    return 'İndirilenler klasörüne kaydedildi'
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return null
}
