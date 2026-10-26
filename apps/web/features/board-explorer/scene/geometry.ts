/**
 * Geometry builders for components. All geometry is authored in millimetres;
 * the parts group is scaled to scene units once.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Moulded package body: vertical walls with a draft angle and a small top
 * chamfer that catches highlights. Group 0 = top face (UV 0..1, v=1 at -z),
 * group 1 = walls.
 */
export function moldedBody(w: number, d: number, y0: number, y1: number, draft = 0.06, chamfer = 0.06): THREE.BufferGeometry {
  const rings = [
    { y: y0, i: 0 },
    { y: y1 - chamfer, i: draft },
    { y: y1, i: draft + chamfer },
  ];
  const corner = (r: { y: number; i: number }, j: number): [number, number, number] => {
    const sx = j === 1 || j === 2 ? 1 : -1;
    const sz = j >= 2 ? 1 : -1;
    return [sx * (w / 2 - r.i), r.y, sz * (d / 2 - r.i)];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  const top = rings[rings.length - 1];
  const tw = w - 2 * top.i;
  const td = d - 2 * top.i;
  const pushTop = (p: [number, number, number]) => {
    pos.push(...p);
    uv.push((p[0] + tw / 2) / tw, 1 - (p[2] + td / 2) / td);
  };
  const c = [0, 1, 2, 3].map((j) => corner(top, j));
  [c[0], c[3], c[2], c[0], c[2], c[1]].forEach(pushTop);
  const topCount = 6;
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < 4; j++) {
      const b0 = corner(rings[k], j);
      const b1 = corner(rings[k], (j + 1) % 4);
      const t0 = corner(rings[k + 1], j);
      const t1 = corner(rings[k + 1], (j + 1) % 4);
      for (const p of [b0, t1, b1, b0, t0, t1]) {
        pos.push(...p);
        uv.push(0, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.addGroup(0, topCount, 0);
  g.addGroup(topCount, pos.length / 3 - topCount, 1);
  return g;
}

/**
 * Unit solder fillet / meniscus: x 0..1 (outward from the termination),
 * y 0..1 (height at the termination), z -0.5..0.5. Concave profile y = (1-x)^2.
 */
export function filletGeometry(segments = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const f = (x: number) => (1 - x) * (1 - x);
  const n = (x: number) => {
    const nx = 2 * (1 - x);
    const l = Math.hypot(nx, 1);
    return [nx / l, 1 / l, 0];
  };
  for (let i = 0; i < segments; i++) {
    const x0 = i / segments;
    const x1 = (i + 1) / segments;
    const A0 = [x0, f(x0), -0.5];
    const B0 = [x0, f(x0), 0.5];
    const A1 = [x1, f(x1), -0.5];
    const B1 = [x1, f(x1), 0.5];
    const n0 = n(x0);
    const n1 = n(x1);
    for (const [p, nn] of [
      [A0, n0],
      [B0, n0],
      [B1, n1],
      [A0, n0],
      [B1, n1],
      [A1, n1],
    ] as const) {
      pos.push(...p);
      nor.push(...nn);
    }
    // side caps
    const O = [0, 0];
    for (const z of [0.5, -0.5]) {
      const tri = z > 0 ? [O, [x1, f(x1)], [x0, f(x0)]] : [O, [x0, f(x0)], [x1, f(x1)]];
      for (const [x, y] of tri) {
        pos.push(x, y, z);
        nor.push(0, 0, z > 0 ? 1 : -1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Gull-wing lead for the QFP, in mm. x = 0 at the package body edge, pointing outward;
 * the foot rests on the board (y = 0) from x≈0.58 to x=1.0. Width 0.2 along z.
 */
export function gullWingGeometry(): THREE.BufferGeometry {
  const center: Array<[number, number]> = [
    [-0.12, 0.72],
    [0.14, 0.72],
    [0.27, 0.66],
    [0.36, 0.5],
    [0.43, 0.27],
    [0.5, 0.13],
    [0.6, 0.08],
    [0.74, 0.075],
    [1.0, 0.075],
  ];
  const t = 0.075;
  const up: Array<[number, number]> = [];
  const dn: Array<[number, number]> = [];
  for (let i = 0; i < center.length; i++) {
    const p = center[Math.max(0, i - 1)];
    const q = center[Math.min(center.length - 1, i + 1)];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy);
    const nx = -dy / l;
    const ny = dx / l;
    up.push([center[i][0] + nx * t, center[i][1] + ny * t]);
    dn.push([center[i][0] - nx * t, center[i][1] - ny * t]);
  }
  const shape = new THREE.Shape();
  up.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  for (let i = dn.length - 1; i >= 0; i--) shape.lineTo(dn[i][0], dn[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.1);
  g.computeVertexNormals();
  return g;
}

/** Rounded box, unit size, for instanced chips / terminations (scaled per instance). */
export function unitRoundedBox(radius = 0.12): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(1, 1, 1, 2, radius);
  g.translate(0, 0.5, 0); // origin at the bottom face
  return g;
}

export function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** Low-poly sphere for solder balls under BGAs / WLCSPs. */
export function ballGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.5, 10, 6);
}

/** Rounded-rectangle extrusion with a soft top bevel (RF shield lid). Group 0 = caps, 1 = walls/bevel. */
export function shieldGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const r = 0.6;
  const bevel = 0.22;
  const shape = new THREE.Shape();
  const x0 = -w / 2 + bevel;
  const z0 = -d / 2 + bevel;
  const x1 = w / 2 - bevel;
  const z1 = d / 2 - bevel;
  shape.moveTo(x0 + r, z0);
  shape.lineTo(x1 - r, z0);
  shape.quadraticCurveTo(x1, z0, x1, z0 + r);
  shape.lineTo(x1, z1 - r);
  shape.quadraticCurveTo(x1, z1, x1 - r, z1);
  shape.lineTo(x0 + r, z1);
  shape.quadraticCurveTo(x0, z1, x0, z1 - r);
  shape.lineTo(x0, z0 + r);
  shape.quadraticCurveTo(x0, z0, x0 + r, z0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel - 0.02,
    bevelOffset: 0,
    bevelSegments: 3,
    curveSegments: 6,
  });
  // Extrusion runs along +z; stand it up so +z(extrude) -> +y and shape y -> +z.
  g.rotateX(-Math.PI / 2);
  // after rotation: shape (x, y) -> (x, ?, -y); flip z back so shape y maps to +z
  g.scale(1, 1, -1);
  // flipping one axis inverts winding; restore it
  const idx = g.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
  } else {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const u = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      for (const attr of [p, u]) {
        const s = attr.itemSize;
        for (let k = 0; k < s; k++) {
          const a = attr.array[(i + 1) * s + k];
          (attr.array as Float32Array)[(i + 1) * s + k] = attr.array[(i + 2) * s + k];
          (attr.array as Float32Array)[(i + 2) * s + k] = a;
        }
      }
    }
  }
  g.translate(0, bevel, 0);
  return smoothLid(g, w, d);
}

/**
 * Re-mesh an extruded lid: drop the (never visible) bottom cap, keep the top cap
 * flat, and smooth the bevel + walls so the stamped edge reads as rounded metal.
 */
function smoothLid(src: THREE.BufferGeometry, w: number, d: number): THREE.BufferGeometry {
  const p = src.getAttribute("position") as THREE.BufferAttribute;
  const capEnd = src.groups.length ? src.groups[0].count : 0;
  const capPos: number[] = [];
  const wallPos: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    if (n.y < -0.9) continue; // bottom cap
    const target = i < capEnd && n.y > 0.9 ? capPos : wallPos;
    target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const build = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const pa = g.getAttribute("position") as THREE.BufferAttribute;
    const uvs = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) {
      uvs[i * 2] = pa.getX(i) / w + 0.5;
      uvs[i * 2 + 1] = 0.5 - pa.getZ(i) / d;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    const m = mergeVertices(g, 1e-4);
    m.computeVertexNormals();
    return m.toNonIndexed();
  };
  const cap = build(capPos);
  const wall = build(wallPos);
  const merged = mergeGeometries([cap, wall], true);
  cap.dispose();
  wall.dispose();
  src.dispose();
  return merged;
}
