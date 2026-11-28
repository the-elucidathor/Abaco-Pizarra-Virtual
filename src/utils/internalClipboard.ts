import type {
  CanvasObject,
  DocumentObject,
  GroupRecord,
  ImageObject,
} from '../types/whiteboard';
import { cloneObjectsWithGroupTree, ensureGroupsArray } from './cad/cadGroups';
import { normalizarTabla } from './tableUtils';

export interface InternalClipboardPayload {
  objects: CanvasObject[];
  groups: GroupRecord[];
  copiedAt: number;
}

export interface InternalClipboardMeta {
  copiedAt: number;
  preferInternal: boolean;
  blurredSinceCopy: boolean;
}

// V1.11.8-1: Portapapeles interno persistente a nivel de módulo (compartido entre tableros y proyectos sin depender del portapapeles del sistema)
let storedClipboard: InternalClipboardPayload | null = null;
let clipboardMeta: InternalClipboardMeta = {
  copiedAt: 0,
  preferInternal: false,
  blurredSinceCopy: false,
};

function isValidClonableResource(obj: CanvasObject): boolean {
  if (obj.type === 'image') {
    const img = obj as ImageObject;
    if (typeof img.src !== 'string' || img.src.trim().length === 0) {
      return false;
    }
    // Evita URLs blob efímeras que ya no existan tras cambiar de sesión
    if (img.src.startsWith('blob:')) {
      return false;
    }
    return true;
  }
  if (obj.type === 'document') {
    const doc = obj as DocumentObject;
    if (!doc.docKind || !doc.fileName) return false;
    if (doc.pdfDataUrl && doc.pdfDataUrl.startsWith('blob:')) return false;
    if (doc.renderedPageDataUrl && doc.renderedPageDataUrl.startsWith('blob:')) return false;
    return true;
  }
  return true;
}

function safeDeepCloneEntry(obj: CanvasObject): CanvasObject | null {
  if (!isValidClonableResource(obj)) return null;
  try {
    return JSON.parse(JSON.stringify(obj)) as CanvasObject;
  } catch {
    return null;
  }
}

export function setInternalClipboard(
  objects: CanvasObject[],
  groups: GroupRecord[]
): { storedCount: number; skippedCount: number } {
  try {
    const sorted = [...objects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const clonedObjects: CanvasObject[] = [];
    let skippedCount = 0;

    for (const item of sorted) {
      const cloned = safeDeepCloneEntry(item);
      if (cloned) {
        clonedObjects.push(cloned);
      } else {
        skippedCount += 1;
      }
    }

    const clonedGroups = ensureGroupsArray(groups).map((g) => ({ ...g }));
    const now = Date.now();
    storedClipboard = {
      objects: clonedObjects,
      groups: clonedGroups,
      copiedAt: now,
    };
    clipboardMeta = {
      copiedAt: now,
      preferInternal: clonedObjects.length > 0,
      blurredSinceCopy: false,
    };
    return { storedCount: clonedObjects.length, skippedCount };
  } catch {
    return { storedCount: 0, skippedCount: objects.length };
  }
}

export function getInternalClipboard(): InternalClipboardPayload | null {
  if (!storedClipboard || storedClipboard.objects.length === 0) return null;
  return storedClipboard;
}

export function hasInternalClipboard(): boolean {
  return Boolean(storedClipboard && storedClipboard.objects.length > 0);
}

export function markInternalClipboardBlurred(): void {
  clipboardMeta.blurredSinceCopy = true;
}

export function markSystemClipboardPreferred(): void {
  clipboardMeta.preferInternal = false;
}

export function getInternalClipboardMeta(): InternalClipboardMeta {
  return clipboardMeta;
}

export function cloneClipboardEntriesForPaste(
  source: { objects: CanvasObject[]; groups: GroupRecord[] },
  options: {
    deltaX: number;
    deltaY: number;
    layerId: string;
    startZIndex: number;
  }
): {
  clones: CanvasObject[];
  newGroups: GroupRecord[];
  skippedCount: number;
} {
  const validSource: CanvasObject[] = [];
  let skippedCount = 0;

  const sorted = [...source.objects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  for (const item of sorted) {
    const verified = safeDeepCloneEntry(item);
    if (verified) {
      validSource.push(verified);
    } else {
      skippedCount += 1;
    }
  }

  if (validSource.length === 0) {
    return { clones: [], newGroups: [], skippedCount };
  }

  const { clones, newGroups } = cloneObjectsWithGroupTree(
    validSource,
    ensureGroupsArray(source.groups),
    options.deltaX,
    options.deltaY,
    options.layerId,
    options.startZIndex
  );

  const normalizedClones = clones.map((c) => {
    try {
      return c.type === 'table' ? normalizarTabla(c) : c;
    } catch {
      return c;
    }
  });

  return {
    clones: normalizedClones,
    newGroups,
    skippedCount,
  };
}
