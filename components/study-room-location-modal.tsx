"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const IMAGE_SRC = "/images/study-room-location.jpg";

// Self-contained trigger + modal: the button that opens it lives in the same
// flex row as the other home-page CTAs (see app/page.tsx), and the modal
// itself is fixed-position so where this sits in the DOM doesn't matter.
// Referencing the image by plain string path (not a static import) means
// the build never fails even before the file exists at
// public/images/study-room-location.jpg -- only a broken <img> at runtime
// until it's added, handled below via onError.
export function StudyRoomLocationModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="h-12 w-full rounded-full border-2 border-[#4B3B71]/20 px-8 text-base font-semibold text-[#4B3B71] hover:bg-[#f5efff] sm:w-auto"
      >
        스터디룸 위치 확인
      </Button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="스터디룸 위치 안내"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-full" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="닫기"
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#4B3B71] shadow-md transition-colors hover:bg-[#f5efff]"
            >
              <X className="h-5 w-5" />
            </button>

            {hasImageError ? (
              <div className="flex h-56 w-72 max-w-full flex-col items-center justify-center gap-1 rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-xl">
                <p className="font-semibold text-[#4B3B71]">위치 안내 이미지를 준비 중입니다.</p>
                <p>잠시 후 다시 확인해 주세요.</p>
              </div>
            ) : (
              // Unknown intrinsic size ahead of time; a plain img lets CSS
              // scale it to fit the viewport without distorting the aspect
              // ratio (next/image would need explicit width/height or fill).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={IMAGE_SRC}
                alt="스터디룸 위치 안내"
                onError={() => setHasImageError(true)}
                className="max-h-[90vh] w-auto max-w-full rounded-2xl object-contain shadow-xl"
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
