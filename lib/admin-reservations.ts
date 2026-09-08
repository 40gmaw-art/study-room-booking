import { formatTimeRange, TIME_SLOTS } from "@/lib/booking";

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
  user_id: string;
  created_at: string;
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

export type AdminBookingGroup = {
  key: string;
  startTime: string;
  label: string;
  name: string;
  department: string;
  student_number: string;
  participant_count: number;
  reservation_number: string;
  status: string;
  reservations: AdminReservationRow[];
};

export type AdminBookingDateGroup = {
  date: string;
  totalReservationCount: number;
  totalParticipantCount: number;
  bookings: AdminBookingGroup[];
};

function isImmediatelyNextSlot(prevStartTime: string, nextStartTime: string): boolean {
  const prevIndex = TIME_SLOTS.findIndex((slot) => slot.value === prevStartTime);
  return prevIndex !== -1 && TIME_SLOTS[prevIndex + 1]?.value === nextStartTime;
}

// Display-only grouping for the admin "예약 관리" screen: merges consecutive
// 1-hour rows into one card spanning a time range, but ONLY when they are
// (a) back-to-back slots (no gap) AND (b) the SAME booking -- same user_id
// AND identical created_at. Postgres's now() is stable for the whole
// duration of one transaction, so every row create_reservations_bulk
// inserts for a single bulk request shares the exact same created_at,
// while two separate booking requests (even by the same user, even for
// adjacent slots) get different created_at values and are correctly kept
// as separate cards. There is no existing "booking group id" column to
// group by instead -- reservation_number is generated per ROW, not per
// booking (see create_reservations_bulk) -- so this reuses (user_id,
// created_at), both already-stored columns, rather than adding one.
export function groupReservationsIntoBookings(rows: AdminReservationRow[]): AdminBookingDateGroup[] {
  const byDate = new Map<string, AdminReservationRow[]>();

  for (const row of rows) {
    if (!byDate.has(row.reservation_date)) {
      byDate.set(row.reservation_date, []);
    }
    byDate.get(row.reservation_date)!.push(row);
  }

  const sortedDates = Array.from(byDate.keys()).sort();

  return sortedDates.map((date) => {
    const sortedRows = [...byDate.get(date)!].sort((a, b) => a.start_time.localeCompare(b.start_time));
    const rowGroups: AdminReservationRow[][] = [];

    for (const row of sortedRows) {
      const currentGroup = rowGroups[rowGroups.length - 1];
      const lastRow = currentGroup?.[currentGroup.length - 1];
      const sameBooking =
        lastRow !== undefined &&
        lastRow.user_id === row.user_id &&
        lastRow.created_at === row.created_at &&
        isImmediatelyNextSlot(lastRow.start_time, row.start_time);

      if (currentGroup && sameBooking) {
        currentGroup.push(row);
      } else {
        rowGroups.push([row]);
      }
    }

    const bookings: AdminBookingGroup[] = rowGroups.map((group) => {
      const first = group[0];
      const last = group[group.length - 1];
      const firstSlot = TIME_SLOTS.find((slot) => slot.value === first.start_time);
      const lastSlot = TIME_SLOTS.find((slot) => slot.value === last.start_time);
      const label =
        firstSlot && lastSlot ? formatTimeRange({ start: firstSlot.start, end: lastSlot.end }) : slotLabelFor(first.start_time);

      return {
        key: first.id,
        startTime: first.start_time,
        label,
        name: first.name,
        department: first.department,
        student_number: first.student_number,
        participant_count: first.participant_count,
        reservation_number: first.reservation_number,
        status: first.status,
        reservations: group,
      };
    });

    return {
      date,
      totalReservationCount: sortedRows.length,
      totalParticipantCount: sortedRows.reduce((sum, row) => sum + row.participant_count, 0),
      bookings,
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
