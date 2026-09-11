export const TIME_SLOTS = [
  { value: "10:00:00", label: "10:00~11:00", start: "10:00", end: "11:00" },
  { value: "11:00:00", label: "11:00~12:00", start: "11:00", end: "12:00" },
  { value: "12:00:00", label: "12:00~13:00", start: "12:00", end: "13:00" },
  { value: "13:00:00", label: "13:00~14:00", start: "13:00", end: "14:00" },
  { value: "14:00:00", label: "14:00~15:00", start: "14:00", end: "15:00" },
  { value: "15:00:00", label: "15:00~16:00", start: "15:00", end: "16:00" },
  { value: "16:00:00", label: "16:00~17:00", start: "16:00", end: "17:00" },
] as const;

export type TimeSlot = (typeof TIME_SLOTS)[number];

export interface BookingDateOption {
  date: string;
  enabled: boolean;
  isWeekend: boolean;
  isBeforeToday: boolean;
  isAfterAllowedRange: boolean;
}

export function getSeoulDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

export function formatDateForDisplay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function formatDateForInput(date: Date) {
  const parts = getSeoulDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTodayDateKey() {
  return formatDateForInput(new Date());
}

export interface CalendarDay {
  dateKey: string;
  day: number;
}

// Builds a month's calendar grid as full Sun-Sat weeks, padding leading/
// trailing cells with null so every row has exactly 7 columns. Pure Y/M/D
// arithmetic via Date.UTC (same trick used elsewhere in this file) -- no
// dependency on the browser's local timezone.
export function getMonthGridWeeks(year: number, month: number): (CalendarDay | null)[][] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (CalendarDay | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (CalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function toUtcDateFromSeoulParts(parts: ReturnType<typeof getSeoulDateParts>) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getIsoWeekday(date: Date) {
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function getSeoulTodayDate() {
  const parts = getSeoulDateParts();
  return toUtcDateFromSeoulParts(parts);
}

export function getBookingDateOptions(): BookingDateOption[] {
  const today = getSeoulTodayDate();
  const todayParts = getSeoulDateParts();
  const todayIsoWeekday = getIsoWeekday(toUtcDateFromSeoulParts(todayParts));
  const currentWeekMonday = addDays(today, 1 - todayIsoWeekday);
  const startDate = todayIsoWeekday >= 6 ? addDays(currentWeekMonday, 7) : today;
  const endDate = addDays(currentWeekMonday, 11);
  const options: BookingDateOption[] = [];

  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    const dateKey = formatDateForInput(current);
    const isoWeekday = getIsoWeekday(current);
    const isWeekend = isoWeekday >= 6;
    const isBeforeToday = current < today;
    const isAfterAllowedRange = current > endDate;
    const enabled = !isBeforeToday && !isWeekend && current <= endDate && !(dateKey in BLOCKED_HOLIDAY_DATES);

    options.push({
      date: dateKey,
      enabled,
      isWeekend,
      isBeforeToday,
      isAfterAllowedRange,
    });
  }

  return options;
}

export function getBookingDates() {
  return getBookingDateOptions()
    .filter((option) => option.enabled)
    .map((option) => option.date);
}

export function getDefaultBookingDate() {
  return getBookingDates()[0] ?? "";
}

// One-off date exceptions for 2026-10, layered on top of the normal
// weekday/rolling-window rule above rather than replacing it:
//   - BLOCKED_HOLIDAY_DATES: national holidays that fall on what would
//     otherwise be a bookable weekday -- reservations are blocked outright,
//     with an optional label to show on the calendar (null = no label, just
//     unbookable). 10/5 is the substitute holiday for 개천절 (10/3, a
//     Saturday), so both the actual holiday and its substitute matter here.
//   - EXAM_PERIOD_DATES: mid-term exam week, display-only -- its weekday
//     dates stay bookable under the existing weekday rule and its weekend
//     dates stay blocked under the existing weekend rule; nothing about
//     enabled/disabled changes for these dates.
// Extend either directly for a future term; nothing else needs to change.
export const BLOCKED_HOLIDAY_DATES: Record<string, string | null> = {
  "2026-10-05": "개천절",
  "2026-10-07": null,
  "2026-10-09": "한글날",
};

export const EXAM_PERIOD_DATES = new Set([
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
  "2026-10-26",
]);

export interface DateBadge {
  label: string;
  variant: "holiday" | "exam";
}

// Calendar display only -- never consulted for whether a date can be
// booked (that's isBookingDateAllowed below).
export function getDateBadge(dateKey: string): DateBadge | null {
  const holidayLabel = BLOCKED_HOLIDAY_DATES[dateKey];
  if (holidayLabel) {
    return { label: holidayLabel, variant: "holiday" };
  }
  if (EXAM_PERIOD_DATES.has(dateKey)) {
    return { label: "중간고사", variant: "exam" };
  }
  return null;
}

export function isBookingDateAllowed(dateKey: string) {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(dateKey);
  if (!match) {
    return false;
  }

  if (dateKey in BLOCKED_HOLIDAY_DATES) {
    return false;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = getSeoulTodayDate();
  const todayParts = getSeoulDateParts();
  const todayIsoWeekday = getIsoWeekday(toUtcDateFromSeoulParts(todayParts));
  const currentWeekMonday = addDays(today, 1 - todayIsoWeekday);
  const startDate = todayIsoWeekday >= 6 ? addDays(currentWeekMonday, 7) : today;
  const endDate = addDays(currentWeekMonday, 11);

  return date >= startDate && date <= endDate && getIsoWeekday(date) >= 1 && getIsoWeekday(date) <= 5;
}

export function getBookingDateValidation(dateKey: string) {
  if (!dateKey) {
    return { allowed: false, message: "예약 날짜를 선택해 주세요." };
  }

  if (dateKey in BLOCKED_HOLIDAY_DATES) {
    return { allowed: false, message: "공휴일은 예약할 수 없습니다." };
  }

  if (!isBookingDateAllowed(dateKey)) {
    return { allowed: false, message: "평일에만 이용할 수 있으며, 다음 주 금요일까지 예약 가능합니다." };
  }

  return { allowed: true, message: "" };
}

// A slot only counts as "past" when dateKey is TODAY in Asia/Seoul and its
// start time has already been reached -- a future date's slots are never
// past, no matter what the current wall-clock time is. Uses the same
// Intl.DateTimeFormat + explicit "Asia/Seoul" approach as getSeoulDateParts
// above (zero-padded, timezone-safe) instead of round-tripping through
// Date.prototype.toLocaleString()/new Date(string), which silently
// re-parses that string in the runtime's OWN local timezone rather than
// Seoul's -- producing wrong instants whenever they differ.
export function isPastTimeSlot(dateKey: string, slotValue: string) {
  if (dateKey !== getTodayDateKey()) {
    return false;
  }

  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const map = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const nowTime = `${map.hour}:${map.minute}:${map.second}`;

  return slotValue <= nowTime;
}

export function isGachonEmail(email: string) {
  return /@gachon\.ac\.kr$/i.test(email.trim());
}

export function getStatusLabel(status: string) {
  return status === "cancelled" ? "취소됨" : "예정";
}

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 8;

// A single reservation request can cover at most this many 1-hour slots
// (i.e. 4 hours) on a given date. Shared by the client UI and the server
// action so the rule can never drift between them.
export const MAX_TIME_SLOTS_PER_RESERVATION = 4;

export interface TimeRange {
  start: string;
  end: string;
}

// Display-only merge: combines back-to-back 1-hour slots (previous slot's
// end === next slot's start) into contiguous ranges. The underlying
// reservation data still stores/sends individual 1-hour slots -- this never
// changes what gets booked, only how the selection is summarized on screen.
export function mergeConsecutiveTimeSlots(slots: Array<{ start: string; end: string }>): TimeRange[] {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const merged: TimeRange[] = [];

  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.end === slot.start) {
      last.end = slot.end;
    } else {
      merged.push({ start: slot.start, end: slot.end });
    }
  }

  return merged;
}

export function formatTimeRange(range: TimeRange) {
  return `${range.start} ~ ${range.end}`;
}

// Rejects blank input, non-digit characters (so decimals/negatives/letters
// never parse), and anything outside MIN_PARTICIPANTS-MAX_PARTICIPANTS.
// Shared by server actions and client components so the rule can never
// drift between them.
export function parseParticipantCount(raw: FormDataEntryValue | string | null | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < MIN_PARTICIPANTS || value > MAX_PARTICIPANTS) {
    return null;
  }
  return value;
}

export function buildReservationNumber(dateKey: string) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GSR-${dateKey.replace(/-/g, "")}-${random}`;
}
