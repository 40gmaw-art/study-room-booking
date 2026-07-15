import { redirect } from "next/navigation";

// This route was the Next.js/Supabase starter template's generic example
// page. It is not part of the study-room booking product (students use
// /booking, admins use /admin) and must never be a real login destination.
export default function ProtectedPage() {
  redirect("/");
}
