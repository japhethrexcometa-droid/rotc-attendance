import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabase";

export interface ReportFilters {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  platoon?: string;
  searchQuery?: string;
}

export interface AttendanceRow {
  cadet_id: string;
  id_number: string;
  full_name: string;
  platoon: string | null;
  session_date: string;
  session_type: "AM" | "PM";
  status: "present" | "late" | "absent" | "excused";
  score: number;
  scan_time: string | null;
}

export function getAttendanceScore(status: string): number {
  switch (status) {
    case "present":
      return 1.0;
    case "late":
      return 0.75;
    case "absent":
      return 0.0;
    case "excused":
      return 0.0;
    default:
      return 0.0;
  }
}

export function getCadetStanding(
  absenceCount: number,
): "Active" | "Warning" | "Drop" {
  if (absenceCount <= 2) return "Active";
  if (absenceCount <= 4) return "Warning";
  return "Drop";
}

export async function getAttendanceReport(
  filters: ReportFilters,
): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from("attendance")
    .select(
      "id, cadet_id, session_id, status, scan_time, sessions(session_date, session_type), users(id_number, full_name, platoon)",
    );

  if (error) throw error;
  if (!data) return [];

  let rows: AttendanceRow[] = (data as any[]).map((record) => {
    const session = record.sessions ?? {};
    const user = record.users ?? {};
    return {
      cadet_id: record.cadet_id,
      id_number: user.id_number ?? "",
      full_name: user.full_name ?? "",
      platoon: user.platoon ?? null,
      session_date: session.session_date ?? "",
      session_type: session.session_type as "AM" | "PM",
      status: record.status as AttendanceRow["status"],
      score: getAttendanceScore(record.status),
      scan_time: record.scan_time ?? null,
    };
  });

  // Apply filters in JS
  if (filters.startDate) {
    rows = rows.filter((r) => r.session_date >= filters.startDate!);
  }
  if (filters.endDate) {
    rows = rows.filter((r) => r.session_date <= filters.endDate!);
  }
  if (filters.platoon) {
    rows = rows.filter((r) => r.platoon === filters.platoon);
  }
  if (filters.searchQuery) {
    const q = filters.searchQuery.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.id_number.toLowerCase().includes(q),
    );
  }

  // Sort: session_date DESC, then full_name ASC
  rows.sort((a, b) => {
    if (b.session_date !== a.session_date) {
      return b.session_date.localeCompare(a.session_date);
    }
    return a.full_name.localeCompare(b.full_name);
  });

  return rows;
}

export async function exportToExcel(rows: AttendanceRow[]): Promise<string> {
  const escapeCsv = (value: string | number | null) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };

  const header = [
    "ID Number",
    "Full Name",
    "Platoon",
    "Session Date",
    "Session Type",
    "Status",
    "Score",
    "Scan Time",
  ];
  const body = rows.map((r) =>
    [
      r.id_number,
      r.full_name,
      r.platoon ?? "",
      r.session_date,
      r.session_type,
      r.status,
      r.score,
      r.scan_time ?? "",
    ]
      .map(escapeCsv)
      .join(","),
  );
  const csv = [header.join(","), ...body].join("\n");
  const fs = FileSystem as any;
  const fileUri = `${fs.cacheDirectory}attendance_report_${Date.now()}.csv`;
  await FileSystem.writeAsStringAsync(fileUri, csv, {
    encoding: fs.EncodingType.UTF8,
  });
  return fileUri;
}
