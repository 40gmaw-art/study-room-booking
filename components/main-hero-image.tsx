"use client";

import { useState } from "react";
import Image from "next/image";

export function MainHeroImage() {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br from-[#8b72c2] to-[#4B3B71]">
        <div className="h-28 w-full max-w-[220px] rounded-[1.5rem] border border-white/20 bg-white/10 shadow-inner" />
      </div>
    );
  }

  return (
    <Image
      src="/images/study-room.png"
      alt="공명 스터디룸"
      fill
      priority
      sizes="(min-width: 1024px) 1152px, 100vw"
      onError={() => setHasError(true)}
      className="z-0 object-cover object-center"
    />
  );
}
