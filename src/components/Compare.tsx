import { useRef, useState, type CSSProperties } from "react";

export function CompareSlider({ before, after, style, className = "" }: { before: string; after: string; style?: CSSProperties; className?: string }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={ref}
      style={style}
      className={`relative select-none touch-none overflow-hidden ${className}`}
      onPointerDown={(e) => { drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => drag.current && move(e.clientX)}
      onPointerUp={() => (drag.current = false)}
    >
      <img src={after} alt="Restored" className="block h-full w-full object-contain" draggable={false} />
      <img
        src={before}
        alt="Original"
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <span className="glass absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold tracking-widest">ORIGINAL</span>
      <span className="glass absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold tracking-widest text-cyan">RESTORED</span>
      <div className="absolute inset-y-0 w-0.5 bg-gradient-brand shadow-glow" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
          ⇆
        </div>
      </div>
    </div>
  );
}
