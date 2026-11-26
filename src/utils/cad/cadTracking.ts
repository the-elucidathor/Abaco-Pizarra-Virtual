import {
  FEATURE_TRACKING_ENABLED,
  type CadDraftingConfig,
  type CadSnapKind,
  type CadTrackingGuideLine,
  type CadTrackingPoint,
  type CadTrackingResolution,
} from '../../types/cad';
import type { CanvasObject, Point2D } from '../../types/whiteboard';
import {
  formatCadNumber,
  getUnitShortLabel,
  worldDeltaToCadAngleDeg,
  worldDistToCadDist,
} from './cadCoords';
import {
  extractSnapGeometry,
  queryNearbyObjects,
  segmentIntersection,
} from './cadSpatialIndex';

export interface TrackingHysteresis {
  lastTrackingGuideKey?: string | null;
  lastTrackingSecondKey?: string | null;
}

export interface TrackingSessionState {
  acquiredPoints: CadTrackingPoint[];
  hoverCandidateId: string | null;
  hoverStartMs: number;
  releasedUntilLeaveIds: Set<string>;
  pointLookupById: Map<string, Point2D>;
}

interface CandidatePoint {
  id: string;
  point: Point2D;
  kind: CadSnapKind;
  objectId?: string;
}

const VALID_IDS_CACHE = new WeakMap<CanvasObject[], Set<string>>();

function getValidObjectIdSet(objects: CanvasObject[]): Set<string> {
  let set = VALID_IDS_CACHE.get(objects);
  if (!set) {
    set = new Set(objects.map((o) => o.id));
    VALID_IDS_CACHE.set(objects, set);
  }
  return set;
}

export function createTrackingSessionState(): TrackingSessionState {
  return {
    acquiredPoints: [],
    hoverCandidateId: null,
    hoverStartMs: 0,
    releasedUntilLeaveIds: new Set<string>(),
    pointLookupById: new Map<string, Point2D>(),
  };
}

export function clearTrackingSessionState(state: TrackingSessionState | null | undefined): void {
  if (!state) return;
  state.acquiredPoints = [];
  state.hoverCandidateId = null;
  state.hoverStartMs = 0;
  state.releasedUntilLeaveIds.clear();
  state.pointLookupById.clear();
}

function makeCandidateId(kind: CadSnapKind, pt: Point2D, objectId?: string): string {
  return `${kind}:${objectId ?? 'none'}:${Math.round(pt.x * 2)}:${Math.round(pt.y * 2)}`;
}

function getTrackingCandidatesNearPoint(
  rawWorld: Point2D,
  visibleObjects: CanvasObject[],
  radiusWorld: number,
  config: CadDraftingConfig,
  excludeObjectIds?: string[]
): CandidatePoint[] {
  const nearby = queryNearbyObjects(
    visibleObjects,
    rawWorld,
    radiusWorld + 12,
    excludeObjectIds
  );
  if (nearby.length === 0) return [];

  const pool = extractSnapGeometry(nearby);
  const candidates: CandidatePoint[] = [];

  // Si RG está desactivado, el rastreo usa solo extremos y puntos medios (requisito 1.5)
  const useEndpoint = config.osnapEnabled ? Boolean(config.osnapModes.endpoint) : true;
  const useMidpoint = config.osnapEnabled ? Boolean(config.osnapModes.midpoint) : true;
  const useCenter = config.osnapEnabled && Boolean(config.osnapModes.center);
  const useQuadrant = config.osnapEnabled && Boolean(config.osnapModes.quadrant);
  const useIntersection = config.osnapEnabled && Boolean(config.osnapModes.intersection);

  const pushIfNear = (pt: Point2D, kind: CadSnapKind, objectId?: string) => {
    if (Math.hypot(pt.x - rawWorld.x, pt.y - rawWorld.y) <= radiusWorld) {
      candidates.push({
        id: makeCandidateId(kind, pt, objectId),
        point: pt,
        kind,
        objectId,
      });
    }
  };

  if (useEndpoint) {
    for (const ep of pool.endpoints) {
      pushIfNear(ep.point, 'endpoint', ep.objectId);
    }
  }
  if (useMidpoint) {
    for (const mp of pool.midpoints) {
      pushIfNear(mp.point, 'midpoint', mp.objectId);
    }
  }
  if (useCenter) {
    for (const c of pool.centers) {
      pushIfNear(c.point, 'center', c.objectId);
    }
  }
  if (useQuadrant) {
    for (const q of pool.quadrants) {
      pushIfNear(q.point, 'quadrant', q.objectId);
    }
  }
  if (useIntersection) {
    const margin = radiusWorld * 1.5;
    const nearSegs = pool.segments.filter(({ a, b }) => {
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
    for (let i = 0; i < nearSegs.length; i++) {
      for (let j = i + 1; j < nearSegs.length; j++) {
        const ix = segmentIntersection(
          nearSegs[i].a,
          nearSegs[i].b,
          nearSegs[j].a,
          nearSegs[j].b
        );
        if (ix) {
          pushIfNear(ix, 'intersection', nearSegs[i].objectId);
        }
      }
    }
  }

  return candidates;
}

function updateTrackingAcquiredPoints(
  rawWorld: Point2D,
  state: TrackingSessionState,
  visibleObjects: CanvasObject[],
  config: CadDraftingConfig,
  zoom: number,
  excludeObjectIds: string[] | undefined,
  nowMs: number
): void {
  const safeZoom = Math.max(0.15, zoom);
  const validIds = getValidObjectIdSet(visibleObjects);
  const excludeSet =
    excludeObjectIds && excludeObjectIds.length > 0 ? new Set(excludeObjectIds) : null;

  // Depura puntos cuyos objetos ya no existen o están excluidos
  state.acquiredPoints = state.acquiredPoints.filter(
    (p) =>
      (!p.objectId || validIds.has(p.objectId)) &&
      (!excludeSet || !p.objectId || !excludeSet.has(p.objectId))
  );

  const maxPoints = Math.max(1, Math.min(5, Math.round(config.trackingMaxPoints || 3)));

  if (config.trackingMode === 'auto') {
    const autoRadiusWorld = 40 / safeZoom;
    const nearby = getTrackingCandidatesNearPoint(
      rawWorld,
      visibleObjects,
      autoRadiusWorld,
      config,
      excludeObjectIds
    );

    const byId = new Map<string, CadTrackingPoint>();
    for (const existing of state.acquiredPoints) {
      byId.set(existing.id, existing);
    }

    for (const cand of nearby) {
      // Evita duplicar exactamente la misma posición geométrica con otra etiqueta
      let dup = false;
      for (const cur of byId.values()) {
        if (
          cur.id !== cand.id &&
          Math.hypot(cur.point.x - cand.point.x, cur.point.y - cand.point.y) < 1.5 / safeZoom
        ) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      byId.set(cand.id, {
        id: cand.id,
        point: cand.point,
        kind: cand.kind,
        objectId: cand.objectId,
        acquiredAt: byId.get(cand.id)?.acquiredAt ?? nowMs,
      });
    }

    const merged = Array.from(byId.values());
    merged.sort(
      (a, b) =>
        Math.hypot(a.point.x - rawWorld.x, a.point.y - rawWorld.y) -
        Math.hypot(b.point.x - rawWorld.x, b.point.y - rawWorld.y)
    );
    state.acquiredPoints = merged.slice(0, maxPoints);
    state.hoverCandidateId = null;
    state.releasedUntilLeaveIds.clear();
    return;
  }

  // Modo "Por adquisición": detener 400 ms sobre un punto para adquirirlo; volver a pasar para liberarlo
  const acquireRadiusWorld = 14 / safeZoom;
  const leaveRadiusWorld = 22 / safeZoom;

  for (const id of Array.from(state.releasedUntilLeaveIds)) {
    const pt = state.pointLookupById.get(id);
    if (!pt || Math.hypot(pt.x - rawWorld.x, pt.y - rawWorld.y) > leaveRadiusWorld) {
      state.releasedUntilLeaveIds.delete(id);
    }
  }

  const nearby = getTrackingCandidatesNearPoint(
    rawWorld,
    visibleObjects,
    acquireRadiusWorld,
    config,
    excludeObjectIds
  );

  let bestCand: CandidatePoint | null = null;
  let bestDist = Infinity;
  for (const cand of nearby) {
    const d = Math.hypot(cand.point.x - rawWorld.x, cand.point.y - rawWorld.y);
    if (d < bestDist) {
      bestDist = d;
      bestCand = cand;
    }
  }

  if (!bestCand) {
    state.hoverCandidateId = null;
    return;
  }

  state.pointLookupById.set(bestCand.id, bestCand.point);

  if (state.releasedUntilLeaveIds.has(bestCand.id)) {
    state.hoverCandidateId = null;
    return;
  }

  const existingIdx = state.acquiredPoints.findIndex(
    (p) =>
      p.id === bestCand!.id ||
      Math.hypot(p.point.x - bestCand!.point.x, p.point.y - bestCand!.point.y) < 2 / safeZoom
  );

  if (existingIdx >= 0) {
    const removed = state.acquiredPoints[existingIdx];
    state.acquiredPoints = state.acquiredPoints.filter((_, idx) => idx !== existingIdx);
    state.releasedUntilLeaveIds.add(bestCand.id);
    state.releasedUntilLeaveIds.add(removed.id);
    state.pointLookupById.set(removed.id, removed.point);
    state.hoverCandidateId = null;
    return;
  }

  if (state.hoverCandidateId === bestCand.id) {
    if (nowMs - state.hoverStartMs >= 400) {
      const nextList = [
        ...state.acquiredPoints,
        {
          id: bestCand.id,
          point: bestCand.point,
          kind: bestCand.kind,
          objectId: bestCand.objectId,
          acquiredAt: nowMs,
        },
      ];
      state.acquiredPoints =
        nextList.length > maxPoints ? nextList.slice(nextList.length - maxPoints) : nextList;
      state.releasedUntilLeaveIds.add(bestCand.id);
      state.hoverCandidateId = null;
    }
  } else {
    state.hoverCandidateId = bestCand.id;
    state.hoverStartMs = nowMs;
  }
}

function getAllowedTrackingAnglesDeg(config: CadDraftingConfig): number[] {
  const angles = new Set<number>([0, 90]);
  if (config.trackingShowPolarAngles) {
    const step = Math.max(15, Math.min(90, config.polarAngle || 45));
    for (let a = 0; a < 180; a += step) {
      angles.add(Math.round(a));
    }
  }
  return Array.from(angles).sort((a, b) => a - b);
}

function formatTrackingLabel(
  origin: Point2D,
  target: Point2D,
  config: CadDraftingConfig
): { distanceWorld: number; angleDeg: number; label: string } {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distWorld = Math.hypot(dx, dy);
  const cadAngle =
    distWorld > 1e-4 ? Math.round(worldDeltaToCadAngleDeg(dx, dy, config)) % 360 : 0;
  const distCad = worldDistToCadDist(distWorld, config);
  const unit = getUnitShortLabel(config.unit);
  const distStr = `${formatCadNumber(distCad, Math.min(2, config.decimals))} ${unit}`;
  const isOrthoAngle =
    cadAngle === 0 || cadAngle === 90 || cadAngle === 180 || cadAngle === 270;
  const label = isOrthoAngle || distWorld < 1 ? distStr : `${cadAngle}° · ${distStr}`;
  return { distanceWorld: distWorld, angleDeg: cadAngle, label };
}

function intersectGuideRays(
  originA: Point2D,
  dirA: Point2D,
  originB: Point2D,
  dirB: Point2D
): Point2D | null {
  const denom = dirA.x * dirB.y - dirA.y * dirB.x;
  if (Math.abs(denom) < 0.05) return null;
  const rx = originB.x - originA.x;
  const ry = originB.y - originA.y;
  const t = (rx * dirB.y - ry * dirB.x) / denom;
  if (!Number.isFinite(t)) return null;
  return {
    x: originA.x + t * dirA.x,
    y: originA.y + t * dirA.y,
  };
}

/**
 * Evalúa las líneas de apoyo (rastreo de referencia) respecto al cursor.
 * Devuelve puntos adquiridos, guías activas, intersección de 2 guías o proyección sobre 1 guía.
 */
export function evaluateTrackingGuides(
  rawWorld: Point2D,
  state: TrackingSessionState | null | undefined,
  visibleObjects: CanvasObject[],
  config: CadDraftingConfig,
  zoom: number,
  hyst?: TrackingHysteresis | null,
  excludeObjectIds?: string[],
  nowMs = Date.now()
): CadTrackingResolution | null {
  if (!FEATURE_TRACKING_ENABLED || !config.trackingEnabled || !state) {
    return null;
  }

  updateTrackingAcquiredPoints(
    rawWorld,
    state,
    visibleObjects,
    config,
    zoom,
    excludeObjectIds,
    nowMs
  );

  if (state.acquiredPoints.length === 0) {
    return {
      acquiredPoints: [],
      activeGuides: [],
      intersectionPoint: null,
      snappedPoint: null,
    };
  }

  const safeZoom = Math.max(0.15, zoom);
  const baseTolWorld = Math.max(3, Math.min(24, config.trackingTolerancePx || 8)) / safeZoom;
  const allowedAngles = getAllowedTrackingAnglesDeg(config);

  interface MatchedGuideCandidate {
    key: string;
    originId: string;
    origin: Point2D;
    originKind: CadSnapKind;
    baseDir: Point2D;
    perpDist: number;
    score: number;
    projPt: Point2D;
  }

  const perPointBest: MatchedGuideCandidate[] = [];

  for (const acq of state.acquiredPoints) {
    let bestForPt: MatchedGuideCandidate | null = null;

    for (const deg of allowedAngles) {
      const rad = (deg * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = config.yAxisUp ? -Math.sin(rad) : Math.sin(rad);
      const dx = rawWorld.x - acq.point.x;
      const dy = rawWorld.y - acq.point.y;
      const dot = dx * ux + dy * uy;
      const perpDist = Math.abs(dx * uy - dy * ux);
      const key = `${acq.id}@${deg}`;
      const wasActive =
        hyst?.lastTrackingGuideKey === key || hyst?.lastTrackingSecondKey === key;
      const captureTol = wasActive ? baseTolWorld * 1.38 : baseTolWorld;

      if (perpDist <= captureTol) {
        const score = perpDist - (wasActive ? baseTolWorld * 0.25 : 0);
        if (!bestForPt || score < bestForPt.score) {
          const sign = dot >= 0 ? 1 : -1;
          const dir = { x: ux * sign, y: uy * sign };
          const projPt = {
            x: acq.point.x + ux * dot,
            y: acq.point.y + uy * dot,
          };
          bestForPt = {
            key,
            originId: acq.id,
            origin: acq.point,
            originKind: acq.kind,
            baseDir: dir,
            perpDist,
            score,
            projPt,
          };
        }
      }
    }

    if (bestForPt) {
      perPointBest.push(bestForPt);
    }
  }

  if (perPointBest.length === 0) {
    return {
      acquiredPoints: state.acquiredPoints,
      activeGuides: [],
      intersectionPoint: null,
      snappedPoint: null,
    };
  }

  // 1. Verificar intersección de dos guías pertenecientes a puntos de referencia distintos
  const wasIntersection = Boolean(hyst?.lastTrackingGuideKey && hyst?.lastTrackingSecondKey);
  const ixTol = baseTolWorld * (wasIntersection ? 1.75 : 1.45);
  let bestPair: {
    a: MatchedGuideCandidate;
    b: MatchedGuideCandidate;
    pt: Point2D;
    dist: number;
  } | null = null;

  for (let i = 0; i < perPointBest.length; i++) {
    for (let j = i + 1; j < perPointBest.length; j++) {
      const ga = perPointBest[i];
      const gb = perPointBest[j];
      if (ga.originId === gb.originId) continue;
      if (Math.hypot(ga.origin.x - gb.origin.x, ga.origin.y - gb.origin.y) < 2 / safeZoom) {
        continue;
      }
      const ix = intersectGuideRays(ga.origin, ga.baseDir, gb.origin, gb.baseDir);
      if (!ix) continue;
      const d = Math.hypot(ix.x - rawWorld.x, ix.y - rawWorld.y);
      if (d <= ixTol && (!bestPair || d < bestPair.dist)) {
        bestPair = { a: ga, b: gb, pt: ix, dist: d };
      }
    }
  }

  if (bestPair) {
    const infoA = formatTrackingLabel(bestPair.a.origin, bestPair.pt, config);
    const infoB = formatTrackingLabel(bestPair.b.origin, bestPair.pt, config);
    const dirToIxA =
      infoA.distanceWorld > 1e-4
        ? {
            x: (bestPair.pt.x - bestPair.a.origin.x) / infoA.distanceWorld,
            y: (bestPair.pt.y - bestPair.a.origin.y) / infoA.distanceWorld,
          }
        : bestPair.a.baseDir;
    const dirToIxB =
      infoB.distanceWorld > 1e-4
        ? {
            x: (bestPair.pt.x - bestPair.b.origin.x) / infoB.distanceWorld,
            y: (bestPair.pt.y - bestPair.b.origin.y) / infoB.distanceWorld,
          }
        : bestPair.b.baseDir;

    const guideA: CadTrackingGuideLine = {
      key: bestPair.a.key,
      originId: bestPair.a.originId,
      origin: bestPair.a.origin,
      originKind: bestPair.a.originKind,
      angleDeg: infoA.angleDeg,
      dir: dirToIxA,
      distanceWorld: infoA.distanceWorld,
      label: infoA.label,
    };
    const guideB: CadTrackingGuideLine = {
      key: bestPair.b.key,
      originId: bestPair.b.originId,
      origin: bestPair.b.origin,
      originKind: bestPair.b.originKind,
      angleDeg: infoB.angleDeg,
      dir: dirToIxB,
      distanceWorld: infoB.distanceWorld,
      label: infoB.label,
    };

    return {
      acquiredPoints: state.acquiredPoints,
      activeGuides: [guideA, guideB],
      intersectionPoint: bestPair.pt,
      snappedPoint: bestPair.pt,
    };
  }

  // 2. Guía de rastreo simple
  perPointBest.sort((a, b) => a.score - b.score);
  const winner = perPointBest[0];
  const info = formatTrackingLabel(winner.origin, winner.projPt, config);
  const singleGuide: CadTrackingGuideLine = {
    key: winner.key,
    originId: winner.originId,
    origin: winner.origin,
    originKind: winner.originKind,
    angleDeg: info.angleDeg,
    dir: winner.baseDir,
    distanceWorld: info.distanceWorld,
    label: info.label,
  };

  return {
    acquiredPoints: state.acquiredPoints,
    activeGuides: [singleGuide],
    intersectionPoint: null,
    snappedPoint: winner.projPt,
  };
}

/**
 * Recalcula la etiqueta y distancia de una guía de rastreo después de aplicar SNAP sobre ella.
 */
export function buildSnappedSingleGuide(
  guide: CadTrackingGuideLine,
  snappedWorld: Point2D,
  config: CadDraftingConfig
): CadTrackingGuideLine {
  const info = formatTrackingLabel(guide.origin, snappedWorld, config);
  const dir =
    info.distanceWorld > 1e-4
      ? {
          x: (snappedWorld.x - guide.origin.x) / info.distanceWorld,
          y: (snappedWorld.y - guide.origin.y) / info.distanceWorld,
        }
      : guide.dir;
  return {
    ...guide,
    angleDeg: info.angleDeg,
    dir,
    distanceWorld: info.distanceWorld,
    label: info.label,
  };
}
