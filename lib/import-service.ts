import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";

// Types

export type ImportMode = "cadet" | "officer";

export interface CadetExcelRow {
  "ID Number": string;
  "Full Name": string;
  Platoon?: string;
  "Year Level"?: string;
  Gender?: string;
  School?: string;
}

export interface OfficerExcelRow {
  "Full Name": string;
  "Position/Role": string;
  Year: string;
}

export interface UserImportCredentials {
  id_number: string;
  full_name: string;
  platoon: string | null;
  year_level: string | null;
  gender: string | null;
  school: string | null;
  role: "cadet" | "officer";
  password_hash: string;
  qr_token: string | null;
  is_active: boolean;
  raw_password: string;
}

export interface CredentialsReportEntry {
  id_number: string;
  full_name: string;
  raw_password: string;
}

export interface ImportResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  credentialsReport: CredentialsReportEntry[];
  insertedIdNumbers: string[];
}

function normalizeCadetText(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeHeader(value: string) {
  return normalizeCadetText(value).toLowerCase();
}

function toYearToken(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "YR";
}

function quickHash(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).toUpperCase().slice(0, 5);
}

function buildOfficerIdNumber(fullName: string, year: string) {
  const cleanName = fullName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nameToken = cleanName.slice(0, 4) || "OFFR";
  const yearToken = toYearToken(year);
  const hash = quickHash(`${fullName}|${year}`);
  return `OFF-${yearToken}-${nameToken}-${hash}`;
}

export function generateOfficerIdNumber(fullName: string, year: string) {
  return buildOfficerIdNumber(
    normalizeCadetText(fullName),
    normalizeCadetText(year),
  );
}

async function generateQrToken(seed: string) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${seed}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );
}

async function hashPassword(plain: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, plain);
}

// Functions

function parseCsvRows(content: string): string[][] {
  const parseCsvLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    values.push(current.trim());
    return values;
  };

  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

async function readSpreadsheetRows(fileUri: string): Promise<string[][]> {
  const lowerUri = fileUri.toLowerCase();
  const fs = FileSystem as any;

  if (lowerUri.endsWith(".xlsx") || lowerUri.endsWith(".xls")) {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: fs.EncodingType.Base64,
    });
    const workbook = XLSX.read(base64, { type: "base64" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("Excel file has no sheets.");
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    return rows
      .map((row) => row.map((cell) => normalizeCadetText(String(cell ?? ""))))
      .filter((row) => row.some((cell) => cell.length > 0));
  }

  const content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: fs.EncodingType.UTF8,
  });
  return parseCsvRows(content);
}

export async function parseExcel(
  fileUri: string,
  mode: ImportMode = "cadet",
): Promise<{ rows: (CadetExcelRow | OfficerExcelRow)[]; errors: string[] }> {
  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB safety limit
  const MAX_ROWS = 1000; // aligned with target batch range

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error("Selected file does not exist.");
  }
  if (typeof fileInfo.size === "number" && fileInfo.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("File is too large. Please upload up to 5MB only.");
  }

  const matrix = await readSpreadsheetRows(fileUri);
  if (matrix.length < 2) {
    throw new Error("File is empty or missing data rows.");
  }

  const headerValues = matrix[0];
  const headerIndex = new Map<string, number>();
  headerValues.forEach((header, idx) => {
    const normalized = normalizeHeader(header);
    headerIndex.set(normalized, idx);
  });
  const getCell = (cells: string[], key: string) => {
    const idx = headerIndex.get(normalizeHeader(key));
    if (idx === undefined || idx < 0) return "";
    return normalizeCadetText(cells[idx]);
  };

  const requiredCadetHeaders = ["id number", "full name"];
  const requiredOfficerHeaders = ["full name"];
  if (
    mode === "cadet" &&
    requiredCadetHeaders.some((h) => !headerIndex.has(h))
  ) {
    throw new Error('Cadet import requires headers "ID Number" and "Full Name".');
  }
  if (
    mode === "officer" &&
    (requiredOfficerHeaders.some((h) => !headerIndex.has(h)) ||
      (!headerIndex.has("position/role") &&
        !headerIndex.has("position") &&
        !headerIndex.has("role")) ||
      (!headerIndex.has("year") && !headerIndex.has("year level")))
  ) {
    throw new Error(
      'Officer import requires headers "Full Name", "Position/Role", and "Year".',
    );
  }

  const rawRows = matrix.slice(1).map((cells) => {
    if (mode === "cadet") {
      return {
        "ID Number": getCell(cells, "id number"),
        "Full Name": getCell(cells, "full name"),
        Platoon: getCell(cells, "platoon") || undefined,
        "Year Level": getCell(cells, "year level") || undefined,
        Gender: getCell(cells, "gender") || undefined,
        School: getCell(cells, "school") || undefined,
      } as CadetExcelRow;
    }
    return {
      "Full Name": getCell(cells, "full name"),
      "Position/Role":
        getCell(cells, "position/role") ||
        getCell(cells, "position") ||
        getCell(cells, "role"),
      Year: getCell(cells, "year") || getCell(cells, "year level"),
    } as OfficerExcelRow;
  });

  if (rawRows.length > MAX_ROWS) {
    throw new Error(`Too many rows (${rawRows.length}). Maximum allowed is ${MAX_ROWS}.`);
  }

  const rows: (CadetExcelRow | OfficerExcelRow)[] = [];
  const errors: string[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    if (mode === "cadet") {
      const cadet = raw as CadetExcelRow;
      const idNumber = normalizeCadetText(cadet["ID Number"]);
      const fullName = normalizeCadetText(cadet["Full Name"]);
      if (!idNumber) {
        errors.push(`Row ${i + 2}: Missing or empty "ID Number"`);
        continue;
      }
      if (!fullName) {
        errors.push(`Row ${i + 2}: Missing or empty "Full Name"`);
        continue;
      }
      if (seenInFile.has(idNumber)) {
        errors.push(`Row ${i + 2}: Duplicate "ID Number" in file (${idNumber})`);
        continue;
      }
      seenInFile.add(idNumber);
      rows.push({
        "ID Number": idNumber,
        "Full Name": fullName,
        Platoon: normalizeCadetText(cadet["Platoon"]) || undefined,
        "Year Level": normalizeCadetText(cadet["Year Level"]) || "2025-2026",
        Gender: normalizeCadetText(cadet["Gender"]).toUpperCase() || undefined,
        School: normalizeCadetText(cadet["School"]) || undefined,
      });
      continue;
    }

    const officer = raw as OfficerExcelRow;
    const fullName = normalizeCadetText(officer["Full Name"]);
    const position = normalizeCadetText(officer["Position/Role"]);
    const year = normalizeCadetText(officer.Year);
    if (!fullName) {
      errors.push(`Row ${i + 2}: Missing or empty "Full Name"`);
      continue;
    }
    if (!position) {
      errors.push(`Row ${i + 2}: Missing or empty "Position/Role"`);
      continue;
    }
    if (!year) {
      errors.push(`Row ${i + 2}: Missing or empty "Year"`);
      continue;
    }
    const dedupeKey = `${fullName}|${position}|${year}`;
    if (seenInFile.has(dedupeKey)) {
      errors.push(`Row ${i + 2}: Duplicate officer row in file`);
      continue;
    }
    seenInFile.add(dedupeKey);
    rows.push({
      "Full Name": fullName,
      "Position/Role": position,
      Year: year,
    });
  }

  return { rows, errors };
}

export async function generateCredentials(
  row: CadetExcelRow,
): Promise<UserImportCredentials> {
  const idNumber = normalizeCadetText(row["ID Number"]);
  const fullName = normalizeCadetText(row["Full Name"]);
  const platoon = normalizeCadetText(row["Platoon"]) || null;
  const yearLevel = normalizeCadetText(row["Year Level"]) || "2025-2026";
  const rawPassword = `ROTC${idNumber.slice(-4)}`;
  const password_hash = await hashPassword(rawPassword);
  const qr_token = await generateQrToken(`qr:${idNumber}`);

  return {
    id_number: idNumber,
    full_name: fullName,
    platoon,
    year_level: yearLevel,
    gender: normalizeCadetText(row["Gender"]).toUpperCase() || null,
    school: normalizeCadetText(row["School"]) || null,
    role: "cadet",
    password_hash,
    qr_token,
    is_active: true,
    raw_password: rawPassword,
  };
}

export async function generateOfficerCredentials(
  row: OfficerExcelRow,
): Promise<UserImportCredentials> {
  const fullName = normalizeCadetText(row["Full Name"]);
  const positionRole = normalizeCadetText(row["Position/Role"]);
  const year = normalizeCadetText(row.Year) || "N/A";
  const idNumber = buildOfficerIdNumber(fullName, year);
  const rawPassword = `ROTC${idNumber.slice(-4)}`;
  const password_hash = await hashPassword(rawPassword);
  const qr_token = await generateQrToken(`qr:${idNumber}`);

  return {
    id_number: idNumber,
    full_name: fullName,
    platoon: positionRole || null,
    year_level: year,
    gender: null,
    school: null,
    role: "officer",
    password_hash,
    qr_token,
    is_active: true,
    raw_password: rawPassword,
  };
}

export async function batchInsertOnly(
  users: UserImportCredentials[],
  batchSize = 500,
): Promise<ImportResult> {
  const result: ImportResult = {
    total: users.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    credentialsReport: [],
    insertedIdNumbers: [],
  };

  for (let i = 0; i < users.length; i += batchSize) {
    const chunk = users.slice(i, i + batchSize);
    const idNumbers = chunk.map((c) => c.id_number);

    const { data: existingRows, error: existingError } = await supabase
      .from("users")
      .select("id, id_number")
      .in("id_number", idNumbers);

    if (existingError) {
      result.errors.push(
        `Batch ${Math.floor(i / batchSize) + 1}: failed to check duplicates (${existingError.message})`,
      );
      result.skipped += chunk.length;
      continue;
    }

    const existing = new Set((existingRows ?? []).map((r) => r.id_number));
    const toInsert = chunk.filter((c) => !existing.has(c.id_number));
    result.skipped += chunk.length - toInsert.length;
    if (toInsert.length === 0) continue;

    const insertPayload = toInsert.map(({ raw_password, ...dbRow }) => ({
      ...dbRow,
      id_number: normalizeCadetText(dbRow.id_number),
      full_name: normalizeCadetText(dbRow.full_name),
      platoon: normalizeCadetText(dbRow.platoon) || null,
      year_level: normalizeCadetText(dbRow.year_level) || "2025-2026",
      gender: dbRow.gender || null,
      school: dbRow.school || null,
      role: dbRow.role,
      qr_token: dbRow.qr_token || null,
      is_active: true,
    }));

    const { data, error } = await supabase
      .from("users")
      .insert(insertPayload)
      .select("id_number");

    if (error) {
      result.errors.push(
        `Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`,
      );
      result.skipped += toInsert.length;
    } else {
      result.inserted += data?.length ?? toInsert.length;
      result.insertedIdNumbers.push(
        ...((data ?? []).map((row) => row.id_number) as string[]),
      );
      result.credentialsReport.push(
        ...toInsert.map((entry) => ({
          id_number: entry.id_number,
          full_name: entry.full_name,
          raw_password: entry.raw_password,
        })),
      );
    }
  }

  return result;
}

export async function importFromFile(
  fileUri: string,
  mode: ImportMode = "cadet",
): Promise<ImportResult> {
  const { rows, errors: parseErrors } = await parseExcel(fileUri, mode);
  const credentials =
    mode === "cadet"
      ? await Promise.all((rows as CadetExcelRow[]).map(generateCredentials))
      : await Promise.all(
          (rows as OfficerExcelRow[]).map(generateOfficerCredentials),
        );

  const result = await batchInsertOnly(credentials);

  return {
    ...result,
    errors: [...parseErrors, ...result.errors],
    credentialsReport: result.credentialsReport,
  };
}