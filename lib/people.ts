export type Person = {
  name: string;
  email: string;
}

// テスト
export const PEOPLE: Person[] = [
  { name: "玉木", email: "s.tamaki@ictinc.co.jp"},
  { name: "長尾さん", email: "nagao@ictinc.co.jp"},
  { name: "社長", email: "uji@ictinc.co.jp"},
  { name: "博也さん", email: "ueyama@ictinc.co.jp"},
  { name: "松本さん", email: "y.matsumoto@ictinc.co.jp"},
  { name: "内田さん", email: "uchida@ictinc.co.jp"},
  { name: "酒澤さん", email: "sakazawa@ictinc.co.jp"},
  { name: "滝本さん", email: "r.takimoto@ictinc.co.jp"},
  { name: "中野さん", email: "y.nakano@ictinc.co.jp"},
  { name: "陽子さん", email: "y.ueyama@ictinc.co.jp"},
  { name: "小林さん", email: "s.kobayashi@ictinc.co.jp"},
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

// AIが返した呼び名を、既知メンバーに突き合わせる（簡易マッチ）
export function resolveParticipants(names: string[]): {
  matched: Person[];
  unmatched: string[];
} {
  const matched: Person[] = [];
  const unmatched: string[] = [];
  for (const n of names) {
    const hit = PEOPLE.find(
      (p) => p.name.includes(n) || n.includes(p.name) || p.email.startsWith(n),
    );
    if (hit) matched.push(hit);
    else unmatched.push(n);
  }
  return { matched, unmatched };
}