/**
 * Builds every GPU-side asset for the board once per canvas: the procedural PCB
 * maps, component marking textures and shared materials. Disposed on unmount.
 */
import * as THREE from "three";
import { getBoardLayout, type BoardLayout, type Part } from "../model/layout";
import { ensureFonts, resolveFontFamily } from "../textures/canvas";
import { paintBoard } from "../textures/paintBoard";
import { paintB2BTop, paintEpoxyTop, paintShieldTop, type TexturePair } from "../textures/markings";
import { canvasTextures, createMaterials, disposeMaterials, type Materials } from "./materials";

export interface TexSet {
  map: THREE.Texture;
  data: THREE.Texture;
}

export interface BoardAssets {
  layout: BoardLayout;
  board: TexSet;
  /** textured top materials keyed by part ref */
  tops: Map<string, THREE.MeshStandardMaterial>;
  materials: Materials;
  edge: THREE.MeshStandardMaterial;
  boardTop: THREE.MeshStandardMaterial;
  /**
   * three only honours envMapIntensity when material.envMap is set explicitly;
   * bind the studio environment to materials that want calmer reflections.
   */
  bindEnvironment: (env: THREE.Texture) => void;
  dispose: () => void;
}

const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function edgeTexture(): THREE.CanvasTexture {
  // Routed FR-4 edge: mask skins, glass-epoxy core and faint copper planes.
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9b9161";
  g.fillRect(0, 0, 8, 128);
  for (let i = 0; i < 10; i++) {
    const y = 8 + i * 11.2;
    g.fillStyle = i % 3 === 0 ? "rgba(150,110,60,0.55)" : "rgba(60,58,34,0.35)";
    g.fillRect(0, y, 8, 1.4);
  }
  g.fillStyle = "#123d2f";
  g.fillRect(0, 0, 8, 5);
  g.fillRect(0, 123, 8, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export async function createBoardAssets(gl: THREE.WebGLRenderer, isCancelled: () => boolean): Promise<BoardAssets | null> {
  const sans = resolveFontFamily("--font-plex-sans", "Arial, Helvetica, sans-serif");
  const mono = resolveFontFamily("--font-plex-mono", "Consolas, monospace");
  await ensureFonts([sans.split(",")[0], mono.split(",")[0]]);
  if (isCancelled()) return null;

  const layout = getBoardLayout();
  await yieldFrame();
  if (isCancelled()) return null;

  const maxTex = gl.capabilities.maxTextureSize;
  const nav = navigator as Navigator & { deviceMemory?: number };
  // 6144 px PCB maps (~210 MB with mips) only on discrete GPUs; 4096 (~95 MB) otherwise.
  let rendererName = "";
  try {
    const ctx = gl.getContext();
    const info = ctx.getExtension("WEBGL_debug_renderer_info");
    rendererName = info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  } catch {
    rendererName = "";
  }
  const integrated = /intel|swiftshader|llvmpipe|software|microsoft basic|mali|adreno|apple gpu|radeon\(tm\) graphics|vega \d+ graphics/i.test(rendererName);
  const rich = maxTex >= 8192 && (nav.deviceMemory ?? 8) >= 8 && !integrated;
  const width = Math.min(maxTex, rich ? 6144 : 4096);
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());

  performance.mark("board-explorer:paint-start");
  const boardCanvases = paintBoard(layout, width, sans);
  performance.measure("board-explorer:paint-board", "board-explorer:paint-start");
  const board = canvasTextures(boardCanvases.albedo, boardCanvases.data, aniso);
  await yieldFrame();
  if (isCancelled()) {
    board.map.dispose();
    board.data.dispose();
    return null;
  }

  const materials = createMaterials();
  const textures: THREE.Texture[] = [board.map, board.data];
  const tops = new Map<string, THREE.MeshStandardMaterial>();

  const topMaterial = (pairT: TexturePair, opts: { metal?: boolean; bump?: number; roughness?: number } = {}) => {
    const t = canvasTextures(pairT.albedo, pairT.data, aniso);
    textures.push(t.map, t.data);
    return new THREE.MeshStandardMaterial({
      map: t.map,
      roughnessMap: t.data,
      metalnessMap: t.data,
      bumpMap: t.data,
      bumpScale: opts.bump ?? 0.6,
      roughness: opts.roughness ?? 1,
      metalness: opts.metal ? 1 : 0,
      envMapIntensity: opts.metal ? 1 : 0.45,
    });
  };

  const markingFor = (p: Part): TexturePair | null => {
    switch (p.kind) {
      case "bga": {
        const inset = 0.6;
        return paintEpoxyTop(p.w - inset, p.h - inset, p.marking ?? [], mono, { pxPerMm: 44, pin1: true, logo: p.ref === "U1", seed: p.ref.length * 7 });
      }
      case "qfp":
        return paintEpoxyTop(p.w, p.h, p.marking ?? [], mono, { pxPerMm: 72, pin1: true, logo: true, seed: 5 });
      case "qfn":
        return paintEpoxyTop(p.w, p.h, p.marking ?? [], mono, { pxPerMm: p.w > 5 ? 72 : 64, pin1: true, seed: 9 });
      case "inductor":
        return paintEpoxyTop(p.w, p.h, p.marking ?? [], mono, { pxPerMm: 64, base: "#2c2d2f", ink: "#9a9c98", seed: 13 });
      case "tantalum":
        return paintEpoxyTop(p.w, p.h, p.marking ?? [], mono, { pxPerMm: 64, base: "#151617", ink: "#a8a69c", band: p.rot === 90 ? "top" : "left", seed: 17 });
      case "crystal":
        return paintEpoxyTop(p.w - 0.24, p.h - 0.24, p.w > 2.5 ? ["32.768", "Y3 K6"] : ["26.000", "B6K"], mono, {
          pxPerMm: 120,
          base: "#a4a6a2",
          ink: "#5f625f",
          metal: true,
        });
      case "shield":
        return paintShieldTop(p.w, p.h, mono);
      case "b2b":
        return paintB2BTop(p);
      default:
        return null;
    }
  };

  for (const p of layout.parts) {
    const pairT = markingFor(p);
    if (!pairT) continue;
    const metal = p.kind === "shield" || p.kind === "crystal";
    tops.set(p.ref, topMaterial(pairT, { metal, bump: p.kind === "shield" ? 1.2 : 0.5 }));
  }
  await yieldFrame();

  const edgeTex = edgeTexture();
  textures.push(edgeTex);
  const edge = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.78, metalness: 0 });

  const boardTop = new THREE.MeshStandardMaterial({
    map: board.map,
    roughnessMap: board.data,
    metalnessMap: board.data,
    bumpMap: board.data,
    bumpScale: 0.9,
    roughness: 1,
    metalness: 1,
    // keep the mask a deep green under the overhead softbox; pads still get the key-light glint
    envMapIntensity: 0.6,
  });

  // Upload big textures now so the first interactive frame does not hitch.
  gl.initTexture(board.map);
  gl.initTexture(board.data);

  performance.measure("board-explorer:assets-total", "board-explorer:paint-start");

  const dispose = () => {
    textures.forEach((t) => t.dispose());
    tops.forEach((m) => m.dispose());
    edge.dispose();
    boardTop.dispose();
    disposeMaterials(materials);
  };

  if (isCancelled()) {
    dispose();
    return null;
  }

  const bindEnvironment = (env: THREE.Texture) => {
    const set = (m: THREE.MeshStandardMaterial, k: number) => {
      m.envMap = env;
      m.envMapIntensity = k;
      m.needsUpdate = true;
    };
    set(boardTop, 0.6);
    set(materials.epoxy, 0.4);
    set(materials.epoxyGrey, 0.45);
    set(materials.lcp, 0.5);
    set(materials.substrate, 0.6);
    tops.forEach((mat, ref) => {
      if (!ref.startsWith("SH") && !ref.startsWith("Y")) set(mat, 0.4);
    });
  };

  return { layout, board, tops, materials, edge, boardTop, bindEnvironment, dispose };
}
