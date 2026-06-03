# Plan de pruebas — feature/genoma-fusion

> Ejecutar antes de mergear a `master`. Marcar cada ítem con `[x]` al verificarlo.

---

## 1. Build y arranque

- [x ] `npm run dev` arranca sin errores en consola
- [x ] La app carga y la statusbar muestra el servidor conectado

---

## 2. Skills

- [x] La página Agentes → tab "Skills" carga sin errores
- [x] **Crear** una skill: nombre + descripción + contenido manual → Guardar (Prueba: No se cierra el modal de la creación de skill)
- [x] **Generar contenido con IA**: rellenar nombre + descripción en el campo IA → "Generar contenido" → aparece texto en el textarea
- [x] **Editar** la skill creada y guardar cambios
- [x] **Eliminar** la skill
- [x] Las skills aparecen en el selector "Skills asociadas" del AgentEditor cuando el agente es de nivel **proyecto**

---

## 3. Orquestación — ejecución básica

- [x] Crear una orquestación con al menos 2 agentes IA
- [x] Ejecutar: el paso 1 muestra spinner → al completarse muestra ✓ → el paso 2 muestra spinner (no el 1)
- [x] Los logs en vivo muestran actividad del paso correcto mientras está en curso
- [x] Al terminar se muestra el resultado con pasos completados, duración y archivos modificados

---

## 4. Gate HITL

- [ ] En una orquestación, seleccionar una conexión entre agentes y activar el check "Gate de revisión humana" en el panel de configuración
- [ ] Al ejecutar, la ejecución se pausa tras ese paso y aparece el panel ámbar de revisión
- [ ] **Aprobar**: la ejecución continúa al siguiente paso
- [ ] **Revisar**: aparece el textarea de feedback → "Enviar feedback" → el paso se re-ejecuta
- [ ] **Cancelar**: la orquestación se detiene

---

## 5. Scripts determinísticos

- [ ] En el editor de orquestación, la paleta muestra una sección "Scripts" con entradas como `quality-score`, `prepare-context`, etc.
- [ ] Arrastrar un script al lienzo y conectarlo entre dos agentes
- [ ] Ejecutar: el paso de script completa instantáneamente (0 tokens, sin llamada IA)

---

## 6. Quality Score

- [ ] Tras ejecutar una orquestación con agentes IA, cada paso muestra un badge **QS X/100** (verde/ámbar/rojo)
- [ ] Click en el badge despliega los checks individuales

---

## 7. Git Checkpointing

- [ ] En un proyecto que sea repo git, activar `gitEnabled` en la edición del proyecto
- [ ] Ejecutar una orquestación que modifique archivos
- [ ] En el resultado, cada paso muestra un SHA de commit (ej. `a1b2c3d`)

---

## 8. Ops Ledger

- [ ] En el resultado de una ejecución, el tab "Operaciones" lista los archivos modificados por paso
- [ ] El botón revertir (↩) en una operación `applied` la marca como `reverted`

---

## 9. Build de producción

- [ x] `npm run build` completa sin errores de TypeScript ni de Vite (Pruebas: salen avisos de duplicate dependency references)
