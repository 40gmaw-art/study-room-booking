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
    const enabled = !isBeforeToday && !isWeekend && current <= endDate;

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

export function isBookingDateAllowed(dateKey: string) {
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(dateKey);
  if (!match) {
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

  if (!isBookingDateAllowed(dateKey)) {
    return { allowed: false, message: "평일에만 이용할 수 있으며, 다음 주 금요일까지 예약 가능합니다." };
  }

  return { allowed: true, message: "" };
}

export function isPastTimeSlot(dateKey: string, slotValue: string) {
  const now = new Date();
  const seoulNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const slotDateTime = new Date(`${dateKey}T${slotValue}+09:00`);

  return slotDateTime.getTime() <= seoulNow.getTime();
}

export function isGachonEmail(email: string) {
  return /@gachon\.ac\.kr$/i.test(email.trim());
}

export function getStatusLabel(status: string) {
  return status === "cancelled" ? "취소됨" : "예정";
}

export const MIN_PARTICIPANTS = 1;
export const MAX_PARTICIPANTS = 6;

// Rejects blank input, non-digit characters (so decimals/negatives/letters
// never parse), and anything outside 1-6. Shared by server actions and
// client components so the rule can never drift between them.
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
