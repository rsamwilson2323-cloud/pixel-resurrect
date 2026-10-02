import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Sparkles, Wand2, Palette, ScanFace, Eraser, Focus, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { CompareSlider } from "@/components/Compare";
import showcase from "@/assets/showcase.jpg";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pixel Resurrect — Image Restoration Studio" },
      { name: "description", content: "Restore damaged, faded and blurry photos in your browser. Bring your memories back to life." },
      { property: "og:title", content: "Pixel Resurrect — Image Restoration Studio" },
      { property: "og:description", content: "Restore damaged, faded and blurry photos in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Eraser, title: "Scratch Removal", text: "Auto dust detection plus a manual repair brush with inpainting." },
  { icon: Focus, title: "Sharpening", text: "Sharpness, detail, edge, clarity and noise reduction controls." },
  { icon: Palette, title: "Color Restoration", text: "Revive faded tones with auto color and fine-grained sliders." },
  { icon: ScanFace, title: "Face Enhancement", text: "Detects faces and lifts detail without smoothing identity away." },
  { icon: Wand2, title: "Colorization", text: "AI colorization ready to connect — clearly labelled as AI." },
  { icon: Sparkles, title: "Private by Default", text: "Everything is processed locally in your browser." },
];

function Particles() {
  const [ps, setPs] = useState<{ l: number; d: number; s: number; delay: number }[]>([]);
  useEffect(() => {
    setPs(Array.from({ length: 40 }, () => ({ l: Math.random() * 100, d: 8 + Math.random() * 14, s: 2 + Math.random() * 3, delay: Math.random() * -20 })));
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {ps.map((p, i) => (
        <span
          key={i}
          className="particle absolute bottom-0 rounded-sm bg-gradient-brand"
          style={{ left: `${p.l}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }}
        />
      ))}
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-aurora">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Logo />
        <Link to="/studio" className="rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
          Open Studio
        </Link>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2">
        <Particles />
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="relative">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full glass px-4 py-1 text-xs tracking-widest text-cyan">
            <Sparkles className="h-3 w-3" /> BRING YOUR MEMORIES BACK TO LIFE.
          </p>
          <h1 className="text-5xl font-bold leading-tight md:text-6xl">
            Every Memory Deserves a <span className="text-gradient">Second Life.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Restore damaged photographs, recover lost details, enhance faces, and bring faded memories back to life with intelligent image restoration.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/studio" search={{ tab: "restore" }} className="inline-flex items-center gap-2 rounded-full bg-gradient-brand px-6 py-3 font-semibold text-primary-foreground shadow-glow transition hover:scale-105">
              Restore Your Photo <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#features" className="glass rounded-full px-6 py-3 font-semibold transition hover:bg-accent">Explore Features</a>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-gradient-brand opacity-30 blur-3xl" />
          <div className="relative overflow-hidden rounded-3xl glass p-2 shadow-glow">
            <ShowcaseCompare />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">Sample showcase — drag the handle to compare.</p>
        </motion.div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="mb-10 text-center text-3xl font-bold md:text-4xl">A full restoration <span className="text-gradient">toolkit</span></h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }} className="glass rounded-2xl p-6 transition hover:shadow-glow">
              <f.icon className="mb-4 h-8 w-8 text-cyan" />
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">© 2026 Pixel Resurrect</footer>
    </div>
  );
}

/** Generates an aged version of the showcase photo on a canvas for the "before" side. */
function ShowcaseCompare() {
  const [before, setBefore] = useState<string>(showcase);
  useEffect(() => {
    const img = new Image();
    img.src = showcase;
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.filter = "sepia(0.8) blur(1.5px) contrast(0.7) brightness(1.1)";
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 50;
        d.data[i] = (d.data[i] ?? 0) + n; d.data[i + 1] = (d.data[i + 1] ?? 0) + n; d.data[i + 2] = (d.data[i + 2] ?? 0) + n;
      }
      ctx.putImageData(d, 0, 0);
      ctx.strokeStyle = "rgba(255,250,235,0.8)";
      for (let k = 0; k < 14; k++) {
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        const x = Math.random() * c.width;
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + 60, c.height / 3, x - 60, (2 * c.height) / 3, x + Math.random() * 80, c.height);
        ctx.stroke();
      }
      setBefore(c.toDataURL("image/jpeg", 0.85));
    };
  }, []);
  return <CompareSlider before={before} after={showcase} className="aspect-[10/7] rounded-2xl" />;
}
