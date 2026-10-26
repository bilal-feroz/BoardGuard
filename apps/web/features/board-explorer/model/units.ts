import { BOARD_SIZE_MM } from "@/lib/regions";

/**
 * Scene units. Everything in the layout model is authored in millimetres
 * (origin top-left of the board, +x right, +y "down" the board drawing).
 * In 3D, 1 unit = 10 mm, the board lies in the XZ plane, top surface at y = 0,
 * centred on the origin. Board drawing +y maps to world +z (towards the
 * default camera).
 */
export const MM = 0.1;

export const BOARD_W = BOARD_SIZE_MM.width; // mm
export const BOARD_H = BOARD_SIZE_MM.height; // mm
export const BOARD_T = BOARD_SIZE_MM.thickness; // mm

export const WORLD_W = BOARD_W * MM;
export const WORLD_H = BOARD_H * MM;
export const WORLD_T = BOARD_T * MM;

/** Board-mm (x, y) to world (x, z). */
export function mmToWorld(xMm: number, yMm: number): [number, number] {
  return [(xMm - BOARD_W / 2) * MM, (yMm - BOARD_H / 2) * MM];
}

/** Normalised region coords (u, v) to world (x, z). */
export function uvToWorld(u: number, v: number): [number, number] {
  return [(u - 0.5) * WORLD_W, (v - 0.5) * WORLD_H];
}
