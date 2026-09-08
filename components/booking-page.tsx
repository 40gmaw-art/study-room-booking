"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoutButton } from "@/components/logout-button";
import { DateCalendar } from "@/components/date-calendar";
import { formatTimeRange, getBookingDateOptions, getDefaultBookingDate, isPastTimeSlot, mergeConsecutiveTimeSlots, MAX_PARTICIPANTS, MAX_TIME_SLOTS_PER_RESERVATION, MIN_PARTICIPANTS, TIME_SLOTS } from "@/lib/booking";
import { createReservationsBulkAction, getBookingAvailability, getMyActiveReservedSlots } from "@/lib/booking-actions";
import { useActionState } from "react";

type SlotAvailability = { value: string; label: string; count: number; full: boolean };

const AVAILABILITY_REFRESH_MS = 20000;

export function BookingPage({ profile }: { profile: { name: string; department: string; student_number: string; email: string; role: string } | null }) {
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string>(getDefaultBookingDate());
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [myReservedSlots, setMyReservedSlots] = useState<Set<string>>(new Set());
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const [participantCountInput, setParticipantCountInput] = useState(String(MIN_PARTICIPANTS));
  const selectedSlotsRef = useRef(selectedSlots);

  const [state, formAction] = useActionState(createReservationsBulkAction, {
    success: false,
    message: "",
    reservations: [] as Array<{ reservation_number: string; start_time: string }>,
  });

  useEffect(() => {
    selectedSlotsRef.current = selectedSlots;
  }, [selectedSlots]);

  const applyAvailability = useCallback((nextSlots: SlotAvailability[]) => {
    setSlots(nextSlots);

    const current = selectedSlotsRef.current;
    const justClosed = nextSlots.filter((slot) => slot.full && current.has(slot.value));
    if (justClosed.length === 0) {
      return;
    }

    setSelectedSlots((prev) => {
      const next = new Set(prev);
      justClosed.forEach((slot) => next.delete(slot.value));
      return next;
    });
    setRemovalNotice(
      `선택하신 시간대 중 일부가 마감되어 선택에서 제외되었습니다: ${justClosed.map((slot) => slot.label).join(", ")}`,
    );
  }, []);

  useEffect(() => {
    const requestedDate = searchParams.get("date") ?? getDefaultBookingDate();
    setSelectedDate(requestedDate);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }

    let isActive = true;
    void (async () => {
      const [nextSlots, myActiveSlots] = await Promise.all([
        getBookingAvailability(selectedDate),
        getMyActiveReservedSlots(selectedDate),
      ]);
      if (isActive) {
        applyAvailability(nextSlots);
        setMyReservedSlots(new Set(myActiveSlots));
      }
    })();
    return () => {
      isActive = false;
    };
  }, [selectedDate, applyAvailability]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }

    const interval = setInterval(() => {
      void (async () => {
        const [nextSlots, myActiveSlots] = await Promise.all([
          getBookingAvailability(selectedDate),
          getMyActiveReservedSlots(selectedDate),
        ]);
        applyAvailability(nextSlots);
        setMyReservedSlots(new Set(myActiveSlots));
      })();
    }, AVAILABILITY_REFRESH_MS);

    return () => clearInterval(interval);
  }, [selectedDate, applyAvailability]);

  useEffect(() => {
    setSelectedSlots(new Set());
    setRemovalNotice(null);
    setMyReservedSlots(new Set());
  }, [selectedDate]);

  useEffect(() => {
    if (!state.success) {
      return;
    }

    setSelectedSlots(new Set());
    setRemovalNotice(null);
    void (async () => {
      const [nextSlots, myActiveSlots] = await Promise.all([
        getBookingAvailability(selectedDate),
        getMyActiveReservedSlots(selectedDate),
      ]);
      applyAvailability(nextSlots);
      setMyReservedSlots(new Set(myActiveSlots));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const availableDates = useMemo(() => getBookingDateOptions(), []);

  useEffect(() => {
    if (!selectedDate && availableDates[0]) {
      setSelectedDate(availableDates[0].date);
      return;
    }

    if (selectedDate && !availableDates.some((option) => option.date === selectedDate)) {
      const fallback = availableDates.find((option) => option.enabled)?.date ?? availableDates[0]?.date;
      if (fallback) {
        setSelectedDate(fallback);
      }
    }
  }, [availableDates, selectedDate]);

  const selectedDateAvailability = availableDates.find((option) => option.date === selectedDate);
  const isSelectedDateEnabled = selectedDateAvailability?.enabled ?? false;

  const selectedSlotList = TIME_SLOTS.filter((slot) => selectedSlots.has(slot.value));
  const mergedTimeRanges = mergeConsecutiveTimeSlots(selectedSlotList);

  function toggleSlot(value: string) {
    setRemovalNotice(null);
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  // Only digits, no decimals/negatives/blank/letters allowed through.
  const isParticipantCountWellFormed = /^\d+$/.test(participantCountInput);
  const participantCount = isParticipantCountWellFormed ? Number(participantCountInput) : NaN;
  const isParticipantCountInRange = isParticipantCountWellFormed && participantCount >= MIN_PARTICIPANTS && participantCount <= MAX_PARTICIPANTS;

  // The most people that can fit into EVERY selected slot at once (the
  // smallest remaining headroom across the current selection).
  const maxAllowedForSelection =
    selectedSlotList.length === 0
      ? MAX_PARTICIPANTS
      : Math.min(
          ...selectedSlotList.map((slot) => {
            const detail = slots.find((item) => item.value === slot.value);
            return Math.max(MAX_PARTICIPANTS - (detail?.count ?? 0), 0);
          }),
        );

  const exceedsAvailableCapacity =
    selectedSlotList.length > 0 && isParticipantCountInRange && participantCount > maxAllowedForSelection;
  const isParticipantCountValid = isParticipantCountInRange && !exceedsAvailableCapacity;

  // Hours already ACTIVE for the current user on the selected date (from a
  // separate, earlier booking). The 4-hour cap applies to the running daily
  // total, not just to this one selection, so the remaining budget shrinks
  // by however many hours are already booked.
  const myUsedSlotCount = myReservedSlots.size;
  const remainingDailyBudget = Math.max(MAX_TIME_SLOTS_PER_RESERVATION - myUsedSlotCount, 0);
  const dailyBudgetExhausted = remainingDailyBudget === 0;

  const exceedsMaxTimeSlots = selectedSlotList.length > remainingDailyBudget;

  const canSubmit = selectedSlotList.length > 0 && isSelectedDateEnabled && isParticipantCountValid && !exceedsMaxTimeSlots;

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-[#4B3B71]/10 bg-white/90 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#4B3B71]">예약하기</p>
            <p className="text-base font-bold">{profile?.name ?? "학생"}님</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/my-reservations">내 예약</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/" prefetch={false}>홈</Link>
            </Button>
            <LogoutButton className="rounded-full" />
          </div>
        </header>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="md:text-lg">날짜 선택</CardTitle>
            <CardDescription className="md:text-base">평일에만 이용할 수 있으며, 다음 주 금요일까지 예약 가능합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <DateCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          </CardContent>
        </Card>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>시간대 선택</CardTitle>
            <CardDescription>
              최소 2인에서 최대 8인까지 예약하실 수 있으며, 선착순에 따라 최대 4시간까지 이용 가능합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {removalNotice ? (
              <div className="mb-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">{removalNotice}</div>
            ) : null}
            {dailyBudgetExhausted ? (
              <div className="mb-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
                이 날짜에 이미 최대 {MAX_TIME_SLOTS_PER_RESERVATION}시간을 예약하셨습니다. 추가로 예약하려면 기존 예약을 취소해 주세요.
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TIME_SLOTS.map((slot) => {
                const detail = slots.find((item) => item.value === slot.value);
                const isPast = isPastTimeSlot(selectedDate, slot.value);
                const alreadyReservedByMe = myReservedSlots.has(slot.value);
                // Priority: my own reservation > someone else's (room full) >
                // past slot > my daily 4-hour budget used up > selectable.
                // Each flag below is mutually exclusive by construction, so
                // exactly one of them (or none) explains why a slot is
                // disabled -- that single reason drives both the label text
                // and its color, so they can never disagree with each other.
                const reservedByOthers = Boolean(detail?.full) && !alreadyReservedByMe;
                const limitedByDailyCap = !alreadyReservedByMe && !reservedByOthers && !isPast && dailyBudgetExhausted;
                const disabled =
                  !isSelectedDateEnabled || alreadyReservedByMe || reservedByOthers || isPast || limitedByDailyCap;
                const active = selectedSlots.has(slot.value);
                const statusText = !isSelectedDateEnabled
                  ? "예약 불가"
                  : alreadyReservedByMe
                    ? "이미 예약됨"
                    : reservedByOthers
                      ? "예약 마감"
                      : isPast
                        ? "지난 시간대"
                        : limitedByDailyCap
                          ? "선택 불가"
                          : null;

                const cardToneClass = alreadyReservedByMe
                  ? "border-[#4B3B71]/25 bg-[#f5efff]"
                  : reservedByOthers
                    ? "border-red-200 bg-red-50"
                    : limitedByDailyCap
                      ? "border-slate-200 bg-slate-100"
                      : disabled
                        ? "border-slate-200 bg-white opacity-60"
                        : "border-slate-200 bg-white";

                const statusTextToneClass = alreadyReservedByMe
                  ? "font-semibold text-[#4B3B71]"
                  : reservedByOthers
                    ? "font-semibold text-red-600"
                    : limitedByDailyCap
                      ? "font-semibold text-slate-500"
                      : "text-slate-600";

                return (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => !disabled && toggleSlot(slot.value)}
                    disabled={disabled}
                    aria-pressed={active}
                    className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                      active ? "border-[#4B3B71] bg-[#f5efff] ring-1 ring-[#4B3B71]" : cardToneClass
                    } ${disabled ? "cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{formatTimeRange(slot)}</span>
                      {active ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-[#4B3B71]">
                          <Check className="h-3.5 w-3.5" />
                          선택됨
                        </span>
                      ) : null}
                    </div>
                    {statusText ? <div className={`mt-2 text-sm ${statusTextToneClass}`}>{statusText}</div> : null}
                  </button>
                );
              })}
            </div>

            {exceedsMaxTimeSlots ? (
              <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700">
                  {myUsedSlotCount > 0
                    ? `이 날짜에 이미 ${myUsedSlotCount}시간을 예약하셨습니다. 하루 최대 ${MAX_TIME_SLOTS_PER_RESERVATION}시간까지만 예약할 수 있습니다.`
                    : "한 번에 최대 4시간까지만 예약할 수 있습니다."}
                </p>
                <p className="mt-1 text-xs font-semibold text-red-600">
                  선택한 시간대가 {selectedSlotList.length}개입니다. 최대 {remainingDailyBudget}개까지 선택할 수 있습니다.
                </p>
              </div>
            ) : null}

            {mergedTimeRanges.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-[#4B3B71]/15 bg-[#f5efff] p-4">
                <p className="text-sm font-semibold text-[#4B3B71]">선택한 시간대 {mergedTimeRanges.length}개</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {mergedTimeRanges.map((range) => (
                    <li key={`${range.start}-${range.end}`}>· {formatTimeRange(range)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>예약 확인</CardTitle>
            <CardDescription>선택한 내용과 프로필 정보를 확인한 뒤 예약을 완료하세요.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="reservationDate" value={selectedDate} />
              {selectedSlotList.map((slot) => (
                <input key={slot.value} type="hidden" name="startTimes" value={slot.value} />
              ))}
              <div className="grid gap-2">
                <Label htmlFor="name">이름</Label>
                <Input id="name" value={profile?.name ?? ""} readOnly />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="department">학과</Label>
                <Input id="department" value={profile?.department ?? ""} readOnly />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="studentNumber">학번</Label>
                <Input id="studentNumber" value={profile?.student_number ?? ""} readOnly />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="participantCount">예약 인원</Label>
                <Input
                  id="participantCount"
                  name="participantCount"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PARTICIPANTS}
                  max={MAX_PARTICIPANTS}
                  step={1}
                  value={participantCountInput}
                  onChange={(event) => setParticipantCountInput(event.target.value)}
                  className="max-w-[120px]"
                />
                <p className="text-xs text-slate-500">선택한 모든 시간대에 동일한 예약 인원이 적용됩니다.</p>
                {selectedSlotList.length > 0 ? (
                  <p className={`text-xs font-semibold ${exceedsAvailableCapacity ? "text-red-600" : "text-[#4B3B71]"}`}>
                    {exceedsAvailableCapacity
                      ? "선택한 시간대 중 잔여 인원이 부족한 시간대가 있습니다."
                      : `선택한 시간대에 최소 ${MIN_PARTICIPANTS}명에서 최대 ${maxAllowedForSelection}명까지 예약할 수 있습니다.`}
                  </p>
                ) : null}
                {!isParticipantCountWellFormed || (isParticipantCountWellFormed && !isParticipantCountInRange) ? (
                  <p className="text-xs font-semibold text-red-600">
                    예약 인원은 {MIN_PARTICIPANTS}명 이상 {MAX_PARTICIPANTS}명 이하의 숫자로 입력해 주세요.
                  </p>
                ) : null}
              </div>
              <div className="rounded-2xl bg-[#f8f4ff] p-4 text-sm text-slate-700">
                <div>예약일: {selectedDate}</div>
                <div className={`mt-2 font-semibold ${exceedsMaxTimeSlots ? "text-red-600" : "text-[#4B3B71]"}`}>
                  선택한 시간대 {mergedTimeRanges.length}개
                </div>
                {exceedsMaxTimeSlots ? (
                  <div className="mt-1 text-xs font-semibold text-red-600">
                    {myUsedSlotCount > 0
                      ? `이 날짜에 이미 ${myUsedSlotCount}시간을 예약하셔서 추가로 ${remainingDailyBudget}시간(개)까지만 예약할 수 있습니다.`
                      : `최대 ${MAX_TIME_SLOTS_PER_RESERVATION}시간(개)까지만 예약할 수 있습니다.`}{" "}
                    시간대를 {selectedSlotList.length - remainingDailyBudget}개 이상 해제해 주세요.
                  </div>
                ) : null}
                {mergedTimeRanges.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {mergedTimeRanges.map((range) => (
                      <li key={`${range.start}-${range.end}`}>· {formatTimeRange(range)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 text-slate-500">선택된 시간대가 없습니다.</div>
                )}
                {selectedSlotList.length > 0 && isParticipantCountInRange ? (
                  <>
                    <div className="mt-2 font-semibold text-[#4B3B71]">예약 인원 {participantCount}명</div>
                    <div className="mt-1 text-slate-600">선택한 각 시간대에 {participantCount}명으로 예약됩니다.</div>
                  </>
                ) : null}
              </div>
              {!state.success && state.message ? (
                <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">{state.message}</p>
              ) : null}
              {state.success && state.message ? (
                <p className="rounded-2xl bg-[#f5efff] p-3 text-sm font-semibold text-[#4B3B71]">{state.message}</p>
              ) : null}
              <Button
                type="submit"
                className="h-12 w-full rounded-full bg-[#4B3B71] text-base hover:bg-[#3f315d]"
                disabled={!canSubmit}
              >
                {selectedSlotList.length === 0
                  ? "시간대를 선택해주세요"
                  : exceedsMaxTimeSlots
                    ? myUsedSlotCount > 0
                      ? "하루 예약 가능 시간을 초과했습니다"
                      : "한 번에 최대 4시간까지만 예약할 수 있습니다"
                    : !isParticipantCountInRange
                      ? "예약 인원을 확인해주세요"
                      : exceedsAvailableCapacity
                        ? "예약 가능 인원을 초과했습니다"
                        : `${selectedSlotList.length}개 시간대 · ${participantCount}명 예약하기`}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
