import type {CsState} from './cs'
export type Poll = {q: string; opts: string[]}
export type Sched = {days: number[]; time: string; on: boolean}
export type FileMeta = {id: string; name: string; size: number; type: string}
export type PermKey = 'rooms' | 'teams' | 'radio' | 'kick'
export type RoomKind = 'voice' | 'radio' | 'music'
export type Station = {id: string; title: string; url: string; tag: string}
export type Who = 'all' | 'admin' | 'owner'
export type VRoom = {id: string; title: string; kind: RoomKind; sid?: string; tunedBy?: string}

type Base = {id: string; ts: number; uid: string; name: string; pk?: string; sig?: string}
export type Box = {iv: string; ct: string; keys: Record<string, {iv: string; ct: string}>}
export type Ev = Base & (
  | {t: 'sealed'; ch: string; box: Box}
  | {t: 'msg'; ch: string; text: string; file?: FileMeta; re?: string; poll?: Poll; teams?: string[][]}
  | {t: 'edit'; target: string; text: string; ch?: string}
  | {t: 'del'; target: string; ch?: string}
  | {t: 'react'; target: string; emoji: string; on: boolean; ch?: string}
  | {t: 'pin'; target: string; on: boolean; ch?: string}
  | {t: 'vote'; target: string; opt: number; on: boolean; ch?: string}
  | {t: 'sched'; days: number[]; time: string; on: boolean}
  | {t: 'chan'; chId: string; title: string}
  | {t: 'group'; title: string}
  | {t: 'role'; target: string; role: 'admin' | 'member'}
  | {t: 'kick'; target: string; prev: string; box: Box}
  | {t: 'wipe'}
  | {t: 'vroom'; rid: string; title: string; on: boolean; kind?: RoomKind}
  | {t: 'station'; sid: string; title: string; url: string; tag: string; on: boolean}
  | {t: 'tune'; rid: string; sid: string}
  | {t: 'perm'; key: PermKey; who: Who}
  | {t: 'hi'}
)

export type Msg = {
  id: string; ch: string; uid: string; name: string; ts: number; text: string
  file?: FileMeta; re?: string; edited: boolean; pinned: boolean; reacts: Record<string, string[]>
  poll?: Poll; votes: Record<number, string[]>; teams?: string[][]
}
export type Channel = {id: string; title: string}
export type View = {title: string; channels: Channel[]; msgs: Map<string, Msg[]>; byId: Map<string, Msg>; people: Map<string, string>; sched: Sched | null
  owner: string; admins: Set<string>; banned: Map<string, number>; prevs: Set<string>; lastKick: string | null; wiped: boolean
  rooms: VRoom[]; perms: Record<PermKey, Who>; stations: Station[]
}

// room: hangi ses odasında. Boş ya da yok ise ana oda (Telsiz odası); eski sürümler hep orada görünür.
// cs: CS2 maç durumu (Windows uygulaması, isteğe bağlı). Eski sürümler bu alanı yok sayar.
export type VoiceState = {in: boolean; muted: boolean; deaf: boolean; cam: boolean; screen: boolean; sAudio?: boolean; room?: string; cs?: CsState}
export type Other = {uid: string; name: string; voice: VoiceState}
export type Presence = {uid: string; name: string; voice: VoiceState; others?: Other[]}
export type Profile = {color?: string; avatar?: string; look?: 'monster' | 'badge' | 'pixel' | 'letter'; seed?: number; icon?: number}
