"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";
import { apiUrl } from "@/lib/api";
import { useStore } from "@/lib/store";

const ACCEPT = "image/jpeg,image/png,image/webp,image/bmp,image/tiff";

export function FixtureOption({ fixtureId, hint }: { fixtureId: string; hint?: string }) {
  const fx = useStore((s) => s.fixtures[fixtureId]);
  const submitFixture = useStore((s) => s.submitFixture);
  const busy = useStore((s) => s.busy);
  if (!fx) return null;
  return (
    <button
      type="button"
      disabled={!!busy}
      onClick={() => submitFixture(fixtureId)}
      className="group flex w-full items-stretch gap-3 rounded-[4px] border border-line bg-panel-2/60 p-2 text-left transition-colors hover:border-line-strong hover:bg-raised disabled:opacity-50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={apiUrl(fx.url)} alt="" className="h-14 w-20 shrink-0 rounded-[2px] border border-line object-cover" loading="lazy" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink">{fx.label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-2">{hint}</span>}
        <span className="mono mt-1 block truncate text-[10px] uppercase tracking-[0.05em] text-muted">
          {fx.synthetic ? "Synthetic fixture" : "Recorded image"} · {fx.license ?? "see provenance"}
        </span>
      </span>
      <Icon.ChevronRight className="mt-1 shrink-0 text-muted group-hover:text-ink" />
    </button>
  );
}

export function UploadButton({ label = "Upload image" }: { label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const submitFile = useStore((s) => s.submitFile);
  const busy = useStore((s) => s.busy);
  return (
    <>
      <Button size="sm" disabled={!!busy} onClick={() => input.current?.click()}>
        <Icon.Upload size={14} /> {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Choose an image file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) submitFile(f, f.name, "upload");
          e.target.value = "";
        }}
      />
    </>
  );
}

export function CameraButton() {
  const [open, setOpen] = useState(false);
  const busy = useStore((s) => s.busy);
  return (
    <>
      <Button size="sm" disabled={!!busy} onClick={() => setOpen(true)}>
        <Icon.Camera size={14} /> Camera
      </Button>
      {open && <CameraModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CameraModal({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const submitFile = useStore((s) => s.submitFile);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr("This browser does not expose camera access (a secure https or localhost origin is required).");
        return;
      }
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (video.current) video.current.srcObject = stream;
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
        setErr(null);
      } catch (e) {
        const name = (e as DOMException).name;
        setErr(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in the browser, or upload an image instead."
          : name === "NotFoundError" ? "No camera or USB microscope was found. Connect one, or upload an image instead."
            : `Camera unavailable (${name}).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (b) {
        submitFile(b, `camera-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.jpg`, "camera");
        onClose();
      }
    }, "image/jpeg", 0.92);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Live camera capture" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-3xl rounded-[6px] border border-line-strong bg-panel shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div>
            <div className="text-[13px] font-medium">Live capture</div>
            <div className="text-[11.5px] text-muted">USB microscopes appear as cameras. The frame is sent to the vision API for analysis.</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink"><Icon.X /></button>
        </div>
        <div className="canvas-grid relative aspect-video">
          {err ? <div className="absolute inset-0 grid place-items-center p-8 text-center text-[13px] text-amber">{err}</div>
            : <video ref={video} autoPlay playsInline muted className="h-full w-full object-contain" />}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <select aria-label="Camera device" className="mono h-8 max-w-[60%] rounded-[4px] border border-line bg-panel-2 px-2 text-[11.5px] text-ink-2" value={deviceId ?? ""} onChange={(e) => setDeviceId(e.target.value || undefined)}>
            <option value="">Default camera</option>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!!err} onClick={capture}><Icon.Camera size={14} /> Capture frame</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
