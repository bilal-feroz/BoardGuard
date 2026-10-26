"use client";

import { Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BoardRegion, RegionStatus } from "@/lib/regions";
import { uvToWorld } from "../model/units";
import { displayColor, statusOf } from "../status";
import type { LabelRegistry } from "./RegionLabels";

const LIFT = 0.0045; // 0.045 mm above the mask: no z-fighting, visually on the surface

interface RegionOverlayProps {
  region: BoardRegion;
  status: RegionStatus;
  selected: boolean;
  hovered: boolean;
  focused: boolean;
}

const RegionOverlay = memo(function RegionOverlay({
  region,
  status,
  selected,
  hovered,
  focused,
}: RegionOverlayProps) {
  const [x0, z0] = uvToWorld(region.u - region.w / 2, region.v - region.h / 2);
  const [x1, z1] = uvToWorld(region.u + region.w / 2, region.v + region.h / 2);
  const color = displayColor(status, selected);
  const emphasis = selected || hovered || focused;
  const baseOpacity = status === "unvisited" && !selected ? 0.5 : 0.85;
  const outline = useMemo(
    () =>
      [
        [x0, LIFT, z0],
        [x1, LIFT, z0],
        [x1, LIFT, z1],
        [x0, LIFT, z1],
        [x0, LIFT, z0],
      ] as [number, number, number][],
    [x0, x1, z0, z1],
  );
  const brackets = useMemo(() => {
    const L = Math.min(0.32, (x1 - x0) * 0.22, (z1 - z0) * 0.22);
    const y = LIFT * 1.2;
    return [
      [
        [x0, y, z0 + L],
        [x0, y, z0],
        [x0 + L, y, z0],
      ],
      [
        [x1 - L, y, z0],
        [x1, y, z0],
        [x1, y, z0 + L],
      ],
      [
        [x1, y, z1 - L],
        [x1, y, z1],
        [x1 - L, y, z1],
      ],
      [
        [x0 + L, y, z1],
        [x0, y, z1],
        [x0, y, z1 - L],
      ],
    ] as [number, number, number][][];
  }, [x0, x1, z0, z1]);

  const fillGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [x0, x1, z0, z1]);
  useEffect(() => () => fillGeo.dispose(), [fillGeo]);

  return (
    <group>
      {(selected || hovered) && (
        <mesh
          geometry={fillGeo}
          position={[(x0 + x1) / 2, LIFT * 0.8, (z0 + z1) / 2]}
          renderOrder={1}
        >
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.07 : 0.045}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      <Line
        points={outline}
        color={color}
        lineWidth={emphasis ? 1.4 : 1}
        transparent
        opacity={emphasis ? 0.95 : baseOpacity * 0.75}
        toneMapped={false}
        depthWrite={false}
      />
      {brackets.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color={color}
          lineWidth={emphasis ? 3 : 2.2}
          transparent
          opacity={emphasis ? 1 : baseOpacity}
          toneMapped={false}
          depthWrite={false}
        />
      ))}
    </group>
  );
});

export function RegionOverlays({
  regions,
  statuses,
  selectedId,
  focusId,
  hoveredId,
  registry,
}: {
  regions: BoardRegion[];
  statuses: Record<string, RegionStatus>;
  selectedId: string | null;
  focusId: string | null;
  hoveredId: string | null;
  registry: LabelRegistry;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(
    () => invalidate(),
    [statuses, selectedId, focusId, hoveredId, regions, invalidate],
  );

  // Label anchors: the top-left corner of each region, slightly above the mask.
  const anchors = useMemo(
    () =>
      regions.map((r) => {
        const [x, z] = uvToWorld(r.u - r.w / 2, r.v - r.h / 2);
        return { id: r.id, p: new THREE.Vector3(x, LIFT, z) };
      }),
    [regions],
  );
  const tmp = useMemo(() => new THREE.Vector3(), []);
  // Runs after the camera rig + controls have updated the camera for this frame.
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      const el = registry.current.get(a.id);
      if (!el) continue;
      tmp.copy(a.p).project(camera);
      const visible = tmp.z < 1 && tmp.z > -1;
      const x = Math.round(((tmp.x + 1) / 2) * size.width);
      const y = Math.round(((1 - tmp.y) / 2) * size.height);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.visibility = visible ? "visible" : "hidden";
    }
  });

  return (
    <group>
      {regions.map((r) => (
        <RegionOverlay
          key={r.id}
          region={r}
          status={statusOf(statuses, r.id)}
          selected={selectedId === r.id}
          hovered={hoveredId === r.id}
          focused={focusId === r.id}
        />
      ))}
    </group>
  );
}
