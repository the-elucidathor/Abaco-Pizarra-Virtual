import React from 'react';
import type { LineKind, Point2D, ShapeKind, StrokeStyle } from '../types/whiteboard';

export interface ShapeCatalogItem {
  kind: ShapeKind;
  label: string;
}

export interface ShapeCatalogGroup {
  id: string;
  title: string;
  items: ShapeCatalogItem[];
}

export const SHAPE_CATALOG_GROUPS: ShapeCatalogGroup[] = [
  {
    id: 'basic',
    title: 'Polígonos básicos',
    items: [
      { kind: 'rectangle', label: 'Rectángulo' },
      { kind: 'square', label: 'Cuadrado' },
      { kind: 'triangle', label: 'Triángulo' },
      { kind: 'right-triangle', label: 'Triáng. rectángulo' },
      { kind: 'right-trapezoid', label: 'Trapecio rect.' },
      { kind: 'trapezoid', label: 'Trapecio' },
      { kind: 'parallelogram', label: 'Paralelogramo' },
      { kind: 'diamond', label: 'Rombo' },
    ],
  },
  {
    id: 'regular',
    title: 'Polígonos regulares',
    items: [
      { kind: 'pentagon', label: 'Pentágono' },
      { kind: 'hexagon', label: 'Hexágono' },
      { kind: 'octagon', label: 'Octágono' },
      { kind: 'polygon', label: 'Polígono N-lados' },
      { kind: 'star', label: 'Estrella' },
    ],
  },
  {
    id: 'rounded',
    title: 'Formas redondeadas y trazos',
    items: [
      { kind: 'circle', label: 'Círculo' },
      { kind: 'ellipse', label: 'Elipse' },
      { kind: 'rounded-rect', label: 'Rect. redondeado' },
      { kind: 'semicircle', label: 'Semicírculo' },
      { kind: 'sector', label: 'Sector circular' },
      { kind: 'arc', label: 'Arco' },
      { kind: 'curve', label: 'Curva Bézier' },
      { kind: 'polyline', label: 'Polilínea' },
    ],
  },
  {
    id: 'solids3d',
    title: 'Sólidos 3D',
    items: [
      { kind: 'cube', label: 'Cubo' },
      { kind: 'cube-wire', label: 'Cubo transparente' },
      { kind: 'cylinder', label: 'Cilindro' },
      { kind: 'oblique-prism', label: 'Prisma oblicuo' },
      { kind: 'square-pyramid', label: 'Pirámide cuad.' },
      { kind: 'cone', label: 'Cono' },
      { kind: 'sphere', label: 'Esfera' },
      { kind: 'tetrahedron', label: 'Tetraedro' },
      { kind: 'triangular-prism', label: 'Prisma triangular' },
      { kind: 'hex-pyramid', label: 'Pirámide hex.' },
      { kind: 'hex-prism', label: 'Prisma hexagonal' },
      { kind: 'octahedron', label: 'Octaedro' },
      { kind: 'frustum-pyramid', label: 'Tronco pirámide' },
      { kind: 'frustum-cone', label: 'Tronco de cono' },
    ],
  },
];

export const SOLID_3D_KINDS: ReadonlySet<ShapeKind> = new Set<ShapeKind>([
  'cube',
  'cube-wire',
  'cylinder',
  'oblique-prism',
  'square-pyramid',
  'cone',
  'sphere',
  'tetrahedron',
  'triangular-prism',
  'hex-pyramid',
  'hex-prism',
  'octahedron',
  'frustum-pyramid',
  'frustum-cone',
]);

export function is3DSolidShape(kind: ShapeKind): boolean {
  return SOLID_3D_KINDS.has(kind);
}

export interface LineCatalogItem {
  kind: LineKind;
  label: string;
}

export const LINE_CATALOG: LineCatalogItem[] = [
  { kind: 'line', label: 'Línea recta' },
  { kind: 'segment', label: 'Segmento acotado' },
  { kind: 'dashed-line', label: 'Línea discontinua' },
  { kind: 'arrow', label: 'Flecha simple' },
  { kind: 'double-arrow', label: 'Flecha doble' },
  { kind: 'vector', label: 'Vector dirigido' },
  { kind: 'connector', label: 'Conector curvo' },
  { kind: 'orthogonal', label: 'Conector ortogonal' },
];

function polarToCartesian(cx: number, cy: number, rx: number, ry: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + rx * Math.cos(rad),
    y: cy + ry * Math.sin(rad),
  };
}

function buildArcPath(w: number, h: number, startAngle: number, endAngle: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(4, w / 2 - 4);
  const ry = Math.max(4, h / 2 - 4);
  const start = polarToCartesian(cx, cy, rx, ry, endAngle);
  const end = polarToCartesian(cx, cy, rx, ry, startAngle);
  const diff = (((endAngle - startAngle) % 360) + 360) % 360;
  const largeArcFlag = diff <= 180 ? '0' : '1';
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function regularPolygonPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  offsetRad = -Math.PI / 2
): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i * 2 * Math.PI) / sides + offsetRad;
    pts.push(`${(cx + rx * Math.cos(ang)).toFixed(1)},${(cy + ry * Math.sin(ang)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export interface ShapeRenderOptions {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  cornerRadius?: number;
  polygonSides?: number;
  arcStartAngle?: number;
  arcEndAngle?: number;
  customPoints?: Point2D[];
  customVertices?: Point2D[];
  flipX?: boolean;
  flipY?: boolean;
}

export function renderShapeSvgElement(
  kind: ShapeKind,
  w: number,
  h: number,
  opts: ShapeRenderOptions
): React.ReactNode {
  const rendered = renderShapeSvgElementInner(kind, w, h, opts);
  if (!opts.flipX && !opts.flipY) return rendered;
  const tx = opts.flipX ? w : 0;
  const ty = opts.flipY ? h : 0;
  const sx = opts.flipX ? -1 : 1;
  const sy = opts.flipY ? -1 : 1;
  return <g transform={`translate(${tx}, ${ty}) scale(${sx}, ${sy})`}>{rendered}</g>;
}

function renderShapeSvgElementInner(
  kind: ShapeKind,
  w: number,
  h: number,
  opts: ShapeRenderOptions
): React.ReactNode {
  const sw = opts.strokeWidth;
  const pad = sw / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);
  const dash =
    opts.strokeStyle === 'dashed' ? '8 5' : opts.strokeStyle === 'dotted' ? '2 5' : undefined;
  const fill = opts.fillColor === 'transparent' ? 'none' : opts.fillColor;
  const hiddenDash = `${Math.max(2, sw * 1.4)} ${Math.max(2.5, sw * 1.8)}`;
  const stroke = opts.strokeColor;

  if (kind === 'custom-polygon' || (opts.customVertices && opts.customVertices.length >= 2)) {
    const verts = opts.customVertices && opts.customVertices.length >= 2 ? opts.customVertices : [
      { x: pad, y: pad },
      { x: w - pad, y: pad },
      { x: w - pad, y: h - pad },
      { x: pad, y: h - pad },
    ];
    if (verts.length === 2) {
      return (
        <line
          x1={verts[0].x}
          y1={verts[0].y}
          x2={verts[1].x}
          y2={verts[1].y}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      );
    }
    return (
      <polygon
        points={verts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        strokeDasharray={dash}
        strokeLinejoin="round"
      />
    );
  }

  switch (kind) {
    case 'rectangle':
    case 'square':
      return (
        <rect
          x={pad}
          y={pad}
          width={iw}
          height={ih}
          rx={opts.cornerRadius || 0}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      );
    case 'rounded-rect':
      return (
        <rect
          x={pad}
          y={pad}
          width={iw}
          height={ih}
          rx={Math.min(iw, ih) * 0.22}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      );
    case 'circle':
    case 'ellipse':
      return (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={iw / 2}
          ry={ih / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
        />
      );
    case 'triangle':
      return (
        <polygon
          points={`${w / 2},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'right-triangle':
      return (
        <polygon
          points={`${pad},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'right-trapezoid':
      return (
        <polygon
          points={`${pad},${pad} ${pad + iw * 0.72},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'trapezoid':
      return (
        <polygon
          points={`${pad + iw * 0.2},${pad} ${pad + iw * 0.8},${pad} ${w - pad},${h - pad} ${pad},${h - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'parallelogram':
      return (
        <polygon
          points={`${pad + iw * 0.25},${pad} ${w - pad},${pad} ${pad + iw * 0.75},${h - pad} ${pad},${h - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},${pad} ${w - pad},${h / 2} ${w / 2},${h - pad} ${pad},${h / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'pentagon':
      return (
        <polygon
          points={regularPolygonPoints(w / 2, h / 2, iw / 2, ih / 2, 5)}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'hexagon':
      return (
        <polygon
          points={regularPolygonPoints(w / 2, h / 2, iw / 2, ih / 2, 6, 0)}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'octagon':
      return (
        <polygon
          points={regularPolygonPoints(w / 2, h / 2, iw / 2, ih / 2, 8, Math.PI / 8)}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    case 'polygon': {
      const sides = Math.max(3, opts.polygonSides || 6);
      return (
        <polygon
          points={regularPolygonPoints(w / 2, h / 2, iw / 2, ih / 2, sides)}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    }
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = (i * Math.PI) / 5 - Math.PI / 2;
        const rScale = i % 2 === 0 ? 1 : 0.42;
        const px = w / 2 + (iw / 2) * rScale * Math.cos(ang);
        const py = h / 2 + (ih / 2) * rScale * Math.sin(ang);
        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      }
      return (
        <polygon
          points={pts.join(' ')}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    }
    case 'semicircle': {
      const rX = iw / 2;
      const rY = ih * 0.72;
      const baseY = h - pad - ih * 0.14;
      return (
        <path
          d={`M ${pad} ${baseY} A ${rX} ${rY} 0 0 1 ${w - pad} ${baseY} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    }
    case 'sector': {
      const sx = pad;
      const sy = h - pad;
      return (
        <path
          d={`M ${sx} ${sy} L ${sx} ${pad} A ${iw} ${ih} 0 0 1 ${w - pad} ${sy} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      );
    }
    case 'arc': {
      const a0 = opts.arcStartAngle ?? 0;
      const a1 = opts.arcEndAngle ?? 220;
      const diff = (((a1 - a0) % 360) + 360) % 360;
      if (diff >= 359.8 || (Math.abs(a1 - a0) >= 359.8 && diff < 0.2)) {
        const rx = Math.max(4, w / 2 - 4);
        const ry = Math.max(4, h / 2 - 4);
        return (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
        );
      }
      const d = buildArcPath(w, h, a0, a1);
      return (
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      );
    }
    case 'curve': {
      const p0 = opts.customPoints?.[0] ?? { x: pad, y: h - pad };
      const p1 = opts.customPoints?.[1] ?? { x: w / 2, y: pad - h * 0.35 };
      const p2 = opts.customPoints?.[2] ?? { x: w - pad, y: h - pad };
      const d = `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      return (
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      );
    }
    case 'polyline': {
      const pts =
        opts.customPoints && opts.customPoints.length > 0
          ? opts.customPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
          : `${pad},${h - pad} ${w * 0.38},${pad} ${w * 0.65},${h * 0.68} ${w - pad},${pad + 4}`;
      return (
        <polyline
          points={pts}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    // ============ 3D SOLIDS ============
    case 'cube':
    case 'cube-wire': {
      const dx = iw * 0.25;
      const dy = ih * 0.22;
      const fx = pad;
      const fy = pad + dy;
      const fw = iw - dx;
      const fh = ih - dy;
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round">
          <rect x={fx} y={fy} width={fw} height={fh} fill={fill} />
          <polygon
            points={`${fx},${fy} ${fx + dx},${pad} ${w - pad},${pad} ${fx + fw},${fy}`}
            fill={fill}
          />
          <polygon
            points={`${fx + fw},${fy} ${w - pad},${pad} ${w - pad},${pad + fh} ${fx + fw},${fy + fh}`}
            fill={fill}
          />
          {kind === 'cube-wire' && (
            <g strokeDasharray={hiddenDash} opacity={0.7}>
              <line x1={fx + dx} y1={pad} x2={fx + dx} y2={pad + fh} />
              <line x1={fx + dx} y1={pad + fh} x2={fx} y2={fy + fh} />
              <line x1={fx + dx} y1={pad + fh} x2={w - pad} y2={pad + fh} />
            </g>
          )}
        </g>
      );
    }
    case 'oblique-prism': {
      const dx = iw * 0.26;
      const dy = ih * 0.22;
      const skew = iw * 0.14;
      const topY = pad;
      const frontTopY = pad + dy;
      const botY = h - pad;
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round" fill={fill}>
          {/* Top face */}
          <polygon
            points={`${pad + skew + dx},${topY} ${w - pad},${topY} ${w - pad - dx},${frontTopY} ${pad + skew},${frontTopY}`}
          />
          {/* Front face */}
          <polygon
            points={`${pad + skew},${frontTopY} ${w - pad - dx},${frontTopY} ${w - pad - dx - skew},${botY} ${pad},${botY}`}
          />
          {/* Right face */}
          <polygon
            points={`${w - pad - dx},${frontTopY} ${w - pad},${topY} ${w - pad - skew},${botY - dy} ${w - pad - dx - skew},${botY}`}
          />
        </g>
      );
    }
    case 'cylinder': {
      const rx = iw / 2;
      const ry = Math.max(4, ih * 0.15);
      const topCy = pad + ry;
      const botCy = h - pad - ry;
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <path
            d={`M ${pad} ${topCy} L ${pad} ${botCy} A ${rx} ${ry} 0 0 0 ${w - pad} ${botCy} L ${w - pad} ${topCy}`}
            fill={fill}
          />
          <ellipse cx={w / 2} cy={topCy} rx={rx} ry={ry} fill={fill} />
          <path
            d={`M ${pad} ${botCy} A ${rx} ${ry} 0 0 1 ${w - pad} ${botCy}`}
            fill="none"
            strokeDasharray={hiddenDash}
            opacity={0.65}
          />
        </g>
      );
    }
    case 'square-pyramid': {
      const apexX = w * 0.5;
      const apexY = pad;
      const bl = { x: pad, y: h - pad - ih * 0.12 };
      const bf = { x: w * 0.44, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.14 };
      const bb = { x: w * 0.58, y: h - pad - ih * 0.28 };
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon points={`${apexX},${apexY} ${bl.x},${bl.y} ${bf.x},${bf.y}`} fill={fill} />
          <polygon points={`${apexX},${apexY} ${bf.x},${bf.y} ${br.x},${br.y}`} fill={fill} />
          <g strokeDasharray={hiddenDash} opacity={0.68} fill="none">
            <line x1={apexX} y1={apexY} x2={bb.x} y2={bb.y} />
            <line x1={bl.x} y1={bl.y} x2={bb.x} y2={bb.y} />
            <line x1={br.x} y1={br.y} x2={bb.x} y2={bb.y} />
          </g>
        </g>
      );
    }
    case 'cone': {
      const rx = iw / 2;
      const ry = Math.max(4, ih * 0.15);
      const botCy = h - pad - ry;
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <path
            d={`M ${w / 2} ${pad} L ${pad} ${botCy} A ${rx} ${ry} 0 0 0 ${w - pad} ${botCy} Z`}
            fill={fill}
          />
          <path
            d={`M ${pad} ${botCy} A ${rx} ${ry} 0 0 1 ${w - pad} ${botCy}`}
            fill="none"
            strokeDasharray={hiddenDash}
            opacity={0.68}
          />
        </g>
      );
    }
    case 'sphere': {
      const cx = w / 2;
      const cy = h / 2;
      const rx = iw / 2;
      const ry = ih / 2;
      const eqRy = Math.max(4, ry * 0.32);
      return (
        <g stroke={stroke} strokeWidth={sw}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} />
          <path
            d={`M ${cx - rx} ${cy} A ${rx} ${eqRy} 0 0 0 ${cx + rx} ${cy}`}
            fill="none"
          />
          <path
            d={`M ${cx - rx} ${cy} A ${rx} ${eqRy} 0 0 1 ${cx + rx} ${cy}`}
            fill="none"
            strokeDasharray={hiddenDash}
            opacity={0.65}
          />
        </g>
      );
    }
    case 'tetrahedron': {
      const apex = { x: w * 0.56, y: pad };
      const bl = { x: pad, y: h - pad - ih * 0.14 };
      const bf = { x: w * 0.45, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.24 };
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon points={`${apex.x},${apex.y} ${bl.x},${bl.y} ${bf.x},${bf.y}`} fill={fill} />
          <polygon points={`${apex.x},${apex.y} ${bf.x},${bf.y} ${br.x},${br.y}`} fill={fill} />
          <line
            x1={bl.x}
            y1={bl.y}
            x2={br.x}
            y2={br.y}
            strokeDasharray={hiddenDash}
            opacity={0.65}
          />
        </g>
      );
    }
    case 'triangular-prism': {
      const t1 = { x: pad + iw * 0.22, y: pad };
      const t2 = { x: w - pad, y: pad + ih * 0.18 };
      const t3 = { x: pad, y: pad + ih * 0.32 };
      const b1 = { x: t1.x, y: h - pad - ih * 0.26 };
      const b2 = { x: t2.x, y: h - pad - ih * 0.1 };
      const b3 = { x: pad + iw * 0.12, y: h - pad };
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon
            points={`${t3.x},${t3.y} ${t2.x},${t2.y} ${b2.x},${b2.y} ${b3.x},${b3.y}`}
            fill={fill}
          />
          <polygon points={`${t1.x},${t1.y} ${t2.x},${t2.y} ${t3.x},${t3.y}`} fill={fill} />
          <g strokeDasharray={hiddenDash} opacity={0.65} fill="none">
            <line x1={t1.x} y1={t1.y} x2={b1.x} y2={b1.y} />
            <line x1={b3.x} y1={b3.y} x2={b1.x} y2={b1.y} />
            <line x1={b2.x} y1={b2.y} x2={b1.x} y2={b1.y} />
          </g>
        </g>
      );
    }
    case 'hex-pyramid': {
      const apex = { x: w / 2, y: pad };
      const cy = h - pad - ih * 0.16;
      const rx = iw / 2;
      const ry = ih * 0.16;
      const pts: Point2D[] = [];
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        pts.push({ x: w / 2 + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
      }
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon
            points={`${apex.x},${apex.y} ${pts[3].x},${pts[3].y} ${pts[2].x},${pts[2].y}`}
            fill={fill}
          />
          <polygon
            points={`${apex.x},${apex.y} ${pts[2].x},${pts[2].y} ${pts[1].x},${pts[1].y}`}
            fill={fill}
          />
          <polygon
            points={`${apex.x},${apex.y} ${pts[1].x},${pts[1].y} ${pts[0].x},${pts[0].y}`}
            fill={fill}
          />
          <g strokeDasharray={hiddenDash} opacity={0.65} fill="none">
            <line x1={apex.x} y1={apex.y} x2={pts[4].x} y2={pts[4].y} />
            <line x1={apex.x} y1={apex.y} x2={pts[5].x} y2={pts[5].y} />
            <line x1={pts[3].x} y1={pts[3].y} x2={pts[4].x} y2={pts[4].y} />
            <line x1={pts[4].x} y1={pts[4].y} x2={pts[5].x} y2={pts[5].y} />
            <line x1={pts[5].x} y1={pts[5].y} x2={pts[0].x} y2={pts[0].y} />
          </g>
        </g>
      );
    }
    case 'hex-prism': {
      const rx = iw / 2;
      const ry = ih * 0.16;
      const topCy = pad + ry;
      const botCy = h - pad - ry;
      const topPts: Point2D[] = [];
      const botPts: Point2D[] = [];
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const px = w / 2 + rx * Math.cos(ang);
        topPts.push({ x: px, y: topCy + ry * Math.sin(ang) });
        botPts.push({ x: px, y: botCy + ry * Math.sin(ang) });
      }
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon
            points={`${topPts[3].x},${topPts[3].y} ${topPts[2].x},${topPts[2].y} ${botPts[2].x},${botPts[2].y} ${botPts[3].x},${botPts[3].y}`}
            fill={fill}
          />
          <polygon
            points={`${topPts[2].x},${topPts[2].y} ${topPts[1].x},${topPts[1].y} ${botPts[1].x},${botPts[1].y} ${botPts[2].x},${botPts[2].y}`}
            fill={fill}
          />
          <polygon
            points={`${topPts[1].x},${topPts[1].y} ${topPts[0].x},${topPts[0].y} ${botPts[0].x},${botPts[0].y} ${botPts[1].x},${botPts[1].y}`}
            fill={fill}
          />
          <polygon
            points={topPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill={fill}
          />
          <g strokeDasharray={hiddenDash} opacity={0.65} fill="none">
            <line x1={topPts[4].x} y1={topPts[4].y} x2={botPts[4].x} y2={botPts[4].y} />
            <line x1={topPts[5].x} y1={topPts[5].y} x2={botPts[5].x} y2={botPts[5].y} />
            <line x1={botPts[3].x} y1={botPts[3].y} x2={botPts[4].x} y2={botPts[4].y} />
            <line x1={botPts[4].x} y1={botPts[4].y} x2={botPts[5].x} y2={botPts[5].y} />
            <line x1={botPts[5].x} y1={botPts[5].y} x2={botPts[0].x} y2={botPts[0].y} />
          </g>
        </g>
      );
    }
    case 'octahedron': {
      const top = { x: w / 2, y: pad };
      const bot = { x: w / 2, y: h - pad };
      const left = { x: pad, y: h / 2 };
      const right = { x: w - pad, y: h / 2 };
      const midFront = { x: w * 0.44, y: h * 0.58 };
      const midBack = { x: w * 0.56, y: h * 0.42 };
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon points={`${top.x},${top.y} ${left.x},${left.y} ${midFront.x},${midFront.y}`} fill={fill} />
          <polygon points={`${top.x},${top.y} ${midFront.x},${midFront.y} ${right.x},${right.y}`} fill={fill} />
          <polygon points={`${bot.x},${bot.y} ${left.x},${left.y} ${midFront.x},${midFront.y}`} fill={fill} />
          <polygon points={`${bot.x},${bot.y} ${midFront.x},${midFront.y} ${right.x},${right.y}`} fill={fill} />
          <g strokeDasharray={hiddenDash} opacity={0.62} fill="none">
            <line x1={top.x} y1={top.y} x2={midBack.x} y2={midBack.y} />
            <line x1={bot.x} y1={bot.y} x2={midBack.x} y2={midBack.y} />
            <line x1={left.x} y1={left.y} x2={midBack.x} y2={midBack.y} />
            <line x1={right.x} y1={right.y} x2={midBack.x} y2={midBack.y} />
          </g>
        </g>
      );
    }
    case 'frustum-pyramid': {
      const tl = { x: pad + iw * 0.24, y: pad + ih * 0.08 };
      const tr = { x: pad + iw * 0.76, y: pad + ih * 0.08 };
      const tf = { x: pad + iw * 0.62, y: pad + ih * 0.18 };
      const tfl = { x: pad + iw * 0.18, y: pad + ih * 0.18 };
      const bl = { x: pad, y: h - pad - ih * 0.08 };
      const bf = { x: pad + iw * 0.72, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.14 };
      const bb = { x: pad + iw * 0.28, y: h - pad - ih * 0.22 };
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <polygon
            points={`${tfl.x},${tfl.y} ${tf.x},${tf.y} ${bf.x},${bf.y} ${bl.x},${bl.y}`}
            fill={fill}
          />
          <polygon
            points={`${tf.x},${tf.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bf.x},${bf.y}`}
            fill={fill}
          />
          <polygon
            points={`${tl.x},${tl.y} ${tr.x},${tr.y} ${tf.x},${tf.y} ${tfl.x},${tfl.y}`}
            fill={fill}
          />
          <g strokeDasharray={hiddenDash} opacity={0.62} fill="none">
            <line x1={tl.x} y1={tl.y} x2={bb.x} y2={bb.y} />
            <line x1={bl.x} y1={bl.y} x2={bb.x} y2={bb.y} />
            <line x1={br.x} y1={br.y} x2={bb.x} y2={bb.y} />
          </g>
        </g>
      );
    }
    case 'frustum-cone': {
      const topRx = iw * 0.26;
      const topRy = Math.max(3, ih * 0.09);
      const botRx = iw / 2;
      const botRy = Math.max(4, ih * 0.14);
      const topCy = pad + topRy;
      const botCy = h - pad - botRy;
      return (
        <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <path
            d={`M ${w / 2 - topRx} ${topCy} L ${pad} ${botCy} A ${botRx} ${botRy} 0 0 0 ${w - pad} ${botCy} L ${w / 2 + topRx} ${topCy}`}
            fill={fill}
          />
          <ellipse cx={w / 2} cy={topCy} rx={topRx} ry={topRy} fill={fill} />
          <path
            d={`M ${pad} ${botCy} A ${botRx} ${botRy} 0 0 1 ${w - pad} ${botCy}`}
            fill="none"
            strokeDasharray={hiddenDash}
            opacity={0.65}
          />
        </g>
      );
    }
  }
}

export function renderLinePreviewSvg(kind: LineKind, strokeColor = '#334155'): React.ReactNode {
  const sw = 2;
  switch (kind) {
    case 'line':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <line x1="6" y1="24" x2="42" y2="8" stroke={strokeColor} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case 'segment':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <line x1="8" y1="22" x2="40" y2="10" stroke={strokeColor} strokeWidth={sw} strokeLinecap="round" />
          <line x1="6" y1="17" x2="10" y2="27" stroke={strokeColor} strokeWidth={sw} />
          <line x1="38" y1="5" x2="42" y2="15" stroke={strokeColor} strokeWidth={sw} />
        </svg>
      );
    case 'dashed-line':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <line
            x1="6"
            y1="24"
            x2="42"
            y2="8"
            stroke={strokeColor}
            strokeWidth={sw}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'arrow':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <line x1="6" y1="24" x2="39" y2="9" stroke={strokeColor} strokeWidth={sw} strokeLinecap="round" />
          <polygon points="43,7 34,8 38,14" fill={strokeColor} />
        </svg>
      );
    case 'double-arrow':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <line x1="10" y1="22" x2="38" y2="10" stroke={strokeColor} strokeWidth={sw} />
          <polygon points="43,8 34,9 38,15" fill={strokeColor} />
          <polygon points="5,24 14,23 10,17" fill={strokeColor} />
        </svg>
      );
    case 'vector':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <circle cx="9" cy="23" r="3" fill={strokeColor} />
          <line x1="9" y1="23" x2="39" y2="9" stroke={strokeColor} strokeWidth={sw} />
          <polygon points="43,7 34,8 38,14" fill={strokeColor} />
        </svg>
      );
    case 'connector':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <path
            d="M 6 24 Q 20 4 40 16"
            fill="none"
            stroke={strokeColor}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <polygon points="43,18 35,19 38,12" fill={strokeColor} />
        </svg>
      );
    case 'orthogonal':
      return (
        <svg viewBox="0 0 48 32" className="w-10 h-7">
          <polyline
            points="6,24 24,24 24,8 40,8"
            fill="none"
            stroke={strokeColor}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <polygon points="43,8 36,4 36,12" fill={strokeColor} />
        </svg>
      );
  }
}
