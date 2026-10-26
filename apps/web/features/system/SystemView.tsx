"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, fmtMs, KV, SectionTitle, Spinner } from "@/components/ui";
import { API_BASE, api, type Runtime } from "@/lib/api";
import { useStore } from "@/lib/store";

interface EvalMetric { name: string; value: number | string; unit?: string; note?: string }
interface EvalSection {
  id: string;
  title: string;
  method: string;
  data: string;
  metrics: EvalMetric[];
  table?: { columns: string[]; rows: (string | number)[][] };
  failures?: string[];
}
interface EvalResults { generated_at: string; opencv_version: string; environment: string; command: string; sections: EvalSection[] }
interface DatasetEntry { file: string; category: string; title: string; author: string; license: string; source_page_url: string; notes?: string }

function Card({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[6px] border border-line bg-panel p-4 ${className}`}>
      <SectionTitle right={right}>{title}</SectionTitle>
      {children}
    </section>
  );
}

export default function SystemView() {
  const [rt, setRt] = useState<Runtime | null>(null);
  const [rtErr, setRtErr] = useState<string | null>(null);
  const [policies, setPolicies] = useState<Awaited<ReturnType<typeof api.policies>>["data"] | null>(null);
  const [tools, setTools] = useState<Awaited<ReturnType<typeof api.tools>>["data"]["tools"]>([]);
  const [evalRes, setEval] = useState<EvalResults | null>(null);
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [probe, setProbe] = useState<{ state: "idle" | "running" | "done" | "error"; result?: Record<string, unknown>; ms?: number; env?: string | null; server?: string | null; err?: string }>({ state: "idle" });
  const fixtures = useStore((s) => s.fixtures);

  useEffect(() => {
    api.runtime().then((r) => setRt(r.data)).catch((e) => setRtErr(String(e.message ?? e)));
    api.policies().then((r) => setPolicies(r.data)).catch(() => {});
    api.tools().then((r) => setTools(r.data.tools)).catch(() => {});
    fetch("evaluation/results.json").then((r) => (r.ok ? r.json() : null)).then(setEval).catch(() => {});
    fetch("evaluation/datasets.json").then((r) => (r.ok ? r.json() : [])).then(setDatasets).catch(() => {});
  }, []);

  const runProbe = async () => {
    const fid = Object.keys(fixtures)[0];
    if (!fid) return;
    setProbe({ state: "running" });
    try {
      const img = await fetch(`${API_BASE}${fixtures[fid].url}`).then((r) => r.blob());
      const fd = new FormData();
      fd.append("file", img, `${fid}.jpg`);
      const t0 = performance.now();
      const res = await fetch(`${API_BASE}/api/vision/quality`, { method: "POST", body: fd });
      const ms = performance.now() - t0;
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? res.statusText);
      setProbe({ state: "done", result: { fixture: fid, verdict: body.quality.verdict, blur_metric: body.quality.metrics.blur_metric, glare_fraction: body.quality.metrics.glare_fraction, server_compute_ms: body.duration_ms, working_size: body.working_size.join("×") }, ms, env: res.headers.get("X-BoardGuard-Runtime"), server: res.headers.get("X-Process-Time-Ms") });
    } catch (e) {
      setProbe({ state: "error", err: String((e as Error).message) });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] gap-4 p-5 lg:grid-cols-3">
        <Card title="Processing runtime" right={rt ? <Badge tone="teal">live</Badge> : rtErr ? <Badge tone="coral">offline</Badge> : <Spinner />}>
          {rt ? (
            <>
              <KV k="Environment" v={rt.environment} tone={rt.environment.startsWith("aws") ? "teal" : undefined} />
              <KV k="OpenCV" v={`${rt.opencv_version} (${rt.opencv_package})`} tone="teal" />
              <KV k="OpenCV threads" v={rt.opencv_threads} />
              <KV k="NumPy / Python" v={`${rt.numpy_version} / ${rt.python_version}`} />
              <KV k="Machine" v={`${rt.machine} · ${rt.cpu_count} vCPU`} />
              <KV k="Platform" v={<span className="block max-w-[220px] truncate" title={rt.platform}>{rt.platform}</span>} />
              <KV k="Storage" v={rt.storage?.backend} />
              <KV k="Uptime" v={`${Math.round(rt.uptime_s)} s`} />
              <KV k="API base" v={API_BASE || "same origin"} />
              {rt.aws && Object.entries(rt.aws).map(([k, v]) => <KV key={k} k={`aws.${k}`} v={v ?? "—"} />)}
              <div className="mt-2 text-[10.5px] text-muted">
                <div className="label !text-[10px]">CPU dispatch (cv2 build)</div>
                <p className="mono mt-0.5 break-words">{rt.opencv_build?.dispatched_code_generation}</p>
              </div>
            </>
          ) : <p className="text-[12px] text-coral">{rtErr ?? "Loading…"}</p>}
        </Card>

        <Card title="Live processing probe" right={probe.state === "running" ? <Spinner /> : null}>
          <p className="text-[12px] leading-relaxed text-ink-2">
            Sends a recorded capture to <span className="mono">POST /api/vision/quality</span> and shows what the service computed and where it ran.
          </p>
          <Button className="mt-3" size="sm" onClick={runProbe} disabled={probe.state === "running" || !Object.keys(fixtures).length}>
            <Icon.Play size={12} /> Run probe
          </Button>
          {probe.state === "done" && probe.result && (
            <div className="enter mt-3">
              {Object.entries(probe.result).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}
              <KV k="round trip (browser)" v={fmtMs(probe.ms)} />
              <KV k="server time (header)" v={probe.server ? `${probe.server} ms` : "—"} />
              <KV k="X-BoardGuard-Runtime" v={probe.env ?? "—"} tone="teal" />
            </div>
          )}
          {probe.state === "error" && <p className="mt-3 text-[12px] text-coral">{probe.err}</p>}
        </Card>

        <Card title="Responsible operation">
          <ul className="space-y-2 text-[12px] leading-relaxed text-ink-2">
            <li>Candidates are <b className="font-medium text-ink">suspected visual anomalies</b> from classical OpenCV analysis. Evidence scores are heuristic, not probabilities.</li>
            <li>No photograph proves or excludes an electrical fault. Every finding ends with a technician decision; nothing is auto-cleared.</li>
            <li>Bad evidence is not analysed: the quality gate and region-level checks trigger recapture requests (max {policies?.max_recaptures ?? 2}) or a safe stop.</li>
            <li>Failed registration withholds overlays and change maps instead of showing misleading alignment.</li>
            <li>Software zoom is not optical magnification; lighting guidance is carried out physically by the technician.</li>
            <li>The 3D board is a representative model, not a scan of the imaged boards.</li>
          </ul>
        </Card>

        <Card title="Evaluation (reproducible)" className="lg:col-span-3" right={evalRes ? <span className="mono text-[10.5px] text-muted">{evalRes.generated_at} · OpenCV {evalRes.opencv_version} · {evalRes.environment}</span> : null}>
          {!evalRes ? <p className="text-[12px] text-muted">No evaluation results bundled. Run <span className="mono">python scripts/evaluate.py</span>.</p> : (
            <>
              <p className="mono mb-3 text-[11px] text-muted">Reproduce: {evalRes.command}</p>
              <div className="grid gap-4 lg:grid-cols-2">
                {evalRes.sections.map((s) => (
                  <div key={s.id} className="rounded-[4px] border border-line p-3">
                    <div className="text-[13px] font-medium">{s.title}</div>
                    <p className="mt-1 text-[11.5px] leading-snug text-muted">{s.method}</p>
                    <p className="mono mt-1 text-[10.5px] text-faint">{s.data}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-6">
                      {s.metrics.map((m) => <KV key={m.name} k={m.name} v={`${typeof m.value === "number" ? (Number.isInteger(m.value) ? m.value : m.value.toFixed(3)) : m.value}${m.unit ? ` ${m.unit}` : ""}`} title={m.note} />)}
                    </div>
                    {s.table && (
                      <div className="mt-2 max-h-56 overflow-auto">
                        <table className="w-full text-[11px]">
                          <thead><tr>{s.table.columns.map((c) => <th key={c} className="sticky top-0 bg-panel py-1 pr-2 text-left font-normal text-muted">{c}</th>)}</tr></thead>
                          <tbody>{s.table.rows.map((r, i) => <tr key={i} className="border-t border-line/70">{r.map((v, j) => <td key={j} className="mono py-1 pr-2 text-ink-2">{String(v)}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {s.failures && s.failures.length > 0 && (
                      <div className="mt-2">
                        <div className="label !text-[10px] !text-amber">Failure cases</div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] text-ink-2">{s.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="Agent tools" className="lg:col-span-2">
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-left text-muted"><th className="py-1 font-normal">Tool</th><th className="font-normal">Kind</th><th className="font-normal">Outputs</th></tr></thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.name} className="border-t border-line/70 align-top">
                  <td className="mono py-1.5 pr-3 text-ink">{t.name}</td>
                  <td className="mono pr-3 text-muted">{t.kind}</td>
                  <td className="py-1.5 text-ink-2">{Object.keys(t.outputs).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Decision rules">
          <ul className="space-y-1.5">
            {policies && Object.entries(policies.rules).map(([k, v]) => (
              <li key={k} className="text-[11.5px] leading-snug"><span className="mono mr-1.5 text-amber">{k}</span><span className="text-ink-2">{v}</span></li>
            ))}
          </ul>
        </Card>

        <Card title="Quality thresholds" >
          {policies && Object.entries(policies.quality_thresholds).map(([k, v]) => <KV key={k} k={k.replaceAll("_", " ")} v={String(v)} />)}
        </Card>
        <Card title="Registration criteria">
          {policies && Object.entries(policies.registration_criteria).map(([k, v]) => <KV key={k} k={k.replaceAll("_", " ")} v={Array.isArray(v) ? v.join("–") : String(v)} />)}
        </Card>
        <Card title="Candidate detector parameters">
          {policies && Object.entries(policies.candidate_params).map(([k, v]) => <KV key={k} k={k.replaceAll("_", " ")} v={String(v)} />)}
        </Card>

        <Card title="Image sources and licences" className="lg:col-span-3">
          {datasets.length === 0 ? <p className="text-[12px] text-muted">Dataset manifest not bundled.</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-[11.5px]">
                <thead><tr className="text-left text-muted">{["File", "Category", "Author", "Licence", "Notes"].map((h) => <th key={h} className="sticky top-0 bg-panel py-1 pr-3 font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {datasets.map((d) => (
                    <tr key={d.file} className="border-t border-line/70 align-top">
                      <td className="mono py-1.5 pr-3"><a className="text-ink hover:underline" href={d.source_page_url} target="_blank" rel="noreferrer">{d.file}</a></td>
                      <td className="mono pr-3 text-muted">{d.category}</td>
                      <td className="pr-3 text-ink-2">{d.author}</td>
                      <td className="mono pr-3 text-ink-2">{d.license}</td>
                      <td className="text-muted">{d.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
