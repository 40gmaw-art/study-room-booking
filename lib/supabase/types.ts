export type Profile = {
  id: string;
  email: string | null;
  name: string | null;
  department: string | null;
  student_number: string | null;
  role: "student" | "admin" | string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ReservationStatus = "active" | "cancelled";

export type Reservation = {
  id: string;
  reservation_number: string;
  user_id: string;
  name: string;
  department: string;
  student_number: string;
  reservation_date: string;
  start_time: string;
  status: ReservationStatus;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};
