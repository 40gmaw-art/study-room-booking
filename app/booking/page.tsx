import { redirect } from "next/navigation";
import { BookingPage } from "@/components/booking-page";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function BookingRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("name, department, student_number, email, role")
    .eq("id", user.id)
    .single();

  if (!profileData) {
    redirect("/login");
  }

  return <BookingPage profile={profileData} />;
}
