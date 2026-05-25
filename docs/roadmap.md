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

## Criterios de entrada para retomar backlog
- Definir prioridad de negocio (impacto/urgencia).
- Confirmar alcance minimo viable por item.
- Alinear pruebas de regresion por modulo antes de integrar.
