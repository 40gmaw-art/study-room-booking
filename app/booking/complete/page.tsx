import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const revalidate = 0;

export default async function BookingCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ reservation_number?: string }>;
}) {
  const params = await searchParams;
  const reservationNumber = params.reservation_number;

  if (!reservationNumber) {
    redirect("/booking");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: reservationData } = await supabase
    .from("reservations")
    .select("reservation_number, reservation_date, start_time")
    .eq("reservation_number", reservationNumber)
    .eq("user_id", user.id)
    .single();

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl text-[#4B3B71]">예약 완료</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-[#f5efff] p-4 text-sm text-slate-700">
              <p className="font-semibold">예약번호</p>
              <p className="mt-1 break-all text-lg font-bold text-[#4B3B71]">{reservationNumber}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">예약 날짜</p>
                <p className="mt-1 font-semibold">{reservationData?.reservation_date ?? "-"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">예약 시간</p>
                <p className="mt-1 font-semibold">{reservationData?.start_time ?? "-"}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="h-12 rounded-full bg-[#4B3B71] hover:bg-[#3f315d]">
                <Link href="/my-reservations">내 예약 보기</Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-full border-[#4B3B71]/20 text-[#4B3B71]">
                <Link href="/" prefetch={false}>홈으로</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
