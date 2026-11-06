export type FileMeta = {id: string; name: string; size: number; type: string}

type Base = {id: string; ts: number; uid: string; name: string}
export type Ev = Base & (
  | {t: 'msg'; ch: string; text: string; file?: FileMeta; re?: string}
  | {t: 'edit'; target: string; text: string}
  | {t: 'del'; target: string}
  | {t: 'react'; target: string; emoji: string; on: boolean}
  | {t: 'chan'; chId: string; title: string}
  | {t: 'group'; title: string}
)

export type Msg = {
  id: string; ch: string; uid: string; name: string; ts: number; text: string
  file?: FileMeta; re?: string; edited: boolean; reacts: Record<string, string[]>
}
export type Channel = {id: string; title: string}
export type View = {title: string; channels: Channel[]; msgs: Map<string, Msg[]>; byId: Map<string, Msg>; people: Map<string, string>}

export type VoiceState = {in: boolean; muted: boolean; deaf: boolean; cam: boolean; screen: boolean}
export type Presence = {uid: string; name: string; voice: VoiceState}
