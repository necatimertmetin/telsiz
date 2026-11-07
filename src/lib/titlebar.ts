import {desktop} from './native'

// Windows uygulamasında kendi başlık çubuğu yok: küçült/büyüt/kapat düğmeleri sayfanın sağ üstüne biner.
// Sayfa o alanı boş bırakır (--wco-w, --wco-h), üst çubuktan pencere sürüklenir. Eski kabukta ve tarayıcıda hiçbir şey değişmez.
type Overlay = {visible: boolean; getTitlebarAreaRect(): DOMRect; addEventListener(t: 'geometrychange', f: () => void): void}
const overlay = () => (navigator as Navigator & {windowControlsOverlay?: Overlay}).windowControlsOverlay

export function setupTitlebar() {
  const o = overlay()
  if (!o) return
  const apply = () => {
    const r = document.documentElement
    r.classList.toggle('wco', o.visible)
    if (!o.visible) return
    const b = o.getTitlebarAreaRect()
    r.style.setProperty('--wco-w', Math.max(0, Math.round(innerWidth - b.right)) + 'px')
    r.style.setProperty('--wco-h', Math.round(b.height) + 'px')
    last = ''
    requestAnimationFrame(syncTitlebar)
  }
  apply()
  o.addEventListener('geometrychange', apply)
  addEventListener('resize', apply)
}

const hex = (c: string) => {
  const m = c.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/)
  if (!m || (m[4] !== undefined && +m[4] === 0)) return null
  return '#' + [m[1], m[2], m[3]].map(x => Math.round(+x).toString(16).padStart(2, '0')).join('')
}

// Düğmelerin altındaki rengi bulur (sağ üst köşedeki ilk dolu arka plan) ve kabuğa yollar. Değişmediyse yollamaz.
let last = ''
export function syncTitlebar() {
  const d = desktop()
  if (!d?.setTitleBar || !document.documentElement.classList.contains('wco')) return
  let el: Element | null = document.elementFromPoint(innerWidth - 4, 4)
  let color: string | null = null
  while (el && !color) { color = hex(getComputedStyle(el).backgroundColor); el = el.parentElement }
  color ??= hex(getComputedStyle(document.body).backgroundColor) ?? '#14161a'
  const symbolColor = hex(getComputedStyle(document.body).color) ?? '#e8e6e1'
  const k = color + symbolColor
  if (k === last) return
  last = k
  d.setTitleBar({color, symbolColor})
}
