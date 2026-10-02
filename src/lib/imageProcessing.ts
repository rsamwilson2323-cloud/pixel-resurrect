// @ts-nocheck -- hot pixel loops; typed-array indexing is bounds-safe by construction.
// Real pixel-level image processing on ImageData (Canvas API).

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  vibrance: number; // -100..100
  temperature: number; // -100..100
  tint: number; // -100..100
  sharpness: number; // 0..100
  detail: number; // 0..100
  edge: number; // 0..100
  clarity: number; // 0..100
  denoise: number; // 0..100
  scratch: number; // 0..100 auto dust/scratch removal strength
  face: number; // 0..100 face-region enhancement
}

export const DEFAULT_ADJ: Adjustments = {
  brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0,
  sharpness: 0, detail: 0, edge: 0, clarity: 0, denoise: 0, scratch: 0, face: 0,
};

export interface FaceBox { x: number; y: number; w: number; h: number }

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  if (r < 1) return new Uint8ClampedArray(src);
  const tmp = new Float32Array(src.length);
  const out = new Uint8ClampedArray(src.length);
  const d = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[(y * w + Math.min(w - 1, Math.max(0, i))) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / d;
        const a = Math.min(w - 1, x + r + 1), b = Math.max(0, x - r);
        sum += src[(y * w + a) * 4 + c] - src[(y * w + b) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += tmp[(Math.min(h - 1, Math.max(0, i)) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / d;
        const a = Math.min(h - 1, y + r + 1), b = Math.max(0, y - r);
        sum += tmp[(a * w + x) * 4 + c] - tmp[(b * w + x) * 4 + c];
      }
    }
  }
  for (let i = 3; i < src.length; i += 4) out[i] = src[i];
  return out;
}

function luma(d: Uint8ClampedArray, i: number) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Removes dust/scratches: pixels that deviate strongly from local median get replaced. */
function removeScratches(d: Uint8ClampedArray, w: number, h: number, strength: number) {
  const thr = 120 - strength; // lower threshold = more aggressive
  const src = new Uint8ClampedArray(d);
  const rv: number[] = [], gv: number[] = [], bv: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      rv.length = gv.length = bv.length = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const i = ((y + j) * w + x + k) * 4;
        rv.push(src[i]); gv.push(src[i + 1]); bv.push(src[i + 2]);
      }
      rv.sort((a, b) => a - b); gv.sort((a, b) => a - b); bv.sort((a, b) => a - b);
      const i = (y * w + x) * 4;
      const ml = 0.299 * rv[4] + 0.587 * gv[4] + 0.114 * bv[4];
      if (Math.abs(luma(src, i) - ml) > thr) { d[i] = rv[4]; d[i + 1] = gv[4]; d[i + 2] = bv[4]; }
    }
  }
}

/** Inpaints masked pixels via iterative diffusion from surrounding known pixels. */
export function inpaint(d: Uint8ClampedArray, w: number, h: number, mask: Uint8Array) {
  const unknown = new Uint8Array(mask);
  let remaining = 0;
  for (let i = 0; i < unknown.length; i++) if (unknown[i]) remaining++;
  let guard = 0;
  while (remaining > 0 && guard++ < 400) {
    const fill: [number, number, number, number][] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!unknown[p]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const yy = y + j, xx = x + k;
        if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
        const q = yy * w + xx;
        if (unknown[q]) continue;
        r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
      }
      if (n) fill.push([p, r / n, g / n, b / n]);
    }
    if (!fill.length) break;
    for (const [p, r, g, b] of fill) { d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = b; unknown[p] = 0; remaining--; }
  }
  // smoothing passes over the repaired zone
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      for (let c = 0; c < 3; c++) {
        d[p * 4 + c] = (d[(p - 1) * 4 + c] + d[(p + 1) * 4 + c] + d[(p - w) * 4 + c] + d[(p + w) * 4 + c]) / 4;
      }
    }
  }
}

function unsharp(d: Uint8ClampedArray, w: number, h: number, radius: number, amount: number, region?: FaceBox[]) {
  const blur = boxBlur(d, w, h, radius);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = amount;
    if (region) {
      let inside = 0;
      for (const f of region) {
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
        const dx = (x - cx) / (f.w * 0.65), dy = (y - cy) / (f.h * 0.75);
        const dist = dx * dx + dy * dy;
        if (dist < 1) inside = Math.max(inside, 1 - dist);
      }
      if (!inside) continue;
      a *= inside;
    }
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (d[i + c] - blur[i + c]) * a);
  }
}

export function process(
  original: ImageData,
  adj: Adjustments,
  mask: Uint8Array | null,
  faces: FaceBox[],
): ImageData {
  const { width: w, height: h } = original;
  const out = new ImageData(new Uint8ClampedArray(original.data), w, h);
  let d = out.data;

  if (mask) inpaint(d, w, h, mask);
  if (adj.scratch > 0) removeScratches(d, w, h, adj.scratch);

  if (adj.denoise > 0) {
    const r = Math.max(1, Math.round(adj.denoise / 35));
    const b = boxBlur(d, w, h, r);
    const t = adj.denoise / 130;
    for (let i = 0; i < d.length; i += 4) {
      // edge-preserving: blend less where difference is large
      const diff = Math.abs(luma(d, i) - (0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]));
      const k = t * Math.max(0, 1 - diff / 40);
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - k) + b[i + c] * k;
    }
  }

  const hasColor = adj.brightness || adj.contrast || adj.saturation || adj.vibrance || adj.temperature || adj.tint;
  if (hasColor) {
    const br = adj.brightness * 1.28;
    const cf = (259 * (adj.contrast * 1.28 + 255)) / (255 * (259 - adj.contrast * 1.28));
    const sat = 1 + adj.saturation / 100;
    const vib = adj.vibrance / 100;
    const temp = adj.temperature * 0.4, tint = adj.tint * 0.4;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + br + temp, g = d[i + 1] + br + tint, b = d[i + 2] + br - temp;
      r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const curSat = mx ? (mx - mn) / mx : 0;
      const s = sat + vib * (1 - curSat);
      d[i] = clamp(l + (r - l) * s); d[i + 1] = clamp(l + (g - l) * s); d[i + 2] = clamp(l + (b - l) * s);
    }
  }

  if (adj.clarity > 0) unsharp(d, w, h, Math.max(4, Math.round(Math.min(w, h) / 120)), adj.clarity / 160);
  if (adj.detail > 0) unsharp(d, w, h, 2, adj.detail / 80);
  if (adj.sharpness > 0) unsharp(d, w, h, 1, adj.sharpness / 45);
  if (adj.edge > 0) {
    const src = new Uint8ClampedArray(d);
    const k = adj.edge / 250;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const lap = 4 * src[i + c] - src[i - 4 + c] - src[i + 4 + c] - src[i - w * 4 + c] - src[i + w * 4 + c];
        d[i + c] = clamp(src[i + c] + lap * k);
      }
    }
  }
  if (adj.face > 0 && faces.length) {
    // subtle detail lift inside face ellipses; texture preserved (no smoothing)
    unsharp(d, w, h, 2, adj.face / 120, faces);
    unsharp(d, w, h, 1, adj.face / 200, faces);
  }
  d = out.data;
  return out;
}

/** Auto color: stretches levels per channel (1% clip) and returns suggested adjustments. */
export function autoColorAdjust(img: ImageData): Partial<Adjustments> {
  const d = img.data;
  let sum = 0, sumSat = 0, rs = 0, bs = 0;
  const n = d.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) {
    const l = luma(d, i); sum += l; hist[l | 0]++;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    sumSat += mx ? (mx - mn) / mx : 0; rs += d[i]; bs += d[i + 2];
  }
  const cnt = n / 4;
  const mean = sum / cnt, msat = sumSat / cnt;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cnt * 0.01) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > cnt * 0.01) break; }
  const range = hi - lo;
  return {
    brightness: Math.round(Math.max(-30, Math.min(30, (128 - mean) / 3))),
    contrast: Math.round(Math.max(0, Math.min(40, (200 - range) / 3))),
    saturation: msat < 0.05 ? 0 : Math.round(Math.max(0, Math.min(40, (0.35 - msat) * 100))),
    vibrance: msat < 0.05 ? 0 : 20,
    temperature: Math.round(Math.max(-25, Math.min(25, (bs - rs) / cnt / 3))),
  };
}

export const MAX_DIM = 2400;

export async function fileToImageData(file: File): Promise<{ data: ImageData; naturalW: number; naturalH: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), naturalW: img.naturalWidth, naturalH: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Transform { rotate: number; flipH: boolean; flipV: boolean }

export function renderToCanvas(img: ImageData, t: Transform, scale = 1): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = img.width; src.height = img.height;
  src.getContext("2d")!.putImageData(img, 0, 0);
  const rot = ((t.rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const w = Math.round((swap ? img.height : img.width) * scale);
  const h = Math.round((swap ? img.width : img.height) * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  ctx.drawImage(src, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  return c;
}

export function thumb(c: HTMLCanvasElement, max = 220): string {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  const t = document.createElement("canvas");
  t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.7);
}

export function isGrayscale(img: ImageData) {
  const d = img.data;
  let diff = 0, n = 0;
  for (let i = 0; i < d.length; i += 40) { diff += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); n++; }
  return diff / n < 6;
}

export async function detectFaces(img: ImageData): Promise<FaceBox[] | null> {
  // Uses the browser's built-in Shape Detection API where supported.
  const FD = (globalThis as unknown as { FaceDetector?: new (o: object) => { detect: (s: ImageBitmapSource) => Promise<{ boundingBox: DOMRectReadOnly }[]> } }).FaceDetector;
  if (!FD) return null;
  const bmp = await createImageBitmap(img);
  const res = await new FD({ fastMode: false, maxDetectedFaces: 20 }).detect(bmp);
  return res.map((r) => ({ x: r.boundingBox.x, y: r.boundingBox.y, w: r.boundingBox.width, h: r.boundingBox.height }));
}
