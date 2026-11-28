import type {
  CadCommandId,
  CadDraftingConfig,
  CadSessionState,
} from '../../types/cad';
import type { CanvasObject, GroupRecord, Point2D } from '../../types/whiteboard';
import { getObjectsBoundingBox } from '../id';
import {
  cadDistToWorldDist,
  formatCadNumber,
  getUnitShortLabel,
  worldDistToCadDist,
  worldToCad,
} from './cadCoords';
import { type CadAidToggleCommand, parseCadInput } from './cadParser';
import {
  type CadBuildContext,
  buildCadArcFrom3Points,
  buildCadArcFromCenterStartEnd,
  buildCadCircle,
  buildCadLine,
  buildCadPolygon,
  buildCadPolyline,
  buildCadRectangle,
} from './cadBuilders';
import {
  buildDimensionObject,
  createDimensionAnchor,
  extractCircleRadiusAtPoint,
  recomputeAssociativeDimensions,
  resolveLinearAxisMode,
} from './cadDimensions';
import { expandSelectionToGroups, ensureGroupsArray } from './cadGroups';
import { findObjectNearWorldPoint } from './cadSnap';
import {
  joinCompatibleSegments,
  matchPointBetweenObjects,
  mirrorObjectsAcrossLine,
} from './cadTransform';
import {
  extractWorldPathPoints,
  generatePathArray,
  resolvePathArrayBasePoint,
} from './cadArrays';

export interface CadOptionButton {
  code: string;
  label: string;
  active?: boolean;
}

export interface CadPromptInfo {
  commandLabel: string;
  prompt: string;
  options: CadOptionButton[];
  hasBasePoint: boolean;
  baseWorld: Point2D | null;
}

export function getCadBasePoint(session: CadSessionState): Point2D | null {
  if (!session.activeCommand) return null;
  if (session.activeCommand === 'array-path') {
    return session.pathArray.customBasePointWorld;
  }
  if (session.points.length === 0) return null;
  if (
    session.activeCommand === 'circle' ||
    session.activeCommand === 'polygon' ||
    session.activeCommand === 'dim-radial' ||
    session.activeCommand === 'dim-diametral' ||
    session.activeCommand === 'dim-angular'
  ) {
    return session.points[0];
  }
  if (session.activeCommand === 'arc') {
    if (session.arcMethod === 'center-start-angle') {
      return session.points[0];
    }
    return session.points[session.points.length - 1];
  }
  return session.points[session.points.length - 1];
}

export function getCadPromptInfo(
  session: CadSessionState,
  config: CadDraftingConfig,
  selectedCount = 0
): CadPromptInfo {
  const baseWorld = getCadBasePoint(session);
  const unitLabel = getUnitShortLabel(config.unit);

  if (session.pickingOrigin) {
    return {
      commandLabel: 'ORIGEN',
      prompt: 'Haz clic en la pizarra o ingresa X,Y para fijar el nuevo origen (0,0):',
      options: [{ code: 'RESET', label: 'Restablecer (0,0)' }],
      hasBasePoint: false,
      baseWorld: null,
    };
  }

  switch (session.activeCommand) {
    case 'line':
      if (session.points.length === 0) {
        return {
          commandLabel: 'LIN',
          prompt: 'Especifique el primer punto (X,Y o clic en la pizarra):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'LIN',
        prompt:
          'Especifique el siguiente punto (@dX,dY · @dist<áng · distancia) o [Enter] terminar:',
        options: [
          ...(session.lastLineIds.length > 0 ? [{ code: 'U', label: 'Deshacer (U)' }] : []),
          { code: 'ENTER', label: 'Terminar' },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'pline':
      if (session.points.length === 0) {
        return {
          commandLabel: 'PL',
          prompt: 'Especifique el punto inicial de la polilínea (X,Y o clic):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'PL',
        prompt:
          session.points.length >= 3
            ? 'Siguiente vértice (@dX,dY · @dist<áng · distancia) o [C] Cerrar · [Enter] Terminar:'
            : 'Especifique el siguiente vértice (@dX,dY · @dist<áng · distancia) o [Enter] Terminar:',
        options: [
          ...(session.points.length >= 3 ? [{ code: 'C', label: 'Cerrar (C)' }] : []),
          ...(session.points.length >= 2 ? [{ code: 'U', label: 'Deshacer (U)' }] : []),
          ...(session.points.length >= 2 ? [{ code: 'ENTER', label: 'Finalizar' }] : []),
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'rectangle':
      if (session.points.length === 0) {
        return {
          commandLabel: 'REC',
          prompt: 'Especifique la primera esquina del rectángulo (X,Y o clic):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.rectMethod === 'dimensions') {
        if (session.rectWidthWorld === undefined) {
          return {
            commandLabel: 'REC',
            prompt: `Especifique longitud (ancho en ${unitLabel}) o Ancho×Alto (ej. 120x80):`,
            options: [{ code: 'D', label: 'Por esquinas' }],
            hasBasePoint: true,
            baseWorld,
          };
        }
        return {
          commandLabel: 'REC',
          prompt: `Especifique la altura del rectángulo (${unitLabel}):`,
          options: [{ code: 'D', label: 'Por esquinas' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: 'REC',
        prompt: 'Especifique la esquina opuesta (@dX,dY · Ancho×Alto) o [D] Dimensiones:',
        options: [{ code: 'D', label: 'Dimensiones (D)' }],
        hasBasePoint: true,
        baseWorld,
      };

    case 'circle':
      if (session.points.length === 0) {
        return {
          commandLabel: 'CIR',
          prompt: 'Especifique el centro del círculo (X,Y o clic):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'CIR',
        prompt:
          session.circleMethod === 'diameter'
            ? `Especifique el diámetro del círculo (${unitLabel}) o clic en borde:`
            : `Especifique el radio del círculo (${unitLabel}) o [D] Diámetro:`,
        options: [
          {
            code: 'D',
            label: session.circleMethod === 'diameter' ? 'Usar Radio (D)' : 'Diámetro (D)',
            active: session.circleMethod === 'diameter',
          },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'arc':
      if (session.arcMethod === 'center-start-angle') {
        if (session.points.length === 0) {
          return {
            commandLabel: 'ARC',
            prompt: 'Especifique el centro del arco (X,Y o clic) o [M] Método 3 Puntos:',
            options: [{ code: 'M', label: 'Método: Centro-Inicio' }],
            hasBasePoint: false,
            baseWorld: null,
          };
        }
        if (session.points.length === 1) {
          return {
            commandLabel: 'ARC',
            prompt: 'Especifique el punto inicial del arco (X,Y · @dist<áng o clic):',
            options: [{ code: 'M', label: 'Cambiar a 3 Puntos (M)' }],
            hasBasePoint: true,
            baseWorld,
          };
        }
        return {
          commandLabel: 'ARC',
          prompt: 'Especifique el punto final o ángulo de barrido en grados (ej. 90):',
          options: [{ code: 'U', label: 'Paso anterior' }],
          hasBasePoint: true,
          baseWorld,
        };
      }

      if (session.points.length === 0) {
        return {
          commandLabel: 'ARC',
          prompt: 'Especifique el punto inicial del arco (X,Y o clic) o [M] Centro-Inicio-Ángulo:',
          options: [{ code: 'M', label: 'Método: 3 Puntos' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 1) {
        return {
          commandLabel: 'ARC',
          prompt: 'Especifique el segundo punto sobre el arco (X,Y · @dX,dY o clic):',
          options: [{ code: 'M', label: 'Centro-Inicio-Ángulo (M)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: 'ARC',
        prompt: 'Especifique el punto final del arco (X,Y · @dX,dY o clic):',
        options: [{ code: 'U', label: 'Paso anterior' }],
        hasBasePoint: true,
        baseWorld,
      };

    case 'polygon':
      if (session.step === 0) {
        return {
          commandLabel: 'POL',
          prompt: `Indique número de lados (${session.polygonSides}) o especifique el centro directo:`,
          options: [
            { code: 'I', label: 'Inscrito (I)', active: session.polygonFit === 'inscribed' },
            { code: 'E', label: 'Circunscrito (E)', active: session.polygonFit === 'circumscribed' },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 0) {
        return {
          commandLabel: 'POL',
          prompt: `Especifique el centro del polígono (${session.polygonSides} lados):`,
          options: [
            { code: 'I', label: 'Inscrito (I)', active: session.polygonFit === 'inscribed' },
            { code: 'E', label: 'Circunscrito (E)', active: session.polygonFit === 'circumscribed' },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'POL',
        prompt: `Especifique el radio (${session.polygonFit === 'inscribed' ? 'Inscrito' : 'Circunscrito'} · ${session.polygonSides} lados):`,
        options: [
          { code: 'I', label: 'Inscrito (I)', active: session.polygonFit === 'inscribed' },
          { code: 'E', label: 'Circunscrito (E)', active: session.polygonFit === 'circumscribed' },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'dim-linear':
      if (session.points.length === 0) {
        return {
          commandLabel: 'ACL',
          prompt: 'Acotación lineal: especifique el primer punto de extensión (use RG o X,Y):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 1) {
        return {
          commandLabel: 'ACL',
          prompt: 'Especifique el segundo punto de extensión:',
          options: [{ code: 'U', label: 'Anterior (U)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: 'ACL',
        prompt: 'Especifique la posición de la línea de cota (Auto detecta H, V o Alineada) o elija eje:',
        options: [
          { code: 'A', label: 'Auto (A)', active: session.linearDimAxis === 'auto' },
          { code: 'H', label: 'Horizontal (H)', active: session.linearDimAxis === 'horizontal' },
          { code: 'V', label: 'Vertical (V)', active: session.linearDimAxis === 'vertical' },
          { code: 'D', label: 'Alineada (D)', active: session.linearDimAxis === 'aligned' },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'dim-aligned':
      if (session.points.length === 0) {
        return {
          commandLabel: 'ACA',
          prompt: 'Acotación alineada: especifique el primer punto (use RG o X,Y):',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 1) {
        return {
          commandLabel: 'ACA',
          prompt: 'Especifique el segundo punto:',
          options: [{ code: 'U', label: 'Anterior (U)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: 'ACA',
        prompt: 'Especifique la separación y posición de la cota alineada:',
        options: [{ code: 'U', label: 'Anterior (U)' }],
        hasBasePoint: true,
        baseWorld,
      };

    case 'dim-angular':
      if (session.points.length === 0) {
        return {
          commandLabel: 'ANG',
          prompt: 'Acotación angular: especifique el vértice del ángulo:',
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 1) {
        return {
          commandLabel: 'ANG',
          prompt: 'Especifique un punto sobre el primer lado del ángulo:',
          options: [{ code: 'U', label: 'Anterior (U)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      if (session.points.length === 2) {
        return {
          commandLabel: 'ANG',
          prompt: 'Especifique un punto sobre el segundo lado del ángulo:',
          options: [{ code: 'U', label: 'Anterior (U)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: 'ANG',
        prompt: 'Especifique la posición y radio del arco de cota angular:',
        options: [{ code: 'U', label: 'Anterior (U)' }],
        hasBasePoint: true,
        baseWorld,
      };

    case 'dim-radial':
    case 'dim-diametral': {
      const code = session.activeCommand === 'dim-radial' ? 'RAD' : 'DIA';
      const title = session.activeCommand === 'dim-radial' ? 'radial' : 'diametral';
      if (session.points.length === 0) {
        return {
          commandLabel: code,
          prompt: `Acotación ${title}: haz clic sobre un círculo/arco o especifique el centro:`,
          options: [{ code: 'ESC', label: 'Cancelar' }],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 1) {
        return {
          commandLabel: code,
          prompt: 'Especifique un punto en el borde (circunferencia) para fijar el radio:',
          options: [{ code: 'U', label: 'Anterior (U)' }],
          hasBasePoint: true,
          baseWorld,
        };
      }
      return {
        commandLabel: code,
        prompt: `Especifique dónde colocar la línea y etiqueta de cota ${title}:`,
        options: [{ code: 'U', label: 'Anterior (U)' }],
        hasBasePoint: true,
        baseWorld,
      };
    }

    case 'dim-ordinate':
      if (session.points.length === 0) {
        return {
          commandLabel: 'COR',
          prompt: 'Cota por coordenadas: especifique el punto a medir (X,Y o RG):',
          options: [
            { code: 'X', label: 'Medir X', active: session.linearDimAxis === 'horizontal' },
            { code: 'Y', label: 'Medir Y', active: session.linearDimAxis === 'vertical' },
            { code: 'A', label: 'Auto', active: session.linearDimAxis === 'auto' },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'COR',
        prompt: 'Especifique el extremo de la directriz de cota:',
        options: [
          { code: 'X', label: 'Medir X', active: session.linearDimAxis === 'horizontal' },
          { code: 'Y', label: 'Medir Y', active: session.linearDimAxis === 'vertical' },
          { code: 'U', label: 'Anterior (U)' },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'mirror':
      if (selectedCount === 0) {
        return {
          commandLabel: 'SIM',
          prompt: 'Simetría: haz clic sobre un objeto (o grupo) para reflejarlo:',
          options: [
            { code: 'S', label: 'Conservar origen (S)', active: session.mirrorKeepSource },
            { code: 'N', label: 'Eliminar origen (N)', active: !session.mirrorKeepSource },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      if (session.points.length === 0) {
        return {
          commandLabel: 'SIM',
          prompt: `Simetría (${selectedCount} sel.): especifique 1er punto del eje o elija eje rápido [H]/[V]:`,
          options: [
            { code: 'H', label: 'Eje Horizontal (H)' },
            { code: 'V', label: 'Eje Vertical (V)' },
            { code: 'S', label: 'Conservar origen', active: session.mirrorKeepSource },
            { code: 'N', label: 'Eliminar origen', active: !session.mirrorKeepSource },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'SIM',
        prompt: 'Especifique el segundo punto del eje de simetría (X,Y o clic):',
        options: [
          { code: 'H', label: 'Horizontal por P1 (H)' },
          { code: 'V', label: 'Vertical por P1 (V)' },
          { code: 'S', label: 'Conservar origen', active: session.mirrorKeepSource },
          { code: 'N', label: 'Eliminar origen', active: !session.mirrorKeepSource },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'match-points':
      if (session.points.length === 0) {
        return {
          commandLabel: 'CP',
          prompt: 'Coincidencia de puntos: selecciona el punto en el Elemento 1 (usa RG □ △ ○ ◇):',
          options: [
            {
              code: 'F',
              label: session.matchKeepFirstFixed ? 'Fijo: Elemento 1 (F)' : 'Fijo: Elemento 2 (F)',
              active: true,
            },
          ],
          hasBasePoint: false,
          baseWorld: null,
        };
      }
      return {
        commandLabel: 'CP',
        prompt: session.matchKeepFirstFixed
          ? 'Selecciona el punto del Elemento 2 que se moverá hasta coincidir con el Elemento 1:'
          : 'Selecciona el punto destino en el Elemento 2 (el Elemento 1 se moverá hacia él):',
        options: [
          {
            code: 'F',
            label: session.matchKeepFirstFixed ? 'Fijo: Elemento 1 (F)' : 'Fijo: Elemento 2 (F)',
            active: true,
          },
          { code: 'U', label: 'Cambiar P1 (U)' },
        ],
        hasBasePoint: true,
        baseWorld,
      };

    case 'join':
      return {
        commandLabel: 'UNI',
        prompt: `Unir segmentos (${selectedCount > 0 ? `${selectedCount} sel.` : 'todos los contiguos'} · tol: ${formatCadNumber(session.joinToleranceCad, config.decimals)} ${unitLabel}):`,
        options: [
          { code: 'ENTER', label: 'Ejecutar unión' },
          { code: 'ESC', label: 'Cancelar' },
        ],
        hasBasePoint: false,
        baseWorld: null,
      };

    case 'array-path': {
      const pa = session.pathArray;
      const baseLabel =
        pa.basePointMode === 'center'
          ? 'Base: Centro'
          : pa.basePointMode === 'custom'
          ? 'Base: Pers.'
          : 'Base: Extremo';

      if (session.step === 0) {
        return {
          commandLabel: 'MC',
          prompt: 'Especifique punto base [Centro/Extremo/Personalizado]:',
          options: [
            { code: 'E', label: 'Extremo (predet.)', active: pa.basePointMode === 'closest' },
            { code: 'C', label: 'Centro', active: pa.basePointMode === 'center' },
            { code: 'P', label: 'Personalizado', active: pa.basePointMode === 'custom' },
            { code: 'O', label: 'Panel MC' },
            { code: 'ENTER', label: 'Siguiente → Camino' },
          ],
          hasBasePoint: Boolean(pa.customBasePointWorld),
          baseWorld: pa.customBasePointWorld,
        };
      }

      if (session.step === 1) {
        return {
          commandLabel: 'MC',
          prompt: 'Seleccione el camino (línea, polilínea, arco, círculo o trazo):',
          options: [
            { code: 'B', label: baseLabel },
            { code: 'A', label: pa.alignToPath ? 'Alinear: Sí' : 'Alinear: No', active: pa.alignToPath },
            {
              code: 'I',
              label: pa.includeOriginalAtStart ? 'Orig. inicio: Sí' : 'Orig. inicio: No',
              active: pa.includeOriginalAtStart,
            },
            { code: 'O', label: 'Panel MC' },
          ],
          hasBasePoint: Boolean(pa.customBasePointWorld),
          baseWorld: pa.customBasePointWorld,
        };
      }

      const distLabel = formatCadNumber(
        worldDistToCadDist(pa.spacingWorld, config),
        config.decimals
      );
      return {
        commandLabel: 'MC',
        prompt:
          pa.mode === 'count'
            ? `MC (${pa.count} elem. · Alinear: ${pa.alignToPath ? 'Sí' : 'No'} · Orig. inicio: ${pa.includeOriginalAtStart ? 'Sí' : 'No'}): escribe cantidad o Enter`
            : `MC (sep. ${distLabel} ${unitLabel} · Alinear: ${pa.alignToPath ? 'Sí' : 'No'}): escribe distancia o Enter`,
        options: [
          { code: 'ENTER', label: 'Aplicar', active: true },
          { code: 'A', label: pa.alignToPath ? 'Alinear: Sí' : 'Alinear: No', active: pa.alignToPath },
          {
            code: 'I',
            label: pa.includeOriginalAtStart ? 'Orig. inicio: Sí' : 'Orig. inicio: No',
            active: pa.includeOriginalAtStart,
          },
          { code: 'D', label: pa.mode === 'count' ? 'Modo: Cantidad' : 'Modo: Distancia' },
          { code: 'B', label: baseLabel },
          { code: 'U', label: 'Camino' },
          { code: 'O', label: 'Panel MC' },
        ],
        hasBasePoint: Boolean(pa.customBasePointWorld),
        baseWorld: pa.customBasePointWorld,
      };
    }

    default:
      return {
        commandLabel: 'COMANDO',
        prompt: 'Escribe un comando (LIN, PL, REC, CIR, ARC, POL, ACL, SIM, MR, MP, MC) o dibuja en el lienzo',
        options: [],
        hasBasePoint: false,
        baseWorld: null,
      };
  }
}

export interface CadCommandEffect {
  nextSession: CadSessionState;
  addObjects?: CanvasObject[];
  replaceObjects?: CanvasObject[];
  updateGroups?: GroupRecord[];
  deleteIds?: string[];
  selectIds?: string[];
  startCommand?: CadCommandId;
  toggleAid?: { aid: CadAidToggleCommand; explicit?: boolean };
  updateOriginWorld?: Point2D;
  switchToSelect?: boolean;
  openArrayModal?: 'rect' | 'polar' | 'path';
  triggerAction?: 'group' | 'ungroup' | 'join';
  errorNotice?: string;
}

export function startCadCommandSession(
  cmd: CadCommandId,
  polygonSides = 6
): CadSessionState {
  return {
    activeCommand: cmd,
    step: 0,
    points: [],
    pickedObjectIds: [],
    circleMethod: 'radius',
    rectMethod: 'corner',
    rectWidthWorld: undefined,
    arcMethod: '3point',
    polygonSides: Math.max(3, Math.min(24, polygonSides)),
    polygonFit: 'inscribed',
    linearDimAxis: 'auto',
    mirrorKeepSource: true,
    matchKeepFirstFixed: true,
    joinToleranceCad: 2,
    pathArray: {
      basePointMode: 'closest',
      customBasePointWorld: null,
      pathObjectId: null,
      mode: 'count',
      count: 6,
      spacingWorld: 80,
      alignToPath: false,
      includeOriginalAtStart: false,
    },
    lastLineIds: [],
    pickingOrigin: false,
    statusMessage: null,
  };
}

export function applyCadPointPick(
  session: CadSessionState,
  pickedWorld: Point2D,
  config: CadDraftingConfig,
  ctx: CadBuildContext,
  objects: CanvasObject[] = [],
  groups: GroupRecord[] = [],
  selectedIds: string[] = [],
  pickedObjectId?: string | null
): CadCommandEffect {
  if (session.pickingOrigin) {
    const unitLabel = getUnitShortLabel(config.unit);
    return {
      updateOriginWorld: pickedWorld,
      nextSession: {
        ...session,
        pickingOrigin: false,
        statusMessage: `Origen fijado en (${formatCadNumber(pickedWorld.x, 1)}, ${formatCadNumber(pickedWorld.y, 1)}) px (${unitLabel})`,
      },
    };
  }

  const cmd = session.activeCommand;
  if (!cmd) return { nextSession: session };

  const resolvedObjId =
    pickedObjectId ??
    findObjectNearWorldPoint(pickedWorld, objects, 14)?.id ??
    null;

  if (cmd === 'line') {
    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const prevPt = session.points[session.points.length - 1];
    if (Math.hypot(pickedWorld.x - prevPt.x, pickedWorld.y - prevPt.y) < 1e-3) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'El punto coincide con el anterior; indica otro destino.',
        },
      };
    }
    const lineObj = buildCadLine(prevPt, pickedWorld, ctx);
    return {
      addObjects: [lineObj],
      selectIds: [lineObj.id],
      nextSession: {
        ...session,
        step: session.step + 1,
        points: [...session.points, pickedWorld],
        pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
        lastLineIds: [...session.lastLineIds, lineObj.id],
        statusMessage: null,
      },
    };
  }

  if (cmd === 'pline') {
    const pts = session.points;
    if (pts.length > 0) {
      const prevPt = pts[pts.length - 1];
      if (Math.hypot(pickedWorld.x - prevPt.x, pickedWorld.y - prevPt.y) < 1e-3) {
        return {
          nextSession: {
            ...session,
            statusMessage: 'El vértice coincide con el anterior.',
          },
        };
      }
    }
    return {
      nextSession: {
        ...session,
        step: pts.length + 1,
        points: [...pts, pickedWorld],
        pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
        statusMessage: null,
      },
    };
  }

  if (cmd === 'rectangle') {
    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          rectMethod: 'corner',
          rectWidthWorld: undefined,
          statusMessage: null,
        },
      };
    }
    const corner1 = session.points[0];
    if (
      Math.abs(pickedWorld.x - corner1.x) < 1 ||
      Math.abs(pickedWorld.y - corner1.y) < 1
    ) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'El rectángulo debe tener ancho y alto mayores a cero.',
        },
      };
    }
    const rectObj = buildCadRectangle(corner1, pickedWorld, ctx);
    return {
      addObjects: [rectObj],
      selectIds: [rectObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        rectWidthWorld: undefined,
        statusMessage: 'Rectángulo creado',
      },
    };
  }

  if (cmd === 'circle') {
    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const center = session.points[0];
    const distWorld = Math.hypot(pickedWorld.x - center.x, pickedWorld.y - center.y);
    if (distWorld < 1) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'El radio debe ser mayor a cero.',
        },
      };
    }
    const circleObj = buildCadCircle(center, distWorld, ctx);
    return {
      addObjects: [circleObj],
      selectIds: [circleObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Círculo creado',
      },
    };
  }

  if (cmd === 'arc') {
    const pts = session.points;
    if (pts.length < 2) {
      return {
        nextSession: {
          ...session,
          step: pts.length + 1,
          points: [...pts, pickedWorld],
          pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const arcObj =
      session.arcMethod === 'center-start-angle'
        ? buildCadArcFromCenterStartEnd(pts[0], pts[1], pickedWorld, config, ctx)
        : buildCadArcFrom3Points(pts[0], pts[1], pickedWorld, ctx);

    if (!arcObj) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'Los 3 puntos son colineales; elige un punto que defina curvatura.',
        },
      };
    }
    return {
      addObjects: [arcObj],
      selectIds: [arcObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Arco creado',
      },
    };
  }

  if (cmd === 'polygon') {
    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 2,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const center = session.points[0];
    const radiusWorld = Math.hypot(pickedWorld.x - center.x, pickedWorld.y - center.y);
    if (radiusWorld < 1) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'El radio del polígono debe ser mayor a cero.',
        },
      };
    }
    const polyObj = buildCadPolygon(
      center,
      radiusWorld,
      session.polygonSides,
      session.polygonFit,
      ctx
    );
    return {
      addObjects: [polyObj],
      selectIds: [polyObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: `Polígono de ${session.polygonSides} lados creado`,
      },
    };
  }

  // ---- ACOTACIÓN (ACL, ACA, ANG, RAD, DIA, COR) ----
  if (cmd === 'dim-linear' || cmd === 'dim-aligned') {
    if (session.points.length < 2) {
      return {
        nextSession: {
          ...session,
          step: session.points.length + 1,
          points: [...session.points, pickedWorld],
          pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const [p1, p2] = session.points;
    const [id1, id2] = session.pickedObjectIds;
    const resolvedAxis =
      cmd === 'dim-linear'
        ? resolveLinearAxisMode(p1, p2, pickedWorld, session.linearDimAxis)
        : 'aligned';
    const finalDimKind =
      cmd === 'dim-aligned' || resolvedAxis === 'aligned' ? 'aligned' : 'linear';
    const dimObj = buildDimensionObject(
      {
        dimKind: finalDimKind,
        p1,
        p2,
        offsetPt: pickedWorld,
        linearAxis: finalDimKind === 'linear' ? session.linearDimAxis : undefined,
        anchor1: createDimensionAnchor(id1, p1, objects, 'point'),
        anchor2: createDimensionAnchor(id2, p2, objects, 'point'),
      },
      config,
      ctx
    );
    return {
      addObjects: [dimObj],
      selectIds: [dimObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage:
          finalDimKind === 'aligned' ? 'Cota alineada creada' : 'Cota lineal creada',
      },
    };
  }

  if (cmd === 'dim-angular') {
    if (session.points.length < 3) {
      return {
        nextSession: {
          ...session,
          step: session.points.length + 1,
          points: [...session.points, pickedWorld],
          pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const [p1, p2, p3] = session.points;
    const [id1, id2, id3] = session.pickedObjectIds;
    const dimObj = buildDimensionObject(
      {
        dimKind: 'angular',
        p1,
        p2,
        p3,
        offsetPt: pickedWorld,
        anchor1: createDimensionAnchor(id1, p1, objects, 'point'),
        anchor2: createDimensionAnchor(id2, p2, objects, 'point'),
        anchor3: createDimensionAnchor(id3, p3, objects, 'point'),
      },
      config,
      ctx
    );
    return {
      addObjects: [dimObj],
      selectIds: [dimObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Cota angular creada',
      },
    };
  }

  if (cmd === 'dim-radial' || cmd === 'dim-diametral') {
    const dimKind = cmd === 'dim-radial' ? 'radial' : 'diametral';
    if (session.points.length === 0) {
      const targetObj = resolvedObjId
        ? objects.find((o) => o.id === resolvedObjId)
        : findObjectNearWorldPoint(pickedWorld, objects, 18) ?? undefined;
      const circleInfo = extractCircleRadiusAtPoint(targetObj, pickedWorld);
      if (circleInfo && targetObj) {
        return {
          nextSession: {
            ...session,
            step: 2,
            points: [circleInfo.center, circleInfo.rimPt],
            pickedObjectIds: [targetObj.id, targetObj.id],
            statusMessage: null,
          },
        };
      }
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }

    if (session.points.length === 1) {
      if (Math.hypot(pickedWorld.x - session.points[0].x, pickedWorld.y - session.points[0].y) < 1) {
        return {
          nextSession: { ...session, statusMessage: 'El radio debe ser mayor a cero.' },
        };
      }
      return {
        nextSession: {
          ...session,
          step: 2,
          points: [...session.points, pickedWorld],
          pickedObjectIds: [...session.pickedObjectIds, resolvedObjId],
          statusMessage: null,
        },
      };
    }

    const [center, rimPt] = session.points;
    const [id1, id2] = session.pickedObjectIds;
    const dimObj = buildDimensionObject(
      {
        dimKind,
        p1: center,
        p2: rimPt,
        offsetPt: pickedWorld,
        anchor1: createDimensionAnchor(id1, center, objects, 'center'),
        anchor2: createDimensionAnchor(id2 ?? id1, rimPt, objects, 'rim'),
      },
      config,
      ctx
    );
    return {
      addObjects: [dimObj],
      selectIds: [dimObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: dimKind === 'radial' ? 'Cota radial creada' : 'Cota diametral creada',
      },
    };
  }

  if (cmd === 'dim-ordinate') {
    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }
    const p1 = session.points[0];
    const id1 = session.pickedObjectIds[0];
    const ordinateAxis: 'x' | 'y' | undefined =
      session.linearDimAxis === 'horizontal'
        ? 'x'
        : session.linearDimAxis === 'vertical'
        ? 'y'
        : undefined;
    const dimObj = buildDimensionObject(
      {
        dimKind: 'ordinate',
        p1,
        p2: p1,
        offsetPt: pickedWorld,
        ordinateAxis,
        anchor1: createDimensionAnchor(id1, p1, objects, 'point'),
      },
      config,
      ctx
    );
    return {
      addObjects: [dimObj],
      selectIds: [dimObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Cota por coordenadas creada',
      },
    };
  }

  // ---- SIMETRÍA (SIM) ----
  if (cmd === 'mirror') {
    if (selectedIds.length === 0) {
      if (resolvedObjId) {
        const obj = objects.find((o) => o.id === resolvedObjId);
        if (obj) {
          const expanded = expandSelectionToGroups(obj, objects, groups);
          return {
            selectIds: expanded,
            nextSession: {
              ...session,
              statusMessage: `${expanded.length} elemento(s) seleccionado(s). Ahora marca el eje de simetría.`,
            },
          };
        }
      }
      return {
        nextSession: {
          ...session,
          statusMessage: 'Haz clic sobre un elemento para seleccionarlo primero.',
        },
      };
    }

    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [resolvedObjId],
          statusMessage: null,
        },
      };
    }

    const axisA = session.points[0];
    if (Math.hypot(pickedWorld.x - axisA.x, pickedWorld.y - axisA.y) < 1) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'El segundo punto del eje debe ser distinto al primero.',
        },
      };
    }

    const res = mirrorObjectsAcrossLine(
      selectedIds,
      axisA,
      pickedWorld,
      session.mirrorKeepSource,
      objects,
      groups,
      ctx.layerId,
      ctx.zIndex,
      config
    );
    return {
      replaceObjects: recomputeAssociativeDimensions(res.objects, config),
      updateGroups: res.groups,
      selectIds: res.mirroredIds,
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: session.mirrorKeepSource
          ? `Simetría aplicada (${res.mirroredIds.length} objeto(s) reflejados)`
          : 'Simetría aplicada (originales reemplazados)',
      },
    };
  }

  // ---- COINCIDENCIA DE PUNTOS (CP) ----
  if (cmd === 'match-points') {
    const objIdHere =
      resolvedObjId ?? findObjectNearWorldPoint(pickedWorld, objects, 22)?.id ?? null;

    if (!objIdHere) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'Acerca el cursor a un elemento usando RG (extremo, medio, centro o cuadrante).',
        },
      };
    }

    if (session.points.length === 0) {
      return {
        nextSession: {
          ...session,
          step: 1,
          points: [pickedWorld],
          pickedObjectIds: [objIdHere],
          statusMessage: null,
        },
      };
    }

    const p1 = session.points[0];
    const id1 = session.pickedObjectIds[0];
    const p2 = pickedWorld;
    const id2 = objIdHere;

    if (!id1) {
      return {
        nextSession: {
          ...session,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: 'El primer punto no pertenece a ningún objeto válido.',
        },
      };
    }

    if (id1 === id2) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'Selecciona un punto perteneciente a otro elemento distinto.',
        },
      };
    }

    const movingId = session.matchKeepFirstFixed ? id2 : id1;
    const movingPt = session.matchKeepFirstFixed ? p2 : p1;
    const targetPt = session.matchKeepFirstFixed ? p1 : p2;

    const res = matchPointBetweenObjects(objects, groups, movingId, movingPt, targetPt);
    return {
      replaceObjects: recomputeAssociativeDimensions(res.objects, config),
      selectIds: res.movedIds,
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Puntos unidos con precisión geométrica',
      },
    };
  }

  // ---- MATRIZ POR CAMINO (MC) ----
  if (cmd === 'array-path') {
    const selObjs = objects.filter((o) => selectedIds.includes(o.id));
    if (selObjs.length === 0) {
      return {
        switchToSelect: true,
        errorNotice: 'Selecciona al menos un objeto antes de ejecutar la matriz por camino.',
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: 'Comando MC cancelado: sin selección.',
        },
      };
    }

    if (session.step === 0) {
      if (!Number.isFinite(pickedWorld.x) || !Number.isFinite(pickedWorld.y)) {
        return {
          switchToSelect: true,
          errorNotice: 'Punto base inválido. Comando MC cancelado.',
          nextSession: {
            ...session,
            activeCommand: null,
            step: 0,
            points: [],
            pickedObjectIds: [],
          },
        };
      }
      return {
        nextSession: {
          ...session,
          step: session.pathArray.pathObjectId ? 2 : 1,
          points: [pickedWorld],
          pathArray: {
            ...session.pathArray,
            basePointMode: 'custom',
            customBasePointWorld: pickedWorld,
          },
          statusMessage: session.pathArray.pathObjectId
            ? 'Punto base actualizado. Pulsa Enter para aplicar o ajusta opciones.'
            : 'Punto base fijado. Ahora haz clic sobre el camino.',
        },
      };
    }

    if (session.step === 1 || session.step >= 2) {
      // Buscar primero caminos que NO formen parte de los objetos copiados si hay superposición en puntos de apoyo
      const nonSelectedPaths = objects.filter(
        (o) => !selectedIds.includes(o.id) && extractWorldPathPoints(o) !== null
      );
      const validPaths = objects.filter((o) => extractWorldPathPoints(o) !== null);
      const nearNonSel = findObjectNearWorldPoint(pickedWorld, nonSelectedPaths, 20);
      const byResolved =
        pickedObjectId &&
        validPaths.find((o) => o.id === pickedObjectId && !selectedIds.includes(o.id));
      const pathObj =
        byResolved ??
        nearNonSel ??
        (pickedObjectId ? validPaths.find((o) => o.id === pickedObjectId) : null) ??
        findObjectNearWorldPoint(pickedWorld, validPaths, 20);

      if (!pathObj) {
        return {
          errorNotice: 'Haz clic sobre una línea, polilínea, arco, círculo o trazo válido.',
          nextSession: {
            ...session,
            statusMessage: 'Camino inválido: selecciona una línea, polilínea, arco, círculo o trazo.',
          },
        };
      }

      const resolvedBase = resolvePathArrayBasePoint(
        selObjs,
        pathObj,
        session.pathArray.basePointMode,
        session.pathArray.customBasePointWorld
      );
      if (!resolvedBase) {
        return {
          switchToSelect: true,
          errorNotice: 'Punto base inválido. Comando MC cancelado.',
          nextSession: {
            ...session,
            activeCommand: null,
            step: 0,
            points: [],
            pickedObjectIds: [],
          },
        };
      }

      return {
        nextSession: {
          ...session,
          step: 2,
          pathArray: {
            ...session.pathArray,
            pathObjectId: pathObj.id,
          },
          statusMessage:
            'Camino seleccionado. Revisa la previsualización y pulsa Enter para aplicar.',
        },
      };
    }
  }

  return { nextSession: session };
}

function commitPathArraySession(
  session: CadSessionState,
  config: CadDraftingConfig,
  ctx: CadBuildContext,
  objects: CanvasObject[],
  groups: GroupRecord[],
  selectedIds: string[]
): CadCommandEffect {
  const selObjs = objects.filter((o) => selectedIds.includes(o.id));
  const pathObj = session.pathArray.pathObjectId
    ? objects.find((o) => o.id === session.pathArray.pathObjectId)
    : undefined;

  if (selObjs.length === 0 || !pathObj) {
    return {
      switchToSelect: true,
      errorNotice: 'El camino o la selección de matriz por camino ya no son válidos.',
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Matriz por camino cancelada.',
      },
    };
  }

  const res = generatePathArray(
    selObjs,
    ensureGroupsArray(groups),
    pathObj,
    {
      mode: session.pathArray.mode,
      count: session.pathArray.count,
      spacingWorld: session.pathArray.spacingWorld,
      alignToPath: session.pathArray.alignToPath,
      basePointMode: session.pathArray.basePointMode,
      basePointWorld: session.pathArray.customBasePointWorld,
      includeOriginalAtStart: session.pathArray.includeOriginalAtStart,
    },
    config,
    ctx.layerId,
    ctx.zIndex
  );

  if (res.error || res.createdIds.length === 0) {
    return {
      switchToSelect: true,
      errorNotice: res.error ?? 'No se pudieron generar copias sobre el camino.',
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: res.error ?? 'Matriz por camino cancelada.',
      },
    };
  }

  return {
    addObjects: res.addObjects,
    updateGroups: [...ensureGroupsArray(groups), ...res.addGroups],
    selectIds: res.createdIds,
    switchToSelect: true,
    nextSession: {
      ...session,
      activeCommand: null,
      step: 0,
      points: [],
      pickedObjectIds: [],
      statusMessage: `Matriz por camino aplicada (${res.createdIds.length} copia(s))`,
    },
  };
}

export function finishOrCloseCadSession(
  session: CadSessionState,
  closePolyline: boolean,
  ctx: CadBuildContext,
  objects: CanvasObject[] = [],
  selectedIds: string[] = [],
  config?: CadDraftingConfig,
  groups: GroupRecord[] = []
): CadCommandEffect {
  if (session.activeCommand === 'array-path' && config) {
    if (session.step === 0) {
      return {
        nextSession: {
          ...session,
          step: session.pathArray.pathObjectId ? 2 : 1,
          statusMessage: 'Punto base confirmado. Selecciona el camino.',
        },
      };
    }
    if (session.step === 1) {
      if (session.pathArray.pathObjectId) {
        return {
          nextSession: {
            ...session,
            step: 2,
            statusMessage: null,
          },
        };
      }
      return {
        nextSession: {
          ...session,
          statusMessage: 'Haz clic primero sobre un camino en el lienzo.',
        },
      };
    }
    return commitPathArraySession(session, config, ctx, objects, groups, selectedIds);
  }

  if (session.activeCommand === 'pline') {
    if (session.points.length >= 2) {
      const closed = closePolyline && session.points.length >= 3;
      const polyObj = buildCadPolyline(session.points, closed, ctx);
      return {
        addObjects: [polyObj],
        selectIds: [polyObj.id],
        switchToSelect: true,
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: closed ? 'Polilínea cerrada creada' : 'Polilínea creada',
        },
      };
    }
    return {
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: 'Se requieren al menos 2 puntos para la polilínea.',
      },
    };
  }

  if (session.activeCommand === 'line') {
    return {
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        lastLineIds: [],
        statusMessage:
          session.lastLineIds.length > 0 ? 'Comando Línea finalizado' : null,
      },
    };
  }

  if (session.activeCommand === 'join' && config) {
    const tolWorld = cadDistToWorldDist(session.joinToleranceCad, config);
    const res = joinCompatibleSegments(
      selectedIds.length >= 2 ? selectedIds : null,
      objects,
      tolWorld,
      ctx.layerId,
      ctx.zIndex
    );
    if (res.joinedIds.length === 0) {
      return {
        switchToSelect: true,
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: 'No se encontraron segmentos contiguos dentro de la tolerancia.',
        },
      };
    }
    return {
      replaceObjects: recomputeAssociativeDimensions(res.objects, config),
      selectIds: res.joinedIds,
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        statusMessage: `${res.consumedCount} segmentos unidos en ${res.joinedIds.length} polilínea(s)`,
      },
    };
  }

  return { nextSession: session };
}

export function executeCadCommandText(
  rawText: string,
  session: CadSessionState,
  cursorWorld: Point2D | null,
  config: CadDraftingConfig,
  ctx: CadBuildContext,
  objects: CanvasObject[] = [],
  groups: GroupRecord[] = [],
  selectedIds: string[] = [],
  activeTrackingGuide: { origin: Point2D; dir: Point2D } | null = null
): CadCommandEffect {
  const baseWorld = getCadBasePoint(session);
  const trimmed = rawText.trim();

  // Empty Enter confirms/finishes LIN, PL, UNI, or MC
  if (!trimmed) {
    if (
      session.activeCommand === 'line' ||
      session.activeCommand === 'pline' ||
      session.activeCommand === 'join' ||
      session.activeCommand === 'array-path'
    ) {
      return finishOrCloseCadSession(session, false, ctx, objects, selectedIds, config, groups);
    }
    return { nextSession: session };
  }

  const parsed = parseCadInput(trimmed, Boolean(session.activeCommand), baseWorld, config);

  if (parsed.kind === 'command') {
    const cmd = parsed.command;
    if (cmd === 'array-rect') {
      return { openArrayModal: 'rect', nextSession: session };
    }
    if (cmd === 'array-polar') {
      return { openArrayModal: 'polar', nextSession: session };
    }
    if (cmd === 'array-path') {
      if (selectedIds.length === 0) {
        return {
          errorNotice: 'Selecciona al menos un objeto antes de generar una matriz por camino.',
          nextSession: {
            ...session,
            statusMessage: 'Selecciona al menos un objeto antes de generar una matriz.',
          },
        };
      }
      return {
        startCommand: 'array-path',
        nextSession: startCadCommandSession('array-path', session.polygonSides),
      };
    }
    if (cmd === 'group') {
      return { triggerAction: 'group', nextSession: session };
    }
    if (cmd === 'ungroup') {
      return { triggerAction: 'ungroup', nextSession: session };
    }
    if (cmd === 'join' && selectedIds.length >= 2) {
      return finishOrCloseCadSession(
        startCadCommandSession('join', session.polygonSides),
        false,
        ctx,
        objects,
        selectedIds,
        config
      );
    }
    return {
      startCommand: cmd,
      nextSession: startCadCommandSession(cmd, session.polygonSides),
    };
  }

  if (parsed.kind === 'aid') {
    if (parsed.aid === 'origin') {
      return {
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          pickingOrigin: true,
          statusMessage: 'Modo origen activo',
        },
      };
    }
    return {
      toggleAid: { aid: parsed.aid, explicit: parsed.explicit },
      nextSession: {
        ...session,
        statusMessage: `Ayuda de dibujo actualizada`,
      },
    };
  }

  if (session.pickingOrigin) {
    if (trimmed.toUpperCase() === 'RESET') {
      return {
        updateOriginWorld: { x: 0, y: 0 },
        nextSession: {
          ...session,
          pickingOrigin: false,
          statusMessage: 'Origen restablecido en (0,0)',
        },
      };
    }
    if (parsed.kind === 'point') {
      return {
        updateOriginWorld: parsed.world,
        nextSession: {
          ...session,
          pickingOrigin: false,
          statusMessage: 'Origen actualizado',
        },
      };
    }
  }

  if (parsed.kind === 'option') {
    const key = parsed.key;
    if (key === 'C' && session.activeCommand === 'pline') {
      return finishOrCloseCadSession(session, true, ctx);
    }
    if (key === 'U') {
      if (session.activeCommand === 'line' && session.lastLineIds.length > 0) {
        const lastId = session.lastLineIds[session.lastLineIds.length - 1];
        return {
          deleteIds: [lastId],
          nextSession: {
            ...session,
            points: session.points.slice(0, -1),
            pickedObjectIds: session.pickedObjectIds.slice(0, -1),
            lastLineIds: session.lastLineIds.slice(0, -1),
            step: Math.max(0, session.step - 1),
            statusMessage: 'Último segmento deshecho',
          },
        };
      }
      if (session.points.length > 0) {
        return {
          nextSession: {
            ...session,
            points: session.points.slice(0, -1),
            pickedObjectIds: session.pickedObjectIds.slice(0, -1),
            step: Math.max(0, session.points.length - 1),
            statusMessage: 'Último punto deshecho',
          },
        };
      }
    }
    if (key === 'D' && session.activeCommand === 'circle') {
      return {
        nextSession: {
          ...session,
          circleMethod: session.circleMethod === 'radius' ? 'diameter' : 'radius',
          statusMessage: null,
        },
      };
    }
    if (key === 'D' && session.activeCommand === 'rectangle') {
      return {
        nextSession: {
          ...session,
          rectMethod: session.rectMethod === 'corner' ? 'dimensions' : 'corner',
          rectWidthWorld: undefined,
          statusMessage: null,
        },
      };
    }
    if (key === 'M' && session.activeCommand === 'arc') {
      return {
        nextSession: {
          ...session,
          arcMethod:
            session.arcMethod === '3point' ? 'center-start-angle' : '3point',
          points: [],
          pickedObjectIds: [],
          step: 0,
          statusMessage: null,
        },
      };
    }
    if (key === 'I' && session.activeCommand === 'polygon') {
      return {
        nextSession: {
          ...session,
          polygonFit: 'inscribed',
          statusMessage: null,
        },
      };
    }
    if (key === 'E' && session.activeCommand === 'polygon') {
      return {
        nextSession: {
          ...session,
          polygonFit: 'circumscribed',
          statusMessage: null,
        },
      };
    }

    // Dimension linear / ordinate axis options
    if (session.activeCommand === 'dim-linear') {
      if (key === 'H' || key === 'V' || key === 'A' || key === 'D') {
        const nextAxis: CadSessionState['linearDimAxis'] =
          key === 'H'
            ? 'horizontal'
            : key === 'V'
            ? 'vertical'
            : key === 'A'
            ? 'auto'
            : 'aligned';
        return {
          nextSession: {
            ...session,
            linearDimAxis: nextAxis,
            statusMessage: null,
          },
        };
      }
    }
    if (session.activeCommand === 'dim-ordinate') {
      if (key === 'X' || key === 'Y' || key === 'A') {
        return {
          nextSession: {
            ...session,
            linearDimAxis: key === 'X' ? 'horizontal' : key === 'Y' ? 'vertical' : 'auto',
            statusMessage: null,
          },
        };
      }
    }

    // Mirror options
    if (session.activeCommand === 'mirror') {
      if (key === 'S' || key === 'N') {
        return {
          nextSession: {
            ...session,
            mirrorKeepSource: key === 'S',
            statusMessage: null,
          },
        };
      }
      if ((key === 'H' || key === 'V') && selectedIds.length > 0) {
        let axisA = session.points[0];
        if (!axisA) {
          const selObjs = objects.filter((o) => selectedIds.includes(o.id));
          const bbox = getObjectsBoundingBox(selObjs);
          axisA = bbox
            ? { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
            : { x: config.originX, y: config.originY };
        }
        const axisB =
          key === 'H'
            ? { x: axisA.x + 120, y: axisA.y }
            : { x: axisA.x, y: axisA.y + 120 };
        const res = mirrorObjectsAcrossLine(
          selectedIds,
          axisA,
          axisB,
          session.mirrorKeepSource,
          objects,
          groups,
          ctx.layerId,
          ctx.zIndex,
          config
        );
        return {
          replaceObjects: recomputeAssociativeDimensions(res.objects, config),
          updateGroups: res.groups,
          selectIds: res.mirroredIds,
          switchToSelect: true,
          nextSession: {
            ...session,
            activeCommand: null,
            step: 0,
            points: [],
            pickedObjectIds: [],
            statusMessage: `Simetría ${key === 'H' ? 'horizontal' : 'vertical'} aplicada`,
          },
        };
      }
    }

    // Match points option [F]
    if (session.activeCommand === 'match-points' && key === 'F') {
      return {
        nextSession: {
          ...session,
          matchKeepFirstFixed: !session.matchKeepFirstFixed,
          statusMessage: null,
        },
      };
    }

    // Path array (MC) contextual options
    if (session.activeCommand === 'array-path') {
      const pa = session.pathArray;
      if (key === 'E') {
        return {
          nextSession: {
            ...session,
            step: session.step === 0 ? (pa.pathObjectId ? 2 : 1) : session.step,
            pathArray: { ...pa, basePointMode: 'closest', customBasePointWorld: null },
            statusMessage: 'Punto base: extremo más cercano al inicio del camino.',
          },
        };
      }
      if (key === 'C') {
        return {
          nextSession: {
            ...session,
            step: session.step === 0 ? (pa.pathObjectId ? 2 : 1) : session.step,
            pathArray: { ...pa, basePointMode: 'center', customBasePointWorld: null },
            statusMessage: 'Punto base: centro de selección.',
          },
        };
      }
      if (key === 'P') {
        return {
          nextSession: {
            ...session,
            step: 0,
            pathArray: { ...pa, basePointMode: 'custom' },
            statusMessage: 'Haz clic con RG o escribe coordenadas X,Y para el punto base.',
          },
        };
      }
      if (key === 'B') {
        return {
          nextSession: {
            ...session,
            step: 0,
            statusMessage: null,
          },
        };
      }
      if (key === 'U') {
        return {
          nextSession: {
            ...session,
            step: session.step >= 2 ? 1 : 0,
            statusMessage: null,
          },
        };
      }
      if (key === 'A') {
        const nextAlign = !pa.alignToPath;
        return {
          nextSession: {
            ...session,
            pathArray: { ...pa, alignToPath: nextAlign },
            statusMessage: nextAlign
              ? 'Alinear elementos: Sí (siguen tangente del camino).'
              : 'Alinear elementos: No (mantienen orientación original).',
          },
        };
      }
      if (key === 'S' || key === 'N') {
        const nextAlign = key === 'S';
        return {
          nextSession: {
            ...session,
            pathArray: { ...pa, alignToPath: nextAlign },
            statusMessage: nextAlign
              ? 'Alinear elementos: Sí.'
              : 'Alinear elementos: No.',
          },
        };
      }
      if (key === 'I') {
        const nextInc = !pa.includeOriginalAtStart;
        return {
          nextSession: {
            ...session,
            pathArray: { ...pa, includeOriginalAtStart: nextInc },
            statusMessage: nextInc
              ? 'Incluir original en el inicio: Sí (sin duplicar en d=0).'
              : 'Incluir original en el inicio: No (primera copia en d=0).',
          },
        };
      }
      if (key === 'D') {
        const nextMode = pa.mode === 'count' ? 'spacing' : 'count';
        return {
          nextSession: {
            ...session,
            pathArray: { ...pa, mode: nextMode },
            statusMessage:
              nextMode === 'count'
                ? 'Distribución por cantidad de elementos.'
                : 'Distribución por distancia entre elementos.',
          },
        };
      }
      if (key === 'O') {
        return {
          openArrayModal: 'path',
          nextSession: session,
        };
      }
    }

    return { nextSession: session };
  }

  if (parsed.kind === 'point') {
    if (!session.activeCommand) {
      return {
        nextSession: {
          ...session,
          statusMessage: 'Selecciona o escribe primero un comando (LIN, PL, REC, CIR, ARC, POL, ACL, SIM, MR).',
        },
      };
    }
    return applyCadPointPick(session, parsed.world, config, ctx, objects, groups, selectedIds, null);
  }

  if (parsed.kind === 'dimensions' && session.activeCommand === 'rectangle' && session.points.length >= 1) {
    const c1 = session.points[0];
    const dw = cadDistToWorldDist(parsed.widthCad, config);
    const dh = cadDistToWorldDist(parsed.heightCad, config);
    if (Math.abs(dw) < 1 || Math.abs(dh) < 1) {
      return {
        nextSession: { ...session, statusMessage: 'Las dimensiones deben ser mayores a cero.' },
      };
    }
    const c2 = {
      x: c1.x + dw,
      y: c1.y + (config.yAxisUp ? -dh : dh),
    };
    const rectObj = buildCadRectangle(c1, c2, ctx);
    return {
      addObjects: [rectObj],
      selectIds: [rectObj.id],
      switchToSelect: true,
      nextSession: {
        ...session,
        activeCommand: null,
        step: 0,
        points: [],
        pickedObjectIds: [],
        rectWidthWorld: undefined,
        statusMessage: 'Rectángulo creado por dimensiones',
      },
    };
  }

  if (parsed.kind === 'number') {
    const val = parsed.value;
    const cmd = session.activeCommand;

    // 0. Join tolerance numeric input
    if (cmd === 'join') {
      if (val < 0) {
        return { nextSession: { ...session, statusMessage: 'La tolerancia no puede ser negativa.' } };
      }
      return {
        nextSession: {
          ...session,
          joinToleranceCad: val,
          statusMessage: `Tolerancia actualizada a ${val} ${getUnitShortLabel(config.unit)}. Pulsa Enter para unir.`,
        },
      };
    }

    // 0b. Path array (MC) count or spacing numeric input
    if (cmd === 'array-path') {
      const pa = session.pathArray;
      if (pa.mode === 'count') {
        const cnt = Math.max(2, Math.min(80, Math.round(val)));
        return {
          nextSession: {
            ...session,
            pathArray: { ...pa, count: cnt },
            statusMessage: `Cantidad: ${cnt} elementos. Pulsa Enter para aplicar.`,
          },
        };
      }
      const spacingWorld = cadDistToWorldDist(Math.max(0.5, val), config);
      if (!Number.isFinite(spacingWorld) || spacingWorld < 2) {
        return {
          nextSession: { ...session, statusMessage: 'La separación debe ser mayor a cero.' },
        };
      }
      return {
        nextSession: {
          ...session,
          pathArray: { ...pa, spacingWorld },
          statusMessage: `Separación: ${val} ${getUnitShortLabel(config.unit)}. Pulsa Enter para aplicar.`,
        },
      };
    }

    // 1. Direct Distance Entry for LIN / PL when step >= 1 (prioriza guía activa de rastreo RAS si existe)
    if ((cmd === 'line' || cmd === 'pline') && session.points.length >= 1) {
      const distWorld = cadDistToWorldDist(val, config);
      if (activeTrackingGuide) {
        const nextPt = {
          x: activeTrackingGuide.origin.x + activeTrackingGuide.dir.x * distWorld,
          y: activeTrackingGuide.origin.y + activeTrackingGuide.dir.y * distWorld,
        };
        return applyCadPointPick(session, nextPt, config, ctx, objects, groups, selectedIds, null);
      }
      const prevPt = session.points[session.points.length - 1];
      let ux = 1;
      let uy = 0;
      if (cursorWorld) {
        const dx = cursorWorld.x - prevPt.x;
        const dy = cursorWorld.y - prevPt.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-3) {
          ux = dx / len;
          uy = dy / len;
        }
      }
      const nextPt = {
        x: prevPt.x + ux * distWorld,
        y: prevPt.y + uy * distWorld,
      };
      return applyCadPointPick(session, nextPt, config, ctx, objects, groups, selectedIds, null);
    }

    // 2. Circle numeric radius / diameter
    if (cmd === 'circle' && session.points.length >= 1) {
      if (val <= 0) {
        return { nextSession: { ...session, statusMessage: 'El valor debe ser positivo.' } };
      }
      const radiusWorld =
        session.circleMethod === 'diameter'
          ? cadDistToWorldDist(val / 2, config)
          : cadDistToWorldDist(val, config);
      const circleObj = buildCadCircle(session.points[0], radiusWorld, ctx);
      return {
        addObjects: [circleObj],
        selectIds: [circleObj.id],
        switchToSelect: true,
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: 'Círculo creado',
        },
      };
    }

    // 3. Rectangle Dimensions mode step-by-step width -> height
    if (cmd === 'rectangle' && session.points.length >= 1 && session.rectMethod === 'dimensions') {
      const worldVal = cadDistToWorldDist(val, config);
      if (Math.abs(worldVal) < 1) {
        return { nextSession: { ...session, statusMessage: 'La dimensión no puede ser cero.' } };
      }
      if (session.rectWidthWorld === undefined) {
        return {
          nextSession: {
            ...session,
            step: 2,
            rectWidthWorld: worldVal,
            statusMessage: null,
          },
        };
      }
      const c1 = session.points[0];
      const c2 = {
        x: c1.x + session.rectWidthWorld,
        y: c1.y + (config.yAxisUp ? -worldVal : worldVal),
      };
      const rectObj = buildCadRectangle(c1, c2, ctx);
      return {
        addObjects: [rectObj],
        selectIds: [rectObj.id],
        switchToSelect: true,
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          rectWidthWorld: undefined,
          statusMessage: 'Rectángulo creado por dimensiones',
        },
      };
    }

    // 4. Polygon sides (step 0) or radius (step 2)
    if (cmd === 'polygon') {
      if (session.step === 0 && session.points.length === 0) {
        const sides = Math.round(val);
        if (sides < 3 || sides > 24) {
          return {
            nextSession: {
              ...session,
              statusMessage: 'El número de lados debe estar entre 3 y 24.',
            },
          };
        }
        return {
          nextSession: {
            ...session,
            step: 1,
            polygonSides: sides,
            statusMessage: null,
          },
        };
      }
      if (session.points.length >= 1) {
        if (val <= 0) {
          return { nextSession: { ...session, statusMessage: 'El radio debe ser positivo.' } };
        }
        const radiusWorld = cadDistToWorldDist(val, config);
        const polyObj = buildCadPolygon(
          session.points[0],
          radiusWorld,
          session.polygonSides,
          session.polygonFit,
          ctx
        );
        return {
          addObjects: [polyObj],
          selectIds: [polyObj.id],
          switchToSelect: true,
          nextSession: {
            ...session,
            activeCommand: null,
            step: 0,
            points: [],
            pickedObjectIds: [],
            statusMessage: `Polígono de ${session.polygonSides} lados creado`,
          },
        };
      }
    }

    // 5. Arc center-start-angle: step 2 accepts sweep angle in degrees
    if (
      cmd === 'arc' &&
      session.arcMethod === 'center-start-angle' &&
      session.points.length === 2
    ) {
      const center = session.points[0];
      const startPt = session.points[1];
      const angleDeg = val;
      if (Math.abs(angleDeg) < 0.5 || Math.abs(angleDeg) >= 360) {
        return {
          nextSession: {
            ...session,
            statusMessage: 'Introduce un ángulo entre -359° y 359° (distinto de 0).',
          },
        };
      }
      const radWorld = ((config.yAxisUp ? -angleDeg : angleDeg) * Math.PI) / 180;
      const dx = startPt.x - center.x;
      const dy = startPt.y - center.y;
      const cos = Math.cos(radWorld);
      const sin = Math.sin(radWorld);
      const endPt = {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
      };
      const effConfig =
        angleDeg < 0 ? { ...config, yAxisUp: !config.yAxisUp } : config;
      const arcObj = buildCadArcFromCenterStartEnd(
        center,
        startPt,
        endPt,
        effConfig,
        ctx
      );
      if (!arcObj) {
        return { nextSession: { ...session, statusMessage: 'No se pudo generar el arco.' } };
      }
      return {
        addObjects: [arcObj],
        selectIds: [arcObj.id],
        switchToSelect: true,
        nextSession: {
          ...session,
          activeCommand: null,
          step: 0,
          points: [],
          pickedObjectIds: [],
          statusMessage: `Arco creado (${angleDeg}°)`,
        },
      };
    }

    // 6. Entrada de distancia directa sobre guía de rastreo RAS en cualquier otro paso que espera un punto
    if (activeTrackingGuide && (session.pickingOrigin || session.activeCommand)) {
      const distWorld = cadDistToWorldDist(val, config);
      const nextPt = {
        x: activeTrackingGuide.origin.x + activeTrackingGuide.dir.x * distWorld,
        y: activeTrackingGuide.origin.y + activeTrackingGuide.dir.y * distWorld,
      };
      if (session.pickingOrigin) {
        const unitLabel = getUnitShortLabel(config.unit);
        return {
          updateOriginWorld: nextPt,
          nextSession: {
            ...session,
            pickingOrigin: false,
            statusMessage: `Origen fijado en (${formatCadNumber(nextPt.x, 1)}, ${formatCadNumber(nextPt.y, 1)}) px (${unitLabel})`,
          },
        };
      }
      return applyCadPointPick(session, nextPt, config, ctx, objects, groups, selectedIds, null);
    }

    return {
      nextSession: {
        ...session,
        statusMessage: 'Introduce coordenadas X,Y o @dX,dY en este paso.',
      },
    };
  }

  return {
    nextSession: {
      ...session,
      statusMessage: parsed.kind === 'invalid' ? parsed.message : 'Entrada inválida.',
    },
  };
}

export function formatCadCursorCoords(
  worldPt: Point2D,
  config: CadDraftingConfig
): { x: string; y: string; unitLabel: string } {
  const cad = worldToCad(worldPt, config);
  return {
    x: formatCadNumber(cad.x, config.decimals),
    y: formatCadNumber(cad.y, config.decimals),
    unitLabel: getUnitShortLabel(config.unit),
  };
}

export function formatCadDist(distWorld: number, config: CadDraftingConfig): string {
  return formatCadNumber(worldDistToCadDist(distWorld, config), config.decimals);
}
