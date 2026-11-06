import {useEffect, type ReactNode} from 'react'
import {Icon} from './Icon'

export function Modal({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-label={title}>
        <header><h3>{title}</h3><button className="ico" aria-label="Kapat" onClick={onClose}><Icon n="x" /></button></header>
        <div className="modalbody">{children}</div>
      </div>
    </div>
  )
}
