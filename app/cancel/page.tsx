import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelReservationAction } from "@/lib/booking-actions";
import { redirect } from "next/navigation";

export default async function CancelPage() {
  const action = async (formData: FormData) => {
    "use server";
    const result = await cancelReservationAction(null, formData);
    if (result.success) {
      redirect("/my-reservations");
    }
  };

  return (
    <main className="min-h-screen bg-[#f8f4ff] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card className="border-[#4B3B71]/10 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>예약 취소</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={action} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="reservationNumber">예약번호</Label>
                <Input id="reservationNumber" name="reservationNumber" placeholder="GSR-20260712-A3F91C" required />
              </div>
              <Button className="h-12 w-full rounded-full bg-[#4B3B71] hover:bg-[#3f315d]" type="submit">예약 취소</Button>
              <Button asChild variant="outline" className="h-12 w-full rounded-full border-[#4B3B71]/20 text-[#4B3B71]">
                <Link href="/" prefetch={false}>홈으로</Link>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
