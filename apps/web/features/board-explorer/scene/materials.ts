import * as THREE from "three";

/** Shared PBR materials for components. Created once per canvas, disposed on unmount. */
export function createMaterials() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const m = {
    solder: std({ color: "#dcdcd7", metalness: 1, roughness: 0.22 }),
    tin: std({ color: "#cfd0cb", metalness: 1, roughness: 0.3 }),
    gold: std({ color: "#e4c27c", metalness: 1, roughness: 0.28 }),
    nickel: std({ color: "#b4b6b2", metalness: 1, roughness: 0.4 }),
    epoxy: std({ color: "#141516", metalness: 0, roughness: 0.6, envMapIntensity: 0.45 }),
    epoxyGrey: std({ color: "#26272a", metalness: 0, roughness: 0.64, envMapIntensity: 0.5 }),
    substrate: std({ color: "#2d3326", metalness: 0, roughness: 0.5 }),
    underfill: std({ color: "#b5a886", metalness: 0, roughness: 0.42 }),
    ceramic: std({ color: "#cfc6b0", metalness: 0, roughness: 0.7 }),
    // seam-welded crystal lid: duller than the shield so it doesn't read as white plastic
    lid: std({ color: "#9a9c98", metalness: 1, roughness: 0.48 }),
    silicon: new THREE.MeshPhysicalMaterial({
      color: "#1b1f28",
      metalness: 0.4,
      roughness: 0.14,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
    }),
    lcp: std({ color: "#1a1b1b", metalness: 0, roughness: 0.5, envMapIntensity: 0.55 }),
    // per-instance colour carries the body tint (MLCC tan / resistor black / ferrite grey)
    chipBody: std({ color: "#ffffff", metalness: 0, roughness: 0.58 }),
  };
  return m;
}

export type Materials = ReturnType<typeof createMaterials>;

export function disposeMaterials(m: Materials) {
  Object.values(m).forEach((mat) => mat.dispose());
}

/** Wrap a canvas pair as textures on a material (albedo sRGB, packed data linear). */
export function canvasTextures(albedo: HTMLCanvasElement, dataCanvas: HTMLCanvasElement, anisotropy: number) {
  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const dat = new THREE.CanvasTexture(dataCanvas);
  dat.colorSpace = THREE.NoColorSpace;
  dat.anisotropy = anisotropy;
  return { map, data: dat };
}
