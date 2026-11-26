// OPT: 2.7 — Instantáneas incrementales con compartición estructural segura (y respaldo profundo si se desactiva)
import type { BoardSheet, CanvasObject, GroupRecord } from '../types/whiteboard';
import { safeRunOpt } from './optFlags';

export interface BoardHistorySnapshot {
  objects: CanvasObject[];
  groups: GroupRecord[];
  sheets?: BoardSheet[];
}

function deepCloneSnapshotFallback(
  objects: CanvasObject[],
  groups: GroupRecord[],
  sheets?: BoardSheet[]
): BoardHistorySnapshot {
  return JSON.parse(
    JSON.stringify({
      objects,
      groups,
      sheets,
    })
  ) as BoardHistorySnapshot;
}

/**
 * Captura una instantánea inmutable del tablero.
 * Cuando `incrementalHistory` está activo, reutiliza las referencias de objetos inmutables
 * (trazos, PDFs, imágenes, tablas) clonando solo las estructuras de arreglo y metadatos de grupo,
 * reduciendo el coste de CPU y memoria de O(N * tamaño_payload) a O(N).
 */
export function captureBoardHistorySnapshot(
  objects: CanvasObject[],
  groups: GroupRecord[],
  sheets?: BoardSheet[]
): BoardHistorySnapshot {
  return safeRunOpt(
    'incrementalHistory',
    () => ({
      objects: [...objects],
      groups: groups.map((g) => ({ ...g })),
      sheets: sheets ? sheets.map((s) => ({ ...s })) : undefined,
    }),
    () => deepCloneSnapshotFallback(objects, groups, sheets)
  );
}
