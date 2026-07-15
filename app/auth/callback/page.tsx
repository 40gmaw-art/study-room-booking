import { ensureProfileAfterLogin } from "@/lib/auth-actions";
import { redirect } from "next/navigation";

export const revalidate = 0;

export default async function AuthCallbackPage() {
  await ensureProfileAfterLogin();
  redirect("/booking");
}
