import React from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';

interface TextObjectErrorBoundaryProps {
  objectId: string;
  resetKey?: string;
  onRepair: (objectId: string) => void;
  children: React.ReactNode;
}

interface TextObjectErrorBoundaryState {
  hasError: boolean;
}

// Límite de error aislado por cuadro de texto: impide que un texto corrupto derribe toda la pizarra
export class TextObjectErrorBoundary extends React.Component<
  TextObjectErrorBoundaryProps,
  TextObjectErrorBoundaryState
> {
  constructor(props: TextObjectErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): TextObjectErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `[Ábaco] Error al renderizar cuadro de texto (${this.props.objectId}):`,
      error,
      errorInfo
    );
  }

  componentDidUpdate(prevProps: TextObjectErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      (prevProps.objectId !== this.props.objectId ||
        prevProps.resetKey !== this.props.resetKey)
    ) {
      this.setState({ hasError: false });
    }
  }

  private handleRepair = (e: React.MouseEvent) => {
    e.stopPropagation();
    this.props.onRepair(this.props.objectId);
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full min-h-[44px] rounded border border-amber-400/80 bg-amber-50/95 dark:bg-amber-950/90 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] text-amber-900 dark:text-amber-100 shadow-xs"
        >
          <span className="flex items-center gap-1.5 truncate">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="truncate">No se pudo mostrar este texto</span>
          </span>
          <button
            type="button"
            onClick={this.handleRepair}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 font-medium shrink-0 cursor-pointer"
          >
            <Wrench className="w-3 h-3" />
            Reparar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
