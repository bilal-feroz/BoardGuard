// Minimal 1.5px-stroke icon set drawn for BoardGuard (no icon font, no sparkles).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Navigate: (p: P) => <Svg {...p}><path d="M3 2.5l9.5 4.2-4 1.3-1.4 4-4.1-9.5z" /></Svg>,
  Pan: (p: P) => <Svg {...p}><path d="M8 1.8v12.4M1.8 8h12.4M8 1.8L6.3 3.5M8 1.8l1.7 1.7M8 14.2l-1.7-1.7M8 14.2l1.7-1.7M1.8 8l1.7-1.7M1.8 8l1.7 1.7M14.2 8l-1.7-1.7M14.2 8l-1.7 1.7" /></Svg>,
  Select: (p: P) => <Svg {...p}><path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" /><path d="M6 8h4M8 6v4" opacity=".6" /></Svg>,
  Measure: (p: P) => <Svg {...p}><path d="M2 11.5l9.5-9.5 2.5 2.5L4.5 14z" /><path d="M5 9.5l1 1M7 7.5l1.5 1.5M9 5.5l1 1" /></Svg>,
  ZoomIn: (p: P) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14M5 7h4M7 5v4" /></Svg>,
  ZoomOut: (p: P) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14M5 7h4" /></Svg>,
  Fit: (p: P) => <Svg {...p}><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" /></Svg>,
  Layers: (p: P) => <Svg {...p}><path d="M8 2l6 3.2-6 3.2-6-3.2z" /><path d="M2 8.2l6 3.2 6-3.2M2 11l6 3.2 6-3.2" opacity=".7" /></Svg>,
  Eye: (p: P) => <Svg {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></Svg>,
  Image: (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 11l3.5-3.5 3 3L11 8l3 3" /></Svg>,
  Compare: (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M8 1.5v13" /><path d="M5 8H3.5M12.5 8H11" /></Svg>,
  Chip: (p: P) => <Svg {...p}><rect x="4" y="4" width="8" height="8" rx=".8" /><path d="M6 1.8V4M8 1.8V4M10 1.8V4M6 12v2.2M8 12v2.2M10 12v2.2M1.8 6H4M1.8 8H4M1.8 10H4M12 6h2.2M12 8h2.2M12 10h2.2" /></Svg>,
  Scope: (p: P) => <Svg {...p}><path d="M6 2h3l-.5 5h-2z" /><path d="M7.5 7v2.5" /><circle cx="7.5" cy="11" r="1.5" /><path d="M3 14.5h9M10.5 9.5a3.5 3.5 0 0 1-1.5 4.5" /></Svg>,
  Upload: (p: P) => <Svg {...p}><path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v3h11v-3" /></Svg>,
  Camera: (p: P) => <Svg {...p}><path d="M2 5h2.5l1.2-1.8h4.6L11.5 5H14v8H2z" /><circle cx="8" cy="9" r="2.4" /></Svg>,
  Download: (p: P) => <Svg {...p}><path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 13.5h11" /></Svg>,
  Report: (p: P) => <Svg {...p}><path d="M3.5 1.8h6l3 3v9.4h-9z" /><path d="M9.5 1.8v3h3M5.5 8h5M5.5 10.5h5M5.5 5.5h2" /></Svg>,
  Check: (p: P) => <Svg {...p}><path d="M3 8.5l3 3 7-7" /></Svg>,
  X: (p: P) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>,
  Alert: (p: P) => <Svg {...p}><path d="M8 2l6.3 11H1.7z" /><path d="M8 6.5v3M8 11.3v.2" /></Svg>,
  Diamond: (p: P) => <Svg {...p}><path d="M8 2l6 6-6 6-6-6z" /><path d="M8 5.5v3.2M8 10.6v.2" /></Svg>,
  Circle: (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.5" /></Svg>,
  Refresh: (p: P) => <Svg {...p}><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></Svg>,
  Play: (p: P) => <Svg {...p}><path d="M5 3l8 5-8 5z" /></Svg>,
  ChevronRight: (p: P) => <Svg {...p}><path d="M6 3.5L10.5 8 6 12.5" /></Svg>,
  ChevronDown: (p: P) => <Svg {...p}><path d="M3.5 6L8 10.5 12.5 6" /></Svg>,
  Info: (p: P) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v4M8 4.8v.2" /></Svg>,
  Cloud: (p: P) => <Svg {...p}><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.7-.6A3.1 3.1 0 0 0 4.5 12.5z" /></Svg>,
  Cpu: (p: P) => <Svg {...p}><rect x="3.5" y="3.5" width="9" height="9" rx="1" /><rect x="6" y="6" width="4" height="4" /><path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" /></Svg>,
  Trace: (p: P) => <Svg {...p}><circle cx="3.5" cy="4" r="1.5" /><circle cx="12.5" cy="8" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><path d="M5 4h3.5v8H5M8.5 8H11" /></Svg>,
  Light: (p: P) => <Svg {...p}><circle cx="8" cy="7" r="3.2" /><path d="M6.5 12.5h3M7 14.5h2M8 1.2v.8M2.5 7h-.8M14.3 7h-.8M3.9 2.9l.6.6M12.1 2.9l-.6.6" /></Svg>,
  Focus: (p: P) => <Svg {...p}><circle cx="8" cy="8" r="2.2" /><path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" /></Svg>,
  Hand: (p: P) => <Svg {...p}><path d="M5 8.5V3.8a1 1 0 0 1 2 0V7.5M7 7V2.8a1 1 0 0 1 2 0V7M9 7V3.6a1 1 0 0 1 2 0V8.5M11 6.2a1 1 0 0 1 2 0v3.3a5 5 0 0 1-5 5h-.5A4.5 4.5 0 0 1 3.3 12L1.9 9.6a1 1 0 0 1 1.7-1L5 10" /></Svg>,
  Stop: (p: P) => <Svg {...p}><rect x="3.5" y="3.5" width="9" height="9" rx="1" /></Svg>,
};
