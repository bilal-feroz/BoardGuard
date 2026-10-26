"use client";

import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * Controlled inspection-bench lighting: a procedural studio environment made of
 * Lightformers (no HDR downloads), one soft key light with shadows and a
 * restrained hemispheric fill.
 */
export function StudioLights() {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 0, 0);
    return o;
  }, []);
  return (
    <>
      <Environment resolution={256} frames={1} environmentIntensity={0.9}>
        <color attach="background" args={["#161b1c"]} />
        {/* large overhead diffuser + a brighter core softbox */}
        <Lightformer form="rect" intensity={0.9} color="#eef0ec" position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 20, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#f6f3ec" position={[-1, 7, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 5, 1]} />
        {/* long strip lights left / right: give metal edges their highlights */}
        <Lightformer form="rect" intensity={3.2} color="#ffffff" position={[-7, 3.2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[9, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#e9f1f0" position={[7, 2.6, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[9, 1.0, 1]} />
        {/* front/back low strips for the rims of packages */}
        <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[0, 2, 8]} rotation={[0, 0, 0]} scale={[12, 0.8, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#dfe6e5" position={[0, 2.5, -8]} rotation={[0, Math.PI, 0]} scale={[12, 0.8, 1]} />
        {/* faint bench bounce */}
        <Lightformer form="rect" intensity={0.25} color="#33403f" position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[16, 16, 1]} />
      </Environment>
      <hemisphereLight args={["#e8eeed", "#0c1011", 0.22]} />
      <primitive object={target} />
      <directionalLight
        position={[-5.5, 9.5, 5.5]}
        intensity={1.55}
        color="#fff7ec"
        target={target}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={6.5}
        shadow-camera-bottom={-6.5}
        shadow-camera-near={2}
        shadow-camera-far={30}
        shadow-bias={-0.00008}
        shadow-normalBias={0.0025}
        shadow-radius={3}
      />
    </>
  );
}

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "#1b2426");
  grad.addColorStop(0.45, "#141b1c");
  grad.addColorStop(1, "#0e1314");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // faint engineering grid, very low contrast
  g.strokeStyle = "rgba(240,240,235,0.022)";
  g.lineWidth = 1;
  for (let i = 0; i <= 512; i += 16) {
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i + 0.5);
    g.lineTo(512, i + 0.5);
    g.stroke();
  }
  const fade = g.createRadialGradient(256, 256, 120, 256, 256, 256);
  fade.addColorStop(0, "rgba(14,19,20,0)");
  fade.addColorStop(1, "rgba(14,19,20,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Inspection bench: unlit radial falloff into the page background + soft contact shadow. */
export function Bench({ boardReady }: { boardReady: boolean }) {
  const tex = useMemo(() => radialTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const BENCH_Y = -0.38;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BENCH_Y, 0]}>
        <planeGeometry args={[44, 44]} />
        <meshBasicMaterial map={tex} toneMapped={false} depthWrite={false} />
      </mesh>
      {boardReady && <ContactShadows position={[0, BENCH_Y + 0.002, 0]} scale={[22, 14]} resolution={512} blur={2.6} far={1.2} opacity={0.75} frames={1} color="#000000" />}
      {/* four standoffs the board rests on */}
      {(
        [
          [-7.08, -3.58],
          [7.08, -3.58],
          [-7.08, 3.58],
          [6.06, 3.58],
        ] as const
      ).map(([x, z], i) => (
        <mesh key={i} position={[x, (BENCH_Y - 0.1) / 2, z]}>
          <cylinderGeometry args={[0.16, 0.18, Math.abs(BENCH_Y) - 0.1, 20]} />
          <meshStandardMaterial color="#8d9190" metalness={1} roughness={0.42} />
        </mesh>
      ))}
    </>
  );
}
