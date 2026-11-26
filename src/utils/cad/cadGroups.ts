import type { CanvasObject, DimensionObject, GroupRecord } from '../../types/whiteboard';
import { uid } from '../id';

export function ensureGroupsArray(groups?: GroupRecord[]): GroupRecord[] {
  return Array.isArray(groups) ? groups : [];
}

export function getAncestorGroupIds(groupId: string, groups: GroupRecord[]): string[] {
  const map = new Map(groups.map((g) => [g.id, g]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = groupId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = map.get(cur)?.parentGroupId;
  }
  return chain;
}

export function getTopLevelGroupId(groupId: string, groups: GroupRecord[]): string {
  const chain = getAncestorGroupIds(groupId, groups);
  return chain[chain.length - 1] ?? groupId;
}

export function getDescendantGroupIds(rootGroupId: string, groups: GroupRecord[]): string[] {
  const result: string[] = [rootGroupId];
  const seen = new Set<string>([rootGroupId]);
  let added = true;
  while (added) {
    added = false;
    for (const g of groups) {
      if (g.parentGroupId && seen.has(g.parentGroupId) && !seen.has(g.id)) {
        seen.add(g.id);
        result.push(g.id);
        added = true;
      }
    }
  }
  return result;
}

export function getGroupMemberObjects(
  groupId: string,
  objects: CanvasObject[],
  groups: GroupRecord[]
): CanvasObject[] {
  const descendantSet = new Set(getDescendantGroupIds(groupId, groups));
  return objects.filter((o) => o.groupId && descendantSet.has(o.groupId));
}

export function expandSelectionToGroups(
  clickedObj: CanvasObject,
  objects: CanvasObject[],
  groups: GroupRecord[]
): string[] {
  if (!clickedObj.groupId) return [clickedObj.id];
  const safeGroups = ensureGroupsArray(groups);
  const topId = getTopLevelGroupId(clickedObj.groupId, safeGroups);
  const members = getGroupMemberObjects(topId, objects, safeGroups);
  if (members.length === 0) return [clickedObj.id];
  return members.map((m) => m.id);
}

export function pruneEmptyGroups(
  objects: CanvasObject[],
  groups: GroupRecord[]
): GroupRecord[] {
  let current = ensureGroupsArray(groups).map((g) => ({ ...g }));
  const usedDirect = new Set(
    objects.map((o) => o.groupId).filter((gid): gid is string => Boolean(gid))
  );

  // Iteratively drop leaf groups that have neither objects nor child groups
  let changed = true;
  while (changed) {
    changed = false;
    const hasChildGroup = new Set(
      current.map((g) => g.parentGroupId).filter((pid): pid is string => Boolean(pid))
    );
    const next = current.filter((g) => usedDirect.has(g.id) || hasChildGroup.has(g.id));
    if (next.length !== current.length) {
      current = next;
      changed = true;
    }
  }
  return current;
}

export function createGroupFromSelection(
  selectedIds: string[],
  objects: CanvasObject[],
  groups: GroupRecord[],
  customName?: string
): {
  objects: CanvasObject[];
  groups: GroupRecord[];
  createdGroup: GroupRecord | null;
} {
  const safeGroups = ensureGroupsArray(groups);
  const selSet = new Set(selectedIds);
  const selObjs = objects.filter((o) => selSet.has(o.id));
  if (selObjs.length < 2) {
    return { objects, groups: safeGroups, createdGroup: null };
  }

  // Gather distinct top-level groups already represented in the selection
  const existingTopIds = new Set<string>();
  let hasUngrouped = false;
  for (const o of selObjs) {
    if (o.groupId) {
      existingTopIds.add(getTopLevelGroupId(o.groupId, safeGroups));
    } else {
      hasUngrouped = true;
    }
  }

  // If all selected items already live under one single top-level group and no ungrouped items exist,
  // avoid creating a redundant duplicate wrapper unless there are multiple sub-items.
  if (existingTopIds.size === 1 && !hasUngrouped) {
    const onlyTopId = Array.from(existingTopIds)[0];
    const allInTop = getGroupMemberObjects(onlyTopId, objects, safeGroups);
    if (allInTop.length === selObjs.length) {
      return {
        objects,
        groups: safeGroups,
        createdGroup: safeGroups.find((g) => g.id === onlyTopId) ?? null,
      };
    }
  }

  const nextNum = safeGroups.length + 1;
  const newGroup: GroupRecord = {
    id: uid('grp'),
    name: customName?.trim() || `Grupo ${nextNum}`,
    createdAt: Date.now(),
  };

  // Ensure any existing group records referenced on objects exist in safeGroups
  const knownGroupIds = new Set(safeGroups.map((g) => g.id));
  const normalizedGroups: GroupRecord[] = [...safeGroups];
  for (const topId of existingTopIds) {
    if (!knownGroupIds.has(topId)) {
      normalizedGroups.push({
        id: topId,
        name: `Subgrupo ${normalizedGroups.length + 1}`,
        createdAt: Date.now(),
      });
      knownGroupIds.add(topId);
    }
  }

  // Re-parent existing top groups touched by selection under newGroup (supporting nested groups!),
  // and assign ungrouped selected objects directly to newGroup.
  const nextGroups: GroupRecord[] = [
    ...normalizedGroups.map((g) =>
      existingTopIds.has(g.id) ? { ...g, parentGroupId: newGroup.id } : g
    ),
    newGroup,
  ];

  const nextObjects = objects.map((o) => {
    if (!selSet.has(o.id)) return o;
    if (!o.groupId) {
      return { ...o, groupId: newGroup.id };
    }
    return o;
  });

  return {
    objects: nextObjects,
    groups: pruneEmptyGroups(nextObjects, nextGroups),
    createdGroup: newGroup,
  };
}

export function ungroupTopLevelSelection(
  selectedIds: string[],
  objects: CanvasObject[],
  groups: GroupRecord[]
): {
  objects: CanvasObject[];
  groups: GroupRecord[];
  ungroupedCount: number;
} {
  const safeGroups = ensureGroupsArray(groups);
  const selSet = new Set(selectedIds);
  const targetTopIds = new Set<string>();

  for (const o of objects) {
    if (selSet.has(o.id) && o.groupId) {
      targetTopIds.add(getTopLevelGroupId(o.groupId, safeGroups));
    }
  }

  if (targetTopIds.size === 0) {
    return { objects, groups: safeGroups, ungroupedCount: 0 };
  }

  const nextObjects = objects.map((o) => {
    if (o.groupId && targetTopIds.has(o.groupId)) {
      const copy = { ...o };
      delete copy.groupId;
      return copy;
    }
    return o;
  });

  // Child sub-groups whose parent was dissolved become top-level groups
  const nextGroups = safeGroups
    .filter((g) => !targetTopIds.has(g.id))
    .map((g) => {
      if (g.parentGroupId && targetTopIds.has(g.parentGroupId)) {
        const copy = { ...g };
        delete copy.parentGroupId;
        return copy;
      }
      return g;
    });

  return {
    objects: nextObjects,
    groups: pruneEmptyGroups(nextObjects, nextGroups),
    ungroupedCount: targetTopIds.size,
  };
}

export function dissolveSpecificGroup(
  groupId: string,
  objects: CanvasObject[],
  groups: GroupRecord[]
): { objects: CanvasObject[]; groups: GroupRecord[] } {
  const safeGroups = ensureGroupsArray(groups);
  const target = safeGroups.find((g) => g.id === groupId);
  const parentOfTarget = target?.parentGroupId;

  const nextObjects = objects.map((o) => {
    if (o.groupId === groupId) {
      const copy = { ...o };
      if (parentOfTarget) copy.groupId = parentOfTarget;
      else delete copy.groupId;
      return copy;
    }
    return o;
  });

  const nextGroups = safeGroups
    .filter((g) => g.id !== groupId)
    .map((g) => {
      if (g.parentGroupId === groupId) {
        const copy = { ...g };
        if (parentOfTarget) copy.parentGroupId = parentOfTarget;
        else delete copy.parentGroupId;
        return copy;
      }
      return g;
    });

  return {
    objects: nextObjects,
    groups: pruneEmptyGroups(nextObjects, nextGroups),
  };
}

export function renameGroup(
  groupId: string,
  newName: string,
  groups: GroupRecord[]
): GroupRecord[] {
  const trimmed = newName.trim();
  if (!trimmed) return ensureGroupsArray(groups);
  return ensureGroupsArray(groups).map((g) =>
    g.id === groupId ? { ...g, name: trimmed } : g
  );
}

export function addObjectsToGroup(
  objectIds: string[],
  targetGroupId: string,
  objects: CanvasObject[],
  groups: GroupRecord[]
): { objects: CanvasObject[]; groups: GroupRecord[] } {
  const safeGroups = ensureGroupsArray(groups);
  const idSet = new Set(objectIds);
  const targetAncestors = new Set(getAncestorGroupIds(targetGroupId, safeGroups));

  const nextObjects = objects.map((o) => {
    if (!idSet.has(o.id)) return o;
    // Prevent placing an ancestor group inside its own descendant
    if (o.groupId && targetAncestors.has(o.groupId)) {
      return o;
    }
    return { ...o, groupId: targetGroupId };
  });

  return {
    objects: nextObjects,
    groups: pruneEmptyGroups(nextObjects, safeGroups),
  };
}

export function removeObjectsFromGroup(
  objectIds: string[],
  objects: CanvasObject[],
  groups: GroupRecord[]
): { objects: CanvasObject[]; groups: GroupRecord[] } {
  const idSet = new Set(objectIds);
  const nextObjects = objects.map((o) => {
    if (!idSet.has(o.id)) return o;
    const copy = { ...o };
    delete copy.groupId;
    return copy;
  });
  return {
    objects: nextObjects,
    groups: pruneEmptyGroups(nextObjects, groups),
  };
}

export function translateCanvasObject(
  obj: CanvasObject,
  dx: number,
  dy: number
): CanvasObject {
  if (obj.type === 'dimension') {
    const dim = obj as DimensionObject;
    return {
      ...dim,
      x: dim.x + dx,
      y: dim.y + dy,
      p1: { x: dim.p1.x + dx, y: dim.p1.y + dy },
      p2: { x: dim.p2.x + dx, y: dim.p2.y + dy },
      p3: dim.p3 ? { x: dim.p3.x + dx, y: dim.p3.y + dy } : undefined,
      offsetPt: { x: dim.offsetPt.x + dx, y: dim.offsetPt.y + dy },
    };
  }
  return {
    ...obj,
    x: obj.x + dx,
    y: obj.y + dy,
  };
}

export function cloneObjectsWithGroupTree(
  sourceObjects: CanvasObject[],
  sourceGroups: GroupRecord[],
  deltaX: number,
  deltaY: number,
  layerId: string,
  startZIndex: number,
  options?: {
    preserveLayerAndLock?: boolean;
    keepGroupNames?: boolean;
  }
): {
  clones: CanvasObject[];
  newGroups: GroupRecord[];
  idMap: Map<string, string>;
} {
  const safeGroups = ensureGroupsArray(sourceGroups);
  const groupById = new Map(safeGroups.map((g) => [g.id, g]));

  // Collect all referenced groupIds and their ancestor chain
  const referencedGroupIds = new Set<string>();
  for (const obj of sourceObjects) {
    if (!obj.groupId) continue;
    for (const gid of getAncestorGroupIds(obj.groupId, safeGroups)) {
      referencedGroupIds.add(gid);
    }
  }

  const groupIdMap = new Map<string, string>();
  for (const oldGid of referencedGroupIds) {
    groupIdMap.set(oldGid, uid('grp'));
  }

  const newGroups: GroupRecord[] = [];
  for (const oldGid of referencedGroupIds) {
    const src = groupById.get(oldGid);
    const newId = groupIdMap.get(oldGid)!;
    newGroups.push({
      id: newId,
      name: src
        ? options?.keepGroupNames
          ? src.name
          : `${src.name} (Copia)`
        : `Grupo (Copia)`,
      parentGroupId:
        src?.parentGroupId && groupIdMap.has(src.parentGroupId)
          ? groupIdMap.get(src.parentGroupId)
          : undefined,
      createdAt: Date.now(),
    });
  }

  const idMap = new Map<string, string>();
  for (const orig of sourceObjects) {
    idMap.set(orig.id, uid(orig.type.slice(0, 3)));
  }

  const clones: CanvasObject[] = sourceObjects.map((orig, idx) => {
    const rawClone: CanvasObject = JSON.parse(JSON.stringify(orig));
    rawClone.id = idMap.get(orig.id)!;
    rawClone.zIndex = startZIndex + idx;
    rawClone.layerId = options?.preserveLayerAndLock ? orig.layerId : layerId;
    rawClone.locked = options?.preserveLayerAndLock ? Boolean(orig.locked) : false;
    if (orig.groupId && groupIdMap.has(orig.groupId)) {
      rawClone.groupId = groupIdMap.get(orig.groupId);
    } else {
      delete rawClone.groupId;
    }

    const translated = translateCanvasObject(rawClone, deltaX, deltaY);
    if (translated.type === 'dimension') {
      const d = { ...translated };
      if (d.anchor1 && idMap.has(d.anchor1.objectId)) {
        d.anchor1 = { ...d.anchor1, objectId: idMap.get(d.anchor1.objectId)! };
      }
      if (d.anchor2 && idMap.has(d.anchor2.objectId)) {
        d.anchor2 = { ...d.anchor2, objectId: idMap.get(d.anchor2.objectId)! };
      }
      if (d.anchor3 && idMap.has(d.anchor3.objectId)) {
        d.anchor3 = { ...d.anchor3, objectId: idMap.get(d.anchor3.objectId)! };
      }
      return d;
    }
    if (translated.type === 'line') {
      const l = { ...translated };
      if (l.startNodeId && idMap.has(l.startNodeId)) {
        l.startNodeId = idMap.get(l.startNodeId);
      }
      if (l.endNodeId && idMap.has(l.endNodeId)) {
        l.endNodeId = idMap.get(l.endNodeId);
      }
      return l;
    }
    return translated;
  });

  return { clones, newGroups, idMap };
}
