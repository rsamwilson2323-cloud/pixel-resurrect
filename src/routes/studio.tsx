import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard, Wand2, Focus, Palette, ScanFace, Sparkles, History, Settings as SettingsIcon,
  Upload, X, Undo2, Redo2, RotateCcw, ZoomIn, ZoomOut, Maximize, Minimize2, RotateCw, FlipHorizontal,
  FlipVertical, Download, Loader2, Brush, Trash2, Menu, ImagePlus, Info, Columns2, SplitSquareHorizontal, Square,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { CompareSlider } from "@/components/Compare";
import {
  DEFAULT_ADJ, process, autoColorAdjust, fileToImageData, renderToCanvas, thumb, isGrayscale, detectFaces,
  type Adjustments, type Transform, type FaceBox,
} from "@/lib/imageProcessing";
import {
  getHistory, setHistory, addHistory, getSettings, saveSettings, getStats, bumpStats, storageUsedKB,
  type HistoryItem, type Settings, DEFAULT_SETTINGS,
} from "@/lib/storage";
import { getAiStatus, runAiTask } from "@/lib/ai.functions";

type Tab = "dashboard" | "restore" | "enhance" | "color" | "face" | "colorize" | "history" | "settings";
const TABS: { id: Tab; label: string; icon: typeof Wand2 }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "restore", label: "Restore Image", icon: Wand2 },
  { id: "enhance", label: "Image Enhancer", icon: Focus },
  { id: "color", label: "Color Restoration", icon: Palette },
  { id: "face", label: "Face Enhancement", icon: ScanFace },
  { id: "colorize", label: "Photo Colorization", icon: Sparkles },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];
const WORK_TABS: Tab[] = ["restore", "enhance", "color", "face", "colorize"];

export const Route = createFileRoute("/studio")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => (TABS.some((t) => t.id === s["tab"]) ? { tab: s["tab"] as Tab } : {}),
  head: () => ({
    meta: [
      { title: "Studio — Pixel Resurrect" },
      { name: "description", content: "Upload a photo and restore scratches, sharpness, color and faces right in your browser." },
      { property: "og:title", content: "Studio — Pixel Resurrect" },
      { property: "og:description", content: "Restore your photos in a professional browser-based workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

interface Snap { adj: Adjustments; mask: Uint8Array | null; t: Transform }
interface Meta { name: string; size: number; type: string; w: number; h: number; nw: number; nh: number }
const ID_T: Transform = { rotate: 0, flipH: false, flipV: false };
const FORMATS = ["image/jpeg", "image/png", "image/webp", "image/bmp"];
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);
const canvasUrl = (c: HTMLCanvasElement) =>
  new Promise<string>((res) => c.toBlob((b) => res(URL.createObjectURL(b!)), "image/png"));

function Studio() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/studio" });
  const tab: Tab = search.tab ?? "dashboard";
  const setTab = (t: Tab) => { navigate({ search: { tab: t } }); setNavOpen(false); };
  const [navOpen, setNavOpen] = useState(false);

  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHist] = useState<HistoryItem[]>([]);
  const [stats, setStats] = useState({ processed: 0, restored: 0 });
  useEffect(() => { setSettingsState(getSettings()); setHist(getHistory()); setStats(getStats()); }, []);
  const refresh = () => { setHist(getHistory()); setStats(getStats()); };
  const updateSettings = (s: Partial<Settings>) => { const n = { ...settings, ...s }; setSettingsState(n); saveSettings(n); };

  // image state
  const original = useRef<ImageData | null>(null);
  const processed = useRef<ImageData | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snap, setSnap] = useState<Snap>({ adj: DEFAULT_ADJ, mask: null, t: ID_T });
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const [origUrl, setOrigUrl] = useState("");
  const [procUrl, setProcUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const [aiColorized, setAiColorized] = useState(false);
  const [version, setVersion] = useState(0);
  const [touched, setTouched] = useState(false);

  const push = useCallback(() => { setPast((p) => [...p.slice(-40), snap]); setFuture([]); setTouched(true); }, [snap]);
  const apply = (next: Partial<Snap>, record = true) => { if (record) push(); setSnap((s) => ({ ...s, ...next })); };
  const setAdj = (k: keyof Adjustments, v: number) => setSnap((s) => ({ ...s, adj: { ...s.adj, [k]: v } }));
  const undo = () => { if (!past.length) return; setFuture((f) => [snap, ...f]); setSnap(past[past.length - 1]!); setPast((p) => p.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, snap]); setSnap(future[0]!); setFuture((f) => f.slice(1)); };
  const reset = () => { if (!meta) return; push(); setSnap({ adj: DEFAULT_ADJ, mask: null, t: ID_T }); };

  const loadFile = useCallback(async (file: File) => {
    if (!FORMATS.includes(file.type)) { toast.error("Unsupported file. Use JPG, PNG, WEBP or BMP."); return; }
    if (file.size > 50 * 1048576) { toast.error("File too large (max 50 MB)."); return; }
    setLoading(true);
    try {
      const { data, naturalW, naturalH } = await fileToImageData(file);
      original.current = data;
      setMeta({ name: file.name, size: file.size, type: (file.type.split("/")[1] ?? "").toUpperCase(), w: data.width, h: data.height, nw: naturalW, nh: naturalH });
      setSnap({ adj: DEFAULT_ADJ, mask: null, t: ID_T });
      setPast([]); setFuture([]); setFaces([]); setAiColorized(false); setTouched(false);
      setVersion((v) => v + 1);
      bumpStats("processed"); refresh();
      if (naturalW > data.width) toast.info(`Large image scaled to ${data.width}×${data.height} for safe processing.`);
      if (!WORK_TABS.includes(tab)) setTab("restore");
    } catch {
      toast.error("Could not read this image. The file may be corrupted.");
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const removeImage = () => { original.current = null; processed.current = null; setMeta(null); setOrigUrl(""); setProcUrl(""); setPast([]); setFuture([]); };

  // paste support
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) loadFile(f);
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [loadFile]);

  // original preview (follows transform)
  useEffect(() => {
    if (!original.current) return;
    let url = "";
    canvasUrl(renderToCanvas(original.current, snap.t)).then((u) => { url = u; setOrigUrl(u); });
    return () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [snap.t, version]);

  // processing pipeline
  useEffect(() => {
    if (!original.current) return;
    setBusy(true);
    let url = "";
    const id = setTimeout(async () => {
      try {
        processed.current = process(original.current!, snap.adj, snap.mask, faces);
        url = await canvasUrl(renderToCanvas(processed.current, snap.t));
        setProcUrl(url);
      } catch (e) {
        toast.error("Processing failed: " + (e as Error).message);
      } finally { setBusy(false); }
    }, 140);
    return () => { clearTimeout(id); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  }, [snap, faces, version]);

  // view state
  const [mode, setMode] = useState<"slider" | "side" | "single">("slider");
  const [zoom, setZoom] = useState(1);
  const [brush, setBrush] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [showFaces, setShowFaces] = useState(true);
  const viewer = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => { const h = () => setIsFs(!!document.fullscreenElement); document.addEventListener("fullscreenchange", h); return () => document.removeEventListener("fullscreenchange", h); }, []);
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : viewer.current?.requestFullscreen());
  const untransformed = snap.t.rotate % 360 === 0 && !snap.t.flipH && !snap.t.flipV;

  // brush overlay
  const overlay = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = overlay.current!; const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width, y = ((e.clientY - r.top) / r.height) * c.height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(255,40,120,0.6)";
    ctx.beginPath(); ctx.arc(x, y, (brushSize * c.width) / 1000, 0, Math.PI * 2); ctx.fill();
  };
  const applyBrush = () => {
    const c = overlay.current; if (!c || !meta) return;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const m = new Uint8Array(c.width * c.height);
    let any = false;
    for (let i = 0; i < m.length; i++) if ((d[i * 4 + 3] ?? 0) > 0) { m[i] = 1; any = true; }
    if (!any) { toast.info("Paint over scratches first."); return; }
    if (snap.mask) for (let i = 0; i < m.length; i++) m[i] = (m[i] ?? 0) | (snap.mask[i] ?? 0);
    apply({ mask: m });
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    toast.success("Painted area repaired.");
  };

  const ratio = meta ? (snap.t.rotate % 180 === 0 ? meta.w / meta.h : meta.h / meta.w) : 1;
  const frameStyle = (frac = 1) => ({
    aspectRatio: String(ratio),
    width: `calc(min(${100 * frac}%, ${isFs ? 88 : 68}vh * ${ratio}) * ${zoom})`,
  });

  // export
  const [fmt, setFmt] = useState<Settings["exportFormat"]>("png");
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [fname, setFname] = useState("");
  useEffect(() => { setFmt(settings.exportFormat); setQuality(settings.quality); }, [settings.exportFormat, settings.quality]);
  useEffect(() => { if (meta) setFname(meta.name.replace(/\.[^.]+$/, "") + "-restored"); }, [meta]);

  const download = (c: HTMLCanvasElement, name: string) => {
    const mime = `image/${fmt}`;
    c.toBlob((b) => {
      if (!b) { toast.error("Export failed."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = `${name || "image"}.${fmt === "jpeg" ? "jpg" : fmt}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, mime, quality / 100);
  };
  const saveHistory = (status: HistoryItem["status"]) => {
    if (!processed.current || !original.current || !settings.saveHistory) return;
    const used = Object.entries(snap.adj).filter(([, v]) => v !== 0).map(([k]) => k);
    if (snap.mask) used.push("brush repair");
    addHistory({
      id: crypto.randomUUID(), name: meta!.name, date: Date.now(), status, tools: used,
      before: thumb(renderToCanvas(original.current, snap.t)), after: thumb(renderToCanvas(processed.current, snap.t)),
    });
    bumpStats("restored"); refresh();
  };
  const downloadRestored = () => {
    if (!processed.current) return;
    download(renderToCanvas(processed.current, snap.t, scale), fname);
    if (settings.autoSave) saveHistory("restored");
    toast.success("Restored image downloaded.");
  };
  const downloadOriginal = () => original.current && download(renderToCanvas(original.current, ID_T), (meta?.name ?? "original").replace(/\.[^.]+$/, ""));
  const exportComparison = () => {
    if (!processed.current || !original.current) return;
    const a = renderToCanvas(original.current, snap.t), b = renderToCanvas(processed.current, snap.t);
    const pad = Math.round(a.width * 0.02), bar = Math.round(a.height * 0.07) + 20;
    const c = document.createElement("canvas");
    c.width = a.width * 2 + pad * 3; c.height = a.height + bar + pad;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#121018"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, pad, bar); ctx.drawImage(b, a.width + pad * 2, bar);
    ctx.font = `bold ${Math.round(bar * 0.4)}px sans-serif`; ctx.textBaseline = "middle";
    ctx.fillStyle = "#e5e5ef"; ctx.fillText("ORIGINAL", pad, bar / 2);
    ctx.fillStyle = "#5fd8f0"; ctx.fillText("RESTORED", a.width + pad * 2, bar / 2);
    download(c, `${fname}-comparison`);
  };

  // quick actions
  const autoColor = () => { if (!original.current) return; apply({ adj: { ...snap.adj, ...autoColorAdjust(original.current) } }); toast.success("Auto color applied."); };
  const quickRestore = () => {
    if (!original.current) return;
    apply({ adj: { ...snap.adj, ...autoColorAdjust(original.current), scratch: 45, denoise: 25, sharpness: 30, detail: 20, clarity: 20 } });
    toast.success("Quick restore applied — fine-tune with the sliders.");
  };
  const runFaceDetect = async () => {
    if (!processed.current && !original.current) return;
    try {
      const f = await detectFaces(original.current!);
      if (f === null) { toast.error("Face detection isn't supported in this browser (try Chrome with experimental web features enabled)."); return; }
      setFaces(f);
      toast[f.length ? "success" : "info"](f.length ? `Detected ${f.length} face(s).` : "No faces found.");
      if (f.length && snap.adj.face === 0) apply({ adj: { ...snap.adj, face: 40 } });
    } catch (e) { toast.error("Face detection failed: " + (e as Error).message); }
  };

  // AI
  const aiStatus = useServerFn(getAiStatus);
  const aiRun = useServerFn(runAiTask);
  const [ai, setAi] = useState<{ available: boolean; configured: string[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { if (tab === "colorize" && !ai) aiStatus().then(setAi).catch(() => setAi({ available: false, configured: [] })); }, [tab, ai, aiStatus]);
  const colorize = async () => {
    if (!original.current) return;
    setAiBusy(true);
    try {
      const c = renderToCanvas(original.current, ID_T);
      const r = await aiRun({ data: { task: "colorization", image: c.toDataURL("image/jpeg", 0.9) } });
      if (!r.ok) { toast.error(r.error); return; }
      const res = await fetch(r.image); const blob = await res.blob();
      await loadFile(new File([blob], meta!.name, { type: blob.type || "image/png" }));
      setAiColorized(true);
      toast.success("AI colorization complete.");
    } catch (e) { toast.error("AI request failed: " + (e as Error).message); }
    finally { setAiBusy(false); }
  };

  const isGray = useMemo(() => (original.current ? isGrayscale(original.current) : false), [version]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ---------- render helpers ----------
  const Slider = ({ k, label, min = -100, max = 100 }: { k: keyof Adjustments; label: string; min?: number; max?: number }) => (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono text-cyan">{snap.adj[k]}</span></div>
      <input type="range" min={min} max={max} value={snap.adj[k]} className="w-full" disabled={!meta}
        onPointerDown={push} onKeyDown={push} onChange={(e) => setAdj(k, Number(e.target.value))} />
    </label>
  );
  const Btn = ({ onClick, icon: I, label, disabled, active }: { onClick: () => void; icon: typeof Wand2; label: string; disabled?: boolean; active?: boolean }) => (
    <button title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`rounded-lg p-2 transition hover:bg-accent disabled:opacity-30 ${active ? "bg-accent text-cyan" : ""}`}>
      <I className="h-4 w-4" />
    </button>
  );
  const Primary = ({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-40">{children}</button>
  );
  const Ghost = ({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition hover:bg-accent disabled:opacity-40">{children}</button>
  );

  const panels: Record<string, React.ReactNode> = {
    restore: (
      <>
        <Primary onClick={quickRestore} disabled={!meta}><Wand2 className="h-4 w-4" />Quick Restore</Primary>
        <h4 className="pt-2 text-sm font-semibold">Scratch & Dust Removal</h4>
        {Slider({ k: "scratch", label: "Auto scratch detection", min: 0 })}
        <div className="rounded-xl border p-3 space-y-3">
          <div className="flex items-center justify-between text-sm"><span>Manual repair brush</span>
            <button disabled={!meta || !untransformed} onClick={() => { setBrush(!brush); setMode("single"); }} className={`rounded-lg px-3 py-1 text-xs ${brush ? "bg-gradient-brand text-primary-foreground" : "border"} disabled:opacity-40`}><Brush className="mr-1 inline h-3 w-3" />{brush ? "On" : "Off"}</button>
          </div>
          {!untransformed && <p className="text-xs text-muted-foreground">Reset rotation/flip to use the brush.</p>}
          <label className="block text-xs text-muted-foreground">Brush size {brushSize}<input type="range" min={3} max={80} value={brushSize} onChange={(e) => setBrushSize(+e.target.value)} className="w-full" /></label>
          <div className="grid grid-cols-2 gap-2">
            <Ghost onClick={applyBrush} disabled={!brush}>Repair</Ghost>
            <Ghost onClick={() => overlay.current?.getContext("2d")!.clearRect(0, 0, 99999, 99999)} disabled={!brush}>Clear</Ghost>
          </div>
          <Ghost onClick={() => apply({ mask: null })} disabled={!snap.mask}>Reset brush repairs</Ghost>
        </div>
        {Slider({ k: "denoise", label: "Noise reduction", min: 0 })}
      </>
    ),
    enhance: (
      <>
        {Slider({ k: "sharpness", label: "Sharpness", min: 0 })}
        {Slider({ k: "detail", label: "Detail enhancement", min: 0 })}
        {Slider({ k: "edge", label: "Edge enhancement", min: 0 })}
        {Slider({ k: "denoise", label: "Noise reduction", min: 0 })}
        {Slider({ k: "clarity", label: "Clarity", min: 0 })}
      </>
    ),
    color: (
      <>
        <Primary onClick={autoColor} disabled={!meta}><Palette className="h-4 w-4" />Auto Color Enhance</Primary>
        {Slider({ k: "saturation", label: "Saturation" })}
        {Slider({ k: "contrast", label: "Contrast" })}
        {Slider({ k: "brightness", label: "Brightness" })}
        {Slider({ k: "temperature", label: "Temperature" })}
        {Slider({ k: "tint", label: "Tint" })}
        {Slider({ k: "vibrance", label: "Vibrance" })}
        {isGray && <p className="rounded-lg border p-3 text-xs text-muted-foreground">This looks like a black & white photo — color sliders can't invent colors. Try Photo Colorization.</p>}
      </>
    ),
    face: (
      <>
        <Primary onClick={runFaceDetect} disabled={!meta}><ScanFace className="h-4 w-4" />Detect Faces</Primary>
        <p className="text-xs text-muted-foreground">{faces.length ? `${faces.length} face(s) detected.` : "No faces detected yet."} Enhancement lifts fine detail only — no smoothing, no identity changes.</p>
        {Slider({ k: "face", label: "Facial detail enhancement", min: 0 })}
        <label className="flex items-center justify-between text-sm">Highlight face regions<input type="checkbox" checked={showFaces} onChange={(e) => setShowFaces(e.target.checked)} /></label>
      </>
    ),
    colorize: (
      <>
        <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-xs">
          <p className="mb-1 font-semibold text-primary">AI-only feature</p>
          Colors produced by AI are estimates, not historically verified. Results will be labelled “AI-generated colors”.
        </div>
        {ai === null ? <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Checking AI configuration…</p>
          : ai.available ? <Primary onClick={colorize} disabled={!meta || aiBusy}>{aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Colorize with AI</Primary>
          : <div className="rounded-xl border p-3 text-xs text-muted-foreground"><Info className="mb-1 h-4 w-4 text-cyan" />No AI provider is configured, so colorization is unavailable. An administrator can add a Replicate, Hugging Face or custom restoration API key on the server to enable it. All other tools work locally.</div>}
        {aiColorized && <p className="rounded-lg bg-accent p-2 text-xs text-cyan">Current image contains AI-generated colors.</p>}
      </>
    ),
  };

  const workspace = (
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <div className="space-y-4 min-w-0">
        {!meta ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
            onClick={() => fileInput.current?.click()}
            className={`glass flex min-h-[60vh] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-primary shadow-glow" : ""}`}
          >
            {loading ? <Loader2 className="h-12 w-12 animate-spin text-cyan" /> : <ImagePlus className="h-14 w-14 text-cyan" />}
            <h3 className="mt-4 text-2xl font-bold">Drop your photo here</h3>
            <p className="mt-2 text-sm text-muted-foreground">or click to browse · or paste from clipboard (Ctrl/⌘ + V)</p>
            <p className="mt-4 text-xs text-muted-foreground">JPG · JPEG · PNG · WEBP · BMP — up to 50 MB</p>
          </div>
        ) : (
          <>
            <div className="glass flex flex-wrap items-center gap-1 rounded-2xl p-2">
              <Btn icon={Undo2} label="Undo" onClick={undo} disabled={!past.length} />
              <Btn icon={Redo2} label="Redo" onClick={redo} disabled={!future.length} />
              <Btn icon={RotateCcw} label="Reset" onClick={reset} />
              <span className="mx-1 h-6 w-px bg-border" />
              <Btn icon={ZoomOut} label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} />
              <span className="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
              <Btn icon={ZoomIn} label="Zoom in" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} />
              <Btn icon={Minimize2} label="Fit to screen" onClick={() => setZoom(1)} />
              <Btn icon={isFs ? Minimize2 : Maximize} label="Fullscreen" onClick={toggleFs} />
              <span className="mx-1 h-6 w-px bg-border" />
              <Btn icon={RotateCcw} label="Rotate left" onClick={() => { setBrush(false); apply({ t: { ...snap.t, rotate: snap.t.rotate - 90 } }); }} />
              <Btn icon={RotateCw} label="Rotate right" onClick={() => { setBrush(false); apply({ t: { ...snap.t, rotate: snap.t.rotate + 90 } }); }} />
              <Btn icon={FlipHorizontal} label="Flip horizontal" onClick={() => { setBrush(false); apply({ t: { ...snap.t, flipH: !snap.t.flipH } }); }} />
              <Btn icon={FlipVertical} label="Flip vertical" onClick={() => { setBrush(false); apply({ t: { ...snap.t, flipV: !snap.t.flipV } }); }} />
              <span className="mx-1 h-6 w-px bg-border" />
              <Btn icon={SplitSquareHorizontal} label="Slider comparison" active={mode === "slider"} onClick={() => { setMode("slider"); setBrush(false); }} />
              <Btn icon={Columns2} label="Side by side" active={mode === "side"} onClick={() => { setMode("side"); setBrush(false); }} />
              <Btn icon={Square} label="Restored only" active={mode === "single"} onClick={() => setMode("single")} />
              <div className="ml-auto flex items-center gap-2 pr-2 text-xs text-muted-foreground">
                {busy && <><Loader2 className="h-4 w-4 animate-spin text-cyan" />Processing…</>}
              </div>
            </div>

            <div ref={viewer} className="checker relative flex h-[72vh] overflow-auto rounded-3xl border p-4 data-[fs=true]:h-screen" data-fs={isFs}>
              <div className="m-auto flex w-full justify-center">
                {!procUrl || !origUrl ? <Loader2 className="h-10 w-10 animate-spin text-cyan" /> :
                  mode === "slider" ? <CompareSlider before={origUrl} after={procUrl} style={frameStyle()} className="rounded-xl" /> :
                  mode === "side" ? (
                    <div className="flex gap-3">
                      {[["ORIGINAL", origUrl], ["RESTORED", procUrl]].map(([l, u]) => (
                        <div key={l} className="relative" style={frameStyle(0.5)}>
                          <img src={u} alt={l} className="h-full w-full rounded-xl object-contain" />
                          <span className="glass absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-widest">{l}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="relative" style={frameStyle()}>
                      <img src={procUrl} alt="Restored" className="h-full w-full rounded-xl object-contain" draggable={false} />
                      {brush && untransformed && (
                        <canvas ref={overlay} width={meta.w} height={meta.h} className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                          onPointerDown={(e) => { painting.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }}
                          onPointerMove={(e) => painting.current && paint(e)} onPointerUp={() => (painting.current = false)} />
                      )}
                      {tab === "face" && showFaces && untransformed && faces.map((f, i) => (
                        <div key={i} className="pointer-events-none absolute rounded-lg border-2 border-cyan shadow-glow"
                          style={{ left: `${(f.x / meta.w) * 100}%`, top: `${(f.y / meta.h) * 100}%`, width: `${(f.w / meta.w) * 100}%`, height: `${(f.h / meta.h) * 100}%` }} />
                      ))}
                    </div>
                  )}
              </div>
            </div>

            <div className="glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-4 py-3 text-xs">
              <span className="max-w-[200px] truncate font-semibold">{meta.name}</span>
              <span className="text-muted-foreground">Dimensions: <b className="text-foreground">{meta.nw}×{meta.nh}</b>{meta.nw !== meta.w && ` (working ${meta.w}×${meta.h})`}</span>
              <span className="text-muted-foreground">Size: <b className="text-foreground">{fmtSize(meta.size)}</b></span>
              <span className="text-muted-foreground">Format: <b className="text-foreground">{meta.type}</b></span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 hover:bg-accent"><Upload className="h-3 w-3" />Replace</button>
                <button onClick={removeImage} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-destructive hover:bg-accent"><X className="h-3 w-3" />Remove</button>
              </div>
            </div>
          </>
        )}
      </div>

      <aside className="space-y-4">
        <div className="glass space-y-4 rounded-2xl p-4">
          <h3 className="font-semibold">{TABS.find((t) => t.id === tab)?.label}</h3>
          {panels[tab]}
        </div>
        <div className="glass space-y-3 rounded-2xl p-4">
          <h3 className="font-semibold">Export</h3>
          <input value={fname} onChange={(e) => setFname(e.target.value)} placeholder="File name" className="w-full rounded-lg border bg-input/20 px-3 py-2 text-sm" />
          <div className="grid grid-cols-3 gap-1">
            {(["png", "jpeg", "webp"] as const).map((f) => (
              <button key={f} onClick={() => setFmt(f)} className={`rounded-lg py-1.5 text-xs font-semibold uppercase ${fmt === f ? "bg-gradient-brand text-primary-foreground" : "border"}`}>{f === "jpeg" ? "jpg" : f}</button>
            ))}
          </div>
          {fmt !== "png" && <label className="block text-xs text-muted-foreground">Quality {quality}%<input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(+e.target.value)} className="w-full" /></label>}
          <select value={scale} onChange={(e) => setScale(+e.target.value)} className="w-full rounded-lg border bg-card px-3 py-2 text-sm">
            <option value={1}>Original resolution</option>
            <option value={2}>Enhanced 2× (high-quality upscale, not AI)</option>
          </select>
          <Primary onClick={downloadRestored} disabled={!meta || busy}><Download className="h-4 w-4" />Download Restored Image</Primary>
          <div className="grid grid-cols-2 gap-2">
            <Ghost onClick={downloadOriginal} disabled={!meta}>Original</Ghost>
            <Ghost onClick={exportComparison} disabled={!meta}>Comparison</Ghost>
          </div>
          {!settings.autoSave && <Ghost onClick={() => { saveHistory("saved"); toast.success("Saved to history."); }} disabled={!meta || !touched}>Save to history</Ghost>}
        </div>
      </aside>
    </div>
  );

  const kb = typeof window === "undefined" ? 0 : storageUsedKB();
  const dashboard = (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Total Images Processed", stats.processed], ["Images Restored", stats.restored], ["Recent Projects", history.length], ["Storage Used", `${kb} KB`]].map(([l, v]) => (
          <div key={l} className="glass rounded-2xl p-5"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 font-display text-3xl font-bold text-gradient">{v}</p></div>
        ))}
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Quick Actions</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([["Restore Old Photo", "restore", Wand2], ["Enhance Image", "enhance", Focus], ["Colorize Photo", "colorize", Sparkles], ["Remove Scratches", "restore", Brush]] as const).map(([l, t, I]) => (
            <button key={l} onClick={() => setTab(t)} className="glass group rounded-2xl p-5 text-left transition hover:shadow-glow">
              <I className="h-7 w-7 text-cyan transition group-hover:scale-110" /><p className="mt-3 font-semibold">{l}</p>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 font-semibold">Recent Activity</h3>
        {history.length === 0 ? <p className="glass rounded-2xl p-6 text-sm text-muted-foreground">No activity yet. Upload a photo to get started.</p> :
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {history.slice(0, 6).map((h) => (
              <div key={h.id} className="glass flex items-center gap-3 rounded-2xl p-3">
                <img src={h.after} alt="" className="h-14 w-14 rounded-lg object-cover" />
                <div className="min-w-0"><p className="truncate text-sm font-medium">{h.name}</p><p className="text-xs text-muted-foreground">{new Date(h.date).toLocaleString()}</p></div>
              </div>
            ))}
          </div>}
      </div>
    </div>
  );

  const historyView = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Saved in this browser only — clearing browser data removes this history.</p>
        <button disabled={!history.length} onClick={() => { setHistory([]); refresh(); toast.success("History cleared."); }} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm text-destructive disabled:opacity-40"><Trash2 className="h-4 w-4" />Clear all</button>
      </div>
      {history.length === 0 ? <p className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">No restorations yet.</p> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {history.map((h) => (
            <div key={h.id} className="glass rounded-2xl p-4">
              <div className="grid grid-cols-2 gap-2">
                <div><img src={h.before} alt="Original" className="aspect-square w-full rounded-lg object-cover" /><p className="mt-1 text-[10px] tracking-widest text-muted-foreground">ORIGINAL</p></div>
                <div><img src={h.after} alt="Restored" className="aspect-square w-full rounded-lg object-cover" /><p className="mt-1 text-[10px] tracking-widest text-cyan">RESTORED</p></div>
              </div>
              <p className="mt-3 truncate text-sm font-semibold">{h.name}</p>
              <p className="text-xs text-muted-foreground">{new Date(h.date).toLocaleString()} · <span className="text-cyan">{h.status}</span></p>
              {h.tools.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">{h.tools.join(", ")}</p>}
              <div className="mt-3 flex gap-2">
                <a href={h.after} download={`${h.name.replace(/\.[^.]+$/, "")}-thumb.jpg`} className="flex-1 rounded-lg border py-1.5 text-center text-xs hover:bg-accent">Download preview</a>
                <button onClick={() => { setHistory(history.filter((x) => x.id !== h.id)); refresh(); }} className="rounded-lg border px-3 text-destructive hover:bg-accent" aria-label="Delete"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>}
      <p className="text-xs text-muted-foreground">To keep storage light, history keeps small previews. Full-resolution files are saved when you download them.</p>
    </div>
  );

  const settingsView = (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-2 font-semibold">Preferences</h3>
        <Row label="Theme">
          <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as Settings["theme"] })} className="rounded-lg border bg-card px-2 py-1 text-sm"><option value="aurora">Aurora glow</option><option value="midnight">Midnight (flat)</option></select>
        </Row>
        <Row label="Default export format">
          <select value={settings.exportFormat} onChange={(e) => updateSettings({ exportFormat: e.target.value as Settings["exportFormat"] })} className="rounded-lg border bg-card px-2 py-1 text-sm"><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WEBP</option></select>
        </Row>
        <Row label={`Default quality (${settings.quality}%)`}><input type="range" min={40} max={100} value={settings.quality} onChange={(e) => updateSettings({ quality: +e.target.value })} /></Row>
        <Row label="Auto-save to history on download"><input type="checkbox" checked={settings.autoSave} onChange={(e) => updateSettings({ autoSave: e.target.checked })} /></Row>
      </div>
      <div className="glass rounded-2xl p-5">
        <h3 className="mb-2 font-semibold">Privacy</h3>
        <Row label="Keep restoration history"><input type="checkbox" checked={settings.saveHistory} onChange={(e) => updateSettings({ saveHistory: e.target.checked })} /></Row>
        <Row label="Clear processing history"><button onClick={() => { setHistory([]); localStorage.removeItem("pr-stats"); refresh(); toast.success("Cleared."); }} className="rounded-lg border px-3 py-1 text-sm text-destructive">Clear</button></Row>
        <p className="pt-3 text-xs text-muted-foreground">Images are processed entirely in your browser and never uploaded — except when you explicitly run an AI feature.</p>
      </div>
      <div className="glass rounded-2xl p-5 lg:col-span-2">
        <h3 className="mb-2 font-semibold">About Pixel Resurrect</h3>
        <p className="text-sm text-muted-foreground">Pixel Resurrect v1.0 — Bring Your Memories Back to Life. Local tools: dust & scratch removal, brush inpainting, sharpening, denoising, color restoration, face-region enhancement, transforms and export. AI colorization connects to a server-side provider when configured.</p>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${settings.theme === "aurora" ? "bg-aurora" : "bg-background"}`}>
      <input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
      <div className="flex">
        <aside className={`glass fixed inset-y-0 left-0 z-40 w-64 transform p-4 transition lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="mb-8 flex items-center justify-between"><Logo /><button className="lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
          <nav className="space-y-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${tab === t.id ? "bg-gradient-brand font-semibold text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <t.icon className="h-4 w-4" />{t.label}
              </button>
            ))}
          </nav>
          <Link to="/" className="absolute bottom-4 left-4 text-xs text-muted-foreground hover:text-foreground">← Back to home</Link>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-background/60 lg:hidden" onClick={() => setNavOpen(false)} />}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <button className="glass rounded-lg p-2 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <h1 className="text-2xl font-bold">{TABS.find((t) => t.id === tab)?.label}</h1>
          </div>
          {tab === "dashboard" ? dashboard : tab === "history" ? historyView : tab === "settings" ? settingsView : workspace}
        </main>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"><span className="text-sm">{label}</span>{children}</div>
);

