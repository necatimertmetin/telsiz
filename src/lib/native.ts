// Masaüstü (Electron) ve Android (Capacitor) kabuklarının web koduna açtığı köprü.
type TelsizPlugin = {
  callStart(): Promise<void>
  callStop(): Promise<void>
  setSpeaker(o: {on: boolean}): Promise<void>
  fileOpen(o: {name: string; type: string}): Promise<{handle: string}>
  fileWrite(o: {handle: string; b64: string}): Promise<void>
  fileClose(o: {handle: string}): Promise<void>
}
export type DesktopBridge = {
  onHotkey(cb: (k: 'mute' | 'deaf') => void): void
  listSources(): Promise<{id: string; name: string; thumb: string}[]>
  pickSource(id: string | null): Promise<void>
  flash(): void
}
declare global {
  interface Window {
    Capacitor?: {getPlatform?: () => string; Plugins?: {Telsiz?: TelsizPlugin}}
    telsizDesktop?: DesktopBridge
  }
}

export const desktop = () => window.telsizDesktop
const plugin = () => window.Capacitor?.Plugins?.Telsiz
export const isAndroidApp = () => window.Capacitor?.getPlatform?.() === 'android'
export const canShareScreen = () => !isAndroidApp() && !!navigator.mediaDevices?.getDisplayMedia

export async function callStarted() {
  await plugin()?.callStart().catch(() => {})
}
export async function callStopped() {
  await plugin()?.callStop().catch(() => {})
}
export const setSpeaker = (on: boolean) => plugin()?.setSpeaker({on}).catch(() => {})

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
