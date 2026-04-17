import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { syncPendingSessionMutations } from "./session-manager";
import { supabase } from "./supabase";

const QUEUE_KEY = "rotc_offline_queue";

const WEB_DB_NAME = "rotc_offline_db";
const WEB_STORE_NAME = "kv";

async function getWebDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  return await new Promise((resolve) => {
    const request = window.indexedDB.open(WEB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WEB_STORE_NAME)) {
        db.createObjectStore(WEB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

const storage = {
  getItem: async (key: string) => {
    if (Platform.OS !== "web") {
      return AsyncStorage.getItem(key);
    }
    const db = await getWebDb();
    if (!db) {
      return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    }
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(WEB_STORE_NAME, "readonly");
      const store = tx.objectStore(WEB_STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS !== "web") {
      await AsyncStorage.setItem(key, value);
      return;
    }
    const db = await getWebDb();
    if (!db) {
      if (typeof window !== "undefined") window.localStorage.setItem(key, value);
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(WEB_STORE_NAME, "readwrite");
      const store = tx.objectStore(WEB_STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  },
  removeItem: async (key: string) => {
    if (Platform.OS !== "web") {
      await AsyncStorage.removeItem(key);
      return;
    }
    const db = await getWebDb();
    if (!db) {
      if (typeof window !== "undefined") window.localStorage.removeItem(key);
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(WEB_STORE_NAME, "readwrite");
      const store = tx.objectStore(WEB_STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  },
};

export interface OfflineScanRecord {
  localId: string;
  cadet_id: string;
  session_id: string;
  status: "present" | "late";
  scan_time: string; // ISO string
  scanned_by: string;
  synced: boolean;
}

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

async function readQueue(): Promise<OfflineScanRecord[]> {
  const raw = await storage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OfflineScanRecord[];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OfflineScanRecord[]): Promise<void> {
  await storage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(record: OfflineScanRecord): Promise<void> {
  const queue = await readQueue();
  queue.push(record);
  await writeQueue(queue);
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.filter((r) => !r.synced).length;
}

export async function hasPendingScan(
  cadetId: string,
  sessionId: string,
): Promise<boolean> {
  const queue = await readQueue();
  return queue.some(
    (r) => !r.synced && r.cadet_id === cadetId && r.session_id === sessionId,
  );
}

export async function syncPending(): Promise<SyncResult> {
  const queue = await readQueue();
  const pending = queue.filter((r) => !r.synced);
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const record of pending) {
    const { error } = await supabase.from("attendance").upsert(
      {
        cadet_id: record.cadet_id,
        session_id: record.session_id,
        status: record.status,
        scan_time: record.scan_time,
        scanned_by: record.scanned_by,
      },
      { onConflict: "cadet_id,session_id" },
    );

    if (error) {
      failed++;
      errors.push(error.message);
    } else {
      record.synced = true;
      synced++;
    }
  }

  await writeQueue(queue);
  return { synced, failed, errors };
}

export async function clearSynced(): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((r) => !r.synced));
}

export function startSyncListener(): () => void {
  // NetInfo listener — wired in app/_layout.tsx
  // Imported lazily to avoid issues in non-RN environments
  let unsubscribe: (() => void) | null = null;

  import("@react-native-community/netinfo").then((NetInfo) => {
    unsubscribe = NetInfo.default.addEventListener((state) => {
      if (state.isConnected) {
        syncPending().catch(() => {});
        syncPendingSessionMutations().catch(() => {});
      }
    });
  });

  return () => {
    if (unsubscribe) unsubscribe();
  };
}
