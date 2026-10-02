export interface HistoryItem {
  id: string;
  name: string;
  date: number;
  before: string;
  after: string;
  status: "restored" | "saved";
  tools: string[];
}

export interface Settings {
  theme: "aurora" | "midnight";
  exportFormat: "png" | "jpeg" | "webp";
  quality: number;
  autoSave: boolean;
  saveHistory: boolean;
  previewQuality: "fast" | "full";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "aurora", exportFormat: "png", quality: 92, autoSave: true, saveHistory: true, previewQuality: "full",
};

const HK = "pr-history", SK = "pr-settings", ST = "pr-stats";

const read = <T,>(k: string, fb: T): T => {
  if (typeof window === "undefined") return fb;
  try { const v = localStorage.getItem(k); return v ? { ...fb, ...JSON.parse(v) } : fb; } catch { return fb; }
};

export const getHistory = (): HistoryItem[] => {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(HK) || "[]"); } catch { return []; }
};
export const setHistory = (h: HistoryItem[]) => {
  let list = h;
  while (list.length) {
    try { localStorage.setItem(HK, JSON.stringify(list)); return; } catch { list = list.slice(0, -1); }
  }
  localStorage.removeItem(HK);
};
export const addHistory = (item: HistoryItem) => setHistory([item, ...getHistory()].slice(0, 30));

export const getSettings = () => read<Settings>(SK, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => localStorage.setItem(SK, JSON.stringify(s));

export const getStats = () => read(ST, { processed: 0, restored: 0 });
export const bumpStats = (k: "processed" | "restored") => {
  const s = getStats(); s[k]++; localStorage.setItem(ST, JSON.stringify(s));
};

export const storageUsedKB = () => {
  if (typeof window === "undefined") return 0;
  let t = 0;
  for (const k of [HK, SK, ST]) t += (localStorage.getItem(k) || "").length * 2;
  return Math.round(t / 1024);
};
