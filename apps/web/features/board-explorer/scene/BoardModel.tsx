"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BOARD_OUTLINE, MOUNTING_HOLES } from "../model/outline";
import type { Part } from "../model/layout";
import { BOARD_H, BOARD_T, BOARD_W, MM } from "../model/units";
import type { BoardAssets } from "./assets";
import { ballGeometry, filletGeometry, gullWingGeometry, moldedBody, shieldGeometry, unitBox, unitRoundedBox } from "./geometry";
import { buildInstances, type Xf } from "./instances";

/** Board substrate: extruded outline with mounting holes, textured top, FR-4 edge. */
function Substrate({ assets }: { assets: BoardAssets }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    BOARD_OUTLINE.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    for (const h of MOUNTING_HOLES) {
      const hole = new THREE.Path();
      hole.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: BOARD_T, bevelEnabled: false, curveSegments: 20 });
    // shape (x, y) -> board (x, z); extrusion -> downward thickness
    g.rotateX(Math.PI / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (Math.abs(nor.getY(i)) > 0.5) {
        uv.setXY(i, x / BOARD_W, 1 - z / BOARD_H);
      } else {
        uv.setXY(i, (x + z) * 0.25, (y + BOARD_T) / BOARD_T);
      }
    }
    uv.needsUpdate = true;
    return g;
  }, []);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const materials = useMemo(() => [assets.boardTop, assets.edge], [assets]);
  return <mesh geometry={geometry} material={materials} receiveShadow castShadow />;
}

function InstancedSet({ geometry, material, items, castShadow = true }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: Xf[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.ry ?? 0, 0));
      m.compose(v.set(it.p[0], it.p[1], it.p[2]), q, s.set(it.s[0], it.s[1], it.s[2]));
      mesh.setMatrixAt(i, m);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow />;
}

function PackageBody({ part, assets, geometries }: { part: Part; assets: BoardAssets; geometries: Map<string, THREE.BufferGeometry> }) {
  const m = assets.materials;
  const top = assets.tops.get(part.ref);
  const geo = geometries.get(part.ref);
  if (!geo) return null;
  const pos: [number, number, number] = [part.x, 0, part.y];
  switch (part.kind) {
    case "bga":
      return (
        <group position={pos}>
          <mesh geometry={geometries.get(`${part.ref}:sub`)} material={m.substrate} castShadow receiveShadow />
          <mesh geometry={geo} material={[top ?? m.epoxy, m.epoxy]} castShadow receiveShadow />
        </group>
      );
    case "qfp":
    case "qfn":
    case "inductor":
    case "tantalum":
      return <mesh position={pos} geometry={geo} material={[top ?? m.epoxy, part.kind === "inductor" ? m.epoxyGrey : m.epoxy]} castShadow receiveShadow />;
    case "wlcsp":
      return <mesh position={pos} geometry={geo} material={m.silicon} castShadow receiveShadow />;
    case "crystal":
      return (
        <group position={pos}>
          <mesh geometry={geometries.get(`${part.ref}:base`)} material={m.ceramic} castShadow receiveShadow />
          <mesh geometry={geo} material={[top ?? m.lid, m.lid]} castShadow receiveShadow />
        </group>
      );
    case "b2b":
      return <mesh position={pos} rotation={[0, part.rot === 90 ? -Math.PI / 2 : 0, 0]} geometry={geo} material={[top ?? m.lcp, m.lcp]} castShadow receiveShadow />;
    case "shield":
      return <mesh position={[part.x, 0.02, part.y]} geometry={geo} material={[top ?? m.nickel, m.nickel]} castShadow receiveShadow />;
    default:
      return null;
  }
}

function usePartGeometries(parts: Part[]) {
  const geometries = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const p of parts) {
      switch (p.kind) {
        case "bga": {
          const sub = new THREE.BoxGeometry(p.w, 0.3, p.h);
          sub.translate(0, 0.22 + 0.15, 0);
          map.set(`${p.ref}:sub`, sub);
          map.set(p.ref, moldedBody(p.w - 0.6, p.h - 0.6, 0.52, p.height, 0.05, 0.06));
          break;
        }
        case "qfp":
          map.set(p.ref, moldedBody(p.w, p.h, 0.12, p.height, 0.1, 0.08));
          break;
        case "qfn":
          map.set(p.ref, moldedBody(p.w, p.h, 0.03, p.height, 0.02, 0.05));
          break;
        case "wlcsp":
          map.set(p.ref, moldedBody(p.w, p.h, 0.16, p.height, 0.0, 0.03));
          break;
        case "inductor": {
          const vertical = p.h > p.w;
          map.set(p.ref, moldedBody(vertical ? p.w : p.w - 0.1, vertical ? p.h - 0.1 : p.h, 0.0, p.height, 0.05, 0.1));
          break;
        }
        case "tantalum": {
          const vertical = p.rot === 90;
          map.set(p.ref, moldedBody(vertical ? p.w : p.w - 0.3, vertical ? p.h - 0.3 : p.h, 0.04, p.height, 0.14, 0.12));
          break;
        }
        case "crystal": {
          const base = new THREE.BoxGeometry(p.w, 0.2, p.h);
          base.translate(0, 0.1, 0);
          map.set(`${p.ref}:base`, base);
          map.set(p.ref, moldedBody(p.w - 0.24, p.h - 0.24, 0.2, p.height, 0.02, 0.06));
          break;
        }
        case "b2b": {
          const vertical = p.rot === 90;
          map.set(p.ref, moldedBody(vertical ? p.h : p.w, vertical ? p.w : p.h, 0.0, p.height, 0.05, 0.06));
          break;
        }
        case "shield":
          map.set(p.ref, shieldGeometry(p.w, p.h, p.height - 0.02));
          break;
        default:
          break;
      }
    }
    return map;
  }, [parts]);
  useLayoutEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  return geometries;
}

/**
 * three only honours envMapIntensity when material.envMap is set explicitly, so
 * once the procedural studio environment exists, bind it to materials that want
 * a calmer reflection (black epoxy, solder mask) than the scene default.
 */
function useEnvIntensities(assets: BoardAssets) {
  const done = useRef(false);
  useFrame(({ scene, invalidate }) => {
    if (done.current || !scene.environment) return;
    assets.bindEnvironment(scene.environment);
    done.current = true;
    invalidate();
  });
}

/** The complete board assembly, authored in millimetres and scaled into scene units. */
export function BoardModel({ assets }: { assets: BoardAssets }) {
  useEnvIntensities(assets);
  const { layout, materials: m } = assets;
  const sets = useMemo(() => buildInstances(layout), [layout]);
  const shared = useMemo(
    () => ({
      rounded: unitRoundedBox(0.14),
      box: unitBox(),
      fillet: filletGeometry(8),
      lead: gullWingGeometry(),
      ball: ballGeometry(),
    }),
    [],
  );
  useLayoutEffect(() => () => Object.values(shared).forEach((g) => g.dispose()), [shared]);
  const geometries = usePartGeometries(layout.parts);

  return (
    <group scale={MM} position={[(-BOARD_W / 2) * MM, 0, (-BOARD_H / 2) * MM]}>
      <Substrate assets={assets} />
      {layout.parts.map((p) => (
        <PackageBody key={p.ref} part={p} assets={assets} geometries={geometries} />
      ))}
      <InstancedSet geometry={shared.rounded} material={m.chipBody} items={sets.chipBodies} />
      <InstancedSet geometry={shared.rounded} material={m.tin} items={sets.chipTerms} />
      <InstancedSet geometry={shared.fillet} material={m.solder} items={sets.fillets} castShadow={false} />
      <InstancedSet geometry={shared.lead} material={m.tin} items={sets.leads} />
      <InstancedSet geometry={shared.ball} material={m.solder} items={sets.balls} castShadow={false} />
      <InstancedSet geometry={shared.box} material={m.nickel} items={sets.metal} />
      <InstancedSet geometry={shared.box} material={m.gold} items={sets.gold} castShadow={false} />
      <InstancedSet geometry={shared.fillet} material={m.underfill} items={sets.underfill} />
    </group>
  );
}
