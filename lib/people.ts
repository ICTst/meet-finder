export type Person = {
  name: string;
  email: string;
}

// テスト
export const PEOPLE: Person[] = [
  { name: "玉木", email: "s.tamaki@ictinc.co.jp"},
  { name: "長尾さん", email: "nagao@ictinc.co.jp"},
  { name: "社長", email: "uji@ictinc.co.jp"},
]

// 会議室 リソースカレンダー
export const ROOM = {
  name: "会議室",
  calendarId: process.env.ROOM_RESOURCE_ID ?? "",
}

// メンバーと会議室をまとめて、取得対象のリストにする
export function buildTargets(): { name: string; calendarId: string }[] {
  return [
    ...PEOPLE.map((p) => ({ name: p.name, calendarId: p.email })),
    { name: ROOM.name, calendarId: ROOM.calendarId },
  ];
}