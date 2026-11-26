// OPT: Sistema centralizado de banderas de optimización (abaco_opt_flags) con recuperación automática ante fallos

export type OptFlagKey =
  | 'rafCycle' // 2.1 Ciclo rAF único por dirty flag
  | 'layeredRender' // 2.2 Separación de capas (contenido estático / vista previa / manejadores)
  | 'viewportCulling' // 2.3 Culling por viewport + caché de BBox
  | 'spatialIndex' // 2.4 Índice espacial uniforme (selección, RG/OSNAP, borrador parcial, corte/trim)
  | 'strokePathCache' // 2.5 Caché de rutas SVG / Path2D para trazos
  | 'reactMemoThrottle' // 2.6 Memoización React + coordenadas/estado a 30 Hz
  | 'incrementalHistory'; // 2.7 Historial incremental o con compartición estructural segura

export type OptFlagsState = Record<OptFlagKey, boolean>;

export const OPT_FLAGS_STORAGE_KEY = 'abaco_opt_flags';

export const DEFAULT_OPT_FLAGS: OptFlagsState = {
  rafCycle: true,
  layeredRender: true,
  viewportCulling: true,
  spatialIndex: true,
  strokePathCache: true,
  reactMemoThrottle: true,
  incrementalHistory: true,
};

let cachedFlags: OptFlagsState | null = null;
const listeners = new Set<(flags: OptFlagsState) => void>();

export function readOptFlags(): OptFlagsState {
  if (cachedFlags) return cachedFlags;
  const resolved: OptFlagsState = { ...DEFAULT_OPT_FLAGS };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(OPT_FLAGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<OptFlagKey, unknown>>;
        if (parsed && typeof parsed === 'object') {
          (Object.keys(DEFAULT_OPT_FLAGS) as OptFlagKey[]).forEach((k) => {
            if (typeof parsed[k] === 'boolean') {
              resolved[k] = parsed[k] as boolean;
            }
          });
        }
      }
    }
  } catch {
    // Si localStorage falla o el JSON es inválido, conserva los valores por defecto
  }
  cachedFlags = resolved;
  return resolved;
}

export function isOptEnabled(flag: OptFlagKey): boolean {
  return readOptFlags()[flag];
}

export function setOptFlags(patch: Partial<OptFlagsState>): OptFlagsState {
  const current = readOptFlags();
  const next: OptFlagsState = { ...current, ...patch };
  cachedFlags = next;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OPT_FLAGS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignorar error de cuota/almacenamiento
  }
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      // No propagar errores de suscriptores
    }
  });
  return next;
}

export function resetOptFlagsCache(): void {
  cachedFlags = null;
}

export function disableOptFlagOnError(flag: OptFlagKey, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(`[Ábaco][opt] Desactivando optimización "${flag}" tras error:`, msg);
  setOptFlags({ [flag]: false });
}

export function subscribeOptFlags(listener: (flags: OptFlagsState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ejecuta la ruta optimizada si la bandera está activa; si falla, registra advertencia,
 * desactiva la bandera automáticamente y ejecuta el método anterior sin romper la UI.
 */
export function safeRunOpt<T>(
  flag: OptFlagKey,
  optimizedFn: () => T,
  fallbackFn: () => T
): T {
  if (!isOptEnabled(flag)) {
    return fallbackFn();
  }
  try {
    return optimizedFn();
  } catch (err) {
    disableOptFlagOnError(flag, err);
    return fallbackFn();
  }
}

// Exposición discreta para inspección y control desde consola de desarrollo (sin UI extra)
if (typeof window !== 'undefined') {
  try {
    const win = window as unknown as {
      __ABACO_OPT_FLAGS__?: {
        get: () => OptFlagsState;
        set: (patch: Partial<OptFlagsState>) => OptFlagsState;
        enableAll: () => OptFlagsState;
        disableAll: () => OptFlagsState;
      };
    };
    win.__ABACO_OPT_FLAGS__ = {
      get: () => ({ ...readOptFlags() }),
      set: (patch) => setOptFlags(patch),
      enableAll: () => setOptFlags({ ...DEFAULT_OPT_FLAGS }),
      disableAll: () =>
        setOptFlags({
          rafCycle: false,
          layeredRender: false,
          viewportCulling: false,
          spatialIndex: false,
          strokePathCache: false,
          reactMemoThrottle: false,
          incrementalHistory: false,
        }),
    };
  } catch {
    // Ignorar en entornos restringidos
  }
}
