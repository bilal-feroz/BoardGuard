"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { BoardRegion } from "@/lib/regions";
import { uvToWorld, WORLD_H, WORLD_T, WORLD_W } from "../model/units";

/** Overview: controlled three-quarter view. Focus: near top-down (~14 deg tilt), board "up" stays up. */
const OVERVIEW = { azimuth: 0.36, polar: 0.9, fill: 0.86 };
const FOCUS = { azimuth: 0.0, polar: 0.245, fill: 0.84 };
const FLIGHT_S = { focus: 1.35, overview: 1.2 };

interface Pose {
  target: THREE.Vector3;
  radius: number;
  azimuth: number;
  polar: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function dirFromSpherical(azimuth: number, polar: number) {
  return new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
}

/**
 * Distance + target that frame an axis-aligned box from a fixed view direction,
 * centring the projected box (two refinement passes for perspective asymmetry).
 */
function framePose(box: THREE.Box3, azimuth: number, polar: number, fovDeg: number, aspect: number, fill: number): Pose {
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * fill;
  const tanH = tanV * aspect;
  const dir = dirFromSpherical(azimuth, polar);
  const F = dir.clone().negate();
  const worldUp = Math.abs(F.y) > 0.999 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const R = new THREE.Vector3().crossVectors(F, worldUp).normalize();
  const U = new THREE.Vector3().crossVectors(R, F).normalize();
  const corners: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  }
  const target = box.getCenter(new THREE.Vector3());
  let d = 1;
  for (let pass = 0; pass < 3; pass++) {
    d = 0;
    for (const c of corners) {
      const q = c.clone().sub(target);
      const x = q.dot(R);
      const y = q.dot(U);
      const z = q.dot(F);
      d = Math.max(d, Math.abs(y) / tanV - z, Math.abs(x) / tanH - z);
    }
    // measure the projected bounds and recentre
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const q = c.clone().sub(target);
      const depth = d + q.dot(F);
      const nx = q.dot(R) / depth;
      const ny = q.dot(U) / depth;
      minX = Math.min(minX, nx);
      maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny);
      maxY = Math.max(maxY, ny);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    target.addScaledVector(R, cx * d).addScaledVector(U, cy * d);
    // keep the orbit pivot on the board plane
    const t = -target.y / F.y;
    if (Number.isFinite(t) && Math.abs(F.y) > 0.2) target.addScaledVector(F, t);
  }
  return { target, radius: d, azimuth, polar };
}

export function regionBox(r: BoardRegion): THREE.Box3 {
  const [x0, z0] = uvToWorld(r.u - r.w / 2, r.v - r.h / 2);
  const [x1, z1] = uvToWorld(r.u + r.w / 2, r.v + r.h / 2);
  return new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0.08, z1));
}

const BOARD_BOX = new THREE.Box3(new THREE.Vector3(-WORLD_W / 2, -WORLD_T, -WORLD_H / 2), new THREE.Vector3(WORLD_W / 2, 0.12, WORLD_H / 2));

interface Flight {
  from: Pose;
  to: Pose;
  start: number;
  duration: number;
  id: string | null;
}

export function CameraRig({
  regions,
  focusId,
  reducedMotion,
  onFocusSettled,
}: {
  regions: BoardRegion[];
  focusId: string | null;
  reducedMotion: boolean;
  onFocusSettled?: (id: string | null) => void;
}) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const flight = useRef<Flight | null>(null);
  const pendingSettle = useRef<{ id: string | null } | null>(null);
  const userMoved = useRef(false);
  const mounted = useRef(false);
  const settledCb = useRef(onFocusSettled);
  useEffect(() => {
    settledCb.current = onFocusSettled;
  }, [onFocusSettled]);
  useControlsBoundary();

  const poseFor = useCallback(
    (id: string | null): Pose => {
      const aspect = Math.max(0.2, size.width / Math.max(1, size.height));
      const region = id ? regions.find((r) => r.id === id) : undefined;
      if (region) return framePose(regionBox(region), FOCUS.azimuth, FOCUS.polar, camera.fov, aspect, FOCUS.fill);
      return framePose(BOARD_BOX, OVERVIEW.azimuth, OVERVIEW.polar, camera.fov, aspect, OVERVIEW.fill);
    },
    [regions, size.width, size.height, camera],
  );

  const apply = useCallback(
    (p: Pose) => {
      const c = controls.current;
      if (!c) return;
      const pos = dirFromSpherical(p.azimuth, p.polar).multiplyScalar(p.radius).add(p.target);
      c.setLookAt(pos.x, pos.y, pos.z, p.target.x, p.target.y, p.target.z, false);
      invalidate();
    },
    [invalidate],
  );

  const currentPose = useCallback((): Pose | null => {
    const c = controls.current;
    if (!c) return null;
    const target = c.getTarget(new THREE.Vector3());
    const pos = c.getPosition(new THREE.Vector3());
    const off = pos.sub(target);
    const sph = new THREE.Spherical().setFromVector3(off);
    return { target, radius: sph.radius, azimuth: sph.theta, polar: sph.phi };
  }, []);

  // Focus changes: fly (or cut) to the new pose.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const to = poseFor(focusId);
    userMoved.current = false;
    if (!mounted.current) {
      mounted.current = true;
      apply(to);
      if (focusId) pendingSettle.current = { id: focusId };
      return;
    }
    const from = currentPose();
    if (reducedMotion || !from) {
      flight.current = null;
      c.enabled = true;
      apply(to);
      pendingSettle.current = { id: focusId };
      invalidate();
      return;
    }
    c.enabled = false;
    flight.current = {
      from,
      to,
      start: performance.now(),
      duration: (focusId ? FLIGHT_S.focus : FLIGHT_S.overview) * 1000,
      id: focusId,
    };
    invalidate();
    // poseFor intentionally excluded: resizes are handled below without a flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, reducedMotion]);

  // Resizes re-frame the current mode instantly unless the user has taken over the camera.
  useEffect(() => {
    if (!mounted.current || flight.current || userMoved.current) return;
    apply(poseFor(focusId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useFrame(() => {
    const f = flight.current;
    if (f) {
      const u = Math.min(1, (performance.now() - f.start) / f.duration);
      const t = easeInOutCubic(u);
      let dAz = f.to.azimuth - f.from.azimuth;
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz)); // shortest way round, never a spin
      apply({
        target: f.from.target.clone().lerp(f.to.target, t),
        radius: Math.exp(THREE.MathUtils.lerp(Math.log(f.from.radius), Math.log(f.to.radius), t)),
        azimuth: f.from.azimuth + dAz * t,
        polar: THREE.MathUtils.lerp(f.from.polar, f.to.polar, t),
      });
      if (u >= 1) {
        flight.current = null;
        if (controls.current) controls.current.enabled = true;
        pendingSettle.current = { id: f.id };
      }
      invalidate();
      return;
    }
    if (pendingSettle.current) {
      // fire after the settled pose has actually been rendered once
      const { id } = pendingSettle.current;
      pendingSettle.current = null;
      requestAnimationFrame(() => settledCb.current?.(id));
    }
  }, -2);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minPolarAngle={0}
      maxPolarAngle={1.2}
      minDistance={0.9}
      maxDistance={42}
      smoothTime={0.16}
      draggingSmoothTime={0.08}
      dollyToCursor
      infinityDolly={false}
      boundaryFriction={0.2}
      onStart={() => {
        userMoved.current = true;
      }}
    />
  );
}

/** Keep the orbit pivot over the bench so the board can't be panned out of view. */
export function useControlsBoundary() {
  const controls = useThree((s) => s.controls) as CameraControls | null;
  useEffect(() => {
    if (!controls || !("setBoundary" in controls)) return;
    controls.setBoundary(new THREE.Box3(new THREE.Vector3(-WORLD_W * 0.62, -0.2, -WORLD_H * 0.7), new THREE.Vector3(WORLD_W * 0.62, 0.6, WORLD_H * 0.7)));
  }, [controls]);
}
