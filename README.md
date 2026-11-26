# Ábaco Pizarra Virtual

**Ábaco Pizarra Virtual** es una aplicación educativa gratuita de código abierto (licencia **MIT**) enfocada en **ejecutarse de forma nativa en PC sin conexión a internet**, combinando una pizarra virtual interactiva, un editor matemático en tiempo real y herramientas de dibujo técnico CAD con almacenamiento local.

---

## Enfoque nativo en PC y funcionamiento 100% sin internet

- **Sin dependencias en la nube**: Todos los tableros, trazos, archivos `.pizarra`, configuraciones e historial de versiones se guardan de forma local en el equipo (mediante **IndexedDB**, diálogos nativos del sistema en Electron o la carpeta local `./local-data/` si se ejecuta con el servidor local).
- **Motor completo empaquetado localmente**: Las tipografías (`@fontsource/acme`, `@fontsource/alatsi`), el renderizador matemático (`katex`), el graficador (`mathjs`), los importadores de documentos (`pdfjs-dist`, `mammoth`, `xlsx`) y el generador del manual en PDF funcionan sin acceso a internet.
- **Corrector ortográfico listo para trabajar sin red**: En ausencia de conexión a internet, la aplicación omite consultas externas y utiliza automáticamente sus diccionarios integrados sin bloquear ni retrasar el trabajo. *(Únicamente si el usuario lo activa contando con acceso a internet, puede descargar y guardar en caché local diccionarios Hunspell completos desde `cdn.jsdelivr.net/npm/dictionary-*`).*

---

## Capacidades principales

- **Lienzo multi-tablero con navegación fluida**: Zoom centrado en el cursor, desplazamiento libre (herramienta Mano, `Espacio + arrastre` o botón central), encuadre automático y fondos configurables (blanco, cuadrícula, rayado, punteado e isométrico) con plano de coordenadas opcional.
- **Dibujo, trazos técnicos y CAD**: Lápiz a mano alzada sensible a presión, resaltador, borrador parcial/total de trazos, figuras geométricas 2D/3D, polígonos, curvas Bézier, arcos, cotas, referencias a objetos (OSNAP/RG), matrices polares/rectangulares y barra de comandos CAD.
- **Agrupación real de elementos**: Agrupa trazos, figuras, texto y ecuaciones en una unidad geométrica única; al mover, escalar o rotar el grupo, todos sus hijos mantienen sus proporciones y posiciones relativas respecto al pivote del grupo.
- **Texto enriquecido transparente y ecuaciones en tiempo real**: Edición directa sobre el lienzo con fondo transparente para alinear el contenido con la cuadrícula de la pizarra, e inserción de ecuaciones **KaTeX** tanto en bloque independiente como integradas en tiempo real dentro del texto (`En línea` / `En bloque`).
- **Plano cartesiano y graficador**: Representación simultánea de funciones matemáticas, cálculo numérico de intersecciones, puntos coordenados y vectores.
- **Tablas y notas adhesivas**: Tablas editables con pegado tabular desde portapapeles y notas adhesivas configurables.
- **Importación local de documentos**: Soporte para arrastrar y soltar imágenes (`PNG`, `JPG`, `SVG`, `WEBP`), archivos `PDF` multipágina, documentos `DOCX`, hojas de cálculo `XLSX/CSV` y texto plano, con opción para bloquear documentos como fondo de referencia.
- **Exportación y manual integrado**: Exportación a `PNG`, `PDF` vectorial, impresión, archivos editables `.pizarra` y generación del manual ilustrado (`public/Manual_de_Usuario_Abaco_Pizarra_Virtual.pdf` y botón **Manual PDF** dentro de la app).

---

## Requisitos previos

- **Node.js** 20 o superior
- **npm** (incluido con Node.js)

---

## Ejecución nativa en PC (Electron — sin internet)

La aplicación utiliza rutas relativas (`base: './'`) para cargar de manera nativa directamente desde disco (`file://`) sin necesidad de servidor web ni conexión a internet.

1. **Clonar el repositorio e instalar dependencias:**

   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd Abaco-Pizarra-Virtual
   npm install
   npm install -D electron electron-builder
   ```

2. **Compilar la aplicación y abrir la ventana nativa de escritorio:**

   ```bash
   npm run build
   npm run electron:dev
   ```

   *(Opcionalmente, en desarrollo con recarga web puedes ejecutar `npm run dev` en una terminal y `VITE_DEV_SERVER_URL=http://localhost:3000 npm run electron:dev` en otra).*

3. **Generar instalador nativo para Windows (.exe NSIS x64):**

   ```bash
   npm run electron:build-win
   ```

   El instalador listo para usar sin internet se generará dentro del directorio `release-windows/`.

---

## Ejecución en modo servidor local (Web)

Si deseas abrirlo en un navegador local mediante el servidor Express incluido (`server.ts`):

```bash
cp .env.example .env
npm run dev
```

Abre en tu navegador `http://localhost:3000`. Para producción local:

```bash
npm run build
npm start
```

---

## Licencia

Este es un **proyecto educativo gratuito y de código abierto** distribuido bajo la **Licencia MIT**. Consulta el archivo [`LICENSE`](./LICENSE) para conocer los términos completos y la exención de responsabilidad.
