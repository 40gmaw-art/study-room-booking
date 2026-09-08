import { TIME_SLOTS } from "@/lib/booking";

export const MAX_PARTICIPANTS_PER_SLOT = 8;

export type AdminReservationRow = {
  id: string;
  reservation_number: string;
  reservation_date: string;
  start_time: string;
  name: string;
  department: string;
  student_number: string;
  status: string;
  participant_count: number;
};

export type AdminSlotGroup = {
  startTime: string;
  label: string;
  reservationCount: number;
  participantTotal: number;
  remaining: number;
  full: boolean;
  reservations: AdminReservationRow[];
};

export type AdminDateGroup = {
  date: string;
  totalReservationCount: number;
  totalParticipantCount: number;
  slots: AdminSlotGroup[];
};

// Groups reservations by date, then by start time, keeping only slots/dates
// that actually have at least one reservation. Never introduces synthetic
// empty groups for the full TIME_SLOTS list or the full booking date range.
// One team per slot: a slot is "full" as soon as ANY active reservation
// exists for it, regardless of that team's size -- participantTotal/
// remaining are informational only (how big the one booked team is), not a
// shared-capacity countdown.
export function groupActiveReservations(rows: AdminReservationRow[]): AdminDateGroup[] {
  const byDate = new Map<string, Map<string, AdminReservationRow[]>>();

  for (const row of rows) {
    if (!byDate.has(row.reservation_date)) {
      byDate.set(row.reservation_date, new Map());
    }
    const bySlot = byDate.get(row.reservation_date)!;
    if (!bySlot.has(row.start_time)) {
      bySlot.set(row.start_time, []);
    }
    bySlot.get(row.start_time)!.push(row);
  }

  const sortedDates = Array.from(byDate.keys()).sort();

  return sortedDates.map((date) => {
    const bySlot = byDate.get(date)!;
    const sortedSlotTimes = Array.from(bySlot.keys()).sort();

    const slots: AdminSlotGroup[] = sortedSlotTimes.map((startTime) => {
      const reservations = bySlot.get(startTime)!;
      const participantTotal = reservations.reduce((sum, row) => sum + row.participant_count, 0);
      return {
        startTime,
        label: TIME_SLOTS.find((slot) => slot.value === startTime)?.label ?? startTime,
        reservationCount: reservations.length,
        participantTotal,
        remaining: Math.max(MAX_PARTICIPANTS_PER_SLOT - participantTotal, 0),
        full: reservations.length >= 1,
        reservations,
      };
    });

    return {
      date,
      totalReservationCount: slots.reduce((sum, slot) => sum + slot.reservationCount, 0),
      totalParticipantCount: slots.reduce((sum, slot) => sum + slot.participantTotal, 0),
      slots,
    };
  });
}

export function countFullSlots(rows: AdminReservationRow[]): number {
  return groupActiveReservations(rows).reduce(
    (sum, group) => sum + group.slots.filter((slot) => slot.full).length,
    0,
  );
}

export function sumParticipants(rows: AdminReservationRow[]): number {
  return rows.reduce((sum, row) => sum + row.participant_count, 0);
}

export function formatFullKoreanDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

export function formatFullKoreanDateWithWeekday(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", weekday: "long" }).format(utcDate);
  return `${formatFullKoreanDate(dateKey)} ${weekday}`;
}

export function slotLabelFor(startTime: string) {
  return TIME_SLOTS.find((slot) => slot.value === startTime)?.label ?? startTime;
}
