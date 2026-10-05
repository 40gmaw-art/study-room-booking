"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelReservationAction, cancelReservationsByDateAction } from "@/lib/booking-actions";
import { formatTimeRange, isPastTimeSlot, TIME_SLOTS } from "@/lib/booking";

// Only ACTIVE reservations are ever passed in (see app/my-reservations/page.tsx),
// so there's no status/cancelled_at to track here -- a cancelled reservation
// is removed from this list entirely rather than shown in a "취소됨" state.
export type MyReservationRow = {
  reservation_number: string;
  reservation_date: string;
  start_time: string;
  participant_count: number;
};

type CancelState = { success: boolean; message: string; reservationNumber?: string };

const initialCancelState: CancelState = { success: false, message: "" };

function formatSlotTime(startTime: string) {
  const slot = TIME_SLOTS.find((item) => item.value === startTime);
  return slot ? formatTimeRange({ start: slot.start, end: slot.end }) : startTime;
}

function formatDateHeading(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(date);
  return `${dateKey} (${weekday})`;
}

export function MyReservationsList({ initialReservations }: { initialReservations: MyReservationRow[] }) {
  const [removedReservationNumbers, setRemovedReservationNumbers] = useState<Set<string>>(() => new Set());
  const [cancelTarget, setCancelTarget] = useState<MyReservationRow | null>(null);
  const [batchCancelDate, setBatchCancelDate] = useState<string | null>(null);
  const [isBatchCancelling, setIsBatchCancelling] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [cancelState, cancelAction, isCancelling] = useActionState(cancelReservationAction, initialCancelState);
  const isAnyCancellationPending = isCancelling || isBatchCancelling;
  const reservations = initialReservations.filter(
    (reservation) => !removedReservationNumbers.has(reservation.reservation_number),
  );
  const reservationsByDate = new Map<string, MyReservationRow[]>();
  for (const reservation of reservations) {
    const dateReservations = reservationsByDate.get(reservation.reservation_date) ?? [];
    dateReservations.push(reservation);
    reservationsByDate.set(reservation.reservation_date, dateReservations);
  }
  const dateGroups = Array.from(reservationsByDate.entries())
    .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
    .map(([date, dateReservations]) => [
      date,
      [...dateReservations].sort((first, second) => first.start_time.localeCompare(second.start_time)),
    ] as const);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      const renderedReservations = initialReservations.filter(
        (reservation) => !removedReservationNumbers.has(reservation.reservation_number),
      );
      console.info("[my-reservations] component render data", {
        propsCount: initialReservations.length,
        props: initialReservations.map(({ reservation_date, start_time }) => ({ reservation_date, start_time })),
        renderedCount: renderedReservations.length,
        rendered: renderedReservations.map(({ reservation_date, start_time }) => ({ reservation_date, start_time })),
      });
    }
  }, [initialReservations, removedReservationNumbers]);

  useEffect(() => {
    if (!cancelState.message) {
      return;
    }

    if (cancelState.success && cancelState.reservationNumber) {
      const cancelledNumber = cancelState.reservationNumber;
      // The cancelled reservation is no longer active, so it's removed from
      // this list immediately -- matching what a re-fetch (refresh, or
      // navigating away and back) would show, since the page query only
      // ever selects status='active' rows.
      setRemovedReservationNumbers((previous) => new Set(previous).add(cancelledNumber));
      setCancelTarget(null);
    }

    setFeedback({ tone: cancelState.success ? "success" : "error", text: cancelState.message });
  }, [cancelState]);

  async function confirmBatchCancellation() {
    if (!batchCancelDate) {
      return;
    }

    setIsBatchCancelling(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.set("reservationDate", batchCancelDate);
      const result = await cancelReservationsByDateAction(formData);

      if (result.cancelledReservationNumbers.length) {
        setRemovedReservationNumbers((previous) => {
          const next = new Set(previous);
          result.cancelledReservationNumbers.forEach((number) => next.add(number));
          return next;
        });
      }
      setFeedback({ tone: result.success ? "success" : "error", text: result.message });
      setBatchCancelDate(null);
    } finally {
      setIsBatchCancelling(false);
    }
  }

  return (
    <>
      {feedback ? (
        <div
          className={`rounded-2xl p-3 text-sm ${
            feedback.tone === "success" ? "bg-[#f5efff] text-[#4B3B71]" : "bg-red-50 text-red-600"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {!reservations.length ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">예약 내역이 없습니다.</div>
      ) : (
        dateGroups.map(([date, dateReservations], groupIndex) => {
          const cancellableCount = dateReservations.filter(
            (reservation) => !isPastTimeSlot(reservation.reservation_date, reservation.start_time),
          ).length;

          return (
            <section key={date} className={`space-y-3 ${groupIndex > 0 ? "pt-5" : ""}`}>
              <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-bold text-[#4B3B71] sm:text-xl">{formatDateHeading(date)}</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit rounded-full border-[#4B3B71]/30 text-[#4B3B71] hover:bg-[#f5efff]"
                  disabled={cancellableCount === 0 || isAnyCancellationPending}
                  onClick={() => setBatchCancelDate(date)}
                >
                  예약 일괄 취소
                </Button>
              </div>
              {dateReservations.map((reservation) => {
                // Cancellable only while the slot hasn't started yet -- reuses the
                // same date+time judgment the booking page uses.
                const hasStarted = isPastTimeSlot(reservation.reservation_date, reservation.start_time);
                return (
                  <div
                    key={reservation.reservation_number}
                    className="rounded-xl border border-[#4B3B71]/15 bg-white p-4 sm:p-5"
                  >
                    <p className="text-lg font-bold text-[#4B3B71]">{formatSlotTime(reservation.start_time)}</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <p className="text-sm text-slate-600">
                        <span className="text-xs font-medium text-slate-500">예약 인원</span>
                        <span className="ml-2 font-medium text-slate-700">{reservation.participant_count}명</span>
                      </p>
                      {hasStarted ? (
                        <span className="justify-self-end rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                          취소 불가 · 이미 이용 시간이 시작되었습니다
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-self-end rounded-full border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setCancelTarget(reservation)}
                        >
                          예약 취소
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })
      )}

      {cancelTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-[#241b35]">예약을 취소하시겠습니까?</h2>
            <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">날짜:</span> {cancelTarget.reservation_date}
              </p>
              <p>
                <span className="text-slate-500">시간:</span> {formatSlotTime(cancelTarget.start_time)}
              </p>
              <p>
                <span className="text-slate-500">예약 인원:</span> {cancelTarget.participant_count}명
              </p>
            </div>
            <p className="mt-3 text-xs font-semibold text-red-600">취소된 예약은 복구할 수 없습니다.</p>
            <form action={cancelAction} className="mt-5 flex justify-end gap-2">
              <input type="hidden" name="reservationNumber" value={cancelTarget.reservation_number} />
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setCancelTarget(null)}
                disabled={isAnyCancellationPending}
              >
                닫기
              </Button>
              <Button
                type="submit"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                disabled={isCancelling}
              >
                {isCancelling ? "취소 처리 중..." : "취소하기"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {batchCancelDate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-cancel-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 id="batch-cancel-title" className="text-lg font-bold text-[#241b35]">
              {batchCancelDate} 예약을 모두 취소하시겠습니까?
            </h2>
            {(() => {
              const batchReservations = reservationsByDate.get(batchCancelDate) ?? [];
              const cancellableCount = batchReservations.filter(
                (reservation) => !isPastTimeSlot(reservation.reservation_date, reservation.start_time),
              ).length;

              return (
                <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  {cancellableCount === batchReservations.length
                    ? `총 ${batchReservations.length}개의 예약이 취소됩니다.`
                    : `총 ${batchReservations.length}개 예약 중 ${cancellableCount}개를 취소할 수 있습니다.`}
                </p>
              );
            })()}
            <p className="mt-3 text-xs font-semibold text-red-600">취소된 예약은 복구할 수 없습니다.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setBatchCancelDate(null)}
                disabled={isBatchCancelling}
              >
                취소
              </Button>
              <Button
                type="button"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                onClick={confirmBatchCancellation}
                disabled={isBatchCancelling}
              >
                {isBatchCancelling ? "취소 처리 중..." : "예약 일괄 취소"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
