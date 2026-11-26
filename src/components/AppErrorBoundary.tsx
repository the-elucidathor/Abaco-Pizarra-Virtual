import React from 'react';
import { AlertOctagon, Check, Copy, RotateCcw, ShieldAlert, History } from 'lucide-react';
import {
  getLastOpenedProjectId,
  listSnapshots,
  loadProject,
  loadSnapshot,
  saveProject,
} from '../services/storageService';
import { convertProjectToSafeMode, loadPreMigrationBackup } from '../utils/richText';

export const SAFE_MODE_BOOT_KEY = 'abaco_safe_mode_boot_v1';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  errorStack: string;
  copied: boolean;
  restoring: boolean;
  restoreNotice: string | null;
  retryCounter: number;
}

// Límite de error global de la aplicación con opciones de recuperación sin pérdida de proyectos
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      errorStack: '',
      copied: false,
      restoring: false,
      restoreNotice: null,
      retryCounter: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message || 'Error inesperado en la aplicación.',
      errorStack: error?.stack || '',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const fullStack = [error?.stack || '', errorInfo?.componentStack || '']
      .filter(Boolean)
      .join('\n');
    console.error('[Ábaco] Error crítico de interfaz capturado:', error, errorInfo);
    this.setState({
      errorMessage: error?.message || String(error),
      errorStack: fullStack,
    });
  }

  private handleCopyError = async () => {
    const text = `[Ábaco Error]\n${this.state.errorMessage}\n\n${this.state.errorStack}`;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Respaldo si el portapapeles no está disponible
    }
  };

  private handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      errorMessage: '',
      errorStack: '',
      restoreNotice: null,
      retryCounter: prev.retryCounter + 1,
    }));
  };

  private handleOpenSafeMode = async () => {
    this.setState({ restoring: true, restoreNotice: null });
    try {
      sessionStorage.setItem(SAFE_MODE_BOOT_KEY, '1');
    } catch {
      // Ignorar si sessionStorage no está disponible
    }
    try {
      const lastId = getLastOpenedProjectId();
      if (lastId) {
        const proj = await loadProject(lastId);
        if (proj) {
          const safeProj = convertProjectToSafeMode(proj);
          await saveProject(safeProj, false);
        }
      }
    } catch (err) {
      console.error('[Ábaco] Error al preparar modo seguro:', err);
    }
    this.setState((prev) => ({
      hasError: false,
      errorMessage: '',
      errorStack: '',
      restoring: false,
      restoreNotice: null,
      retryCounter: prev.retryCounter + 1,
    }));
  };

  private handleRestoreLastStable = async () => {
    this.setState({ restoring: true, restoreNotice: null });
    try {
      const lastId = getLastOpenedProjectId();
      if (lastId) {
        // 1. Intenta primero la última instantánea estable guardada
        const snaps = await listSnapshots(lastId);
        if (snaps.length > 0) {
          const snapProj = await loadSnapshot(lastId, snaps[0].snapshotId);
          if (snapProj) {
            await saveProject(snapProj, false);
            this.setState((prev) => ({
              hasError: false,
              errorMessage: '',
              errorStack: '',
              restoring: false,
              restoreNotice: null,
              retryCounter: prev.retryCounter + 1,
            }));
            return;
          }
        }

        // 2. Si no hay instantánea, intenta restaurar el respaldo previo a la migración en localStorage
        const preBackup = loadPreMigrationBackup(lastId);
        if (preBackup) {
          await saveProject(preBackup, false);
          this.setState((prev) => ({
            hasError: false,
            errorMessage: '',
            errorStack: '',
            restoring: false,
            restoreNotice: null,
            retryCounter: prev.retryCounter + 1,
          }));
          return;
        }
      }

      // 3. Como último recurso, abre en modo seguro normalizando los textos
      await this.handleOpenSafeMode();
    } catch (err) {
      console.error('[Ábaco] No se pudo restaurar la última versión estable:', err);
      this.setState({
        restoring: false,
        restoreNotice: 'No se encontró una versión previa; prueba "Abrir en modo seguro".',
      });
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const errorDump = `${this.state.errorMessage}\n${this.state.errorStack}`.trim();
      return (
        <div className="min-h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-xl w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0">
                <AlertOctagon className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-base font-semibold">
                  Se produjo un error inesperado en Ábaco
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Tus proyectos guardados permanecen protegidos. Puedes reintentar, abrir el
                  proyecto en modo seguro o restaurar la última versión estable.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Detalle del error
                </span>
                <button
                  type="button"
                  onClick={this.handleCopyError}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {this.state.copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copiar error
                    </>
                  )}
                </button>
              </div>
              <textarea
                readOnly
                value={errorDump}
                rows={5}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-[11px] font-mono text-red-700 dark:text-red-300 select-all"
              />
            </div>

            {this.state.restoreNotice && (
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                {this.state.restoreNotice}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={this.state.restoring}
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reintentar
              </button>
              <button
                type="button"
                disabled={this.state.restoring}
                onClick={this.handleOpenSafeMode}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                Abrir en modo seguro
              </button>
              <button
                type="button"
                disabled={this.state.restoring}
                onClick={this.handleRestoreLastStable}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                Restaurar última versión estable
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryCounter}>{this.props.children}</React.Fragment>;
  }
}
