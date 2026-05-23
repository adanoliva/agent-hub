# Dashboard de Entrada - Especificación Técnica

## 📊 Visión General

Dashboard home/principal que muestra estado general del sistema: cantidad de agentes, proyectos, sincronización, notificaciones de optimización y tips.

Se actualiza en tiempo real cuando se modifica un agente o proyecto, y recarga completamente al abrir la app.

---

## 🎯 Ubicación en la App

**Ubicación:** Nuevo tab en sidebar (primera opción)
**Icono:** `ti-dashboard` o `ti-home`
**Nombre:** "Dashboard" o "Inicio"
**Por defecto:** Se abre al iniciar la app
**Accesible:** Siempre desde sidebar

---

## 📋 Contenido del Dashboard

### **Sección 1: Estadísticas Generales**

Tarjeta con información de conteo:

```
┌─────────────────────────────────┐
│ 📊 Estado General                │
│                                 │
│ 🤖 Agentes       45             │
│    └─ Globales: 12              │
│    └─ Por categoría: 18         │
│    └─ Por proyecto: 15          │
│                                 │
│ 📁 Proyectos     12             │
│    └─ Activos: 10               │
│    └─ Pausados: 2               │
│                                 │
│ ✅ Últimas actualizaciones      │
│    └─ Hace 2 horas              │
└─────────────────────────────────┘
```

**Datos necesarios:**
- Cantidad total de agentes
- Desglose por nivel (global, categoría, proyecto)
- Cantidad total de proyectos
- Proyectos activos vs pausados
- Timestamp de última modificación

**Interactividad:**
- Click en "45 Agentes" → Va a vista Agentes
- Click en "12 Proyectos" → Va a vista Proyectos

---

### **Sección 2: Estado de Sincronización**

Tarjeta con estado de sync de agentes y proyectos:

```
┌─────────────────────────────────┐
│ 🔄 Sincronización                │
│                                 │
│ ✅ Agentes: 42/45 sincronizados │
│    ⚠️ 3 pendientes               │
│                                 │
│ ✅ Proyectos: 10/12 al día      │
│    ⚠️ 2 desfasados              │
│                                 │
│ 📦 Directorio externo            │
│    └─ Último sync: hace 1h      │
│    └─ Estado: ✅ Actualizado    │
│                                 │
│ [🔄 Sincronizar todo]           │
└─────────────────────────────────┘
```

**Datos necesarios:**
- Total agentes vs agentes sincronizados
- Número de agentes pendientes
- Total proyectos vs proyectos al día
- Número de proyectos desfasados
- Último sync del directorio externo
- Estado del directorio externo (✅ actualizado / ⚠️ desactualizado / ❌ error)

**Estados posibles:**
- ✅ **Actualizado**: Todo sincronizado
- ⚠️ **Pendiente**: Hay cambios sin sincronizar
- ❌ **Error**: Falló la última sincronización

**Interactividad:**
- Click en "3 pendientes" → Filtra agentes pendientes en vista Agentes
- Click en "2 desfasados" → Filtra proyectos desfasados en vista Proyectos
- Click en "[🔄 Sincronizar todo]" → Ejecuta `POST /api/sync-all`

---

### **Sección 3: Oportunidades de Mejora / Notificaciones**

Tarjeta con sistema de notificaciones y sugerencias:

```
┌──────────────────────────────────┐
│ 💡 Oportunidades de Mejora       │
│                                  │
│ ⚡ 5 notificaciones              │
│                                  │
│ 🔴 CRÍTICA (1)                   │
│    ├─ 🤖 Agente "api-dev"        │
│    │  └─ ❌ Sin modelo especificado
│    │     [Asignar modelo]        │
│                                  │
│ 🟡 OPTIMIZACIÓN (3)              │
│    ├─ 🤖 Agente "test-writer"    │
│    │  └─ ⚠️ No optimizado        │
│    │     [Optimizar ahora]       │
│    │                             │
│    ├─ 📁 Proyecto "React App"    │
│    │  └─ ⚠️ Sin CLAUDE.md        │
│    │     [Generar ahora]         │
│    │                             │
│    └─ 📁 Proyecto "Backend"      │
│       └─ ⚠️ 2 agentes pendientes │
│          [Sincronizar]           │
│                                  │
│ 🔵 INFORMACIÓN (1)               │
│    └─ 📊 Alto consumo de tokens  │
│       └─ 120K esta semana        │
│          [Ver análisis]          │
│                                  │
│ [Ver todas (8)]                  │
└──────────────────────────────────┘
```

**Tipos de notificación:**

| Tipo | Color | Ejemplos |
|------|-------|----------|
| **CRÍTICA** | 🔴 Rojo | Agente sin modelo, proyecto sin CLAUDE.md, error en sync |
| **OPTIMIZACIÓN** | 🟡 Amarillo | Agente no optimizado, agente sin tools, duplicación detectada |
| **INFORMACIÓN** | 🔵 Azul | Tips educativos, nuevos agentes disponibles |
| **ÉXITO** | 🟢 Verde | Sync completado, agente optimizado |

**Lógica de generación de notificaciones:**

```
Revisar todos los agentes:
├─ ¿Sin modelo explícito? → Notificación crítica
├─ ¿Sin tools? → Notificación optimización
└─ ¿No optimizado? → Notificación optimización

Revisar todos los proyectos:
├─ ¿Sin CLAUDE.md? → Notificación crítica
├─ ¿Sin GitHub instructions? → Notificación optimización
├─ ¿Agentes pendientes? → Notificación optimización
└─ ¿Desfasado vs directorio externo? → Notificación optimización

Revisar consumo API (si aiProvider === "api"):
├─ ¿Alto consumo (>80K tokens semana)? → Notificación información

Detectar duplicación:
├─ ¿Agentes muy similares (mismo purpose)? → Notificación optimización
```

**Mostrar máximo 5 notificaciones:**
- Ordenadas por prioridad (CRÍTICA > OPTIMIZACIÓN > INFORMACIÓN > ÉXITO)
- Si hay más de 5, botón "[Ver todas (N)]"

**Cada notificación es clickeable:**
- Click en agente → Abre editor del agente
- Click en proyecto → Abre drawer del proyecto
- Click en acción → Ejecuta acción (optimizar, generar, sincronizar, etc.)

---

### **Sección 4: Quick Actions (Acciones Rápidas)**

Botones de acceso rápido:

```
┌──────────────────────────────────┐
│ ⚡ Acciones Rápidas              │
│                                  │
│ [+ Nuevo Agente]                │
│ [+ Nuevo Proyecto]              │
│ [🔄 Sincronizar Todo]           │
│ [💬 Ir a Chat]                  │
│ [📈 Ver Análisis]               │
└──────────────────────────────────┘
```

**Acciones:**
- **+ Nuevo Agente** → Abre modal de creación de agente
- **+ Nuevo Proyecto** → Abre modal de creación de proyecto
- **🔄 Sincronizar Todo** → Ejecuta `POST /api/sync-all`
- **💬 Ir a Chat** → Navega a vista Chat
- **📈 Ver Análisis** → Navega a Settings → Análisis de uso

---

### **Sección 5: Uso de IA (Condicional)**

**Solo visible si `config.aiProvider === "api"`**

Si no está disponible (CLI o GitHub Copilot), mostrar:

```
┌──────────────────────────────────┐
│ ⚠️ Monitoreo de IA no disponible │
│                                  │
│ Estás usando Claude CLI / GitHub │
│ Copilot. El monitoreo de tokens  │
│ solo está disponible con API.    │
│                                  │
│ Cambiar a API en Ajustes →       │
└──────────────────────────────────┘
```

**Si está disponible (API), mostrar:**

```
┌──────────────────────────────────┐
│ 🤖 Uso de API (Sesión)           │
│                                  │
│ Tokens: 5.2K / 10K (52%) ████░  │
│ Costo: $0.08                    │
│ Llamadas: 3                     │
│                                  │
│ [Historial] [Resetear] [Límites]│
└──────────────────────────────────┘
```

**Datos necesarios:**
- Tokens consumidos en sesión actual
- Tokens totales disponibles (si hay límite)
- Porcentaje usado
- Costo estimado en USD
- Número de llamadas a API

**Interactividad:**
- Click en "[Historial]" → Abre panel de análisis
- Click en "[Resetear]" → Limpia contador de sesión
- Click en "[Límites]" → Va a Settings de API

---

## 🔄 Actualización de Datos

### **Estrategia de actualización (Híbrida)**

#### **1. Carga Inicial (Al abrir app)**
```
App abre
  ↓
GET /api/config (cargar configuración)
  ↓
GET /api/projects (cargar proyectos)
  ↓
GET /api/agents (cargar agentes)
  ↓
Calcular estadísticas
  ↓
Generar notificaciones
  ↓
Dashboard renderiza (~2-3 segundos)
```

#### **2. Actualización en tiempo real (Eventos)**

Cuando el usuario modifica algo:

```
Usuario edita/guarda agente
  ↓
POST /api/agents (guardar)
  ↓
Backend responde con agente actualizado
  ↓
Frontend emite evento local: "agent:updated"
  ↓
Dashboard recalcula:
  - Estadísticas (conteo)
  - Sincronización (estado)
  - Notificaciones (regenera)
  ↓
Dashboard actualiza datos reactivamente
```

**Mismo flujo para proyectos.**

#### **3. Sincronización del directorio externo**

```
Al abrir app:
  ↓
GET /api/agents-directory/status
  ↓
Mostrar estado en dashboard

Cada 10 minutos (background):
  ↓
GET /api/agents-directory/status
  ↓
Si cambió, actualizar badge "Estado"
```

#### **4. Consumo de API (Si está habilitado)**

```
Al abrir app:
  ↓
GET /api/ai/status (obtener uso actual)
  ↓
Mostrar en dashboard

Después de cada llamada a IA:
  ↓
Actualizar tokens consumidos
  ↓
Recalcular porcentaje y costo
```

---

## 📊 Endpoints necesarios

| Método | Endpoint | Descripción | Para qué |
|--------|----------|-------------|----------|
| GET | `/api/config` | Obtener configuración | Saber aiProvider |
| GET | `/api/projects` | Obtener lista de proyectos | Conteo y estado |
| GET | `/api/agents` | Obtener lista de agentes | Conteo y estado |
| GET | `/api/projects/:id/sync-status` | Estado de sync de proyecto | Dashboard |
| GET | `/api/agents-directory/status` | Estado de directorio externo | Dashboard |
| GET | `/api/ai/status` | Tokens consumidos en sesión | Uso de API |
| POST | `/api/sync-all` | Sincronizar todo | Quick action |

---

## 🎨 Componentes a crear

```
src/renderer/pages/
  └── Dashboard.tsx
       ├── Sección Estadísticas
       ├── Sección Sincronización
       ├── Sección Notificaciones
       ├── Sección Quick Actions
       ├── Sección Uso de IA
       └── Lógica de actualización en tiempo real

src/renderer/components/dashboard/
  ├── StatsCard.tsx
  ├── SyncStatus.tsx
  ├── NotificationsPanel.tsx
  ├── QuickActions.tsx
  ├── UsageCard.tsx (o AIUsageCard.tsx)
  └── NotificationItem.tsx
```

---

## 🔄 Eventos y actualizaciones

**Escuchar eventos locales:**

```
"agent:created" → Actualizar estadísticas
"agent:updated" → Actualizar estadísticas, notificaciones, sync
"agent:deleted" → Actualizar estadísticas, notificaciones
"project:created" → Actualizar estadísticas
"project:updated" → Actualizar estadísticas, notificaciones, sync
"project:deleted" → Actualizar estadísticas
"sync:completed" → Actualizar estado de sync
"api:call" → Actualizar tokens consumidos
```

---

## 💾 Estado necesario (Zustand)

```
En el store global:
- projects: Project[]
- agents: Agent[]
- config: Config
- appVersion: string

En el componente Dashboard (useState):
- stats: { totalAgents, totalProjects, ... }
- syncStatus: { agentsPending, projectsPending, ... }
- notifications: Notification[]
- apiUsage: { tokens, cost, calls }
- isLoading: boolean
```

---

## ⏱️ Tiempo de carga esperado

- **Carga inicial:** 2-3 segundos (mínimo)
- **Actualización (eventos):** < 500ms
- **Recálculo de notificaciones:** < 300ms

---

## 🎯 Flujo de usuario esperado

```
1. Usuario abre app
2. Dashboard se carga (~3s)
3. Ve estadísticas, sync, notificaciones
4. Lee notificaciones
5. Decide acción:
   - Click en notificación → Va a agente/proyecto
   - Click en Quick Action → Ejecuta acción
   - Click en stat → Va a vista correspondiente
6. Vuelve a Dashboard después de cambios
7. Dashboard muestra cambios en tiempo real
```

---

## ⚠️ Casos especiales / Avisos

### **Caso 1: Monitoreo de API no disponible**

Si `config.aiProvider !== "api"`:

```
Mostrar aviso:
┌──────────────────────────────────┐
│ ⚠️ Monitoreo no disponible        │
│                                  │
│ Estás usando {Claude CLI / GitHub│
│ Copilot}. El monitoreo de tokens │
│ está disponible solo con API.    │
│                                  │
│ [Cambiar a API]                  │
└──────────────────────────────────┘
```

No mostrar sección de uso de API.

### **Caso 2: Directorio externo deshabilitado**

Si `config.agentsDirectoryEnabled === false`:

```
En sección sincronización, mostrar:
"📦 Directorio externo: ❌ Deshabilitado"
(No mostrar último sync ni estado)
```

### **Caso 3: Sin notificaciones**

```
┌──────────────────────────────────┐
│ 💡 Oportunidades de Mejora       │
│                                  │
│ ✅ Todo está optimizado          │
│                                  │
│ No hay recomendaciones por ahora │
└──────────────────────────────────┘
```

### **Caso 4: Error al cargar datos**

```
Si falla GET /api/projects o GET /api/agents:

┌──────────────────────────────────┐
│ ❌ Error al cargar dashboard     │
│                                  │
│ No pudimos cargar los datos.     │
│                                  │
│ [🔄 Reintentar]                  │
└──────────────────────────────────┘

Mostrar solo lo que esté disponible, con estado "Error"
```

---

## 🎨 Diseño visual

- **Tarjetas (cards):** Fondo `var(--bg2)`, borde sutil
- **Iconos:** Tabler Icons, consistentes con resto de app
- **Colores notificaciones:**
  - 🔴 Crítica: `--red` / `--coral`
  - 🟡 Optimización: `--amber` / `--yellow`
  - 🔵 Información: `--blue` / `--accent`
  - 🟢 Éxito: `--green`
- **Espaciado:** Consistente con resto de app (grid o flex)
- **Responsividad:** Mobile-friendly (stacked en móvil)

---

## ✅ Checklist de implementación

- [ ] Crear página Dashboard.tsx
- [ ] Implementar sección Estadísticas
- [ ] Implementar sección Sincronización
- [ ] Implementar sistema de notificaciones
- [ ] Implementar Quick Actions
- [ ] Implementar sección Uso de IA (condicional)
- [ ] Lógica de actualización en tiempo real
- [ ] Eventos locales (agent:updated, etc.)
- [ ] Manejo de errores y casos especiales
- [ ] Responsive design
- [ ] Testing

---

## 📝 Notas finales

- Dashboard es la puerta de entrada a la app
- Debe ser claro y ejecutable de un vistazo
- Notificaciones deben ser accionables (no solo informativas)
- Actualización debe ser suave (sin parpadeos)
- Avisos claros cuando algo no está disponible
- Mantener consistencia visual con resto de app
