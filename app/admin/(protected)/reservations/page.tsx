import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { AdminReservationManager } from "@/components/admin-reservation-manager";
import { createClient } from "@/lib/supabase/server";
import { getBookingDateOptions } from "@/lib/booking";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminReservationsPage() {
  const supabase = await createClient();

  // Only active reservations are shown here; cancelled ones stay in the
  // table untouched (existing soft-cancel data/behavior is not affected).
  const { data: reservations } = await supabase
    .from("reservations")
    .select(
      "id, reservation_number, reservation_date, start_time, name, department, student_number, status, participant_count, user_id, created_at",
    )
    .eq("status", "active")
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  const allowedDates = getBookingDateOptions().filter((option) => option.enabled);

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-[#4B3B71]/10 bg-white/90 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#4B3B71]">예약 관리</p>
            <p className="text-base font-bold">전체 예약 내역을 확인합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/admin">대시보드</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/" prefetch={false}>홈</Link>
            </Button>
            <LogoutButton className="rounded-full" />
          </div>
        </header>

        <AdminReservationManager initialReservations={reservations ?? []} allowedDates={allowedDates} />
      </div>
    </main>
  );
}
