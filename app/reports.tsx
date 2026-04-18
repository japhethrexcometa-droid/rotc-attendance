import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  Activity,
  ArrowLeft,
  Calendar,
  Download,
  FileText,
  FileSpreadsheet,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import {
  alertRemoteFailure,
  isLikelyNetworkErrorMessage,
  shouldSilenceRemoteFailureAlerts,
} from "../lib/field-mode";
import { autoMarkAbsents } from "../lib/session-manager";
import { supabase } from "../lib/supabase";
import { downloadFileWeb } from "../lib/web-utils";

type AttendanceStatus = "present" | "late" | "absent" | "excused";

interface SessionAttendanceRecord {
  id: string;
  status: AttendanceStatus;
  scan_time: string | null;
  cadet: {
    full_name: string;
    id_number: string;
    platoon: string | null;
  };
}

type AttendanceRecordRow = {
  id: string;
  status: AttendanceStatus;
  scan_time: string | null;
  cadet:
    | {
        full_name: string;
        id_number: string;
        platoon: string | null;
      }
    | {
        full_name: string;
        id_number: string;
        platoon: string | null;
      }[];
};

function normalizeNameText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function formatLastFirst(fullName: string): string {
  const clean = normalizeNameText(fullName);
  if (!clean) return "";
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const first = parts.slice(0, -1).join(" ").toUpperCase();
  return `${last}, ${first}`;
}

function normalizeSchoolName(value: string | null | undefined): string {
  const raw = normalizeNameText(value);
  if (!raw) return "Unassigned";
  const up = raw.toUpperCase();
  if (up.replace(/\./g, "").includes("ST JOHN")) return "ST. JOHN";
  if (up.includes("MSU") && up.includes("BUUG")) return "MSU BUUG";
  return raw;
}

function normalizeGender(
  value: string | null | undefined,
): "MALE" | "FEMALE" | "N/A" {
  const up = normalizeNameText(value).toUpperCase();
  if (up === "MALE" || up === "M") return "MALE";
  if (up === "FEMALE" || up === "F") return "FEMALE";
  return "N/A";
}

function normalizeAttendanceRecord(
  row: AttendanceRecordRow,
): SessionAttendanceRecord {
  const cadet = Array.isArray(row.cadet) ? row.cadet[0] : row.cadet;
  return {
    id: row.id,
    status: row.status,
    scan_time: row.scan_time,
    cadet: {
      full_name: cadet?.full_name ?? "Unknown Cadet",
      id_number: cadet?.id_number ?? "N/A",
      platoon: cadet?.platoon ?? null,
    },
  };
}

const REPORTS_CACHE_KEY = "rotc_reports_cache";
const SESSION_RECORDS_CACHE_PREFIX = "rotc_session_records_";

const storage =
  Platform.OS === "web"
    ? {
        getItem: (key: string) => {
          if (typeof window !== "undefined") {
            return Promise.resolve(window.localStorage.getItem(key));
          }
          return Promise.resolve(null);
        },
        setItem: (key: string, value: string) => {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, value);
          }
          return Promise.resolve();
        },
      }
    : AsyncStorage;

function countStatus(records: { status: string }[], status: string): number {
  return records.filter((r) => r.status === status).length;
}

async function cacheReports(data: any[]): Promise<void> {
  await storage.setItem(REPORTS_CACHE_KEY, JSON.stringify(data));
}

async function getCachedReports(): Promise<any[]> {
  try {
    const raw = await storage.getItem(REPORTS_CACHE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as any[]) ?? [];
  } catch {
    return [];
  }
}

function sessionRecordsCacheKey(sessionId: string): string {
  return `${SESSION_RECORDS_CACHE_PREFIX}${sessionId}`;
}

async function cacheSessionRecords(
  sessionId: string,
  records: SessionAttendanceRecord[],
): Promise<void> {
  await storage.setItem(
    sessionRecordsCacheKey(sessionId),
    JSON.stringify(records),
  );
}

async function getCachedSessionRecords(
  sessionId: string,
): Promise<SessionAttendanceRecord[]> {
  try {
    const raw = await storage.getItem(sessionRecordsCacheKey(sessionId));
    if (!raw) return [];
    return (JSON.parse(raw) as SessionAttendanceRecord[]) ?? [];
  } catch {
    return [];
  }
}

export default function DutyReports() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<
    SessionAttendanceRecord[]
  >([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const [confirmProp, setConfirmProp] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    danger: boolean;
  } | null>(null);

  const [downloadReady, setDownloadReady] = useState<{
    fileName: string;
    content: string;
    session: any;
  } | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const user = await requireRole(
        router,
        ["admin", "officer"],
        "Cadets are not allowed to access reports.",
      );
      if (!user) return;
      setCurrentUser(user);
      fetchReports();
    };
    bootstrap();
  }, [router]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatSessionRealtimeLabel = (session: any) => {
    if (!session?.session_date) return "No date";
    const d = new Date(`${session.session_date}T00:00:00`);
    const day = d.toLocaleDateString("en-US", { weekday: "long" });
    const date = d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return `${day} • ${date}`;
  };

  const fetchReports = async () => {
    setLoading(true);
    const { data: sessions, error } = await supabase
      .from("sessions")
      .select(
        `
        *,
        attendance:attendance(status)
      `,
      )
      .order("session_date", { ascending: false });

    if (!error && sessions) {
      setReports(sessions);
      await cacheReports(sessions);
    } else {
      const cached = await getCachedReports();
      setReports(cached);
    }
    setLoading(false);
  };

  const deleteSessionLog = async (session: any) => {
    if (currentUser?.role !== "admin") {
      Alert.alert("Not allowed", "Only Admin can delete session logs.");
      return;
    }

    setConfirmProp({
      title: "Delete Session Log",
      message:
        "Delete this attendance log?\n\nThis will permanently delete the session and its attendance records.",
      confirmText: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          setLoading(true);
          const { error } = await supabase
            .from("sessions")
            .delete()
            .eq("id", session.id);
          if (error) throw error;

          setReports((prev) => {
            const next = prev.filter((s) => s.id !== session.id);
            cacheReports(next).catch(() => {});
            return next;
          });
          if (selectedSession?.id === session.id) {
            setSelectedSession(null);
            setAttendanceRecords([]);
          }

          await storage.setItem(
            sessionRecordsCacheKey(session.id),
            JSON.stringify([]),
          );
        } catch (error: any) {
          if (shouldSilenceRemoteFailureAlerts()) {
            console.warn("Delete session log:", error?.message);
          } else {
            alertRemoteFailure("Delete Failed", error?.message);
          }
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const exportSessionReport = async (session: any) => {
    try {
      setLoading(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // 1. Load all sessions
      const { data: sessions, error: sessionsError } = await supabase
        .from("sessions")
        .select("id, session_date, session_type, status")
        .order("session_date", { ascending: true });

      if (sessionsError || !sessions || sessions.length === 0) {
        throw new Error("Could not load sessions for attendance sheet export.");
      }

      const sortedSessions = [...sessions].sort((a, b) => {
        if (a.session_date !== b.session_date) {
          return String(a.session_date).localeCompare(String(b.session_date));
        }
        return (
          (a.session_type === "AM" ? 0 : 1) - (b.session_type === "AM" ? 0 : 1)
        );
      });

      // 2. Load attendance WITH gender and school using auto-pagination to handle many hundreds safely
      let allAttendanceRows: any[] = [];
      let fetchMore = true;
      let from = 0;
      const step = 1000;
      
      while (fetchMore) {
        const { data: chunk, error: attendanceError } = await supabase
          .from("attendance")
          .select(
            `
            session_id,
            cadet_id,
            status,
            scan_time,
            cadet:users!attendance_cadet_id_fkey(full_name, id_number, platoon, gender, school, role)
          `
          )
          .order("id", { ascending: true })
          .range(from, from + step - 1);

        if (attendanceError) {
          throw new Error(`Could not fetch attendance records: ${attendanceError.message}`);
        }
        
        if (chunk && chunk.length > 0) {
          allAttendanceRows = allAttendanceRows.concat(chunk);
          from += step;
          if (chunk.length < step) {
            fetchMore = false; // reached the end
          }
        } else {
          fetchMore = false;
        }
      }

      const scoreForStatus = (status: string): string => {
        if (status === "present") return "1";
        if (status === "late") return "0.5";
        if (status === "excused") return "E";
        return "0";
      };

      const escXml = (v: string | number | null | undefined): string =>
        String(v ?? "")
          // Strip control characters that are illegal in XML (except tab=9, LF=10, CR=13)
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");

      const sessionIndexById = new Map<string, number>();
      sortedSessions.forEach((s, idx) =>
        sessionIndexById.set(String(s.id), idx),
      );

      // 3. Build cadet map with gender + school
      type GradeRow = {
        cadetId: string;
        idNumber: string;
        fullName: string;
        platoon: string;
        gender: string;
        school: string;
        scores: string[];
      };

      const cadetMap = new Map<string, GradeRow>();
      const officerMap = new Map<string, GradeRow>();
      for (const row of allAttendanceRows) {
        const cadetId = String(row.cadet_id ?? "");
        if (!cadetId) continue;
        const cadetObj = Array.isArray(row.cadet) ? row.cadet[0] : row.cadet;
        const role = String(cadetObj?.role ?? "cadet").toLowerCase();
        const targetMap = role === "officer" ? officerMap : cadetMap;
        if (!targetMap.has(cadetId)) {
          targetMap.set(cadetId, {
            cadetId,
            idNumber: String(cadetObj?.id_number ?? ""),
            fullName: String(cadetObj?.full_name ?? ""),
            platoon: String(cadetObj?.platoon ?? ""),
            gender: String(cadetObj?.gender ?? "").toUpperCase() || "N/A",
            school: String(cadetObj?.school ?? "") || "Unassigned",
            scores: Array(sortedSessions.length).fill(""),
          });
        }
        const targetRow = targetMap.get(cadetId)!;
        const slot = sessionIndexById.get(String(row.session_id));
        if (slot === undefined) continue;
        targetRow.scores[slot] = scoreForStatus(
          String(row.status ?? "").toLowerCase(),
        );
      }

      // 4. Group by School + Gender, sort alphabetically
      const allCadets = [...cadetMap.values()];
      const groups = new Map<string, GradeRow[]>();

      for (const cadet of allCadets) {
        const gender = normalizeGender(cadet.gender);
        const genderLabel =
          gender === "FEMALE" ? "Female" : gender === "MALE" ? "Male" : "N/A";
        const school = normalizeSchoolName(cadet.school);
        const key = `${school} - ${genderLabel}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(cadet);
      }

      // Sort groups alphabetically by key, and cadets within each group by full name
      const sortedGroupKeys = [...groups.keys()].sort();
      for (const key of sortedGroupKeys) {
        groups
          .get(key)!
          .sort((a, b) =>
            formatLastFirst(a.fullName).localeCompare(
              formatLastFirst(b.fullName),
            ),
          );
      }

      // Also add an "ALL CADETS" master sheet
      const masterList = [...allCadets].sort((a, b) =>
        formatLastFirst(a.fullName).localeCompare(formatLastFirst(b.fullName)),
      );

      // 5. Build Excel XML 2003 Spreadsheet
      const totalSessions = sortedSessions.length;
      const fixedCols = 6; // NR, FULL NAME, ID NUMBER, GENDER, SCHOOL, PLATOON
      const totalCols = fixedCols + totalSessions;
      const generatedAt = new Date().toLocaleString("en-GB", { hour12: false });

      const buildWorksheet = (sheetName: string, rows: GradeRow[]): string => {
        // Session date headers
        const sessionDateHeaders = sortedSessions
          .map((s) => {
            const d = new Date(`${s.session_date}T00:00:00`);
            const label = d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            return `<Cell ss:StyleID="sDateHead"><Data ss:Type="String">${escXml(`${label} ${s.session_type}`)}</Data></Cell>`;
          })
          .join("\n            ");

        // Day number headers
        const dayNumberHeaders = sortedSessions
          .map(
            (_, idx) =>
              `<Cell ss:StyleID="sDayNo"><Data ss:Type="Number">${idx + 1}</Data></Cell>`,
          )
          .join("\n            ");

        // Data rows
        const dataRows = rows
          .map((cadet, idx) => {
            const scoreCells = cadet.scores
              .map((val) => {
                if (val === "" || val === "0") {
                  return `<Cell ss:StyleID="sCenter"><Data ss:Type="Number">0</Data></Cell>`;
                }
                if (val === "E") {
                  return `<Cell ss:StyleID="sCenter"><Data ss:Type="String">E</Data></Cell>`;
                }
                return `<Cell ss:StyleID="sCenter"><Data ss:Type="Number">${val}</Data></Cell>`;
              })
              .join("\n              ");

            return `
          <Row>
            <Cell ss:StyleID="sCenter"><Data ss:Type="Number">${idx + 1}</Data></Cell>
            <Cell ss:StyleID="sDefault"><Data ss:Type="String">${escXml(formatLastFirst(cadet.fullName))}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(cadet.idNumber)}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(cadet.gender)}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(cadet.school)}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(cadet.platoon)}</Data></Cell>
            ${scoreCells}
          </Row>`;
          })
          .join("");

        return `
    <Worksheet ss:Name="${escXml(sheetName.substring(0, 31))}">
      <Table ss:DefaultColumnWidth="80" ss:DefaultRowHeight="16">
        <Column ss:Width="40"/>
        <Column ss:Width="180"/>
        <Column ss:Width="110"/>
        <Column ss:Width="70"/>
        <Column ss:Width="120"/>
        <Column ss:Width="100"/>
        ${sortedSessions.map(() => '<Column ss:Width="85"/>').join("")}

        <Row ss:Height="22">
          <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="sTitle"><Data ss:Type="String">DEPARTMENT OF MILITARY SCIENCE AND TACTICS</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">MINDANAO STATE UNIVERSITY - ZAMBOANGA SIBUGAY</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">ROTC UNIT - ATTENDANCE MASTER SHEET (AUTO FROM QR SCAN)</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">2nd Semester, S.Y. 2025-2026 • ${escXml(sheetName)}</Data></Cell>
        </Row>
        <Row ss:Height="14">
          <Cell ss:MergeAcross="${totalCols - 1}" ss:StyleID="sMeta"><Data ss:Type="String">Sessions: ${totalSessions} | Cadets: ${rows.length} | Generated: ${escXml(generatedAt)}</Data></Cell>
        </Row>
        <Row ss:Height="6"><Cell/></Row>

        <Row>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">NR</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">FULL NAME</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">ID NUMBER</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">GENDER</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">SCHOOL</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">PLATOON</Data></Cell>
          ${sessionDateHeaders}
        </Row>
        <Row>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          ${dayNumberHeaders}
        </Row>
        ${dataRows}
      </Table>
    </Worksheet>`;
      };

      // ── Officer worksheet (simpler: NR, FULL NAME, ID NUMBER, PLATOON + scores) ──
      const officerFixedCols = 4;
      const officerTotalCols = officerFixedCols + totalSessions;
      const buildOfficerWorksheet = (rows: GradeRow[]): string => {
        const sessionDateHeaders = sortedSessions
          .map((s) => {
            const d = new Date(`${s.session_date}T00:00:00`);
            const label = d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            return `<Cell ss:StyleID="sDateHead"><Data ss:Type="String">${escXml(`${label} ${s.session_type}`)}</Data></Cell>`;
          })
          .join("\n            ");
        const dayNumberHeaders = sortedSessions
          .map(
            (_, idx) =>
              `<Cell ss:StyleID="sDayNo"><Data ss:Type="Number">${idx + 1}</Data></Cell>`,
          )
          .join("\n            ");
        const dataRows = rows
          .map((officer, idx) => {
            const scoreCells = officer.scores
              .map((val) => {
                if (val === "" || val === "0")
                  return `<Cell ss:StyleID="sCenter"><Data ss:Type="Number">0</Data></Cell>`;
                if (val === "E")
                  return `<Cell ss:StyleID="sCenter"><Data ss:Type="String">E</Data></Cell>`;
                return `<Cell ss:StyleID="sCenter"><Data ss:Type="Number">${val}</Data></Cell>`;
              })
              .join("\n              ");
            return `
          <Row>
            <Cell ss:StyleID="sCenter"><Data ss:Type="Number">${idx + 1}</Data></Cell>
            <Cell ss:StyleID="sDefault"><Data ss:Type="String">${escXml(formatLastFirst(officer.fullName))}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(officer.idNumber)}</Data></Cell>
            <Cell ss:StyleID="sCenter"><Data ss:Type="String">${escXml(officer.platoon)}</Data></Cell>
            ${scoreCells}
          </Row>`;
          })
          .join("");
        return `
    <Worksheet ss:Name="Officers">
      <Table ss:DefaultColumnWidth="80" ss:DefaultRowHeight="16">
        <Column ss:Width="40"/>
        <Column ss:Width="180"/>
        <Column ss:Width="110"/>
        <Column ss:Width="120"/>
        ${sortedSessions.map(() => '<Column ss:Width="85"/>').join("")}

        <Row ss:Height="22">
          <Cell ss:MergeAcross="${officerTotalCols - 1}" ss:StyleID="sTitle"><Data ss:Type="String">DEPARTMENT OF MILITARY SCIENCE AND TACTICS</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${officerTotalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">MINDANAO STATE UNIVERSITY - ZAMBOANGA SIBUGAY</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${officerTotalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">ROTC UNIT - OFFICER ATTENDANCE RECORD (AUTO FROM QR SCAN)</Data></Cell>
        </Row>
        <Row ss:Height="18">
          <Cell ss:MergeAcross="${officerTotalCols - 1}" ss:StyleID="sSubTitle"><Data ss:Type="String">2nd Semester, S.Y. 2025-2026 • Officers</Data></Cell>
        </Row>
        <Row ss:Height="14">
          <Cell ss:MergeAcross="${officerTotalCols - 1}" ss:StyleID="sMeta"><Data ss:Type="String">Sessions: ${totalSessions} | Officers: ${rows.length} | Generated: ${escXml(generatedAt)}</Data></Cell>
        </Row>
        <Row ss:Height="6"><Cell/></Row>

        <Row>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">NR</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">FULL NAME</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">ID NUMBER</Data></Cell>
          <Cell ss:StyleID="sHeader"><Data ss:Type="String">PLATOON / POSITION</Data></Cell>
          ${sessionDateHeaders}
        </Row>
        <Row>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          <Cell ss:StyleID="sDayNo"/>
          ${dayNumberHeaders}
        </Row>
        ${dataRows}
      </Table>
    </Worksheet>`;
      };

      // Build all worksheets
      const allSheets: string[] = [];
      // 1. All Cadets master sheet
      allSheets.push(buildWorksheet("All Cadets", masterList));
      // 2. Cadets grouped by School + Gender
      for (const key of sortedGroupKeys) {
        allSheets.push(buildWorksheet(key, groups.get(key)!));
      }
      // 3. Officers sheet (separate, always last)
      const allOfficers = [...officerMap.values()].sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      );
      if (allOfficers.length > 0) {
        allSheets.push(buildOfficerWorksheet(allOfficers));
      }

      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">

  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Font ss:FontName="Arial" ss:Size="10"/>
      <Alignment ss:Vertical="Center"/>
    </Style>
    <Style ss:ID="sTitle">
      <Font ss:FontName="Arial" ss:Size="14" ss:Bold="1"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    </Style>
    <Style ss:ID="sSubTitle">
      <Font ss:FontName="Arial" ss:Size="11" ss:Bold="1"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    </Style>
    <Style ss:ID="sMeta">
      <Font ss:FontName="Arial" ss:Size="9" ss:Color="#555555"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
    </Style>
    <Style ss:ID="sHeader">
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#1F3D2B" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sDateHead">
      <Font ss:FontName="Arial" ss:Size="9" ss:Bold="1"/>
      <Interior ss:Color="#D9EDF7" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sDayNo">
      <Font ss:FontName="Arial" ss:Size="9" ss:Bold="1"/>
      <Interior ss:Color="#C4E3F3" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sDefault">
      <Font ss:FontName="Arial" ss:Size="10"/>
      <Alignment ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
      </Borders>
    </Style>
    <Style ss:ID="sCenter">
      <Font ss:FontName="Arial" ss:Size="10"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>
      </Borders>
    </Style>
  </Styles>

  ${allSheets.join("\n")}
</Workbook>`;

      // UTF-8 BOM ensures Excel reads the file without encoding issues.
      // SpreadsheetML (.xls) is Excel 2003 XML format — valid, safe, multi-sheet.
      const BOM = "\uFEFF";
      const fileName = `ROTC_Attendance_${Date.now()}.xls`;
      const finalContent = BOM + xmlContent;

      if (Platform.OS === "web") {
        setDownloadReady({ fileName, content: finalContent, session });
      } else {
        const fileUri =
          ((FileSystem as any).documentDirectory ||
            (FileSystem as any).cacheDirectory ||
            "") + fileName;
        await FileSystem.writeAsStringAsync(fileUri, finalContent);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
        } else {
          Alert.alert("Export complete", `Saved to: ${fileUri}`);
        }

        if (currentUser?.role === "admin") {
          setConfirmProp({
            title: "Export complete",
            message: "Attendance sheet exported.\n\nDo you want to delete this session log now?",
            confirmText: "Delete Log",
            danger: true,
            onConfirm: () => deleteSessionLog(session),
          });
        } else {
          Alert.alert("Export complete", "Attendance sheet exported.");
        }
      }
    } catch (error: any) {
      alertRemoteFailure("Export Failed", error?.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionAttendance = async (session: any) => {
    setSelectedSession(session);
    setRecordsLoading(true);
    if (session.status === "CLOSED") {
      // Safety net: if a legacy/manual close happened without absent stamping,
      // ensure closed sessions still get complete records.
      await autoMarkAbsents(session.id);
    }
    const { data: data, error } = await supabase
      .from("attendance")
      .select(
        `
        id,
        status,
        scan_time,
        cadet:users!attendance_cadet_id_fkey(id_number, full_name, platoon)
      `,
      )
      .eq("session_id", session.id)
      .order("scan_time", { ascending: false })
      .limit(5000);

    if (error) {
      const cached = await getCachedSessionRecords(session.id);
      setAttendanceRecords(cached);
      if (cached.length === 0) {
        if (!shouldSilenceRemoteFailureAlerts()) {
          if (isLikelyNetworkErrorMessage(error.message)) {
            Alert.alert(
              "Offline",
              "Showing cached records when available. Reconnect to refresh.",
            );
          } else {
            Alert.alert("Load Error", error.message);
          }
        }
      }
    } else {
      const records = ((data as AttendanceRecordRow[] | null) ?? []).map(
        normalizeAttendanceRecord,
      );
      setAttendanceRecords(records);
      await cacheSessionRecords(session.id, records);
    }
    setRecordsLoading(false);
  };

  const handleUpdateAttendanceStatus = async (
    record: SessionAttendanceRecord,
    nextStatus: AttendanceStatus,
  ) => {
    if (currentUser?.role !== "admin") return;
    setEditingRecordId(record.id);
    const { error } = await supabase
      .from("attendance")
      .update({
        status: nextStatus,
      })
      .eq("id", record.id);

    if (error) {
      if (shouldSilenceRemoteFailureAlerts()) {
        console.warn("Attendance status update:", error.message);
      } else if (isLikelyNetworkErrorMessage(error.message)) {
        Alert.alert(
          "Offline",
          "Cannot save status changes until you reconnect.",
        );
      } else {
        Alert.alert("Update Failed", error.message);
      }
      setEditingRecordId(null);
      return;
    }

    setAttendanceRecords((prev) =>
      prev.map((item) =>
        item.id === record.id ? { ...item, status: nextStatus } : item,
      ),
    );
    setEditingRecordId(null);
  };

  const statusColor = (status: AttendanceStatus) => {
    if (status === "present") return "#2E7D32";
    if (status === "late") return "#EF6C00";
    if (status === "excused") return "#1565C0";
    return "#C62828";
  };

  const renderReportItem = ({ item }: { item: any }) => (
    <View style={styles.reportCard}>
      <View style={styles.cardHeader}>
        <View style={styles.dateBox}>
          <Calendar color="#1F3D2B" size={16} />
          <Text style={styles.dateText}>
            {new Date(item.session_date).toLocaleDateString()}
          </Text>
        </View>
        <View
          style={[
            styles.typeBadge,
            {
              backgroundColor:
                item.session_type === "AM" ? "#E3F2FD" : "#FFF3E0",
            },
          ]}
        >
          <Text
            style={[
              styles.typeText,
              { color: item.session_type === "AM" ? "#1976D2" : "#E65100" },
            ]}
          >
            {item.session_type} WINDOW
          </Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {countStatus(item.attendance ?? [], "present")}
          </Text>
          <Text style={styles.statLabel}>PRESENT</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: "#EF6C00" }]}>
            {countStatus(item.attendance ?? [], "late")}
          </Text>
          <Text style={styles.statLabel}>LATE</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: "#C62828" }]}>
            {countStatus(item.attendance ?? [], "absent")}
          </Text>
          <Text style={styles.statLabel}>ABSENT</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.exportBtn}
        onPress={() => exportSessionReport(item)}
      >
        <Download color="#FFF" size={18} style={{ marginRight: 8 }} />
        <Text style={styles.exportBtnText}>EXPORT ATTENDANCE SHEET</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.viewBtn}
        onPress={() => loadSessionAttendance(item)}
      >
        <Text style={styles.viewBtnText}>VIEW RECORDS</Text>
      </TouchableOpacity>
      {currentUser?.role === "admin" ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => deleteSessionLog(item)}
        >
          <Text style={styles.deleteBtnText}>DELETE LOG</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.6}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>DUTY REPORTS</Text>
          <Text style={styles.headerSub}>
            Archived attendance logs &amp; statistics
          </Text>
        </View>
      </LinearGradient>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <Activity color="#D4A353" size={20} />
          <Text style={styles.summaryLabel}>TOTAL LOGS</Text>
          <Text style={styles.summaryValue}>{reports.length}</Text>
        </View>
        <View style={styles.summaryItem}>
          <FileText color="#D4A353" size={20} />
          <Text style={styles.summaryLabel}>ACCURACY</Text>
          <Text style={styles.summaryValue}>98.4%</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Recent Sessions</Text>
        {loading && !reports.length ? (
          <ActivityIndicator color="#1F3D2B" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={reports}
            renderItem={renderReportItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
          />
        )}
      </View>

      <Modal visible={!!selectedSession} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Session Records</Text>
              <TouchableOpacity onPress={() => setSelectedSession(null)}>
                <Text style={styles.closeText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            {selectedSession && (
              <Text style={styles.modalSub}>
                {formatSessionRealtimeLabel(selectedSession)} •{" "}
                {selectedSession.session_type} • {selectedSession.status}
              </Text>
            )}
            <Text style={styles.modalNow}>
              Now:{" "}
              {now.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              {now.toLocaleTimeString("en-GB", { hour12: false })}
            </Text>

            {recordsLoading ? (
              <ActivityIndicator color="#1F3D2B" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={attendanceRecords}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: 12 }}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={10}
                removeClippedSubviews={true}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No attendance records.</Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.recordRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recordName}>
                        {formatLastFirst(item.cadet.full_name)}
                      </Text>
                      <Text style={styles.recordMeta}>
                        {item.cadet.id_number} •{" "}
                        {item.cadet.platoon || "No Platoon"}
                      </Text>
                      <Text style={styles.recordMeta}>
                        {item.scan_time
                          ? `${new Date(item.scan_time).toLocaleDateString(
                              "en-US",
                              {
                                weekday: "short",
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )} ${new Date(item.scan_time).toLocaleTimeString(
                              "en-GB",
                              {
                                hour12: false,
                              },
                            )}`
                          : "No scan timestamp"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: statusColor(item.status) },
                      ]}
                    >
                      <Text style={styles.statusPillText}>
                        {item.status.toUpperCase()}
                      </Text>
                    </View>
                    {currentUser?.role === "admin" && (
                      <View style={styles.actionGroup}>
                        {(
                          [
                            "present",
                            "late",
                            "absent",
                            "excused",
                          ] as AttendanceStatus[]
                        ).map((status) => (
                          <TouchableOpacity
                            key={`${item.id}-${status}`}
                            style={[
                              styles.actionChip,
                              item.status === status && {
                                borderColor: statusColor(status),
                              },
                            ]}
                            disabled={editingRecordId === item.id}
                            onPress={() =>
                              handleUpdateAttendanceStatus(item, status)
                            }
                          >
                            <Text style={styles.actionChipText}>
                              {status.slice(0, 3).toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              />
            )}
            {currentUser?.role === "admin" ? (
              <Text style={styles.modalFoot}>
                Admin can edit status including EXCUSED.
              </Text>
            ) : (
              <Text style={styles.modalFoot}>Read-only for officers.</Text>
            )}
          </View>
        </View>
      </Modal>

      {/* DOWNLOAD READY MODAL FOR WEB COMPATIBILITY */}
      <Modal
        visible={downloadReady !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDownloadReady(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>File Ready</Text>
            
            <View style={styles.downloadBox}>
              <FileSpreadsheet color="#4A5D4E" size={40} />
              <Text style={styles.downloadFileName}>{downloadReady?.fileName}</Text>
              <Text style={styles.downloadHint}>
                Your device handles file downloads securely. Tap the button below to complete the download.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setDownloadReady(null);
                  if (currentUser?.role === "admin") {
                    setConfirmProp({
                      title: "Export Canceled",
                      message: "Attendance sheet was NOT downloaded.\n\nDo you still want to delete this session log?",
                      confirmText: "Delete Log",
                      danger: true,
                      onConfirm: () => deleteSessionLog(downloadReady?.session),
                    });
                  }
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnSafe, { paddingHorizontal: 12 }]}
                onPress={() => {
                  if (!downloadReady) return;
                  // MUST BE SYNCHRONOUS
                  downloadFileWeb(downloadReady.fileName, downloadReady.content, "application/octet-stream");
                  
                  // Show admin delete prompt if needed
                  if (currentUser?.role === "admin") {
                    setTimeout(() => {
                      setConfirmProp({
                        title: "Export Finished",
                        message: "Attendance sheet downloaded.\n\nDo you want to delete this session log now?",
                        confirmText: "Delete Log",
                        danger: true,
                        onConfirm: () => deleteSessionLog(downloadReady.session),
                      });
                      setDownloadReady(null);
                    }, 500);
                  } else {
                    setDownloadReady(null);
                    setConfirmProp({
                      title: "Export complete",
                      message: "Attendance sheet exported successfully.",
                      confirmText: "OK",
                      danger: false,
                      onConfirm: () => {},
                    });
                  }
                }}
              >
                <Text style={styles.confirmText}>Download Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Web-Reliable Confirm Modal */}
      <Modal visible={!!confirmProp} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmProp?.title}</Text>
            <Text style={styles.modalSub}>{confirmProp?.message}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setConfirmProp(null)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  confirmProp?.danger
                    ? styles.confirmBtnDanger
                    : styles.confirmBtnSafe,
                ]}
                onPress={() => {
                  if (confirmProp) {
                    confirmProp.onConfirm();
                  }
                  setConfirmProp(null);
                }}
              >
                <Text style={styles.confirmText}>
                  {confirmProp?.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: { marginRight: 20 },
  headerTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  headerSub: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 2 },

  summaryGrid: {
    flexDirection: "row",
    padding: 24,
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EAECE6",
  },
  summaryItem: {
    width: "48%",
    backgroundColor: "#F8F9F7",
    padding: 16,
    borderRadius: 20,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#A0B3A6",
    letterSpacing: 1,
    marginTop: 12,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "900",
    color: "#1F3D2B",
    marginTop: 4,
  },

  content: { flex: 1, padding: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#1F3D2B",
    marginBottom: 20,
    letterSpacing: 0.5,
  },

  reportCard: {
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  dateBox: { flexDirection: "row", alignItems: "center" },
  dateText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#1F3D2B",
    marginLeft: 8,
  },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  typeText: { fontSize: 10, fontWeight: "900" },

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: "#F8F9F7",
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "900", color: "#1F3D2B" },
  statLabel: { fontSize: 9, fontWeight: "900", color: "#A0B3A6", marginTop: 4 },
  divider: { width: 1, height: 30, backgroundColor: "#EAECE6" },
  statusText: { fontSize: 16, fontWeight: "900" },

  exportBtn: {
    flexDirection: "row",
    backgroundColor: "#1F3D2B",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  exportBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  viewBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1F3D2B",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  viewBtnText: {
    color: "#1F3D2B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  deleteBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#A52A2A",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  deleteBtnText: {
    color: "#A52A2A",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    maxHeight: "85%",
    backgroundColor: "#FFF",
    borderRadius: 18,
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#1F3D2B" },
  closeText: { color: "#A52A2A", fontWeight: "900", fontSize: 12 },
  modalSub: { marginTop: 4, color: "#6E7A71", fontSize: 12, marginBottom: 10 },
  modalNow: {
    color: "#1F3D2B",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 10,
  },
  recordRow: {
    borderWidth: 1,
    borderColor: "#EAECE6",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  recordName: { fontSize: 13, fontWeight: "800", color: "#1F3D2B" },
  recordMeta: { fontSize: 11, color: "#6E7A71", marginTop: 2 },
  statusPill: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusPillText: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  actionGroup: { flexDirection: "row", marginTop: 8, gap: 6, flexWrap: "wrap" },
  actionChip: {
    borderWidth: 1,
    borderColor: "#D0D6D1",
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#FFF",
  },
  actionChipText: { fontSize: 10, fontWeight: "800", color: "#3A4A3F" },
  modalFoot: {
    fontSize: 11,
    color: "#6E7A71",
    marginTop: 8,
    textAlign: "center",
  },
  emptyText: {
    color: "#6E7A71",
    textAlign: "center",
    paddingVertical: 16,
    fontSize: 12,
  },
  downloadBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    backgroundColor: "#F4F7F5",
    borderRadius: 16,
    marginVertical: 16,
  },
  downloadFileName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#1F3D2B",
    marginTop: 12,
    textAlign: "center",
  },
  downloadHint: {
    fontSize: 11,
    color: "#6E7A71",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 6,
  },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: "#6E7A71", fontWeight: "700" },
  confirmBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 100,
    alignItems: "center",
  },
  confirmBtnDanger: { backgroundColor: "#C62828" },
  confirmBtnSafe: { backgroundColor: "#2E7D32" },
  confirmText: { color: "#FFF", fontWeight: "800" },
});
