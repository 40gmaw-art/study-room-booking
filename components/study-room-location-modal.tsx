"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const IMAGE_SRC = "/images/study-room-location.png";

// Self-contained trigger + modal: the button that opens it lives in the same
// flex row as the other home-page CTAs (see app/page.tsx), and the modal
// itself is fixed-position so where this sits in the DOM doesn't matter.
// Referencing the image by plain string path (not a static import) means
// the build never fails even before the file exists at
// public/images/study-room-location.png -- only a broken <img> at runtime
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
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="스터디룸 위치 안내"
          onClick={() => setIsOpen(false)}
        >
          {/*
            Outer box: the box's own w/h formula (min(vw), min(dvh)) already
            comes out portrait-shaped (narrow x tall) on a phone held
            upright and landscape-shaped (wide x short) once the phone is
            turned sideways or on a PC window -- no separate breakpoint
            needed for ITS size, only for whether the image inside gets
            rotated. dvh (not vh) reflects the actually-visible mobile
            viewport (accounts for the browser address bar).
          */}
          <div
            className="relative h-[min(80dvh,900px)] w-[min(92vw,1400px)]"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Direct child of the outer box (not the rotated layer below),
                so it's never itself rotated or displaced. */}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="닫기"
              className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#4B3B71] shadow-md transition-colors hover:bg-[#f5efff]"
            >
              <X className="h-5 w-5" />
            </button>

            {hasImageError ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-xl">
                <p className="font-semibold text-[#4B3B71]">위치 안내 이미지를 준비 중입니다.</p>
                <p>잠시 후 다시 확인해 주세요.</p>
              </div>
            ) : (
              // Safety-clip layer: exactly overlays the outer box and hosts
              // the rounded-corner/shadow look, independent of whatever the
              // rotated layer inside it does.
              <div className="absolute inset-0 overflow-hidden rounded-2xl shadow-xl">
                {/*
                  The image is landscape-shaped source art. Below "md" AND
                  while the viewport is portrait (a phone held upright) it's
                  rotated 90deg so it uses the box's larger (vertical) extent
                  instead of being squeezed to the narrow width. Its own
                  pre-rotation box is given the SWAPPED w/h of the outer box
                  above, so after the rotation its visual footprint exactly
                  matches the outer box again. Centered via
                  left/top-1/2 + -translate-1/2 (not flex), so an
                  intentionally-oversized pre-rotation box can't get
                  flex-shrunk before the rotation is applied.

                  At "md" and up, and on a phone turned sideways
                  (landscape), the rotation is switched off and the layer
                  simply fills the box normally -- this covers PC (always,
                  regardless of window shape) and a rotated phone, both of
                  which already have enough horizontal room to show the
                  landscape image right-side-up and large.
                */}
                <div
                  className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 rotate-0 max-md:portrait:h-[min(92vw,1400px)] max-md:portrait:w-[min(80dvh,900px)] max-md:portrait:rotate-90"
                >
                  {/* Unknown intrinsic size ahead of time; object-contain
                      (not next/image, which would need an explicit
                      width/height or fill) both preserves the aspect ratio
                      and upscales a small source image to fill the box
                      above, and (per requirement) never crops it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={IMAGE_SRC}
                    alt="스터디룸 위치 안내"
                    onError={() => setHasImageError(true)}
                    className="h-full w-full object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
