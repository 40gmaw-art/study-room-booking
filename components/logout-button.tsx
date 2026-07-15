import { Button } from "@/components/ui/button";
import { signOutUser } from "@/lib/auth-actions";

export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={signOutUser}>
      <Button type="submit" variant="outline" className={className}>
        로그아웃
      </Button>
    </form>
  );
}
