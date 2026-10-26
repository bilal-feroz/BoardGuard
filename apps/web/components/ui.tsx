"use client";

import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export type Tone = "neutral" | "teal" | "amber" | "coral" | "muted";

const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  teal: "text-teal",
  amber: "text-amber",
  coral: "text-coral",
  muted: "text-muted",
};

const toneBorder: Record<Tone, string> = {
  neutral: "border-line-strong",
  teal: "border-teal/50",
  amber: "border-amber/55",
  coral: "border-coral/55",
  muted: "border-line",
};

const toneGlyph: Record<Tone, ReactNode> = {
  neutral: <Icon.Circle size={10} />,
  teal: <Icon.Check size={10} />,
  amber: <Icon.Diamond size={10} />,
  coral: <Icon.Alert size={10} />,
  muted: <Icon.Circle size={10} />,
};

export function Badge({ tone = "neutral", children, glyph = true, className = "" }: { tone?: Tone; children: ReactNode; glyph?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] mono text-[10.5px] uppercase tracking-[0.06em] ${toneText[tone]} ${toneBorder[tone]} ${className}`}>
      {glyph && toneGlyph[tone]}
      {children}
    </span>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-ink text-bg hover:bg-white border-ink",
    secondary: "bg-transparent text-ink border-line-strong hover:border-muted hover:bg-raised",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-raised hover:text-ink",
    danger: "bg-transparent text-coral border-coral/50 hover:bg-coral-dim/40",
  }[variant];
  const s = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]";
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[4px] border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${v} ${s} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Tooltip({ label, children, side = "right", shortcut }: { label: string; children: ReactNode; side?: "right" | "bottom" | "top" | "left"; shortcut?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pos = {
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  }[side];
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} aria-describedby={open ? id : undefined}>
      {children}
      {open && (
        <span role="tooltip" id={id} className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-[3px] border border-line-strong bg-raised px-2 py-1 text-[11.5px] text-ink shadow-lg shadow-black/40 ${pos}`}>
          {label}
          {shortcut && <kbd className="mono ml-2 text-[10px] text-muted">{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
}

export function IconButton({ label, active, onClick, children, shortcut, side = "right", disabled }: { label: string; active?: boolean; onClick?: () => void; children: ReactNode; shortcut?: string; side?: "right" | "bottom" | "top" | "left"; disabled?: boolean }) {
  return (
    <Tooltip label={label} side={side} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`grid h-8 w-8 place-items-center rounded-[4px] border transition-colors duration-150 disabled:opacity-35 ${
          active ? "border-line-strong bg-raised text-ink" : "border-transparent text-muted hover:bg-panel-2 hover:text-ink"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pb-2">
      <h3 className="label">{children}</h3>
      {right}
    </div>
  );
}

export function KV({ k, v, tone, title }: { k: ReactNode; v: ReactNode; tone?: Tone; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]" title={title}>
      <span className="text-[12px] text-muted">{k}</span>
      <span className={`mono text-[12px] ${tone ? toneText[tone] : "text-ink-2"}`}>{v}</span>
    </div>
  );
}

export function Meter({ value, lo, hi, invert = false, label }: { value: number; lo: number; hi: number; invert?: boolean; label: string }) {
  // Horizontal gauge with marginal / reject thresholds marked. Higher = worse unless invert.
  const max = Math.max(hi * 1.6, value * 1.1, 1e-6);
  const pct = Math.min(100, (value / max) * 100);
  const loP = (lo / max) * 100;
  const hiP = (hi / max) * 100;
  const tone: Tone = invert ? (value < lo ? "coral" : value < hi ? "amber" : "teal") : value >= hi ? "coral" : value >= lo ? "amber" : "teal";
  const fill = { teal: "bg-teal", amber: "bg-amber", coral: "bg-coral", neutral: "bg-ink", muted: "bg-muted" }[tone];
  return (
    <div className="relative h-[5px] w-full rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`absolute left-0 top-0 h-full rounded-full ${fill} opacity-80`} style={{ width: `${pct}%` }} />
      <div className="absolute top-[-3px] h-[11px] w-px bg-amber/70" style={{ left: `${loP}%` }} />
      <div className="absolute top-[-3px] h-[11px] w-px bg-coral/80" style={{ left: `${hiP}%` }} />
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border-b border-line px-4 py-3.5 ${className}`}>{children}</section>;
}

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" fill="none" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}
