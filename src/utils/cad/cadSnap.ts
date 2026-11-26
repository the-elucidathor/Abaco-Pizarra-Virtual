import type {
  CadConstraintGuide,
  CadDraftingConfig,
  CadResolvedCursor,
  CadSnapTarget,
  CadTrackingGuideLine,
  CadTrackingResolution,
} from '../../types/cad';
import type { CanvasObject, Point2D, ShapeObject } from '../../types/whiteboard';
import { localToWorld } from '../geometryCad';
import {
  cadDistToWorldDist,
  cadToWorld,
  worldDeltaToCadAngleDeg,
  worldToCad,
} from './cadCoords';
import {
  extractSnapGeometry,
  queryNearbyObjects,
  segmentIntersection,
} from './cadSpatialIndex';
import {
  type TrackingSessionState,
  buildSnappedSingleGuide,
  evaluateTrackingGuides,
} from './cadTracking';

export { extractSnapGeometry };

export function findNearestSegmentToPoint(
  pt: Point2D,
  objects: CanvasObject[],
  maxDistWorld: number
): [Point2D, Point2D] | null {
  const nearby = queryNearbyObjects(objects, pt, maxDistWorld + 20);
  const pool = extractSnapGeometry(nearby);
  let best: [Point2D, Point2D] | null = null;
  let bestDist = maxDistWorld;
  for (const seg of pool.segments) {
    const { a, b } = seg;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const d = Math.hypot(pt.x - projX, pt.y - projY);
    if (d < bestDist) {
      bestDist = d;
      best = [a, b];
    }
  }
  return best;
}

export function findObjectNearWorldPoint(
  pt: Point2D,
  objects: CanvasObject[],
  toleranceWorld: number
): CanvasObject | null {
  const nearby = queryNearbyObjects(objects, pt, toleranceWorld + 24);
  const pool = extractSnapGeometry(nearby);
  let bestObjId: string | null = null;
  let bestDist = toleranceWorld;

  for (const seg of pool.segments) {
    const { a, b, objectId } = seg;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
    const d = Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
    if (d < bestDist) {
      bestDist = d;
      bestObjId = objectId;
    }
  }

  if (bestObjId) {
    return nearby.find((o) => o.id === bestObjId) ?? null;
  }

  // Revisa figuras circulares/curvas o cajas delimitadoras de arriba hacia abajo en zIndex
  const sorted = [...nearby].sort((a, b) => b.zIndex - a.zIndex);
  for (const obj of sorted) {
    if (obj.type === 'dimension') continue;
    if (
      obj.type === 'shape' &&
      (obj.shapeKind === 'circle' ||
        obj.shapeKind === 'ellipse' ||
        obj.shapeKind === 'arc' ||
        obj.shapeKind === 'sphere')
    ) {
      const center = localToWorld({ x: obj.width / 2, y: obj.height / 2 }, obj);
      const rx = Math.max(
        4,
        obj.width / 2 - (obj.shapeKind === 'arc' ? 4 : obj.strokeWidth / 2 + 2)
      );
      const ry = Math.max(
        4,
        obj.height / 2 - (obj.shapeKind === 'arc' ? 4 : obj.strokeWidth / 2 + 2)
      );
      const normDist = Math.hypot((pt.x - center.x) / rx, (pt.y - center.y) / ry);
      if (
        Math.abs(normDist - 1) * Math.max(rx, ry) <= toleranceWorld * 1.4 ||
        (obj.fillColor !== 'transparent' && normDist <= 1)
      ) {
        return obj;
      }
    }
    if (
      pt.x >= obj.x - toleranceWorld &&
      pt.x <= obj.x + obj.width + toleranceWorld &&
      pt.y >= obj.y - toleranceWorld &&
      pt.y <= obj.y + obj.height + toleranceWorld
    ) {
      return obj;
    }
  }

  return null;
}

// Clasificación de herramientas soportadas por la resolución centralizada de puntos
export type HerramientaResolucionPunto =
  | 'line'
  | 'pline'
  | 'arrow'
  | 'measure'
  | 'rectangle'
  | 'triangle'
  | 'ellipse'
  | 'polygon'
  | 'shape'
  | 'circle'
  | 'arc'
  | 'free';

// Categoría geométrica interna para decidir qué restricciones aplican
export type CategoriaRestriccionHerramienta =
  | 'directional'
  | 'box-shape'
  | 'radial'
  | 'free';

// Estado de histéresis entre fotogramas para evitar parpadeos entre nodos, ángulos o guías de rastreo
export interface SnapHysteresisState {
  lastSnappedCad?: Point2D | null;
  lastSnappedSideWorld?: number | null;
  lastPolarAngleDeg?: number | null;
  lastPolarLenWorld?: number | null;
  lastTrackingGuideKey?: string | null;
  lastTrackingSecondKey?: string | null;
  lastTrackingDistWorld?: number | null;
}

export interface ResolverPuntoOpciones {
  config: CadDraftingConfig;
  viewport?: { panX: number; panY: number; zoom: number };
  stageRect?: { left: number; top: number } | null;
  // Si es true, puntoRaton ya viene en coordenadas del mundo; si es false, se convierte desde pantalla en el Paso 1
  isWorldInput?: boolean;
  visibleObjects: CanvasObject[];
  zoom?: number;
  shapeKind?: ShapeObject['shapeKind'];
  shiftKey?: boolean;
  // Permite incluir snapToGrid del tablero además de config.gridSnap
  gridSnapOverride?: boolean;
  hoverRefSegment?: [Point2D, Point2D] | null;
  // Estado mutable de histéresis entre movimientos consecutivos del cursor
  hysteresisState?: SnapHysteresisState | null;
  // Origen visual de la cuadrícula dentro del marco de hoja (p. ej. esquina superior izquierda del marco)
  gridOriginWorld?: Point2D | null;
  // Paso actual de la cuadrícula del tablero en px del mundo para alinear SNAP cuando coincide
  boardGridStepWorld?: number;
  // Estado mutable del rastreo de referencia (RAS)
  trackingState?: TrackingSessionState | null;
  // IDs de objetos a excluir (por ejemplo, el objeto que se está moviendo o editando por sus extremos)
  excludeObjectIds?: string[];
  // Marca de tiempo en ms para temporizador de adquisición (400 ms)
  nowMs?: number;
  // Callback opcional ante error en el cálculo de rastreo
  onTrackingError?: (error: unknown) => void;
}

const DIRECTIONAL_TOOLS = new Set<HerramientaResolucionPunto>([
  'line',
  'pline',
  'arrow',
  'measure',
]);

const BOX_SHAPE_TOOLS = new Set<HerramientaResolucionPunto>([
  'rectangle',
  'triangle',
  'ellipse',
  'polygon',
  'shape',
]);

// Figuras que siempre mantienen relación de aspecto 1:1 incluso sin ORT ni Shift
const FIXED_PROPORTION_SHAPES = new Set<ShapeObject['shapeKind']>([
  'square',
  'circle',
  'cube',
  'cube-wire',
  'sphere',
]);

// Clasifica si la herramienta usa restricciones direccionales (ORT H/V, SP polar) o de caja/proporción 1:1
export function clasificarHerramientaRestriccion(
  herramienta: HerramientaResolucionPunto,
  shapeKind?: ShapeObject['shapeKind']
): CategoriaRestriccionHerramienta {
  if (DIRECTIONAL_TOOLS.has(herramienta)) return 'directional';
  if (herramienta === 'circle' || herramienta === 'arc') return 'radial';
  if (BOX_SHAPE_TOOLS.has(herramienta)) {
    if (shapeKind === 'polyline') return 'directional';
    return 'box-shape';
  }
  return 'free';
}

// Aplica snap a una coordenada escalar con banda muerta de histéresis (evita oscilación en puntos medios)
function snapScalarWithHysteresis(
  rawVal: number,
  step: number,
  prevSnapped: number | null | undefined
): number {
  const safeStep = Math.max(1e-4, step);
  if (
    typeof prevSnapped === 'number' &&
    Number.isFinite(prevSnapped) &&
    Math.abs(rawVal - prevSnapped) <= 1.5 * safeStep
  ) {
    // Solo salta al siguiente nodo cuando el cursor supera claramente el 62% del paso hacia el vecino
    if (Math.abs(rawVal - prevSnapped) <= 0.62 * safeStep) {
      return prevSnapped;
    }
  }
  return Math.round(rawVal / safeStep) * safeStep;
}

// Busca el punto de referencia geométrica (RG / OSNAP) más cercano al cursor en coordenadas del mundo
function findBestOsnapTarget(
  rawWorld: Point2D,
  baseWorld: Point2D | null,
  visibleObjects: CanvasObject[],
  config: CadDraftingConfig,
  zoom: number,
  excludeObjectIds?: string[]
): CadSnapTarget | null {
  if (!config.osnapEnabled) return null;

  const snapRadius = 14 / Math.max(0.2, zoom);
  const queryRadius = baseWorld ? Math.max(snapRadius * 3, 180) : snapRadius * 3;
  const nearbyObjects = queryNearbyObjects(
    visibleObjects,
    rawWorld,
    queryRadius,
    excludeObjectIds
  );
  if (nearbyObjects.length === 0) return null;

  const pool = extractSnapGeometry(nearbyObjects);
  const holder: { target: CadSnapTarget | null; score: number } = {
    target: null,
    score: Infinity,
  };

  const consider = (cand: CadSnapTarget, priorityBias: number) => {
    const dist = Math.hypot(cand.point.x - rawWorld.x, cand.point.y - rawWorld.y);
    if (dist <= snapRadius) {
      const score = dist + priorityBias;
      if (score < holder.score) {
        holder.score = score;
        holder.target = cand;
      }
    }
  };

  if (config.osnapModes.endpoint) {
    for (const ep of pool.endpoints) {
      consider(
        {
          point: ep.point,
          kind: 'endpoint',
          label: 'Extremo',
          objectId: ep.objectId,
          refSegment: ep.seg,
        },
        0
      );
    }
  }

  if (config.osnapModes.intersection) {
    const margin = snapRadius * 2.5;
    const nearbySegs = pool.segments.filter(({ a, b }) => {
      const minX = Math.min(a.x, b.x) - margin;
      const maxX = Math.max(a.x, b.x) + margin;
      const minY = Math.min(a.y, b.y) - margin;
      const maxY = Math.max(a.y, b.y) + margin;
      return (
        rawWorld.x >= minX &&
        rawWorld.x <= maxX &&
        rawWorld.y >= minY &&
        rawWorld.y <= maxY
      );
    });
    for (let i = 0; i < nearbySegs.length; i++) {
      for (let j = i + 1; j < nearbySegs.length; j++) {
        const ix = segmentIntersection(
          nearbySegs[i].a,
          nearbySegs[i].b,
          nearbySegs[j].a,
          nearbySegs[j].b
        );
        if (ix) {
          consider(
            {
              point: ix,
              kind: 'intersection',
              label: 'Intersección',
              objectId: nearbySegs[i].objectId,
            },
            0.25
          );
        }
      }
    }
  }

  if (config.osnapModes.center) {
    for (const c of pool.centers) {
      consider(
        {
          point: c.point,
          kind: 'center',
          label: 'Centro',
          objectId: c.objectId,
        },
        0.45
      );
    }
  }

  if (config.osnapModes.quadrant) {
    for (const q of pool.quadrants) {
      consider(
        {
          point: q.point,
          kind: 'quadrant',
          label: 'Cuadrante',
          objectId: q.objectId,
        },
        0.55
      );
    }
  }

  if (config.osnapModes.midpoint) {
    for (const mp of pool.midpoints) {
      consider(
        {
          point: mp.point,
          kind: 'midpoint',
          label: 'Punto medio',
          objectId: mp.objectId,
          refSegment: mp.seg,
        },
        0.75
      );
    }
  }

  if (config.osnapModes.perpendicular && baseWorld) {
    for (const seg of pool.segments) {
      const { a, b, objectId } = seg;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-4) continue;
      const t = ((baseWorld.x - a.x) * dx + (baseWorld.y - a.y) * dy) / lenSq;
      if (t >= -0.02 && t <= 1.02) {
        const clampedT = Math.max(0, Math.min(1, t));
        const foot = { x: a.x + clampedT * dx, y: a.y + clampedT * dy };
        consider(
          {
            point: foot,
            kind: 'perpendicular',
            label: 'Perpendicular',
            objectId,
            refSegment: [a, b],
          },
          1.0
        );
      }
    }
  }

  return holder.target;
}

/**
 * Resuelve un punto ajustado sobre una guía de rastreo simple o intersección de dos guías.
 * Si SNAP está activo sobre una guía simple, cuantiza únicamente la distancia a lo largo de ella
 * sin despegar jamás el punto de la línea de rastreo.
 */
function resolvePointFromTracking(
  trackingRes: CadTrackingResolution,
  rawWorld: Point2D,
  config: CadDraftingConfig,
  gridSnapActivo: boolean,
  stepWorld: number,
  hyst: SnapHysteresisState | null | undefined,
  constraintBase?: { origin: Point2D; dir: Point2D; label: string; kind: 'ortho' | 'polar' } | null,
  tolWorld = 8
): {
  world: Point2D;
  snappedToGrid: boolean;
  tracking: CadTrackingResolution;
  extraGuide: CadConstraintGuide | null;
} | null {
  if (trackingRes.intersectionPoint) {
    if (hyst) {
      hyst.lastTrackingGuideKey = trackingRes.activeGuides[0]?.key ?? null;
      hyst.lastTrackingSecondKey = trackingRes.activeGuides[1]?.key ?? null;
      hyst.lastTrackingDistWorld = null;
    }
    return {
      world: { ...trackingRes.intersectionPoint },
      snappedToGrid: false,
      tracking: trackingRes,
      extraGuide: null,
    };
  }

  const guide: CadTrackingGuideLine | undefined = trackingRes.activeGuides[0];
  if (!guide || !trackingRes.snappedPoint) {
    if (hyst) {
      hyst.lastTrackingGuideKey = null;
      hyst.lastTrackingSecondKey = null;
      hyst.lastTrackingDistWorld = null;
    }
    return null;
  }

  // Si además hay una restricción ORT/SP activa, intenta intersectarla con la guía si pasa cerca
  if (constraintBase) {
    const denom = guide.dir.x * constraintBase.dir.y - guide.dir.y * constraintBase.dir.x;
    if (Math.abs(denom) > 0.05) {
      const rx = constraintBase.origin.x - guide.origin.x;
      const ry = constraintBase.origin.y - guide.origin.y;
      const t = (rx * constraintBase.dir.y - ry * constraintBase.dir.x) / denom;
      const ix = {
        x: guide.origin.x + t * guide.dir.x,
        y: guide.origin.y + t * guide.dir.y,
      };
      if (Math.hypot(ix.x - rawWorld.x, ix.y - rawWorld.y) <= tolWorld * 1.45) {
        const updatedGuide = buildSnappedSingleGuide(guide, ix, config);
        if (hyst) {
          hyst.lastTrackingGuideKey = guide.key;
          hyst.lastTrackingSecondKey = null;
          hyst.lastTrackingDistWorld = null;
        }
        return {
          world: ix,
          snappedToGrid: false,
          tracking: {
            ...trackingRes,
            activeGuides: [updatedGuide],
            snappedPoint: ix,
          },
          extraGuide: {
            kind: constraintBase.kind,
            angleDeg: Math.round(
              worldDeltaToCadAngleDeg(
                ix.x - constraintBase.origin.x,
                ix.y - constraintBase.origin.y,
                config
              )
            ),
            from: constraintBase.origin,
            to: ix,
            label: constraintBase.label,
          },
        };
      }
    }
  }

  // Proyección sobre la guía simple (si SNAP está activo, cuantiza únicamente la distancia sobre la guía)
  const dx = rawWorld.x - guide.origin.x;
  const dy = rawWorld.y - guide.origin.y;
  const signedDist = dx * guide.dir.x + dy * guide.dir.y;
  let finalDist = signedDist;
  let snappedToGrid = false;

  if (gridSnapActivo) {
    const prevDist =
      hyst?.lastTrackingGuideKey === guide.key ? hyst.lastTrackingDistWorld : null;
    finalDist = snapScalarWithHysteresis(signedDist, stepWorld, prevDist);
    snappedToGrid = true;
    if (hyst) hyst.lastTrackingDistWorld = finalDist;
  } else if (hyst) {
    hyst.lastTrackingDistWorld = null;
  }

  if (hyst) {
    hyst.lastTrackingGuideKey = guide.key;
    hyst.lastTrackingSecondKey = null;
  }

  const finalWorld: Point2D = {
    x: guide.origin.x + finalDist * guide.dir.x,
    y: guide.origin.y + finalDist * guide.dir.y,
  };
  const updatedGuide = buildSnappedSingleGuide(guide, finalWorld, config);

  return {
    world: finalWorld,
    snappedToGrid,
    tracking: {
      ...trackingRes,
      activeGuides: [updatedGuide],
      snappedPoint: finalWorld,
    },
    extraGuide: null,
  };
}

/**
 * Función centralizada de resolución de puntos para previsualización y confirmación final.
 * Orden de prioridad:
 *   1. RG (punto exacto de un objeto)
 *   2. Intersección de dos guías de rastreo
 *   3. Guía de rastreo simple (con SNAP cuantizando solo distancia sobre la guía)
 *   4. ORT / SP
 *   5. SNAP
 *   6. Punto libre
 */
export function resolverPunto(
  puntoRaton: Point2D,
  puntoAnterior: Point2D | null,
  herramienta: HerramientaResolucionPunto,
  opciones: ResolverPuntoOpciones
): CadResolvedCursor {
  const { config } = opciones;
  const zoom = opciones.zoom ?? opciones.viewport?.zoom ?? 1;
  const shiftKey = Boolean(opciones.shiftKey);
  const gridSnapActivo = Boolean(config.gridSnap || opciones.gridSnapOverride);
  const stepCad = Math.max(0.01, config.snapStep || 10);
  const stepWorld = Math.max(0.5, cadDistToWorldDist(stepCad, config));
  const hyst = opciones.hysteresisState;

  // Alinea SNAP con cuadrícula visible cuando el paso coincide y existe marco activo
  const stepMatchesGrid =
    opciones.boardGridStepWorld !== undefined &&
    Math.abs(stepWorld - opciones.boardGridStepWorld) <= 0.75;
  const alignToFrameGrid =
    Boolean(opciones.gridOriginWorld) &&
    config.originX === 0 &&
    config.originY === 0 &&
    stepMatchesGrid;
  const gridSnapConfig: CadDraftingConfig =
    alignToFrameGrid && opciones.gridOriginWorld
      ? {
          ...config,
          originX: opciones.gridOriginWorld.x,
          originY: opciones.gridOriginWorld.y,
        }
      : config;

  // Paso 1: Convertir el punto del ratón a coordenadas del mundo
  let rawWorld: Point2D;
  if (opciones.isWorldInput || !opciones.viewport) {
    rawWorld = { x: puntoRaton.x, y: puntoRaton.y };
  } else {
    const offsetX = opciones.stageRect?.left ?? 0;
    const offsetY = opciones.stageRect?.top ?? 0;
    rawWorld = {
      x: (puntoRaton.x - offsetX - opciones.viewport.panX) / Math.max(0.05, zoom),
      y: (puntoRaton.y - offsetY - opciones.viewport.panY) / Math.max(0.05, zoom),
    };
  }

  const categoria = clasificarHerramientaRestriccion(herramienta, opciones.shapeKind);

  // Prioridad 1: RG (punto exacto de un objeto)
  const osnapTarget = findBestOsnapTarget(
    rawWorld,
    puntoAnterior,
    opciones.visibleObjects,
    config,
    zoom,
    opciones.excludeObjectIds
  );

  // Evaluación protegida de Rastreo de referencia (RAS) para guías visuales y prioridades 2 y 3
  let trackingRes: CadTrackingResolution | null = null;
  if (opciones.trackingState && config.trackingEnabled) {
    try {
      trackingRes = evaluateTrackingGuides(
        rawWorld,
        opciones.trackingState,
        opciones.visibleObjects,
        config,
        zoom,
        hyst,
        opciones.excludeObjectIds,
        opciones.nowMs
      );
    } catch (err) {
      console.error('Error al calcular guías de rastreo de referencia:', err);
      opciones.onTrackingError?.(err);
      trackingRes = null;
    }
  }

  const attachTrackingOnly = (res: CadResolvedCursor): CadResolvedCursor =>
    trackingRes
      ? {
          ...res,
          tracking: {
            ...trackingRes,
            activeGuides: [],
            intersectionPoint: null,
            snappedPoint: null,
          },
        }
      : res;

  const tolWorld = Math.max(3, config.trackingTolerancePx || 8) / Math.max(0.15, zoom);

  // Sin punto base (primer punto o puntero libre)
  if (!puntoAnterior) {
    if (osnapTarget) {
      if (hyst) hyst.lastSnappedCad = worldToCad(osnapTarget.point, gridSnapConfig);
      return attachTrackingOnly({
        world: { ...osnapTarget.point },
        cad: worldToCad(osnapTarget.point, config),
        snap: osnapTarget,
        guide: null,
        snappedToGrid: false,
      });
    }

    if (trackingRes) {
      const fromTrack = resolvePointFromTracking(
        trackingRes,
        rawWorld,
        config,
        gridSnapActivo,
        stepWorld,
        hyst,
        null,
        tolWorld
      );
      if (fromTrack) {
        if (hyst && fromTrack.snappedToGrid) {
          hyst.lastSnappedCad = worldToCad(fromTrack.world, gridSnapConfig);
        }
        return {
          world: fromTrack.world,
          cad: worldToCad(fromTrack.world, config),
          snap: null,
          guide: null,
          snappedToGrid: fromTrack.snappedToGrid,
          tracking: fromTrack.tracking,
        };
      }
    }

    if (gridSnapActivo) {
      const rawSnap = worldToCad(rawWorld, gridSnapConfig);
      const snappedGrid = {
        x: snapScalarWithHysteresis(rawSnap.x, stepCad, hyst?.lastSnappedCad?.x),
        y: snapScalarWithHysteresis(rawSnap.y, stepCad, hyst?.lastSnappedCad?.y),
      };
      if (hyst) hyst.lastSnappedCad = snappedGrid;
      const finalWorld = cadToWorld(snappedGrid, gridSnapConfig);
      return attachTrackingOnly({
        world: finalWorld,
        cad: worldToCad(finalWorld, config),
        snap: null,
        guide: null,
        snappedToGrid: true,
      });
    }

    if (hyst) hyst.lastSnappedCad = null;
    return attachTrackingOnly({
      world: rawWorld,
      cad: worldToCad(rawWorld, config),
      snap: null,
      guide: null,
      snappedToGrid: false,
    });
  }

  // =========================================================================
  // RAMA A: Figuras definidas por dos esquinas opuestas (Rectángulo, Triángulo, Elipse, Polígono...)
  // =========================================================================
  if (categoria === 'box-shape') {
    const fixedRatio =
      opciones.shapeKind !== undefined && FIXED_PROPORTION_SHAPES.has(opciones.shapeKind);
    const keepProportion = config.ortho || shiftKey || fixedRatio;

    if (!keepProportion) {
      if (hyst) hyst.lastSnappedSideWorld = null;
      if (osnapTarget) {
        if (hyst) hyst.lastSnappedCad = worldToCad(osnapTarget.point, gridSnapConfig);
        return attachTrackingOnly({
          world: { ...osnapTarget.point },
          cad: worldToCad(osnapTarget.point, config),
          snap: osnapTarget,
          guide: null,
          snappedToGrid: false,
        });
      }

      if (trackingRes) {
        const fromTrack = resolvePointFromTracking(
          trackingRes,
          rawWorld,
          config,
          gridSnapActivo,
          stepWorld,
          hyst,
          null,
          tolWorld
        );
        if (fromTrack) {
          return {
            world: fromTrack.world,
            cad: worldToCad(fromTrack.world, config),
            snap: null,
            guide: null,
            snappedToGrid: fromTrack.snappedToGrid,
            tracking: fromTrack.tracking,
          };
        }
      }

      if (gridSnapActivo) {
        const rawSnap = worldToCad(rawWorld, gridSnapConfig);
        const snappedGrid = {
          x: snapScalarWithHysteresis(rawSnap.x, stepCad, hyst?.lastSnappedCad?.x),
          y: snapScalarWithHysteresis(rawSnap.y, stepCad, hyst?.lastSnappedCad?.y),
        };
        if (hyst) hyst.lastSnappedCad = snappedGrid;
        const finalWorld = cadToWorld(snappedGrid, gridSnapConfig);
        return attachTrackingOnly({
          world: finalWorld,
          cad: worldToCad(finalWorld, config),
          snap: null,
          guide: null,
          snappedToGrid: true,
        });
      }

      return attachTrackingOnly({
        world: rawWorld,
        cad: worldToCad(rawWorld, config),
        snap: null,
        guide: null,
        snappedToGrid: false,
      });
    }

    // Proporción 1:1 respetando prioridad 1. RG, 2/3. Rastreo, 4. Proporción 1:1
    let candidateWorld = rawWorld;
    let usedTrack: CadTrackingResolution | null = null;
    if (osnapTarget) {
      candidateWorld = osnapTarget.point;
    } else if (trackingRes) {
      const fromTrack = resolvePointFromTracking(
        trackingRes,
        rawWorld,
        config,
        gridSnapActivo,
        stepWorld,
        hyst,
        null,
        tolWorld
      );
      if (fromTrack) {
        candidateWorld = fromTrack.world;
        usedTrack = fromTrack.tracking;
      }
    }

    const dx = candidateWorld.x - puntoAnterior.x;
    const dy = candidateWorld.y - puntoAnterior.y;
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    let sideWorld = Math.max(Math.abs(dx), Math.abs(dy));
    let snappedToGrid = false;

    if (gridSnapActivo && !osnapTarget && !usedTrack) {
      sideWorld = snapScalarWithHysteresis(
        sideWorld,
        stepWorld,
        hyst?.lastSnappedSideWorld
      );
      if (hyst) hyst.lastSnappedSideWorld = sideWorld;
      snappedToGrid = true;
    } else if (hyst) {
      hyst.lastSnappedSideWorld = null;
    }

    const finalWorld: Point2D = {
      x: puntoAnterior.x + signX * sideWorld,
      y: puntoAnterior.y + signY * sideWorld,
    };
    const finalCad = worldToCad(finalWorld, config);
    if (hyst && snappedToGrid) hyst.lastSnappedCad = finalCad;

    const proportionGuide: CadConstraintGuide | null =
      sideWorld > 1
        ? {
            kind: 'proportion',
            angleDeg: 45,
            from: puntoAnterior,
            to: finalWorld,
            label: 'Proporción 1:1',
          }
        : null;

    return {
      world: finalWorld,
      cad: finalCad,
      snap: osnapTarget ?? null,
      guide: proportionGuide,
      snappedToGrid,
      tracking:
        usedTrack ??
        (trackingRes
          ? { ...trackingRes, activeGuides: [], intersectionPoint: null, snappedPoint: null }
          : undefined),
    };
  }

  // =========================================================================
  // RAMA B: Herramientas direccionales (Línea, Polilínea, Flecha, Medir)
  // Prioridad: 1. RG -> 2. Intersección 2 guías -> 3. Guía simple -> 4. ORT/SP/Paralela -> 5. SNAP -> 6. Libre
  // =========================================================================
  if (categoria === 'directional') {
    // Prioridad 1: RG (punto exacto)
    if (osnapTarget) {
      const finalWorld = { ...osnapTarget.point };
      let perpGuide: CadConstraintGuide | null = null;
      if (osnapTarget.kind === 'perpendicular') {
        const ang = worldDeltaToCadAngleDeg(
          finalWorld.x - puntoAnterior.x,
          finalWorld.y - puntoAnterior.y,
          config
        );
        perpGuide = {
          kind: 'perpendicular',
          angleDeg: ang,
          from: puntoAnterior,
          to: finalWorld,
          refSegment: osnapTarget.refSegment,
          label: 'Perpendicular 90°',
        };
      }
      return attachTrackingOnly({
        world: finalWorld,
        cad: worldToCad(finalWorld, config),
        snap: osnapTarget,
        guide: perpGuide,
        snappedToGrid: false,
      });
    }

    const dxRaw = rawWorld.x - puntoAnterior.x;
    const dyRaw = rawWorld.y - puntoAnterior.y;
    const distRaw = Math.hypot(dxRaw, dyRaw);

    // Prepara restricción direccional activa (para intersección opcional con guía de rastreo)
    let activeConstraint: {
      origin: Point2D;
      dir: Point2D;
      label: string;
      kind: 'ortho' | 'polar';
    } | null = null;
    if (config.ortho) {
      const isHoriz = Math.abs(dxRaw) >= Math.abs(dyRaw);
      activeConstraint = {
        origin: puntoAnterior,
        dir: isHoriz ? { x: dxRaw >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dyRaw >= 0 ? 1 : -1 },
        label: 'Orto',
        kind: 'ortho',
      };
    } else if ((config.polar || shiftKey) && distRaw > 1) {
      const stepDeg =
        shiftKey && !config.polar ? 15 : Math.max(5, config.polarAngle || 45);
      const curAng = worldDeltaToCadAngleDeg(dxRaw, dyRaw, config);
      const nearestRaw = Math.round(curAng / stepDeg) * stepDeg;
      const nearestNorm = ((nearestRaw % 360) + 360) % 360;
      let diff = Math.abs(curAng - nearestRaw);
      if (diff > 180) diff = 360 - diff;
      const captureLimitDeg =
        shiftKey ? 180 : hyst?.lastPolarAngleDeg === nearestNorm ? 12 : 9;
      if (diff <= captureLimitDeg) {
        const rad = (nearestNorm * Math.PI) / 180;
        activeConstraint = {
          origin: puntoAnterior,
          dir: { x: Math.cos(rad), y: config.yAxisUp ? -Math.sin(rad) : Math.sin(rad) },
          label: `Polar ${nearestNorm}°`,
          kind: 'polar',
        };
      }
    }

    // Prioridad 2 y 3: Intersección de 2 guías o Guía de rastreo simple
    if (trackingRes) {
      const fromTrack = resolvePointFromTracking(
        trackingRes,
        rawWorld,
        config,
        gridSnapActivo,
        stepWorld,
        hyst,
        activeConstraint,
        tolWorld
      );
      if (fromTrack) {
        return {
          world: fromTrack.world,
          cad: worldToCad(fromTrack.world, config),
          snap: null,
          guide: fromTrack.extraGuide,
          snappedToGrid: fromTrack.snappedToGrid,
          tracking: fromTrack.tracking,
        };
      }
    }

    // Referencia paralela (RG paralelo) dentro de ayudas direccionales cuando no hay ORT ni SP
    if (
      config.osnapEnabled &&
      config.osnapModes.parallel &&
      !config.ortho &&
      !config.polar &&
      !shiftKey &&
      opciones.hoverRefSegment
    ) {
      const [ra, rb] = opciones.hoverRefSegment;
      const rdx = rb.x - ra.x;
      const rdy = rb.y - ra.y;
      const rLen = Math.hypot(rdx, rdy);

      if (rLen > 2 && distRaw > 4) {
        const ux = rdx / rLen;
        const uy = rdy / rLen;
        const dot = dxRaw * ux + dyRaw * uy;
        const cross = Math.abs(dxRaw * uy - dyRaw * ux);
        const angleDiffRad = Math.atan2(cross, Math.abs(dot));
        if (angleDiffRad <= (6 * Math.PI) / 180) {
          const sign = dot >= 0 ? 1 : -1;
          const snappedLen = gridSnapActivo
            ? snapScalarWithHysteresis(distRaw, stepWorld, hyst?.lastPolarLenWorld)
            : distRaw;
          if (hyst && gridSnapActivo) hyst.lastPolarLenWorld = snappedLen;
          const finalWorld = {
            x: puntoAnterior.x + sign * ux * snappedLen,
            y: puntoAnterior.y + sign * uy * snappedLen,
          };
          const cadAng = worldDeltaToCadAngleDeg(sign * ux, sign * uy, config);
          return attachTrackingOnly({
            world: finalWorld,
            cad: worldToCad(finalWorld, config),
            snap: {
              point: finalWorld,
              kind: 'parallel',
              label: 'Paralelo',
              refSegment: opciones.hoverRefSegment,
            },
            guide: {
              kind: 'parallel',
              angleDeg: cadAng,
              from: puntoAnterior,
              to: finalWorld,
              refSegment: opciones.hoverRefSegment,
              label: `Paralela (${Math.round(cadAng)}°)`,
            },
            snappedToGrid: gridSnapActivo,
          });
        }
      }
    }

    // Prioridad 4a: ORT (restricción estricta horizontal o vertical)
    if (config.ortho) {
      if (hyst) {
        hyst.lastPolarAngleDeg = null;
        hyst.lastPolarLenWorld = null;
      }
      const isHorizontal = Math.abs(dxRaw) >= Math.abs(dyRaw);
      let finalWorld: Point2D = isHorizontal
        ? { x: rawWorld.x, y: puntoAnterior.y }
        : { x: puntoAnterior.x, y: rawWorld.y };

      let snappedToGrid = false;
      if (gridSnapActivo) {
        const snapPt = worldToCad(finalWorld, gridSnapConfig);
        if (isHorizontal) {
          const snappedGridX = snapScalarWithHysteresis(
            snapPt.x,
            stepCad,
            hyst?.lastSnappedCad?.x
          );
          const worldFromGrid = cadToWorld({ x: snappedGridX, y: snapPt.y }, gridSnapConfig);
          finalWorld = { x: worldFromGrid.x, y: puntoAnterior.y };
          if (hyst) {
            hyst.lastSnappedCad = { x: snappedGridX, y: snapPt.y };
          }
        } else {
          const snappedGridY = snapScalarWithHysteresis(
            snapPt.y,
            stepCad,
            hyst?.lastSnappedCad?.y
          );
          const worldFromGrid = cadToWorld({ x: snapPt.x, y: snappedGridY }, gridSnapConfig);
          finalWorld = { x: puntoAnterior.x, y: worldFromGrid.y };
          if (hyst) {
            hyst.lastSnappedCad = { x: snapPt.x, y: snappedGridY };
          }
        }
        snappedToGrid = true;
      }

      const cadAng =
        Math.hypot(finalWorld.x - puntoAnterior.x, finalWorld.y - puntoAnterior.y) > 0.5
          ? worldDeltaToCadAngleDeg(
              finalWorld.x - puntoAnterior.x,
              finalWorld.y - puntoAnterior.y,
              config
            )
          : isHorizontal
          ? dxRaw >= 0
            ? 0
            : 180
          : dyRaw >= 0
          ? config.yAxisUp
            ? 270
            : 90
          : config.yAxisUp
          ? 90
          : 270;

      return attachTrackingOnly({
        world: finalWorld,
        cad: worldToCad(finalWorld, config),
        snap: null,
        guide: {
          kind: 'ortho',
          angleDeg: Math.round(cadAng),
          from: puntoAnterior,
          to: finalWorld,
          label: `Orto ${Math.round(cadAng)}°`,
        },
        snappedToGrid,
      });
    }

    // Prioridad 4b: SP polar
    if ((config.polar || shiftKey) && distRaw > 1) {
      const stepDeg =
        shiftKey && !config.polar ? 15 : Math.max(5, config.polarAngle || 45);
      const curAng = worldDeltaToCadAngleDeg(dxRaw, dyRaw, config);
      const nearestRaw = Math.round(curAng / stepDeg) * stepDeg;
      const nearestNorm = ((nearestRaw % 360) + 360) % 360;
      let diff = Math.abs(curAng - nearestRaw);
      if (diff > 180) diff = 360 - diff;

      const captureLimitDeg =
        shiftKey ? 180 : hyst?.lastPolarAngleDeg === nearestNorm ? 12 : 9;

      if (diff <= captureLimitDeg) {
        const rad = (nearestNorm * Math.PI) / 180;
        const dirX = Math.cos(rad);
        const dirY = config.yAxisUp ? -Math.sin(rad) : Math.sin(rad);
        let projLen = Math.max(0, dxRaw * dirX + dyRaw * dirY);
        let snappedToGrid = false;

        if (gridSnapActivo) {
          projLen = snapScalarWithHysteresis(
            projLen,
            stepWorld,
            hyst?.lastPolarLenWorld
          );
          if (hyst) {
            hyst.lastPolarAngleDeg = nearestNorm;
            hyst.lastPolarLenWorld = projLen;
          }
          snappedToGrid = true;
        } else if (hyst) {
          hyst.lastPolarAngleDeg = nearestNorm;
          hyst.lastPolarLenWorld = null;
        }

        const finalWorld = {
          x: puntoAnterior.x + dirX * projLen,
          y: puntoAnterior.y + dirY * projLen,
        };
        const finalCad = worldToCad(finalWorld, config);
        if (hyst && snappedToGrid) hyst.lastSnappedCad = finalCad;

        return attachTrackingOnly({
          world: finalWorld,
          cad: finalCad,
          snap: null,
          guide: {
            kind: 'polar',
            angleDeg: nearestNorm,
            from: puntoAnterior,
            to: finalWorld,
            label: `Polar ${nearestNorm}°`,
          },
          snappedToGrid,
        });
      }
    }

    if (hyst) {
      hyst.lastPolarAngleDeg = null;
      hyst.lastPolarLenWorld = null;
    }
  }

  // =========================================================================
  // RAMA C: Herramientas radiales / libres (y fallback de dirección sin ORT/SP)
  // =========================================================================
  if (osnapTarget) {
    if (hyst) hyst.lastSnappedCad = worldToCad(osnapTarget.point, gridSnapConfig);
    return attachTrackingOnly({
      world: { ...osnapTarget.point },
      cad: worldToCad(osnapTarget.point, config),
      snap: osnapTarget,
      guide: null,
      snappedToGrid: false,
    });
  }

  if (trackingRes) {
    const fromTrack = resolvePointFromTracking(
      trackingRes,
      rawWorld,
      config,
      gridSnapActivo,
      stepWorld,
      hyst,
      null,
      tolWorld
    );
    if (fromTrack) {
      return {
        world: fromTrack.world,
        cad: worldToCad(fromTrack.world, config),
        snap: null,
        guide: null,
        snappedToGrid: fromTrack.snappedToGrid,
        tracking: fromTrack.tracking,
      };
    }
  }

  if (gridSnapActivo) {
    const rawSnap = worldToCad(rawWorld, gridSnapConfig);
    const snappedGrid = {
      x: snapScalarWithHysteresis(rawSnap.x, stepCad, hyst?.lastSnappedCad?.x),
      y: snapScalarWithHysteresis(rawSnap.y, stepCad, hyst?.lastSnappedCad?.y),
    };
    if (hyst) hyst.lastSnappedCad = snappedGrid;
    const finalWorld = cadToWorld(snappedGrid, gridSnapConfig);
    return attachTrackingOnly({
      world: finalWorld,
      cad: worldToCad(finalWorld, config),
      snap: null,
      guide: null,
      snappedToGrid: true,
    });
  }

  return attachTrackingOnly({
    world: rawWorld,
    cad: worldToCad(rawWorld, config),
    snap: null,
    guide: null,
    snappedToGrid: false,
  });
}

// Mantiene compatibilidad con llamadas existentes delegando en la función central resolverPunto
export function resolveCadCursor(
  rawWorld: Point2D,
  baseWorld: Point2D | null,
  visibleObjects: CanvasObject[],
  config: CadDraftingConfig,
  zoom: number,
  options?: {
    shiftKey?: boolean;
    hoverRefSegment?: [Point2D, Point2D] | null;
    herramienta?: HerramientaResolucionPunto;
    shapeKind?: ShapeObject['shapeKind'];
    gridSnapOverride?: boolean;
    hysteresisState?: SnapHysteresisState | null;
    trackingState?: TrackingSessionState | null;
    excludeObjectIds?: string[];
  }
): CadResolvedCursor {
  return resolverPunto(
    rawWorld,
    baseWorld,
    options?.herramienta ?? 'line',
    {
      config,
      visibleObjects,
      zoom,
      isWorldInput: true,
      shiftKey: options?.shiftKey,
      hoverRefSegment: options?.hoverRefSegment,
      shapeKind: options?.shapeKind,
      gridSnapOverride: options?.gridSnapOverride,
      hysteresisState: options?.hysteresisState,
      trackingState: options?.trackingState,
      excludeObjectIds: options?.excludeObjectIds,
    }
  );
}
