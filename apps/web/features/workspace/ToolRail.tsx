"use client";

import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useStore } from "@/lib/store";

export default function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const layers = useStore((s) => s.layers);
  const toggle = useStore((s) => s.toggleLayer);
  const canvasMode = useStore((s) => s.canvasMode);
  const setCanvasMode = useStore((s) => s.setCanvasMode);
  const showOriginal = useStore((s) => s.showOriginal);
  const setShowOriginal = useStore((s) => s.setShowOriginal);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const session = useStore((s) => s.session);
  const hasObs = !!session?.observations.length;
  const micro = canvasMode === "microscope" && hasObs;

  return (
    <nav aria-label="Inspection tools" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
      <IconButton label="Board view" shortcut="B" active={canvasMode === "board"} onClick={() => setCanvasMode("board")}><Icon.Chip /></IconButton>
      <IconButton label="Microscope view" shortcut="B" active={micro} disabled={!hasObs} onClick={() => setCanvasMode("microscope")}><Icon.Scope /></IconButton>
      <div className="my-1.5 h-px w-6 bg-line" />
      <IconButton label="Navigate · pan, zoom, select" shortcut="V" active={tool === "navigate"} disabled={!micro} onClick={() => setTool("navigate")}><Icon.Navigate /></IconButton>
      <IconButton label="Measure · px, or mm once calibrated" shortcut="M" active={tool === "measure"} disabled={!micro} onClick={() => setTool(tool === "measure" ? "navigate" : "measure")}><Icon.Measure /></IconButton>
      <IconButton label="Region evidence check · drag an area" shortcut="R" active={tool === "region"} disabled={!micro} onClick={() => setTool(tool === "region" ? "navigate" : "region")}><Icon.Select /></IconButton>
      <div className="my-1.5 h-px w-6 bg-line" />
      <IconButton label="Candidate annotations" shortcut="C" active={layers.candidates} disabled={!micro} onClick={() => toggle("candidates")}><Icon.Focus /></IconButton>
      <IconButton label="Specular glare mask" shortcut="G" active={layers.glare} disabled={!micro} onClick={() => toggle("glare")}><Icon.Light /></IconButton>
      <IconButton label="Unusable image tiles" shortcut="T" active={layers.tiles} disabled={!micro} onClick={() => toggle("tiles")}><Icon.Layers /></IconButton>
      <IconButton label="Corrosion cue mask" active={layers.corrosionMask} disabled={!micro} onClick={() => toggle("corrosionMask")}>
        <span className="mono text-[10px]">Cr</span>
      </IconButton>
      <IconButton label="Metallic (solder) mask" active={layers.metalMask} disabled={!micro} onClick={() => toggle("metalMask")}>
        <span className="mono text-[10px]">Sn</span>
      </IconButton>
      <div className="my-1.5 h-px w-6 bg-line" />
      <IconButton label="View original image (hide overlays)" shortcut="O" active={showOriginal} disabled={!micro} onClick={() => setShowOriginal(!showOriginal)}><Icon.Eye /></IconButton>
      <IconButton label="Before / after comparison" disabled={!session?.verification} onClick={() => setWorkspace("verify")}><Icon.Compare /></IconButton>
    </nav>
  );
}
