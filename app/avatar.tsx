"use client";

import { useState } from "react";
import Image from "next/image";

// メンバーのアイコン。画像が無い／読み込み失敗時は名前の頭文字の丸で代用
export function Avatar({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <Image
        src={src}
        alt={name}
        width={28}
        height={28}
        onError={() => setFailed(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">
      {name.slice(0, 1)}
    </span>
  );
}
