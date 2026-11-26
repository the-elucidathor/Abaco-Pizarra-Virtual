import { jsPDF } from 'jspdf';
import { APP_VERSION } from '../version';
import {
  MANUAL_ILLUSTRATION_BUILDERS,
  type ManualIllustrationId,
} from './manualSvgIllustrations';
import { renderSvgToPdf } from './svgToPdfVector';

// ============================================================================
// CONFIGURACIÓN DE PÁGINA Y PALETA (ESTILO MORADO ÁBACO · TAMAÑO CARTA)
// ============================================================================
const MARGIN_X = 18;
const PAGE_W = 215.9; // Tamaño Carta (8.5 in)
const PAGE_H = 279.4; // Tamaño Carta (11 in)
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 179.9 mm
const TOP_Y = 21;
const BOTTOM_LIMIT = PAGE_H - 18;

type Rgb = [number, number, number];

const COLOR_DARK: Rgb = [15, 23, 42]; // #0f172a
const COLOR_PURPLE: Rgb = [109, 40, 217]; // #6d28d9 (acento principal app)
const COLOR_PURPLE_DEEP: Rgb = [76, 29, 149]; // #4c1d95
const COLOR_PURPLE_SOFT: Rgb = [245, 243, 255]; // #f5f3ff
const COLOR_PURPLE_BORDER: Rgb = [196, 181, 253]; // #c4b5fd
const COLOR_SLATE: Rgb = [51, 65, 85]; // #334155
const COLOR_MUTED: Rgb = [100, 116, 139]; // #64748b
const COLOR_BG_SOFT: Rgb = [248, 250, 252]; // #f8fafc
const COLOR_BORDER: Rgb = [203, 213, 225]; // #cbd5e1

// Colores para recuadros didácticos
const CALLOUT_STYLES = {
  tip: {
    label: 'CONSEJO',
    bg: [239, 246, 255] as Rgb, // Azul suave
    border: [147, 197, 253] as Rgb,
    accent: [37, 99, 235] as Rgb,
    title: [30, 64, 175] as Rgb,
  },
  warn: {
    label: 'ATENCIÓN',
    bg: [255, 251, 235] as Rgb, // Ámbar suave
    border: [252, 211, 77] as Rgb,
    accent: [217, 119, 6] as Rgb,
    title: [146, 64, 14] as Rgb,
  },
  shortcut: {
    label: 'ATAJO',
    bg: [245, 243, 255] as Rgb, // Morado suave
    border: [196, 181, 253] as Rgb,
    accent: [109, 40, 217] as Rgb,
    title: [91, 33, 182] as Rgb,
  },
} as const;

type CalloutKind = keyof typeof CALLOUT_STYLES;

interface TocEntry {
  badge: string;
  title: string;
  desc: string;
  page: number;
}

export interface BuildUserManualOptions {
  /** Solo para pruebas de resiliencia ante fallo de una ilustración SVG. */
  injectBrokenIllustrationId?: ManualIllustrationId;
}

function formatSpanishDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
}

class ManualPdfBuilder {
  public readonly doc: jsPDF;
  private y = TOP_Y;
  private pageNum = 1;
  private tocPageNum = 2;
  private tocEntries: TocEntry[] = [];
  private readonly brokenId?: ManualIllustrationId;

  constructor(options?: BuildUserManualOptions) {
    this.brokenId = options?.injectBrokenIllustrationId;
    this.doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
    });
  }

  public get currentPage(): number {
    return this.pageNum;
  }

  private drawInnerHeader(): void {
    this.doc.setFillColor(...COLOR_PURPLE_SOFT);
    this.doc.rect(0, 0, PAGE_W, 13, 'F');
    this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
    this.doc.setLineWidth(0.28);
    this.doc.line(MARGIN_X, 13, PAGE_W - MARGIN_X, 13);

    // Pequeño distintivo "Á" en el encabezado
    this.doc.setFillColor(...COLOR_PURPLE);
    this.doc.roundedRect(MARGIN_X, 4.2, 5.2, 5.2, 1.1, 1.1, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text('Á', MARGIN_X + 2.6, 7.9, { align: 'center' });

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...COLOR_PURPLE_DEEP);
    this.doc.text('ÁBACO PIZARRA VIRTUAL', MARGIN_X + 7.2, 8.1);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.2);
    this.doc.setTextColor(...COLOR_MUTED);
    this.doc.text(`Manual de Usuario · v${APP_VERSION}`, PAGE_W - MARGIN_X, 8.1, {
      align: 'right',
    });
  }

  public addPage(): void {
    this.doc.addPage('letter', 'portrait');
    this.pageNum += 1;
    this.drawInnerHeader();
    this.y = TOP_Y;
  }

  public ensureSpace(neededMm: number): void {
    if (this.y + neededMm > BOTTOM_LIMIT) {
      this.addPage();
    }
  }

  public registerTocEntry(badge: string, title: string, desc: string): void {
    this.tocEntries.push({
      badge,
      title,
      desc,
      page: this.pageNum,
    });
  }

  // ==========================================================================
  // PORTADA (PÁGINA 1) Y RESERVA DE ÍNDICE (PÁGINA 2)
  // ==========================================================================
  public drawCoverAndReserveToc(): void {
    // Cabecera superior morada con acento
    this.doc.setFillColor(...COLOR_PURPLE_DEEP);
    this.doc.rect(0, 0, PAGE_W, 86, 'F');

    // Franja decorativa morado vibrante
    this.doc.setFillColor(...COLOR_PURPLE);
    this.doc.rect(0, 82, PAGE_W, 4, 'F');

    // Motivo geométrico sutil en la esquina superior derecha (legible también en B/N)
    this.doc.setDrawColor(139, 92, 246);
    this.doc.setLineWidth(0.45);
    this.doc.circle(PAGE_W - 26, 30, 18, 'S');
    this.doc.circle(PAGE_W - 26, 30, 11, 'S');
    this.doc.rect(PAGE_W - 58, 46, 20, 20, 'S');

    // Logo principal "Á"
    this.doc.setFillColor(255, 255, 255);
    this.doc.roundedRect(MARGIN_X, 18, 17, 17, 3.2, 3.2, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(22);
    this.doc.setTextColor(...COLOR_PURPLE);
    this.doc.text('Á', MARGIN_X + 8.5, 29.5, { align: 'center' });

    // Título del producto
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(24);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text('ÁBACO PIZARRA VIRTUAL', MARGIN_X + 22, 27);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(12);
    this.doc.setTextColor(237, 233, 254);
    this.doc.text('Manual de Usuario Ilustrado', MARGIN_X + 22, 34.5);

    this.doc.setFontSize(10.5);
    this.doc.setTextColor(221, 214, 254);
    this.doc.text(
      'Guía práctica de dibujo libre, geometría CAD por coordenadas, edición técnica, ecuaciones y exportación.',
      MARGIN_X,
      48,
      { maxWidth: CONTENT_W - 20 }
    );

    // Chip de versión + fecha de generación
    const genDate = formatSpanishDate(new Date());
    this.doc.setFillColor(91, 33, 182);
    this.doc.roundedRect(MARGIN_X, 62, 134, 9.5, 2.2, 2.2, 'F');
    this.doc.setDrawColor(196, 181, 253);
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(MARGIN_X, 62, 134, 9.5, 2.2, 2.2, 'S');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.8);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(
      `Versión ${APP_VERSION}   |   Generado el ${genDate}`,
      MARGIN_X + 4.5,
      68.2
    );

    // Cuerpo de la portada: Inicio rápido + Qué incluye esta edición
    this.y = 97;
    this.drawCallout('shortcut', 'Inicio rápido en 60 segundos', [
      '1. Abre Proyectos para crear o cargar un pizarrón (Espacio infinito, Carta, Oficio, Doble Carta, Media Carta o Personalizado).',
      '2. Selecciona herramientas en la barra izquierda ([V] Selección, [P] Lápiz, [E] Borrador, [T] Texto, [S] Figuras, [L] Líneas, [C] Cortar).',
      '3. Activa las ayudas de precisión en la barra inferior: [F7] GRID, [F9] SNAP, [F8] ORT, [F10] SP, [F3] RG y [F12] DIN.',
      '4. Pulsa [;] sobre el lienzo o escribe en la barra inferior para trazar por coordenadas exactas (X,Y, @dX,dY o @dist<ang).',
    ]);

    this.y += 3;

    // Tarjetas de pilares de la versión 1.11.2 en portada
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11.5);
    this.doc.setTextColor(...COLOR_DARK);
    this.doc.text(`Capacidades principales en la versión ${APP_VERSION}`, MARGIN_X, this.y);
    this.y += 5;

    const cards: { title: string; body: string }[] = [
      {
        title: 'Dibujo libre y borrado parcial',
        body: 'Lápiz suave, texto enriquecido por tramos con justificado y corrector ortográfico ES/EN, borrador continuo y cuchilla de corte por intersecciones.',
      },
      {
        title: 'Motor CAD y precisión real',
        body: 'Coordenadas absolutas, relativas y polares; referencias geométricas RG (OSNAP), seguimiento polar SP, ORT inteligente y cotas técnicas editables.',
      },
      {
        title: 'Contenido STEM y tablas',
        body: 'Ecuaciones KaTeX con soporte de espacios y unidades rectas, gráficas cartesianas, tablas editables con Tab e importación de imágenes y PDF.',
      },
      {
        title: 'Hojas con marco y exportación limpia',
        body: 'Márgenes configurables en mm, recorte opcional al marco, 8 temas de interfaz, 6 colores de lienzo y exportación PNG/PDF transparente.',
      },
    ];

    const colW = (CONTENT_W - 6) / 2;
    const cardH = 31;
    cards.forEach((card, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cx = MARGIN_X + col * (colW + 6);
      const cy = this.y + row * (cardH + 5);

      this.doc.setFillColor(...COLOR_BG_SOFT);
      this.doc.setDrawColor(...COLOR_BORDER);
      this.doc.setLineWidth(0.3);
      this.doc.roundedRect(cx, cy, colW, cardH, 2.2, 2.2, 'FD');

      this.doc.setFillColor(...COLOR_PURPLE);
      this.doc.roundedRect(cx + 3.5, cy + 4, 2.2, 6, 0.8, 0.8, 'F');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(9.5);
      this.doc.setTextColor(...COLOR_PURPLE_DEEP);
      this.doc.text(card.title, cx + 8, cy + 8.2);

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8.3);
      this.doc.setTextColor(...COLOR_SLATE);
      const lines = this.doc.splitTextToSize(card.body, colW - 8) as string[];
      this.doc.text(lines, cx + 4, cy + 14.5);
    });

    this.y += cardH * 2 + 12;

    // Nota al pie de portada sobre impresión
    this.doc.setFillColor(...COLOR_PURPLE_SOFT);
    this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
    this.doc.setLineWidth(0.25);
    this.doc.roundedRect(MARGIN_X, this.y, CONTENT_W, 13, 2, 2, 'FD');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...COLOR_PURPLE_DEEP);
    this.doc.text('Documento vectorial optimizado', MARGIN_X + 4, this.y + 5.2);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.1);
    this.doc.setTextColor(...COLOR_SLATE);
    this.doc.text(
      'Todas las ilustraciones y diagramas de este manual se generan en gráficos vectoriales ligeros para mantener nitidez en pantalla y en impresión.',
      MARGIN_X + 4,
      this.y + 9.8
    );

    // Reservar página 2 para el Índice (se rellena al final con los números exactos)
    this.addPage();
    this.tocPageNum = this.pageNum;
  }

  // ==========================================================================
  // TÍTULOS Y PÁRRAFOS (ANTI-HUÉRFANOS)
  // ==========================================================================
  public drawSectionTitle(num: string, title: string, tocDesc?: string): void {
    // Asegurar espacio para título + al menos un bloque de contenido debajo
    this.ensureSpace(26);
    this.registerTocEntry(num, title, tocDesc ?? title);

    this.y += 1.5;
    const badgeW = num.length > 2 ? 12 : 8.5;
    this.doc.setFillColor(...COLOR_PURPLE);
    this.doc.roundedRect(MARGIN_X, this.y, badgeW, 6.8, 1.5, 1.5, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9.2);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(num, MARGIN_X + badgeW / 2, this.y + 4.7, { align: 'center' });

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(13);
    this.doc.setTextColor(...COLOR_DARK);
    this.doc.text(title, MARGIN_X + badgeW + 3.2, this.y + 5);

    this.y += 8.6;
    this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
    this.doc.setLineWidth(0.35);
    this.doc.line(MARGIN_X, this.y, PAGE_W - MARGIN_X, this.y);
    this.y += 5;
  }

  public drawSubTitle(title: string): void {
    // Evitar subtítulo huérfano al final de página
    this.ensureSpace(18);
    this.y += 1.5;
    this.doc.setFillColor(...COLOR_PURPLE);
    this.doc.rect(MARGIN_X, this.y - 3.2, 1.4, 4.2, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(10.3);
    this.doc.setTextColor(...COLOR_PURPLE_DEEP);
    this.doc.text(title, MARGIN_X + 3.4, this.y);
    this.y += 4.8;
  }

  public drawParagraph(text: string): void {
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9.2);
    this.doc.setTextColor(...COLOR_SLATE);
    const lines = this.doc.splitTextToSize(text, CONTENT_W) as string[];
    this.ensureSpace(lines.length * 4.5 + 2.5);
    this.doc.text(lines, MARGIN_X, this.y);
    this.y += lines.length * 4.5 + 2.2;
  }

  public drawBullets(items: { lead?: string; body: string }[]): void {
    for (const item of items) {
      const fullText = item.lead ? `${item.lead}: ${item.body}` : item.body;
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9);
      const wrapped = this.doc.splitTextToSize(fullText, CONTENT_W - 6) as string[];
      this.ensureSpace(wrapped.length * 4.3 + 2);

      this.doc.setFillColor(...COLOR_PURPLE);
      this.doc.circle(MARGIN_X + 2, this.y - 1.1, 0.85, 'F');

      if (item.lead && wrapped.length > 0) {
        const leadPrefix = `${item.lead}: `;
        this.doc.setFont('helvetica', 'bold');
        const leadWidth = this.doc.getTextWidth(leadPrefix);
        if (leadWidth < CONTENT_W - 14) {
          this.doc.setTextColor(...COLOR_DARK);
          this.doc.text(leadPrefix, MARGIN_X + 5.5, this.y);
          this.doc.setFont('helvetica', 'normal');
          this.doc.setTextColor(...COLOR_SLATE);
          const firstRest = wrapped[0].slice(leadPrefix.length);
          this.doc.text(firstRest, MARGIN_X + 5.5 + leadWidth, this.y);
          for (let i = 1; i < wrapped.length; i++) {
            this.y += 4.3;
            this.doc.text(wrapped[i], MARGIN_X + 5.5, this.y);
          }
          this.y += 4.8;
          continue;
        }
      }

      this.doc.setTextColor(...COLOR_SLATE);
      this.doc.text(wrapped, MARGIN_X + 5.5, this.y);
      this.y += wrapped.length * 4.3 + 1.5;
    }
    this.y += 1.5;
  }

  // ==========================================================================
  // RECUADROS DIDÁCTICOS Y RENDERIZADO DE INSIGNIAS DE TECLAS [F8]
  // ==========================================================================
  private measureLineWithKeyBadges(rawLine: string): number {
    const tokens = rawLine.split(/(\[[A-Za-z0-9+.,;:/\s-]{1,18}\])/g).filter(Boolean);
    let total = 0;
    for (const tok of tokens) {
      const isKey = tok.startsWith('[') && tok.endsWith(']') && tok.length >= 3;
      if (isKey) {
        const keyText = tok.slice(1, -1).trim();
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.6);
        total += this.doc.getTextWidth(keyText) + 4.3;
      } else {
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8.7);
        total += this.doc.getTextWidth(tok);
      }
    }
    return total;
  }

  private wrapLineWithKeyBadges(rawLine: string, maxWidthMm: number): string[] {
    if (!rawLine.includes('[') || !rawLine.includes(']')) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8.7);
      return this.doc.splitTextToSize(rawLine, maxWidthMm) as string[];
    }
    // Mantener cada insignia [...] intacta al dividir por espacios fuera de corchetes
    const parts = rawLine.match(/(\[[^\]]+\]|[^\s[\]]+|\s+)/g) ?? [rawLine];
    const lines: string[] = [];
    let current = '';
    for (const part of parts) {
      if (/^\s+$/.test(part) && !current) continue;
      const candidate = current + part;
      if (current.trim() && this.measureLineWithKeyBadges(candidate.trimEnd()) > maxWidthMm) {
        lines.push(current.trimEnd());
        current = part.trimStart();
      } else {
        current = candidate;
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
    return lines.length > 0 ? lines : [rawLine];
  }

  private renderLineWithKeyBadges(
    rawLine: string,
    x: number,
    baselineY: number,
    textColor: Rgb
  ): void {
    const tokens = rawLine.split(/(\[[A-Za-z0-9+.,;:/\s-]{1,18}\])/g).filter(Boolean);
    let cursorX = x;

    for (const tok of tokens) {
      const isKey = tok.startsWith('[') && tok.endsWith(']') && tok.length >= 3;
      if (isKey) {
        const keyText = tok.slice(1, -1).trim();
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.4);
        const tw = this.doc.getTextWidth(keyText);
        const pillW = tw + 3.0;
        const pillH = 4.0;
        this.doc.setFillColor(255, 255, 255);
        this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
        this.doc.setLineWidth(0.28);
        this.doc.roundedRect(cursorX, baselineY - 3.05, pillW, pillH, 1, 1, 'FD');
        this.doc.setTextColor(...COLOR_PURPLE_DEEP);
        this.doc.text(keyText, cursorX + pillW / 2, baselineY - 0.15, {
          align: 'center',
        });
        cursorX += pillW + 0.9;
      } else {
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8.6);
        this.doc.setTextColor(...textColor);
        this.doc.text(tok, cursorX, baselineY);
        cursorX += this.doc.getTextWidth(tok);
      }
    }
  }

  public drawCallout(kind: CalloutKind, title: string, lines: string[]): void {
    const theme = CALLOUT_STYLES[kind];
    const bodyLines: string[] = [];
    for (const l of lines) {
      bodyLines.push(...this.wrapLineWithKeyBadges(l, CONTENT_W - 12));
    }
    const boxH = 11.5 + bodyLines.length * 4.6 + 2.5;
    this.ensureSpace(boxH + 3);

    this.doc.setFillColor(...theme.bg);
    this.doc.setDrawColor(...theme.border);
    this.doc.setLineWidth(0.32);
    this.doc.roundedRect(MARGIN_X, this.y, CONTENT_W, boxH, 2.2, 2.2, 'FD');

    // Borde lateral de acento
    this.doc.setFillColor(...theme.accent);
    this.doc.roundedRect(MARGIN_X, this.y, 2.2, boxH, 1, 1, 'F');

    // Etiqueta del tipo (CONSEJO / ATENCIÓN / ATAJO)
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7.2);
    const badgeW = this.doc.getTextWidth(theme.label) + 4.4;
    this.doc.roundedRect(MARGIN_X + 5.2, this.y + 3.2, badgeW, 4.4, 1, 1, 'F');
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(theme.label, MARGIN_X + 5.2 + badgeW / 2, this.y + 6.3, {
      align: 'center',
    });

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9.4);
    this.doc.setTextColor(...theme.title);
    this.doc.text(title, MARGIN_X + 7.4 + badgeW, this.y + 6.5);

    let cy = this.y + 12.2;
    for (const bl of bodyLines) {
      if (bl.includes('[') && bl.includes(']')) {
        this.renderLineWithKeyBadges(bl, MARGIN_X + 5.2, cy, COLOR_DARK);
      } else {
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8.7);
        this.doc.setTextColor(...COLOR_DARK);
        this.doc.text(bl, MARGIN_X + 5.2, cy);
      }
      cy += 4.6;
    }

    this.y += boxH + 3.8;
  }

  // ==========================================================================
  // RENDERIZADO DE ILUSTRACIONES SVG CON PROTECCIÓN TRY/CATCH ANTI-CORTES
  // ==========================================================================
  public drawIllustration(
    id: ManualIllustrationId,
    caption: string,
    svgHeightMm: number
  ): void {
    const padX = 3;
    const padTop = 3;
    const captionH = 6.5;
    const cardH = padTop + svgHeightMm + captionH;

    // Nunca partir una ilustración ni separarla de su pie de figura
    this.ensureSpace(cardH + 4);

    try {
      if (this.brokenId && this.brokenId === id) {
        throw new Error(`Fallo simulado en ilustración "${id}"`);
      }
      const builder = MANUAL_ILLUSTRATION_BUILDERS[id];
      if (!builder) {
        throw new Error(`Ilustración "${id}" no encontrada`);
      }
      const svgMarkup = builder();

      // Tarjeta contenedora con bordes redondeados y fondo claro
      this.doc.setFillColor(255, 255, 255);
      this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
      this.doc.setLineWidth(0.32);
      this.doc.roundedRect(MARGIN_X, this.y, CONTENT_W, cardH, 2.4, 2.4, 'FD');

      // Dibujo vectorial del SVG dentro de la tarjeta
      renderSvgToPdf(
        this.doc,
        svgMarkup,
        MARGIN_X + padX,
        this.y + padTop,
        CONTENT_W - padX * 2,
        svgHeightMm
      );

      // Pie descriptivo
      this.doc.setFont('helvetica', 'italic');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLOR_MUTED);
      this.doc.text(caption, PAGE_W / 2, this.y + cardH - 2.3, {
        align: 'center',
      });

      this.y += cardH + 4.2;
    } catch (err) {
      // Regla obligatoria: registrar en consola y continuar generando el PDF sin la ilustración
      console.error(`[Manual PDF] No se pudo dibujar la ilustración "${id}":`, err);
    }
  }

  // ==========================================================================
  // TABLAS ESTILIZADAS (CON SOPORTE OPCIONAL DE INSIGNIAS DE TECLA)
  // ==========================================================================
  public drawTable(
    headers: string[],
    rows: string[][],
    colWidths: number[],
    options?: { keyBadgesInCols?: number[] }
  ): void {
    const drawHeaderRow = () => {
      this.doc.setFillColor(...COLOR_PURPLE_DEEP);
      this.doc.rect(MARGIN_X, this.y, CONTENT_W, 7.2, 'F');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(8.4);
      this.doc.setTextColor(255, 255, 255);
      let cx = MARGIN_X + 2.5;
      headers.forEach((h, idx) => {
        this.doc.text(h, cx, this.y + 4.9);
        cx += colWidths[idx];
      });
      this.y += 7.2;
    };

    this.ensureSpace(16);
    drawHeaderRow();

    rows.forEach((row, rIdx) => {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8.3);
      const cellLines = row.map((cell, idx) => {
        if (options?.keyBadgesInCols?.includes(idx)) {
          return this.wrapLineWithKeyBadges(cell, colWidths[idx] - 4.5);
        }
        return this.doc.splitTextToSize(cell, colWidths[idx] - 4.5) as string[];
      });
      const maxLines = Math.max(...cellLines.map((c) => c.length));
      const rowH = Math.max(6.8, maxLines * 4.2 + 2.8);

      if (this.y + rowH > BOTTOM_LIMIT) {
        this.addPage();
        drawHeaderRow();
      }

      if (rIdx % 2 === 0) {
        this.doc.setFillColor(...COLOR_BG_SOFT);
        this.doc.rect(MARGIN_X, this.y, CONTENT_W, rowH, 'F');
      }
      this.doc.setDrawColor(...COLOR_BORDER);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN_X, this.y + rowH, PAGE_W - MARGIN_X, this.y + rowH);

      let cx = MARGIN_X + 2.5;
      cellLines.forEach((lines, cIdx) => {
        if (options?.keyBadgesInCols?.includes(cIdx)) {
          let ly = this.y + 4.5;
          for (const ln of lines) {
            this.renderLineWithKeyBadges(ln, cx, ly, COLOR_DARK);
            ly += 4.2;
          }
        } else {
          this.doc.setFont('helvetica', cIdx === 0 ? 'bold' : 'normal');
          this.doc.setFontSize(8.3);
          this.doc.setTextColor(...(cIdx === 0 ? COLOR_DARK : COLOR_SLATE));
          this.doc.text(lines, cx, this.y + 4.3);
        }
        cx += colWidths[cIdx];
      });
      this.y += rowH;
    });

    this.y += 4;
  }

  // ==========================================================================
  // RELLENAR ÍNDICE EN PÁGINA 2 Y PIES DE PÁGINA CON NÚMEROS EXACTOS
  // ==========================================================================
  public finalizeTocAndFooters(): void {
    // 1. Dibujar Índice en la página 2 reservada
    this.doc.setPage(this.tocPageNum);
    let ty = TOP_Y;

    this.doc.setFillColor(...COLOR_PURPLE);
    this.doc.roundedRect(MARGIN_X, ty, 3.2, 7.5, 1, 1, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(15);
    this.doc.setTextColor(...COLOR_DARK);
    this.doc.text('Índice general', MARGIN_X + 6, ty + 5.8);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.8);
    this.doc.setTextColor(...COLOR_MUTED);
    this.doc.text(
      `Manual de Usuario de Ábaco Pizarra Virtual · Versión ${APP_VERSION}`,
      MARGIN_X + 6,
      ty + 11.2
    );

    ty += 16;

    for (const entry of this.tocEntries) {
      const rowH = 14.5;
      this.doc.setFillColor(...COLOR_BG_SOFT);
      this.doc.setDrawColor(...COLOR_BORDER);
      this.doc.setLineWidth(0.22);
      this.doc.roundedRect(MARGIN_X, ty, CONTENT_W, rowH, 1.8, 1.8, 'FD');

      // Insignia de sección
      const badgeW = entry.badge.length > 2 ? 12 : 8;
      this.doc.setFillColor(...COLOR_PURPLE);
      this.doc.roundedRect(MARGIN_X + 3, ty + 2.6, badgeW, 5.2, 1.1, 1.1, 'F');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.8);
      this.doc.setTextColor(255, 255, 255);
      this.doc.text(entry.badge, MARGIN_X + 3 + badgeW / 2, ty + 6.2, {
        align: 'center',
      });

      // Título de sección
      const titleX = MARGIN_X + 5.5 + badgeW;
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(9.5);
      this.doc.setTextColor(...COLOR_PURPLE_DEEP);
      this.doc.text(entry.title, titleX, ty + 6.2);

      // Número de página real alineado a la derecha
      const pageLabel = `Pág. ${entry.page}`;
      this.doc.setFillColor(...COLOR_PURPLE_SOFT);
      this.doc.setDrawColor(...COLOR_PURPLE_BORDER);
      this.doc.roundedRect(PAGE_W - MARGIN_X - 18, ty + 2.4, 15, 5.5, 1.2, 1.2, 'FD');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLOR_PURPLE);
      this.doc.text(pageLabel, PAGE_W - MARGIN_X - 10.5, ty + 6.1, {
        align: 'center',
      });

      // Descripción breve
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLOR_SLATE);
      this.doc.text(entry.desc, MARGIN_X + 3.5, ty + 11.7, {
        maxWidth: CONTENT_W - 8,
      });

      ty += rowH + 2.6;
    }

    // 2. Pies de página en todo el documento
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      this.doc.setDrawColor(...COLOR_BORDER);
      this.doc.setLineWidth(0.25);
      this.doc.line(MARGIN_X, PAGE_H - 13, PAGE_W - MARGIN_X, PAGE_H - 13);

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...COLOR_MUTED);
      this.doc.text(
        `Ábaco Pizarra Virtual v${APP_VERSION}  |  Manual de Usuario`,
        MARGIN_X,
        PAGE_H - 8.2
      );
      this.doc.text(`Página ${i} de ${total}`, PAGE_W - MARGIN_X, PAGE_H - 8.2, {
        align: 'right',
      });
    }
  }
}

/**
 * Construye el documento PDF completo del Manual de Usuario de Ábaco Pizarra Virtual.
 */
export function buildUserManualPdf(options?: BuildUserManualOptions): jsPDF {
  const b = new ManualPdfBuilder(options);

  // Portada (pág. 1) + reserva de índice (pág. 2)
  b.drawCoverAndReserveToc();

  // =========================================================================
  // NOVEDADES DE LA VERSIÓN 1.11.6
  // =========================================================================
  b.addPage();
  b.drawSectionTitle(
    APP_VERSION,
    `Novedades de la versión ${APP_VERSION}`,
    'Agrupación geométrica real, ecuaciones en vivo dentro del texto, actualización automática y modo sin internet.'
  );
  b.drawParagraph(
    `La versión ${APP_VERSION} consolida la edición nativa en PC con actualizaciones automáticas opcionales desde GitHub Releases (cuando hay conexión) y mantiene las mejoras recientes:`
  );
  b.drawBullets([
    {
      lead: 'Actualizaciones automáticas en escritorio (v1.11.6)',
      body: 'La aplicación nativa para Windows verifica nuevas versiones publicadas en GitHub, las descarga silenciosamente en segundo plano y avisa al usuario para reiniciar e instalarlas ahora o al cerrar (sin bloquear el trabajo sin internet).',
    },
    {
      lead: 'Agrupación real y transformación conjunta (v1.11.4)',
      body: 'Al agrupar trazos, figuras, texto o ecuaciones (Ctrl+G), el bloque actúa como una sola unidad geométrica: al mover, escalar o rotar el grupo, todos los hijos se transforman de forma proporcional respecto al pivote del grupo.',
    },
    {
      lead: 'Ecuaciones en tiempo real dentro del texto (v1.11.4)',
      body: 'Inserta y edita expresiones matemáticas en vivo (en línea o en bloque) directamente dentro de cuadros de texto enriquecido usando la cinta visual de símbolos y estructuras, manteniendo también el editor independiente.',
    },
    {
      lead: 'Fondo transparente en el editor de texto (v1.11.4)',
      body: 'Al redactar sobre el lienzo, el área de edición permanece transparente para ver la cuadrícula, renglones o diagramas subyacentes y alinear el texto con precisión.',
    },
    {
      lead: 'Portapapeles consistente tras capturas y menú por clic derecho (v1.11.4)',
      body: 'Copiar objetos de la pizarra tras tomar una captura prioriza correctamente el último elemento copiado, y el menú contextual de acciones aparece únicamente al hacer clic derecho sobre elementos seleccionados.',
    },
    {
      lead: 'Navegación con rueda y gestión multihoja (v1.11.2–1.11.3)',
      body: 'En formatos Carta, Oficio, Doble Carta, Media Carta y Personalizado puedes agregar, duplicar o eliminar hojas (hasta 30), desplazarte con la rueda (Ctrl + rueda para zoom) y configurar marco y márgenes en mm.',
    },
    {
      lead: 'Funcionamiento nativo en PC 100% sin internet',
      body: 'Fuentes, renderizado matemático KaTeX, graficador mathjs, importadores PDF/DOCX/XLSX, corrector ortográfico integrado y respaldo local funcionan sin depender de conexión a internet.',
    },
  ]);

  b.drawIllustration(
    'novedades-1-11-1',
    'Figura 12 · Tabla editable, formato por tramos, justificado, corrector ES/EN y ecuación con espacio.',
    49
  );

  // =========================================================================
  // SECCIÓN 1: ENTORNO DE TRABAJO Y NAVEGACIÓN
  // =========================================================================
  b.drawSectionTitle(
    '1',
    'Entorno de trabajo y navegación',
    'Zonas de la interfaz, pestañas de pizarrones, barra lateral, zoom y modo limpio.'
  );
  b.drawParagraph(
    'Ábaco Pizarra Virtual combina la agilidad de una pizarra interactiva para clases y diagramas con un motor de dibujo técnico de precisión basado en coordenadas. Su espacio de trabajo se divide en seis zonas coordinadas:'
  );

  b.drawIllustration(
    'mapa-interfaz',
    'Figura 1 · Mapa de la interfaz con las 6 zonas numeradas y sus paneles principales.',
    78
  );

  b.drawBullets([
    {
      lead: '1. Barra superior',
      body: 'Nombre del proyecto (editable con clic), menús Archivo, Editar, Ver, Insertar, Herramientas y Configuración, junto con Deshacer/Rehacer, Proyectos, Guardar, Exportar área, Exportar y Manual PDF.',
    },
    {
      lead: '2. Pestañas de pizarrones',
      body: 'Alterna entre múltiples pizarrones dentro de un mismo proyecto, duplícalos, renómbralos o abre uno nuevo con el botón "+".',
    },
    {
      lead: '3. Barra lateral izquierda',
      body: 'Acceso rápido a Selección, Mano, Lápiz, Borrador, Texto, Figuras 2D/3D, Líneas, Cortar, Ecuaciones, Gráficas, Notas, Tablas e Importar archivos. Puede contraerse para ganar espacio.',
    },
    {
      lead: '4. Lienzo central',
      body: 'Área principal de trabajo con soporte para espacio infinito o tamaño de hoja fija con marco, cuadrículas, ejes de coordenadas, previsualización en vivo y menús contextuales.',
    },
    {
      lead: '5. Inspector derecho',
      body: 'Tres pestañas: Propiedades (trazo, relleno, tamaño, rotación, fondo, marco de hoja y color del lienzo), Capas (visibilidad, bloqueo y orden) y Orden (apilamiento Z, ecuaciones, gráficas e historial).',
    },
    {
      lead: '6. Barra técnica CAD y barra de estado',
      body: 'En la parte inferior: entrada de comandos y coordenadas, botones rápidos (LIN, PL, REC, CIR, ARC, POL, ACL, SIM, CP), ayudas (GRID, SNAP, ORT, SP, RG, DIN) y controles de zoom.',
    },
  ]);

  b.drawIllustration(
    'barra-lateral',
    'Figura 2 · Herramientas de la barra lateral izquierda y sus atajos de teclado.',
    30
  );

  b.drawSubTitle('Navegación, zoom y modo limpio');
  b.drawBullets([
    {
      lead: 'Desplazar el lienzo',
      body: 'Usa la herramienta Mano (H), mantén presionada la barra espaciadora mientras arrastras o arrastra con el botón central del ratón.',
    },
    {
      lead: 'Zoom preciso',
      body: 'Gira la rueda del ratón para acercar o alejar centrado en el cursor (sobre PDFs o archivos desplazables usa Ctrl + rueda), o utiliza Ctrl++ / Ctrl+- / Ctrl+0 (100%).',
    },
    {
      lead: 'Modo de trabajo limpio (Ctrl+.)',
      body: 'Oculta temporalmente los paneles laterales y barras para concentrarte únicamente en el lienzo; también puedes activar "Transparencia automática" en el menú Ver.',
    },
  ]);

  b.drawCallout('tip', 'Navegación rápida sobre documentos importados', [
    'Si importaste un PDF o documento multipágina, girar la rueda encima desplaza el documento. Usa [Ctrl] + [Rueda] cuando quieras acercar o alejar toda la pizarra.',
  ]);

  // =========================================================================
  // SECCIÓN 2: PROYECTOS, ARCHIVOS Y TAMAÑOS DE PIZARRÓN
  // =========================================================================
  b.drawSectionTitle(
    '2',
    'Proyectos, archivos y tamaños de pizarrón',
    'Guardado automático, historial de 5 versiones, archivos .pizarra y marco de hoja.'
  );
  b.drawParagraph(
    'Todos tus avances se guardan automáticamente en almacenamiento local y puedes organizar proyectos por carpetas, conservar versiones instantáneas o respaldar archivos portables.'
  );
  b.drawBullets([
    {
      lead: 'Gestor de proyectos locales',
      body: 'Desde el botón Proyectos crea carpetas, busca tableros guardados, restaura instantáneas anteriores (snapshots) o descarga respaldos completos.',
    },
    {
      lead: 'Guardar versiones y archivos .pizarra',
      body: 'Pulsa Ctrl+S para guardar una versión en el historial local (se conservan las últimas 5 versiones por proyecto; la más antigua se reemplaza solo tras confirmar el nuevo guardado). Desde Archivo puedes exportar o abrir archivos portables .pizarra.',
    },
    {
      lead: 'Selector de tamaño y marco configurable',
      body: 'Al crear un proyecto o agregar una nueva pestaña (+) elige entre seis formatos con orientación Vertical u Horizontal. En hojas de tamaño definido puedes activar "Mostrar marco", ajustar "Margen (mm)" y habilitar "Recortar dibujo al marco".',
    },
  ]);

  b.drawIllustration(
    'tamanos-hoja',
    'Figura 3 · Formatos Carta, Oficio, Doble Carta y Media Carta con su marco, margen, cuadrícula y medidas reales.',
    52
  );

  b.drawTable(
    ['Formato', 'Dimensiones de referencia', 'Marco y uso recomendado'],
    [
      ['Espacio infinito', 'Lienzo ilimitado con paneo libre', 'Sin marco fijo · Mapas mentales, clases extensas y diagramas abiertos'],
      ['Carta', '21.59 x 27.94 cm (8.5 x 11 in)', 'Con marco configurable · Tareas, apuntes e impresión estándar'],
      ['Oficio', '21.59 x 35.56 cm (8.5 x 14 in)', 'Con marco configurable · Hojas largas, formularios y reportes extensos'],
      ['Doble Carta (Tabloide)', '27.94 x 43.18 cm (11 x 17 in)', 'Con marco configurable · Planos técnicos, pósteres y esquemas amplios'],
      ['Media Carta', '13.97 x 21.59 cm (5.5 x 8.5 in)', 'Con marco configurable · Fichas de estudio, tarjetas y resúmenes breves'],
      ['Personalizado', 'Configurable en px o cm (Vertical / Horizontal)', 'Con marco configurable · Medidas exactas para láminas o presentaciones'],
    ],
    [42, 60, CONTENT_W - 102]
  );

  // =========================================================================
  // SECCIÓN 3: DIBUJO LIBRE, BORRADOR PARCIAL, TEXTO Y TABLAS
  // =========================================================================
  b.drawSectionTitle(
    '3',
    'Dibujo libre, borrador parcial, texto y tablas',
    'Lápiz, texto enriquecido, corrector ES/EN, tablas, borrador parcial y Cortar.'
  );

  b.drawSubTitle('Lápiz, texto enriquecido, notas y tablas');
  b.drawBullets([
    {
      lead: 'Lápiz a mano alzada (P)',
      body: 'Trazos suavizados con ajuste de color, grosor, estilo (sólido, discontinuo, punteado), opacidad, modo resaltador y soporte opcional para sensibilidad a la presión.',
    },
    {
      lead: 'Cuadros de texto enriquecido (T) y Notas adhesivas (N)',
      body: 'Arrastra para crear un cuadro de ancho fijo con salto automático de línea o haz clic simple para ancho automático en una línea. Aplica negrita, cursiva, subrayado, color, tamaño por tramo, alineación (incluyendo justificado Ctrl+J) y corrector ortográfico ES/EN.',
    },
    {
      lead: 'Tablas integradas (Insertar → Tabla)',
      body: 'Elige filas y columnas desde la rejilla rápida, navega entre celdas con Tab, edita el contenido con formato enriquecido y utiliza la barra propia de tabla para añadir o quitar filas y columnas.',
    },
  ]);

  b.drawSubTitle('Borrador parcial continuo (E) y Cortar (C)');
  b.drawParagraph(
    'A diferencia de un borrador que elimina el objeto entero, el borrador de Ábaco trabaja de forma parcial y continua en coordenadas del mundo sobre trazos a mano alzada, líneas, rectángulos y círculos, mientras la herramienta Cortar divide objetos por intersecciones exactas:'
  );

  b.drawIllustration(
    'borrador-cortar',
    'Figura 4 · Antes y después del Borrador parcial (E) sobre línea/círculo y cuchilla de la herramienta Cortar (C).',
    43
  );

  b.drawBullets([
    {
      lead: 'Recorte exacto y subdivisión automática',
      body: 'Al arrastrar el borrador (E) solo desaparece la porción barrida; una línea o círculo se divide en fragmentos o arcos independientes conservando su estilo y registrándose como un solo paso en Ctrl+Z.',
    },
    {
      lead: 'Cuchilla por arrastre e intersecciones (C)',
      body: 'Arrastra una línea roja sobre figuras, polilíneas o segmentos para dividirlos por sus cruces calculados, o pasa el cursor sobre un segmento entre dos cruces y haz clic para recortar únicamente esa sección.',
    },
  ]);

  // =========================================================================
  // SECCIÓN 4: FIGURAS GEOMÉTRICAS 2D, SÓLIDOS 3D Y LÍNEAS
  // =========================================================================
  b.drawSectionTitle(
    '4',
    'Figuras geométricas 2D, sólidos 3D y líneas',
    'Catálogo completo 2D/3D, proporción 1:1 con Shift, líneas y edición de vértices.'
  );
  b.drawParagraph(
    'Pulsa S o abre la ventana flotante de Figuras en la barra izquierda para elegir entre formas básicas 2D (rectángulo, cuadrado, círculo, elipse, triángulo, triángulo rectángulo, trapecios, rombo, pentágono, hexágono, octágono, polígono de N lados, estrella, arco, polilínea) y sólidos 3D (cubo, cilindro, cono, pirámide, prisma, esfera).'
  );

  b.drawIllustration(
    'figuras-2d-3d',
    'Figura 5 · Catálogo visual de figuras geométricas 2D y sólidos 3D disponibles en Ábaco.',
    65
  );

  b.drawBullets([
    {
      lead: 'Arrastre limpio y proporción 1:1',
      body: 'Arrastra de una esquina a la opuesta con vista previa vectorial en vivo. Mantén Shift (o activa ORT) para conservar proporción 1:1 exacta (cuadrado, círculo, triángulo/polígono regular).',
    },
    {
      lead: 'Protección contra clics accidentales',
      body: 'Si haces clic sin arrastrar con Rectángulo, Triángulo u otras figuras de caja, el trazo degenerado se descarta automáticamente sin generar figuras vacías.',
    },
    {
      lead: 'Líneas y conectores (L)',
      body: 'Incluye línea continua, segmento con remates, línea discontinua, flecha simple, flecha doble y conector curvo con punto de control editable.',
    },
    {
      lead: 'Edición de vértices y manejadores',
      body: 'Con Selección (V) selecciona polígonos, polilíneas, líneas o sólidos 3D para arrastrar vértices individuales, cambiar número de lados o rotar.',
    },
  ]);

  // =========================================================================
  // SECCIÓN 5: SISTEMA CAD Y ENTRADA POR COORDENADAS
  // =========================================================================
  b.drawSectionTitle(
    '5',
    'Sistema CAD y entrada por coordenadas',
    'Coordenadas absolutas, relativas y polares; comandos y ejemplo guiado paso a paso.'
  );
  b.drawParagraph(
    'La barra inferior funciona de manera análoga a un entorno CAD: al iniciar un comando solicita cada dato paso a paso (primer punto, siguiente punto, radio, ancho/alto o ángulo) y permite confirmar con Enter, corregir con Retroceso o cancelar con Escape.'
  );

  b.drawIllustration(
    'coordenadas',
    'Figura 6 · Trazado secuencial en el plano cartesiano: 100,50 → @80,-25 → @120<45 (ángulo antihorario).',
    58
  );

  b.drawSubTitle('Formatos de coordenadas aceptados');
  b.drawTable(
    ['Sintaxis', 'Significado', 'Ejemplo práctico'],
    [
      ['X,Y', 'Coordenada cartesiana absoluta respecto al origen (0,0)', '100,50  (Enter)'],
      ['@dX,dY', 'Desplazamiento relativo respecto al último punto capturado', '@80,-25  (Enter)'],
      ['@dist<ang', 'Coordenada polar relativa (distancia y ángulo en grados)', '@120<45  (Enter)'],
      ['Número', 'Distancia en dirección del cursor, radio o cantidad según paso', '60  (Enter)'],
      ['Enter / C', 'Finaliza una polilínea abierta o escribe C para cerrarla', 'C  (Enter)'],
    ],
    [32, 96, CONTENT_W - 128]
  );

  b.drawSubTitle('Ejemplo guiado: dibujar un cuadrado de 5 unidades por coordenadas');
  b.drawParagraph(
    'Sigue esta secuencia exacta en la barra de comandos (o tras pulsar ";" sobre el lienzo) para construir un cuadrado cerrado de 5 × 5 unidades partiendo del origen:'
  );
  b.drawTable(
    ['Paso', 'Entrada exacta', 'Resultado en el lienzo'],
    [
      ['1', 'LIN   [Enter]', 'Inicia el comando de Línea en la barra inferior.'],
      ['2', '0,0   [Enter]', 'Fija el primer vértice en el origen (0,0).'],
      ['3', '@5,0   [Enter]', 'Traza el lado inferior de 5 unidades hacia la derecha hasta (5,0).'],
      ['4', '@0,5   [Enter]', 'Sube verticalmente 5 unidades hasta la esquina superior derecha (5,5).'],
      ['5', '@-5,0   [Enter]', 'Avanza 5 unidades a la izquierda hasta (0,5).'],
      ['6', 'C   [Enter]', 'Cierra automáticamente la figura regresando al origen (0,0).'],
    ],
    [16, 46, CONTENT_W - 62]
  );

  b.drawIllustration(
    'ejemplo-cuadrado-5u',
    'Resultado final del ejemplo guiado: cuadrado cerrado de 5 × 5 unidades desde (0,0).',
    36
  );

  b.drawCallout('shortcut', 'Ejecución directa desde el lienzo sin mover el ratón', [
    'Pulsa [;] (o [/] / [:]) en cualquier parte del área de dibujo para abrir el buscador rápido junto al cursor. Escribe el comando (LIN, REC, ACL, SIM, CP, MR) y confirma con [Enter].',
  ]);

  b.drawSubTitle('Comandos técnicos principales');
  b.drawTable(
    ['Comando', 'Alias', 'Descripción'],
    [
      ['LIN', 'L, LINEA', 'Trazar segmentos rectos encadenados por coordenadas o clics.'],
      ['PL', 'POLILINEA', 'Polilínea continua editable con opción de cierre automático (C).'],
      ['REC', 'RECTANGULO', 'Rectángulo por dos esquinas opuestas o por ancho y alto exactos.'],
      ['CIR', 'CIRCULO', 'Círculo definiendo centro y radio o diámetro numérico.'],
      ['ARC', 'ARCO', 'Arco por 3 puntos o por centro, punto inicial y ángulo.'],
      ['POL', 'POLIGONO', 'Polígono regular de N lados (inscrito o circunscrito).'],
      ['SIM', 'SIMETRIA', 'Reflejar la selección respecto a un eje definido por dos puntos.'],
      ['CP', 'COINCIDIR', 'Desplazar un elemento para hacer coincidir dos puntos con precisión RG.'],
      ['UNI', 'UNIR', 'Unir líneas y polilíneas compatibles cuyos extremos coincidan.'],
      ['AGR / DES', 'AGRUPAR', 'Agrupar o desagrupar objetos seleccionados (Ctrl+G / Ctrl+Shift+G).'],
      ['MR / MP / MC', 'MATRIZ', 'Crear arreglos rectangulares, polares (centro) o siguiendo un camino.'],
    ],
    [28, 36, CONTENT_W - 64]
  );

  // =========================================================================
  // SECCIÓN 6: AYUDAS DE PRECISIÓN (GRID, SNAP, ORT, SP, RG, DIN)
  // =========================================================================
  b.drawSectionTitle(
    '6',
    'Ayudas de precisión (GRID, SNAP, ORT, SP, RG, DIN)',
    'Restricción ortogonal en líneas vs. 1:1 en figuras, SNAP, seguimiento polar y OSNAP.'
  );
  b.drawParagraph(
    'Todas las ayudas trabajan de manera coordinada desde la barra inferior y el teclado (F3, F7, F8, F9, F10, F12). El cálculo de coordenadas aplica primero la restricción geométrica y después el ajuste a cuadrícula (SNAP) respetando dicha restricción.'
  );

  b.drawIllustration(
    'ort-comparacion',
    'Figura 7 · Modo ORT (F8): restricción horizontal/vertical en líneas vs. proporción 1:1 en figuras.',
    41
  );

  b.drawIllustration(
    'snap-sp-din',
    'Figura 8 · Ayudas combinadas: salto a nodos (SNAP), rayos angulares (SP) y lectura en vivo (DIN).',
    52
  );

  b.drawBullets([
    {
      lead: 'GRID (F7) y SNAP (F9)',
      body: 'GRID muestra u oculta la cuadrícula del lienzo sin afectar la exportación transparente. SNAP ajusta el cursor en pasos configurables con histéresis inteligente para evitar temblores al cruzar puntos medios.',
    },
    {
      lead: 'ORT (F8) — Comportamiento inteligente por herramienta',
      body: 'En herramientas direccionales (Línea, Polilínea, Flecha, Medir) restringe estrictamente a 0° y 90° mientras SNAP ajusta la coordenada libre. En figuras de dos esquinas (Rectángulo, Elipse, Polígono) activa proporción 1:1.',
    },
    {
      lead: 'SP (F10) — Seguimiento polar',
      body: 'Guía angular configurable cada 15°, 30°, 45° o 90° con captura estable y cuantización de distancia con SNAP sobre el rayo polar.',
    },
    {
      lead: 'RG (F3) — Referencias geométricas (OSNAP)',
      body: 'Muestra marcadores de color sobre puntos exactos de objetos existentes: Extremo, Punto medio, Centro, Cuadrante, Intersección, Perpendicular y Paralelo.',
    },
    {
      lead: 'DIN (F12) y ORIGEN',
      body: 'DIN muestra junto al cursor las coordenadas X/Y, longitud y ángulo en tiempo real. Con el icono de diana u ORIGEN puedes reubicar el punto (0,0), cambiar unidades (px, mm, cm, m) y dirección del eje +Y.',
    },
  ]);

  b.drawIllustration(
    'osnap-rg',
    'Figura 9 · Marcadores reales de Referencias Geométricas RG (OSNAP) sobre un objeto de muestra.',
    49
  );

  b.drawCallout('warn', 'Evita conflictos al combinar ORT y SP', [
    'ORT ([F8]) restringe únicamente a 0° y 90° en trazos lineales. Si necesitas ángulos de 15°, 30° o 45°, desactiva ORT y deja activo SP ([F10]).',
  ]);

  // =========================================================================
  // SECCIÓN 7: ACOTACIÓN, COINCIDENCIA DE PUNTOS Y MENÚS CONTEXTUALES
  // =========================================================================
  b.drawSectionTitle(
    '7',
    'Acotación técnica, coincidir puntos y menús rápidos',
    'Tipos de cota, edición de etiquetas, coincidir puntos (CP), unir (UNI) y menús.'
  );

  b.drawSubTitle('Acotación técnica');
  b.drawBullets([
    {
      lead: 'Tipos de cota disponibles',
      body: 'Lineal (ACL), Alineada (ACA), Angular (ANG), Radial (RAD), Diametral (DIA) y Por coordenadas (COR), accesibles desde Herramientas, el buscador (;) o la barra de comandos.',
    },
    {
      lead: 'Edición directa de cotas',
      body: 'Haz doble clic sobre el texto de cualquier cota para sobrescribir su etiqueta o personalizar unidades y decimales.',
    },
  ]);

  b.drawIllustration(
    'acotacion',
    'Figura 10 · Ejemplos de acotación lineal, alineada, angular, radial, diametral y por coordenadas.',
    46
  );

  b.drawSubTitle('Coincidir puntos (CP) y Unir segmentos (UNI)');
  b.drawBullets([
    {
      lead: 'Hacer coincidir puntos (CP)',
      body: 'Selecciona el primer punto de referencia (con ayuda de RG) y luego el segundo punto a empatar. Puedes elegir si el primer elemento permanece fijo o se desplaza para eliminar holguras.',
    },
    {
      lead: 'Unir segmentos (UNI)',
      body: 'Selecciona líneas o polilíneas consecutivas con extremos coincidentes y conviértelas en una sola polilínea continua.',
    },
  ]);

  b.drawSubTitle('Menús contextuales rápidos');
  b.drawBullets([
    {
      lead: 'Menú de acciones con clic derecho sobre la selección',
      body: 'Cuando tengas uno o varios elementos seleccionados y hagas clic derecho sobre ellos, aparecerá el menú contextual de acciones (Copiar, Duplicar, Girar, Simetría, Propiedades, Bloquear, Agrupar, Alinear o Acotar) sin estorbar durante el trabajo normal.',
    },
    {
      lead: 'Menú rápido en lienzo vacío',
      body: 'Con clic derecho o el botón contextual sobre el fondo puedes pegar, alternar ayudas (GRID, SNAP, ORT), centrar vista o lanzar herramientas de dibujo.',
    },
  ]);

  // =========================================================================
  // SECCIÓN 8: ECUACIONES, GRÁFICAS, CAPAS Y APARIENCIA
  // =========================================================================
  b.drawSectionTitle(
    '8',
    'Ecuaciones, gráficas, capas y apariencia del lienzo',
    'Ecuaciones KaTeX con espacios, gráficas, importación, capas, colores y 8 temas.'
  );
  b.drawBullets([
    {
      lead: 'Fórmulas matemáticas en vivo (M)',
      body: 'Inserta ecuaciones renderizadas con KaTeX. Al editarlas se habilita una cinta visual de fracciones, raíces, potencias, sumatorias, integrales, matrices y letras griegas, con soporte para espacios explícitos (ej. "0.713 m").',
    },
    {
      lead: 'Plano cartesiano y gráficas (G)',
      body: 'Grafica una o varias funciones matemáticas y=f(x) con rangos X/Y ajustables, colores por curva y etiqueta visible en el lienzo.',
    },
    {
      lead: 'Importar imágenes y documentos',
      body: 'Arrastra archivos al lienzo o usa Importar para insertar imágenes (PNG, JPG, SVG) y documentos (PDF, DOCX, XLSX, TXT), con opción de fijarlos como fondo bloqueado o recorrerlos con la rueda del ratón.',
    },
    {
      lead: 'Capas y pestaña Orden',
      body: 'Desde Capas en el inspector derecho crea capas independientes, controla su visibilidad y bloquéalas; en la pestaña Orden gestiona el apilamiento al frente/atrás de los elementos.',
    },
    {
      lead: 'Fondo y Color del lienzo',
      body: 'En Propiedades combina cualquier patrón de fondo (Blanco liso, Cuadriculado, Rayado, Punteado, Isométrico) con el Color del lienzo (Automático, Blanco, Grafito, Verde pizarra, Crema o Personalizado).',
    },
    {
      lead: '8 temas y cursor de alto contraste',
      body: 'En Configuración elige entre Claro, Oscuro, Cálida, Fría, Natura, Plano, Sepia y Neón, tamaño de cursor (22 a 44 px) y color de alto contraste.',
    },
  ]);

  b.drawIllustration(
    'apariencia',
    'Figura 11 · Colores de lienzo (6 muestras), patrones de fondo (5 estilos) y los 8 temas de interfaz.',
    58
  );

  // =========================================================================
  // SECCIÓN 9: EXPORTACIÓN, IMPRESIÓN Y ATAJOS DE TECLADO
  // =========================================================================
  b.drawSectionTitle(
    '9',
    'Exportación, impresión y modos de salida',
    'Alcance de exportación, fondo actual/blanco/transparente, marco y nitidez.'
  );

  b.drawSubTitle('Opciones de exportación (PDF, PNG, Portapapeles e Impresión)');
  b.drawBullets([
    {
      lead: 'Alcance de exportación',
      body: 'Elige entre Pizarrón completo (o página fija exacta), Área recortada (seleccionada en el lienzo con Exportar área) o Solo objetos seleccionados.',
    },
    {
      lead: 'Modos de fondo',
      body: 'Exporta con el diseño y marco actual del pizarrón, sobre fondo blanco sólido o con fondo transparente (en modo transparente se conservan únicamente los elementos dibujados por el usuario, sin cuadrícula ni marco de hoja).',
    },
    {
      lead: 'Resolución e impresión',
      body: 'Escala 1x, 2x o 3x para PNG y PDF vectorial nítido, copia directa al portapapeles o impresión directa desde el navegador.',
    },
  ]);

  b.drawIllustration(
    'exportacion-modos',
    'Modos de fondo al exportar: Diseño actual (con marco/cuadrícula), Blanco sólido o Transparente (solo dibujo).',
    33
  );

  // =========================================================================
  // SOLUCIÓN DE PROBLEMAS (6 CASOS PRÁCTICOS)
  // =========================================================================
  b.drawSectionTitle(
    'S',
    'Solución de problemas frecuentes',
    'Guía rápida para resolver los 6 incidentes más habituales en clase o dibujo CAD.'
  );
  b.drawTable(
    ['Situación', 'Causa y solución recomendada'],
    [
      [
        '1. Cuadro de texto o tabla muestra "Reparar"',
        'Un contenido antiguo o corrupto activó el aislamiento por Error Boundary para proteger el resto de la pizarra. Pulsa "Reparar" para normalizar automáticamente el objeto sin perder tu proyecto.',
      ],
      [
        '2. La rueda mueve el PDF en vez del lienzo',
        'Cuando el cursor está sobre un PDF o archivo desplazable importado, la rueda recorre el archivo. Mantén [Ctrl] + [Rueda] para hacer zoom sobre el lienzo o mueve el puntero fuera del archivo.',
      ],
      [
        '3. No aparece el marco de hoja o recorte',
        'En "Espacio infinito" no existe marco de hoja. Cambia a Carta, Oficio, Doble Carta, Media Carta o Personalizado y verifica en Propiedades que "Mostrar marco" esté activado.',
      ],
      [
        '4. Las líneas no salen a 0°/90° o no empatan',
        'Activa ORT ([F8]) para líneas ortogonales o RG / OSNAP ([F3]) para enganchar vértices exactos. Si ya existen holguras entre segmentos, usa el comando CP (Coincidir puntos).',
      ],
      [
        '5. El historial conserva máximo 5 versiones',
        'Cada proyecto almacena hasta 5 versiones locales para cuidar el espacio del navegador. Al guardar una sexta versión, la más antigua se reemplaza tras confirmar el guardado; usa Exportar .pizarra para respaldos permanentes.',
      ],
      [
        '6. Al exportar transparente no sale la cuadrícula',
        'El modo Transparente excluye intencionalmente cuadrícula, color de fondo y marco de hoja para entregar solo tus trazos. Si necesitas marco o fondo, elige "Diseño actual" o "Blanco sólido".',
      ],
    ],
    [56, CONTENT_W - 56]
  );

  // =========================================================================
  // TABLA DE ATAJOS DE TECLADO AGRUPADA POR CATEGORÍAS
  // =========================================================================
  b.drawSectionTitle(
    'K',
    'Tabla de atajos de teclado por categoría',
    'Referencia rápida agrupada en Herramientas, Precisión, Edición y Vista.'
  );

  b.drawSubTitle('Herramientas');
  b.drawTable(
    ['Atajo', 'Acción', 'Atajo', 'Acción'],
    [
      ['[V]', 'Herramienta Selección', '[S]', 'Figuras geométricas 2D y sólidos 3D'],
      ['[H] / [Espacio]', 'Mano / desplazar lienzo', '[L]', 'Líneas, flechas y conectores'],
      ['[P]', 'Lápiz a mano alzada', '[C]', 'Cortar / Recortar por intersecciones'],
      ['[E]', 'Borrador parcial continuo', '[M] / [G] / [N]', 'Ecuación / Gráfica / Nota adhesiva'],
      ['[T]', 'Cuadro de texto enriquecido', '[;] o [/]', 'Buscador directo de comandos CAD'],
    ],
    [39, 51, 38, CONTENT_W - 128],
    { keyBadgesInCols: [0, 2] }
  );

  b.drawSubTitle('Precisión');
  b.drawTable(
    ['Atajo', 'Acción', 'Atajo', 'Acción'],
    [
      ['[F3]', 'Activar / desactivar RG (OSNAP)', '[F10]', 'Seguimiento polar SP (15°/30°/45°/90°)'],
      ['[F7]', 'Mostrar / ocultar cuadrícula (GRID)', '[F12]', 'Entrada dinámica junto al cursor (DIN)'],
      ['[F8]', 'Modo ORT (0°/90° líneas · 1:1 figuras)', '[Shift] + arrastre', 'Proporción 1:1 temporal en figuras'],
      ['[F9]', 'Ajuste a pasos de cuadrícula (SNAP)', '[Enter] / [Esc]', 'Confirmar coordenada / Cancelar comando'],
    ],
    [39, 51, 38, CONTENT_W - 128],
    { keyBadgesInCols: [0, 2] }
  );

  b.drawSubTitle('Edición');
  b.drawTable(
    ['Atajo', 'Acción', 'Atajo', 'Acción'],
    [
      ['[Ctrl]+[Z] / [Y]', 'Deshacer / Rehacer', '[Ctrl]+[J]', 'Justificar párrafo en editor de texto'],
      ['[Ctrl]+[C]/[X]/[V]', 'Copiar / Cortar / Pegar', '[Ctrl]+[G]', 'Agrupar / desagrupar (Shift+G)'],
      ['[Ctrl]+[D] / [A]', 'Duplicar / Seleccionar todo', '[Tab]', 'Avanzar entre celdas de tabla'],
      ['[Ctrl]+[S]', 'Guardar versión local (máx. 5)', '[Supr]', 'Eliminar selección actual'],
    ],
    [39, 51, 38, CONTENT_W - 128],
    { keyBadgesInCols: [0, 2] }
  );

  b.drawSubTitle('Vista');
  b.drawTable(
    ['Atajo', 'Acción', 'Atajo', 'Acción'],
    [
      ['[Ctrl]+[+]', 'Acercar zoom sobre el lienzo', '[Ctrl]+[0]', 'Restablecer zoom al 100%'],
      ['[Ctrl]+[-]', 'Alejar zoom sobre el lienzo', '[Ctrl]+[.]', 'Alternar Modo de trabajo limpio'],
      ['[Rueda]', 'Zoom libre (desplaza en PDFs)', '[Ctrl]+[Rueda]', 'Zoom sobre archivos/PDFs importados'],
    ],
    [39, 51, 38, CONTENT_W - 128],
    { keyBadgesInCols: [0, 2] }
  );

  // Rellenar índice exacto en página 2 y pies de página globales
  b.finalizeTocAndFooters();
  return b.doc;
}

/**
 * Genera y descarga inmediatamente el Manual de Usuario en PDF desde el navegador.
 */
export function downloadUserManualPdf(): void {
  const doc = buildUserManualPdf();
  doc.save(`Manual_de_Usuario_Abaco_Pizarra_Virtual_v${APP_VERSION}.pdf`);
}
