# Roadmap tecnico (pendiente)

> Fecha: 2026-05-25
> Alcance: backlog aplazado tras implementar mejoras 1, 2, 3, 5 y 7.

## Pendientes para siguiente iteracion

### 4) Historial de cambios de agentes
- Objetivo: timeline por agente (quien/que/cuando) con rollback.
- Alcance sugerido:
  - Registrar eventos CRUD y optimizacion IA por agente.
  - Guardar snapshots versionados del archivo .md.
  - Exponer endpoint de historial y accion de rollback seguro.
- Riesgos:
  - Crecimiento de almacenamiento.
  - Rollback parcial cuando cambian categorias/tecnologias.

### 6) Cola de tareas con reintentos
- Objetivo: robustez para syncs y operaciones IA largas.
- Alcance sugerido:
  - Cola persistente con estados: pending/running/retry/failed/done.
  - Reintentos con backoff exponencial.
  - Vista de jobs y re-ejecucion manual.
- Riesgos:
  - Concurrencia y bloqueo de recursos.
  - Duplicacion accidental de operaciones idempotentes.

### 8) Busqueda global unificada
- Objetivo: paleta de comandos para entidades y acciones.
- Alcance sugerido:
  - Indice local sobre proyectos, agentes, categorias y acciones frecuentes.
  - Atajos de teclado y navegacion rapida.
  - Resultado accionable con "abrir/editar/sincronizar".
- Riesgos:
  - Relevancia de ranking y latencia del indice.

### 9) Import/Export completo de configuracion
- Objetivo: backup y migracion completa de estado.
- Alcance sugerido:
  - Exportar config, categorias, proyectos, exclusiones e historial relevante.
  - Import con validacion y migraciones por version.
  - Modo preview y merge para evitar sobreescrituras no deseadas.
- Riesgos:
  - Compatibilidad entre versiones de esquema.
  - Contenido sensible (tokens) en paquetes de exportacion.

### 10) Modo diagnostico para soporte
- Objetivo: reporte tecnico sin secretos para soporte rapido.
- Alcance sugerido:
  - Generar informe con entorno, rutas, estado de sync y errores recientes.
  - Redactar/anonimizar datos sensibles automaticamente.
  - Descargar en .md o .json para adjuntar a incidencias.
- Riesgos:
  - Fugas de informacion sensible si la redaccion falla.

### 11) Conector de base de datos con IA

- Objetivo: conectar Agent Hub a la base de datos de un proyecto para que la IA pueda inspeccionar el esquema, generar contexto enriquecido, sugerir agentes específicos y responder preguntas en el chat sobre la estructura de datos real.
- Motores soportados (prioridad): PostgreSQL, MySQL/MariaDB, SQLite. MongoDB como fase 2.
- Política de seguridad: **solo lectura** en todo momento. Ninguna operación de escritura, DDL ni DML es ejecutable desde la app. Las credenciales se guardan cifradas por proyecto en `config.json`.

---

#### Diseño de implementación

##### Almacenamiento de conexiones

Cada proyecto puede tener cero o una conexión de BD. Se añade el campo `dbConnection` al objeto de proyecto en `config.json`:

```json
{
  "id": "p...",
  "dbConnection": {
    "engine": "postgres",
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "user": "readonly_user",
    "passwordEnc": "<AES-256-GCM cifrado con clave derivada del APP_DIR>",
    "ssl": false,
    "label": "Dev local"
  }
}
```

La contraseña nunca se guarda en claro. La clave de cifrado se deriva de `APP_DIR + app.getPath('userData')` con PBKDF2 — no viaja a ningún sitio externo.

---

##### Backend — nuevo módulo `src/backend/db.js`

Responsabilidades:
- Gestionar el ciclo de vida de las conexiones (pool por proyecto, máx. 2 conexiones idle).
- Exponer funciones de introspección de esquema.
- Ejecutar queries de solo lectura con timeout de 10 s y límite de 500 filas.
- Cifrar/descifrar credenciales.

Dependencias nuevas:
- `pg` (PostgreSQL) — ya común en proyectos Node.
- `mysql2` (MySQL/MariaDB).
- SQLite: usar `better-sqlite3` (ya disponible via Electron).
- Sin dependencia extra para MongoDB en fase 1.

Funciones principales exportadas:

```js
testConnection(dbConnection)           // → { ok, latencyMs, error? }
getSchema(projectId)                   // → SchemaInfo (tablas, columnas, índices, FKs)
runReadonlyQuery(projectId, sql)       // → { columns, rows, durationMs } | throws si no es SELECT
encryptPassword(plain)                 // → string cifrado
decryptPassword(enc)                   // → string plano
```

`getSchema()` produce un objeto `SchemaInfo`:

```ts
interface SchemaInfo {
  engine: string;
  database: string;
  tables: Array<{
    name: string;
    rowEstimate: number | null;
    columns: Array<{ name: string; type: string; nullable: boolean; isPk: boolean; isFk: boolean; ref?: string }>;
    indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
    foreignKeys: Array<{ column: string; refTable: string; refColumn: string }>;
  }>;
  fetchedAt: string; // ISO timestamp
}
```

El esquema se cachea en `cache/db-schema-{projectId}.json` con TTL de 30 min. Invalidable manualmente desde la UI.

`runReadonlyQuery()` valida que el SQL sea un `SELECT` puro antes de ejecutar (parse superficial + rechazo si contiene palabras clave peligrosas: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `GRANT`, `EXEC`, etc.).

---

##### API REST — nuevos endpoints en `server.js`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/projects/:id/db/status` | Estado de la conexión (`connected`, `disconnected`, `error`) |
| POST | `/api/projects/:id/db/connect` | Guarda credenciales cifradas y verifica la conexión |
| DELETE | `/api/projects/:id/db/connect` | Elimina las credenciales del proyecto |
| POST | `/api/projects/:id/db/test` | Prueba la conexión sin guardar |
| GET | `/api/projects/:id/db/schema` | Devuelve `SchemaInfo` (desde caché si está vigente) |
| POST | `/api/projects/:id/db/schema/refresh` | Fuerza recarga del esquema |
| POST | `/api/projects/:id/db/query` | Ejecuta un `SELECT` de solo lectura. Body: `{ sql }` |
| POST | `/api/projects/:id/db/generate-context` | Genera texto para `CLAUDE.md` describiendo el esquema |

---

##### Integración con IA — nuevas funciones en `ai.js`

```js
generateDbContext(schemaInfo, projectName)
// → string Markdown con resumen del esquema para insertar en CLAUDE.md
// Describe tablas principales, relaciones clave, convenciones de nombres.

generateDbAgentSuggestions(schemaInfo, existingAgents)
// → AgentSuggestion[] (máx. 3)
// Sugiere agentes basados en el esquema: query-optimizer si hay tablas grandes,
// migration-writer si no hay historial de migraciones, seed-generator, etc.

answerDbQuestion(projectId, question, schemaInfo, messages)
// → string (respuesta en chat, con contexto de esquema inyectado en system prompt)
// Usado desde callAIChat cuando el proyecto activo tiene BD conectada.
```

La función `answerDbQuestion` inyecta el esquema comprimido en el system prompt del chat (no las filas, solo la estructura). Si la pregunta implica ver datos reales, la IA puede sugerir una query que el usuario ejecuta con el endpoint `/db/query` y cuyo resultado se muestra en el chat.

---

##### Vista dedicada `Database.tsx` — página principal

Nueva entrada en el sidebar con icono `ti-database` y view `'database'` en el Zustand store. Sustituye la idea de pestaña en `ProjectDrawer`: la BD tiene su propia vista de pantalla completa para no interferir con el resto de vistas.

---

###### Layout general

```
┌──────────────────────────────────────────────────────────────────────┐
│ [selector de proyecto ▾]  ● myapp_dev  PostgreSQL  12ms  [⟳] [✕]   │  ← topbar
├─────────────────┬────────────────────────────┬───────────────────────┤
│                 │  SELECT u.id, u.email,      │ id │ email  │ role   │
│  ▼ public       │  r.name AS role             │────┼────────┼────────│
│    ▼ Tablas     │  FROM users u               │  1 │ a@...  │ admin  │
│      ▼ users    │  JOIN roles r               │  2 │ b@...  │ user   │
│        id  PK   │    ON r.id = u.role_id      │  3 │ c@...  │ user   │
│        email    │  WHERE u.active = true      │                      │
│        role_id  │  LIMIT 100                  │  3 filas · 12 ms     │
│      ▷ roles    │                  [⎘ Copiar] │           [▶ Run]   │
│      ▷ orders   ├────────────────────────────────────────────────────┤
│    ▼ Vistas     │ ✦  Muéstrame los usuarios activos con su rol       │
│      ▷ v_stats  │ __________________________________________________  │
│  ▷ staging      │                                          [Generar] │
└─────────────────┴────────────────────────────────────────────────────┘
    Árbol BD          Panel central: Consulta (arriba) + Resultados (abajo)
                      Prompt IA: barra fija en la parte inferior del panel central
```

Proporciones orientativas: árbol 22 % · panel central 78 %. El panel central se divide verticalmente en consulta (~35 %) y resultados (~65 %) con un divisor arrastrable.

---

###### Zona izquierda — árbol de base de datos (`.db-tree`)

Árbol colapsable con tres niveles de nodos, análogo al `AgentsTree` existente.

Estructura de nodos:
```
▼ <schema>                   ← nodo raíz por schema (public, staging…)
  ▼ Tablas
    ▼ <tabla>
        <columna>  <tipo>  [PK] [FK] [NN]   ← badges compactos
        …
    ▼ Índices
        <nombre>  (<cols>)  [UNIQUE]
    ▼ Claves foráneas
        <col> → <tabla_ref>.<col_ref>
  ▼ Vistas
    ▷ <vista>
  ▼ Funciones (fase 2)
```

Comportamiento:
- Click en una tabla → el nombre se inserta como fragmento en el área de consulta (o la IA lo toma como contexto de la siguiente pregunta).
- Click derecho en tabla → menú contextual: "Ver estructura completa", "Seleccionar primeras 100 filas" (genera la query automáticamente sin llamar a la IA, 0 tokens), "Copiar nombre".
- Badge de `rowEstimate` junto al nombre de tabla si está disponible (`~12k`).
- Barra de búsqueda en la cabecera del árbol para filtrar por nombre de tabla/columna.
- Botón `⟳` en la cabecera para refrescar el esquema (`POST /db/schema/refresh`).

Estado inicial: al entrar a la vista sin conexión se muestra un panel de configuración inline (formulario de conexión) en lugar del árbol.

---

###### Zona central superior — área de consulta (`.db-query`)

- `<textarea>` o editor de texto monospace editable. La IA genera aquí; el usuario puede editar libremente antes de ejecutar.
- Cabecera con: nombre del modelo usado para generar, timestamp de generación y badges de tablas referenciadas en la query (extraídas por parsing superficial).
- Dos botones alineados a la derecha en la parte inferior del área:
  - **`[⎘ Copiar]`** — copia el SQL al portapapeles. No llama a la IA ni a la BD. Coste: 0 tokens, 0 conexiones.
  - **`[▶ Run]`** — envía el SQL a `POST /db/query`. Activa el estado de carga en la zona de resultados.
- Si el área está vacía, muestra placeholder: _"Escribe una pregunta abajo o edita aquí directamente"_.
- La query es persistida en `localStorage` por `projectId` para no perderla al cambiar de vista.

---

###### Zona central inferior — resultados (`.db-results`)

Estados posibles:

| Estado | Contenido |
|--------|-----------|
| `idle` | Mensaje vacío: "Ejecuta una consulta para ver los resultados" |
| `loading` | Spinner con texto "Ejecutando…" |
| `ok` | Tabla con cabeceras, filas, contador `N filas · Xms` en el pie |
| `error` | Caja coral con el mensaje de error de la BD, fragmento SQL que lo causó si está disponible, y sugerencia de la IA para corregirlo (generada automáticamente, 1 llamada) |
| `empty` | "La consulta devolvió 0 filas" con la query ejecutada en gris |

Tabla de resultados:
- Cabeceras fijas, cuerpo con scroll vertical.
- Máximo 500 filas renderizadas (límite del backend). Si hay más, aviso en el pie: "Mostrando 500 de N — ajusta el LIMIT para ver más".
- Click en una celda → copia el valor al portapapeles.
- Botón `[⎘ Exportar CSV]` en el pie para descargar las filas visibles como CSV (operación local, sin llamadas adicionales).

---

###### Barra inferior de prompt IA (`.db-prompt`)

Barra fija en la parte inferior del panel central, siempre visible.

```
  ✦  [ Muéstrame los pedidos del último mes agrupados por cliente… ]  [Generar]
```

Comportamiento:
- `[Generar]` → llama a `POST /ai/db-query` con `{ question, schemaInfo, projectId }`. La respuesta (SQL) se escribe en el área de consulta superior. **No ejecuta automáticamente** — el usuario decide si pulsa Run o Copiar.
- El prompt no tiene historial persistido (no es un chat completo). Solo se guarda el último prompt en `localStorage` por `projectId` para comodidad.
- Si el esquema no está cargado, el botón aparece deshabilitado con tooltip: "Conecta una base de datos primero".
- Respuesta de la IA: solo el SQL, sin explicación. Si el usuario quiere la explicación, puede pedirla explícitamente ("¿qué hace esta query?") — en ese caso la respuesta se muestra en un callout encima del área de consulta en lugar de sobreescribirla.

---

###### Panel de conexión (estado sin conexión)

Cuando el proyecto seleccionado no tiene BD configurada, el panel central y el árbol se sustituyen por un formulario centrado:

```
        [ ti-database ]
    Conecta una base de datos

  Engine:   [ PostgreSQL ▾ ]
  Host:     [ localhost        ]   Puerto: [ 5432 ]
  Base de datos: [ myapp_dev   ]
  Usuario:  [ readonly_user    ]
  Contraseña: [ ••••••••       ]   [SSL]
  Label:    [ Dev local        ]

        [Probar conexión]   [Guardar y conectar]
```

`[Probar conexión]` → `POST /db/test` → muestra badge verde con latencia o error inline, sin guardar nada.
`[Guardar y conectar]` → `POST /db/connect` → si ok, transiciona a la vista principal con árbol y panel.

---

###### Nuevo endpoint IA

```
POST /api/ai/db-query
Body: { question: string, schemaInfo: SchemaInfo, projectId: string }
→ { sql: string, tablesReferenced: string[] }
```

El system prompt inyecta el esquema comprimido y pide exclusivamente SQL válido para el motor del proyecto, sin explicación, sin markdown extra. La respuesta se parsea y se extrae el bloque SQL limpio antes de enviarlo al renderer.

---

###### Cambios menores en otras vistas

**`ProjectDrawer.tsx`** — pestaña **Base de datos** simplificada:
- Solo muestra el estado de conexión (badge verde/rojo) y un enlace "Gestionar en la vista BD".
- Botón "Generar contexto de BD" sigue aquí → `POST /db/generate-context` → inserta en el editor del `CLAUDE.md`.

**`Dashboard.tsx`** — salud de proyectos:
- Si un proyecto tiene BD configurada pero la conexión falla → incidencia `warning` en `projectHealth`.

**`Sidebar.tsx`** — nueva entrada de navegación:
- Icono `ti-database`, view `'database'`, posición entre Agentes y Chat.

**`store/index.ts`** — nueva view:
- `view` amplía su tipo: `'dashboard' | 'projects' | 'agents' | 'database' | 'chat' | 'settings'`.

**Nuevos tipos en `types.ts`**:
```ts
interface DbConnection {
  engine: 'postgres' | 'mysql' | 'sqlite';
  host: string; port: number; database: string; user: string;
  ssl: boolean; label: string;
  // passwordEnc nunca viaja al renderer
}
interface DbStatus { connected: boolean; latencyMs?: number; error?: string; lastCheckedAt: string }
interface SchemaInfo { engine: string; database: string; tables: SchemaTable[]; fetchedAt: string }
interface SchemaTable {
  name: string; rowEstimate: number | null;
  columns: SchemaColumn[]; indexes: SchemaIndex[]; foreignKeys: SchemaFk[];
}
interface DbQueryResult { columns: string[]; rows: Record<string, unknown>[]; durationMs: number }
```

---

##### Fases de entrega sugeridas

| Fase | Alcance | Prerequisito |
|------|---------|--------------|
| 1 — Vista y conexión | `Database.tsx`, árbol de esquema, panel de conexión, `db.js` backend | — |
| 2 — Consultas manuales | Área de consulta editable, Run, Copiar, tabla de resultados, menú contextual del árbol | Fase 1 |
| 3 — Prompt IA | Barra de prompt, `POST /ai/db-query`, generación de SQL sin ejecución automática | Fase 2 |
| 4 — Contexto y agentes | `generateDbContext` → CLAUDE.md, `generateDbAgentSuggestions` | Fase 1 |
| 5 — MongoDB | Driver `mongodb`, introspección de colecciones/campos | Fase 1 |

---

- Riesgos:
  - Credenciales comprometidas si el `APP_DIR` es accesible a otros procesos — mitigado con cifrado AES-256-GCM y nunca exponer `passwordEnc` al renderer.
  - Queries lentas que bloqueen el event loop de Electron — mitigado con timeout de 10 s y ejecución en worker thread si supera 2 s.
  - Esquemas muy grandes (>200 tablas) que saturen el context window de la IA — mitigado truncando a las 50 tablas con mayor `rowEstimate` y resumiendo el resto.
  - Falsos positivos en la validación de queries de solo lectura (ej. funciones PL/pgSQL) — mitigado rechazando cualquier query con `;` secundario o bloques `BEGIN/END`.

## Criterios de entrada para retomar backlog
- Definir prioridad de negocio (impacto/urgencia).
- Confirmar alcance minimo viable por item.
- Alinear pruebas de regresion por modulo antes de integrar.
