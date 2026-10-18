import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";

type StudentHeaderActionsProps = {
  page: "my-reservations" | "booking";
};

export function StudentHeaderActions({ page }: StudentHeaderActionsProps) {
  return (
    <nav className="student-header-actions" aria-label="학생 메뉴">
      {page === "booking" ? (
        <>
          <Button asChild variant="outline" className="student-header-action-button">
            <Link href="/my-reservations">내 예약</Link>
          </Button>
          <Button asChild variant="outline" className="student-header-action-button">
            <Link href="/" prefetch={false}>홈</Link>
          </Button>
          <LogoutButton className="student-header-action-button" />
        </>
      ) : (
        <>
          <Button asChild variant="outline" className="student-header-action-button">
            <Link href="/booking">예약하기</Link>
          </Button>
          <Button asChild variant="outline" className="student-header-action-button">
            <Link href="/" prefetch={false}>홈</Link>
          </Button>
        </>
      )}
    </nav>
  );
}
