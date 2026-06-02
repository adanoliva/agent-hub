# TODO — Pendientes implementación fases orquestador

> Fases 1-6 implementadas el 2026-06-02. Estos puntos quedan para la siguiente sesión.

---

## 1. UI de gestión de Skills (`Settings.tsx`)

- [ ] Añadir contenido al tab "Skills" (el tipo `Tab` y la pestaña ya están)
- [ ] Lista de skills globales existentes
- [ ] Formulario crear skill: nombre, descripción, contenido (textarea)
- [ ] Botones editar / eliminar por skill
- [ ] Usar endpoints: `GET /api/skills/flat`, `POST /api/skills`, `PUT /api/skills`, `DELETE /api/skills`

## 2. Toggle `gitEnabled` en proyecto (`EditProjectModal.tsx`)

- [ ] Añadir checkbox "Checkpoint git tras cada paso" en la sección de configuración avanzada
- [ ] Guardar campo `gitEnabled: boolean` en el proyecto vía `PUT /api/projects/:id`

## 3. Fix `git commit` sin author configurado (`git-checkpointer.js`)

- [ ] Añadir `--author="AgentHub <agenthub@local>"` al comando `git commit`
- [ ] Evita fallos silenciosos en repos sin `user.email`/`user.name` globales

## 4. Verificar scripts en paleta del orquestador

- [ ] Comprobar que los scripts desaparecen de la paleta cuando ya están en el canvas
- [ ] El guard `agents.includes(agentName)` usa el nombre completo `__script:nombre__` — verificar visualmente

---

## Notas

- **Git no necesita token** — `git-checkpointer.js` solo hace commits locales, sin push.
- **Sync de skills desde directorio externo** ya implementado en `agents-sync.js` (rama `skills/`).
- Los 5 errores TypeScript pre-existentes en `OrchestrationEditor.tsx`, `Dashboard.tsx` y `Settings.tsx` son anteriores a esta sesión.
