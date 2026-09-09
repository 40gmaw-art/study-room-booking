import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/logout-button";
import { MyReservationsList } from "@/components/my-reservations-list";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function MyReservationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: reservations } = await supabase
    .from("reservations")
    .select("reservation_number, reservation_date, start_time, status, participant_count, created_at, cancelled_at")
    .eq("user_id", user.id)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex items-center justify-between rounded-full border border-[#4B3B71]/10 bg-white/90 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#4B3B71]">내 예약</p>
            <p className="text-base font-bold">예약 내역을 확인하세요</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/booking">예약하기</Link>
            </Button>
            <LogoutButton className="rounded-full" />
          </div>
        </header>

        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>예약 목록</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <MyReservationsList initialReservations={reservations ?? []} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
