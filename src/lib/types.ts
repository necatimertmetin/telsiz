export type Poll = {q: string; opts: string[]}
export type Sched = {days: number[]; time: string; on: boolean}
export type FileMeta = {id: string; name: string; size: number; type: string}

type Base = {id: string; ts: number; uid: string; name: string; pk?: string; sig?: string}
export type Box = {iv: string; ct: string; keys: Record<string, {iv: string; ct: string}>}
export type Ev = Base & (
  | {t: 'sealed'; ch: string; box: Box}
  | {t: 'msg'; ch: string; text: string; file?: FileMeta; re?: string; poll?: Poll}
  | {t: 'edit'; target: string; text: string; ch?: string}
  | {t: 'del'; target: string; ch?: string}
  | {t: 'react'; target: string; emoji: string; on: boolean; ch?: string}
  | {t: 'pin'; target: string; on: boolean; ch?: string}
  | {t: 'vote'; target: string; opt: number; on: boolean; ch?: string}
  | {t: 'sched'; days: number[]; time: string; on: boolean}
  | {t: 'chan'; chId: string; title: string}
  | {t: 'group'; title: string}
)

export type Msg = {
  id: string; ch: string; uid: string; name: string; ts: number; text: string
  file?: FileMeta; re?: string; edited: boolean; pinned: boolean; reacts: Record<string, string[]>
  poll?: Poll; votes: Record<number, string[]>
}
export type Channel = {id: string; title: string}
export type View = {title: string; channels: Channel[]; msgs: Map<string, Msg[]>; byId: Map<string, Msg>; people: Map<string, string>; sched: Sched | null}

export type VoiceState = {in: boolean; muted: boolean; deaf: boolean; cam: boolean; screen: boolean; sAudio?: boolean}
export type Other = {uid: string; name: string; voice: VoiceState}
export type Presence = {uid: string; name: string; voice: VoiceState; others?: Other[]}
export type Profile = {color?: string; avatar?: string}
