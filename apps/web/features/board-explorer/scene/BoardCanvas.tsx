"use client";

/**
 * The WebGL part of the explorer. Imported only on the client via next/dynamic
 * (see ../BoardExplorer.tsx) because the app is statically exported.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { uvToWorld } from "../model/units";
import type { BoardExplorerProps } from "../types";
import { createBoardAssets, type BoardAssets } from "./assets";
import { BoardModel } from "./BoardModel";
import { CameraRig } from "./CameraRig";
import { RegionLabels, type LabelRegistry } from "./RegionLabels";
import { RegionOverlays } from "./RegionOverlays";
import { Bench, StudioLights } from "./Studio";

export interface BoardCanvasProps extends Omit<
  BoardExplorerProps,
  "className"
> {
  reducedMotion: boolean;
  onReady?: () => void;
  onContextLost?: () => void;
}

/** The scene and key light never move, so render the shadow map once instead of every frame. */
function bakeShadowsOnce(gl: THREE.WebGLRenderer) {
  gl.shadowMap.autoUpdate = false;
  gl.shadowMap.needsUpdate = true;
}

function useAssets(onReady?: () => void) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [assets, setAssets] = useState<BoardAssets | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: BoardAssets | null = null;
    createBoardAssets(gl, () => cancelled)
      .then((a) => {
        if (!a) return;
        if (cancelled) {
          a.dispose();
          return;
        }
        created = a;
        setAssets(a);
        invalidate();
      })
      .catch((err) =>
        console.error("[board-explorer] asset generation failed", err),
      );
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [gl, invalidate]);

  // Static scene + static key light: bake the shadow map once per asset set.
  useEffect(() => {
    if (!assets) return;
    bakeShadowsOnce(gl);
    invalidate();
    const id = requestAnimationFrame(() => {
      // a couple of frames for the environment + contact shadows, then reveal
      invalidate();
      requestAnimationFrame(() => onReady?.());
    });
    return () => cancelAnimationFrame(id);
  }, [assets, gl, invalidate, onReady]);
  return assets;
}

interface SceneProps extends BoardCanvasProps {
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  registry: LabelRegistry;
}

function Scene(props: SceneProps) {
  const {
    regions,
    statuses,
    selectedId,
    focusId,
    onSelect,
    onFocusSettled,
    reducedMotion,
    onReady,
    hoveredId,
    onHover,
    registry,
  } = props;
  const assets = useAssets(onReady);
  // Picking: map the actual surface point under the pointer (board or the top of
  // a component) to a region by its board-plane footprint. Precise at any angle.
  const regionAt = useMemo(() => {
    const rects = regions.map((r) => {
      const [x0, z0] = uvToWorld(r.u - r.w / 2, r.v - r.h / 2);
      const [x1, z1] = uvToWorld(r.u + r.w / 2, r.v + r.h / 2);
      return { id: r.id, x0, z0, x1, z1 };
    });
    return (x: number, z: number) => rects.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)?.id ?? null;
  }, [regions]);
  const lastHover = useRef<string | null>(null);
  const hover = (id: string | null) => {
    if (lastHover.current === id) return;
    lastHover.current = id;
    onHover(id);
  };
  return (
    <>
      <StudioLights />
      <Bench boardReady={!!assets} />
      {assets && (
        <group
          onPointerMove={(e) => {
            e.stopPropagation();
            hover(regionAt(e.point.x, e.point.z));
          }}
          onPointerOut={() => hover(null)}
          onClick={(e) => {
            e.stopPropagation();
            if (e.delta > 5) return; // that was an orbit drag, not a click
            onSelect(regionAt(e.point.x, e.point.z)); // bare board -> null
          }}
        >
          <BoardModel assets={assets} />
        </group>
      )}
      <RegionOverlays
        regions={regions}
        statuses={statuses}
        selectedId={selectedId}
        focusId={focusId}
        hoveredId={hoveredId}
        registry={registry}
      />
      <CameraRig
        regions={regions}
        focusId={focusId}
        reducedMotion={reducedMotion}
        onFocusSettled={onFocusSettled}
      />
    </>
  );
}

export default function BoardCanvas(props: BoardCanvasProps) {
  const { regions, statuses, selectedId, focusId, onSelect, onContextLost } =
    props;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const onHover = useCallback((id: string | null) => setHoveredId(id), []);
  const registry = useRef(new Map<string, HTMLElement>());
  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        shadows="percentage"
        camera={{ fov: 30, near: 0.05, far: 200, position: [6, 11, 15] }}
        // alpha stays enabled: ContactShadows relies on a transparent clear of its render target
        gl={{
          antialias: true,
          stencil: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
          scene.background = new THREE.Color("#0e1314");
          const el = gl.domElement;
          el.setAttribute("role", "img");
          el.setAttribute(
            "aria-label",
            "Interactive 3D model of a smartphone logic board with five inspection regions. Use the region list to select a region with the keyboard.",
          );
          el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            onContextLost?.();
          });
        }}
        onPointerMissed={(e) => {
          if (e.type === "click") onSelect(null);
        }}
        style={{ position: "absolute", inset: 0, cursor: hoveredId ? "pointer" : undefined }}
      >
        <Scene
          {...props}
          hoveredId={hoveredId}
          onHover={onHover}
          registry={registry}
        />
      </Canvas>
      <RegionLabels
        regions={regions}
        statuses={statuses}
        selectedId={selectedId}
        focusId={focusId}
        hoveredId={hoveredId}
        onSelect={onSelect}
        onHover={onHover}
        registry={registry}
      />
    </>
  );
}
