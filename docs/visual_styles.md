# Guía de Estilos Visuales — Agent Hub

> Esta guía define los estándares visuales, la paleta de colores y los componentes base de la interfaz de Agent Hub (v1.9.4).

## 1. Identidad Visual

Agent Hub utiliza un diseño **"Cyberpunk Minimalista"** basado en un tema oscuro profundo, con acentos en violeta eléctrico y tipografía técnica de alta legibilidad.

- **Principios**: Contraste alto, bordes suavizados (8-14px), espaciado generoso y retroalimentación visual inmediata.
- **Tipografías**:
    - **Títulos**: `Syne` (Sans-serif con personalidad).
    - **Cuerpo / Controles**: `Syne` (12-13px).
    - **Datos / Código**: `JetBrains Mono` (10-12px).

## 2. Paleta de Colores (CSS Variables)

La aplicación utiliza exclusivamente variables CSS definidas en `:root`.

### Fondos (Profundidad)
| Variable | Color | Uso |
| :--- | :--- | :--- |
| `--bg0` | `#0d0d0f` | Fondo principal de la ventana |
| `--bg1` | `#141416` | Sidebar, Topbar, Statusbar |
| `--bg2` | `#1a1a1d` | Cards, Modales, Desplegables |
| `--bg3` | `#222226` | Hover en elementos, inputs secundarios |

### Colores de Estado y Acentos
| Estado | Variable | Color | Dim (Alpha 10-12%) |
| :--- | :--- | :--- | :--- |
| **Acento** | `--accent` | `#7c6af7` | `rgba(124, 106, 247, 0.12)` |
| **Éxito** | `--green` | `#34d399` | `rgba(52, 211, 153, 0.10)` |
| **Aviso** | `--amber` | `#fbbf24` | `rgba(251, 191, 36, 0.10)` |
| **Info** | `--blue` | `#60a5fa` | `rgba(96, 165, 250, 0.10)` |
| **Peligro** | `--coral` | `#fb7185` | `rgba(251, 113, 133, 0.10)` |

### Textos
- `--text0`: `#f2f2f3` (Títulos y énfasis)
- `--text1`: `#a8a8b3` (Cuerpo de texto principal)
- `--text2`: `#62626e` (Texto secundario, etiquetas)
- `--text3`: `#3e3e48` (Placeholders, deshabilitados)

## 3. Componentes Base

### Botones (`.btn`)
- **Base**: `border-radius: 8px`, `font-size: 12px`, padding `7px 13px`.
- **Variantes**:
    - `.primary`: Fondo `--accent`, texto blanco.
    - `.ghost`: Sin fondo, texto `--text2`, hover con fondo `--bg3`.
    - `.danger`: Texto `--coral`.

### Badges (`.badge`)
- Chips redondeados (`20px`) usados para estados o etiquetas.
- **Formato**: Siempre deben contener un icono Tabler seguido del texto.
- **Ejemplo**: `<span className="badge green"><i className="ti ti-check" />Activo</span>`

### Modales (`.modal`)
- **Estructura**: `overlay` (blur 3px) > `modal` (bg2, border3).
- **Ancho**: Estándar `500px`, ancho especial (`.wide`) `640px`, extra ancho `min(1080px, 96vw)`.
- **Regla de Cierre**: Click fuera del modal o tecla ESC.

## 4. Iconografía
- **Librería**: Tabler Icons (v3.6.0).
- **Uso**: `<i className="ti ti-[nombre-icono]" />`.
- **Normas**:
    - No usar SVGs inline (salvo casos excepcionales de diagramas).
    - No usar Emojis en la interfaz de usuario (usar iconos Tabler).
    - Tamaño estándar: `14px` - `18px`.

## 5. Comunicación API (Frontend)

Para mantener la coherencia y evitar errores 404 de rutas duplicadas:

- **SIEMPRE** usar el helper `req()` de `src/renderer/api.ts`.
- **NUNCA** incluir el prefijo `/api` en el string de la ruta (el helper lo añade).
- **APIs Nativas**: Si usas `new EventSource()` o similar, usa la constante `API_BASE`.

```typescript
// Correcto
await req('GET', '/projects');
const es = new EventSource(`${API_BASE}/stream`);
```

## 6. Convenciones de Layout
- **Sidebar**: Fija a la izquierda (48px). Íconos de navegación centralizados.
- **Topbar**: Altura fija (44px). Título a la izquierda, acciones a la derecha.
- **Statusbar**: Altura fija (22px). Información técnica de sistema y uso.
