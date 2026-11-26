// OPT: 2.3 — Culling por caja delimitadora en el viewport + caché WeakMap de bounding box por objeto
import type { CanvasObject } from '../types/whiteboard';
import { isOptEnabled, safeRunOpt } from './optFlags';

export interface WorldBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface BBoxCacheEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  pad: number;
  box: WorldBBox;
}

const bboxWeakCache = new WeakMap<CanvasObject, BBoxCacheEntry>();

function computeObjectMargin(obj: CanvasObject): number {
  if (obj.type === 'stroke' || obj.type === 'line' || obj.type === 'shape') {
    return Math.max(24, (obj.strokeWidth || 2) * 2 + 24);
  }
  if (obj.type === 'dimension') {
    return 80;
  }
  return 28;
}

export function getCachedObjectBBox(obj: CanvasObject): WorldBBox {
  const rot = obj.rotation || 0;
  const pad = computeObjectMargin(obj);
  const existing = bboxWeakCache.get(obj);
  if (
    existing &&
    existing.x === obj.x &&
    existing.y === obj.y &&
    existing.w === obj.width &&
    existing.h === obj.height &&
    existing.rot === rot &&
    existing.pad === pad
  ) {
    return existing.box;
  }

  let box: WorldBBox;
  if (Math.abs(rot) < 1e-4) {
    box = {
      minX: obj.x - pad,
      minY: obj.y - pad,
      maxX: obj.x + obj.width + pad,
      maxY: obj.y + obj.height + pad,
    };
  } else {
    const cx = obj.x + obj.width * 0.5;
    const cy = obj.y + obj.height * 0.5;
    const halfDiag = Math.hypot(obj.width, obj.height) * 0.5 + pad;
    box = {
      minX: cx - halfDiag,
      minY: cy - halfDiag,
      maxX: cx + halfDiag,
      maxY: cy + halfDiag,
    };
  }

  bboxWeakCache.set(obj, {
    x: obj.x,
    y: obj.y,
    w: obj.width,
    h: obj.height,
    rot,
    pad,
    box,
  });
  return box;
}

export function filterVisibleObjectsInViewport(
  objects: CanvasObject[],
  viewport: { panX: number; panY: number; zoom: number },
  stageWidth: number,
  stageHeight: number,
  pinnedIds: Set<string>,
  bypassCulling = false
): CanvasObject[] {
  if (bypassCulling || objects.length <= 24 || stageWidth <= 0 || stageHeight <= 0) {
    return objects;
  }
  if (!isOptEnabled('viewportCulling')) {
    return objects;
  }

  return safeRunOpt(
    'viewportCulling',
    () => {
      const z = Math.max(0.05, viewport.zoom || 1);
      // Margen generoso de pre-carga fuera del viewport para evitar parpadeos en paneo rápido
      const overscanWorld = 180 / z;
      const viewMinX = -viewport.panX / z - overscanWorld;
      const viewMinY = -viewport.panY / z - overscanWorld;
      const viewMaxX = (-viewport.panX + stageWidth) / z + overscanWorld;
      const viewMaxY = (-viewport.panY + stageHeight) / z + overscanWorld;

      const visible: CanvasObject[] = [];
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (pinnedIds.has(obj.id)) {
          visible.push(obj);
          continue;
        }
        const b = getCachedObjectBBox(obj);
        if (b.maxX >= viewMinX && b.minX <= viewMaxX && b.maxY >= viewMinY && b.minY <= viewMaxY) {
          visible.push(obj);
        }
      }
      return visible;
    },
    () => objects
  );
}
