# Agent Hub — Presentación (Pitch)

> Documento de referencia para preparar la presentación en PowerPoint.
> Audiencia: no técnica / negocio · Formato: pitch (11 slides)

---

## SLIDE 1 — Portada

**Título:** Agent Hub

**Subtítulo:** La plataforma para gestionar tus agentes de IA y proyectos de desarrollo en un solo lugar.

**Tagline:** *Construida con IA. Para la IA. Con manos humanas al volante.*

**Visual sugerido:** Logo (icono de robot) sobre fondo oscuro con gradiente violeta (#7c6af7). Versión actual: v1.6.1.

---

## SLIDE 2 — El problema

**Título:** Desarrollar con IA hoy es caótico

**Puntos clave:**
- Los agentes de IA (instrucciones para Claude, Copilot…) se crean manualmente, se pierden y no se reutilizan.
- Cada proyecto acaba con configuraciones distintas y desincronizadas.
- No hay forma fácil de organizar agentes por proyecto, tecnología o equipo.
- Los prompts se escriben a ojo, sin optimización ni reutilización sistemática.
- **El problema más grande:** el conocimiento de cómo usar bien la IA queda en la cabeza de cada persona. No se comparte, no se mejora en equipo.

**Visual sugerido:** Ilustración de archivos dispersos / caos. Icono de carpetas desordenadas.

---

## SLIDE 3 — La solución

**Título:** Agent Hub centraliza y potencia tu ecosistema de IA

**Propuesta de valor en 3 líneas:**
1. **Organiza** todos tus agentes en una jerarquía clara: global → categoría → tecnología → proyecto.
2. **Sincroniza** automáticamente los agentes a cada proyecto cuando se actualizan.
3. **Genera** system prompts profesionales con IA en segundos, sin escribir desde cero.

**Visual sugerido:** Diagrama de jerarquía en cuatro niveles con flechas hacia los proyectos.

---

## SLIDE 4 — ¿Qué es un agente?

**Título:** Los agentes son las instrucciones que guían a la IA

**Explicación simple:**
Un agente es un archivo con instrucciones que le dicen a Claude (o a Copilot) cómo debe comportarse cuando trabaja en tu proyecto. Define su rol, sus herramientas y sus reglas.

**Ejemplo visual (bloque de texto estilizado):**
```
Nombre: code-reviewer
Rol: Revisor de código senior
Herramientas: leer archivos, ejecutar comandos
Instrucción: Analiza el código buscando bugs, vulnerabilidades 
             y oportunidades de mejora. Sé directo y específico.
```

**Visual sugerido:** Tarjeta de agente con icono, nombre, descripción y modelo (haiku / sonnet / opus).

---

## SLIDE 5 — Funcionalidades principales

**Título:** Todo lo que necesitas, en una sola app

| Funcionalidad | Descripción |
|---|---|
| 🗂️ Gestión de proyectos | Organiza por categoría y tecnología. Abre en VS Code con un clic. |
| 🤖 Editor de agentes | Crea y edita agentes con asistencia de IA integrada. |
| ✨ Generación con IA | Describe lo que necesitas y la IA escribe el prompt por ti. |
| 🔄 Sync automático | Los agentes se sincronizan a todos los proyectos que los usan. |
| 💬 Chat integrado | Consulta a la IA usando tus agentes como contexto activo. |
| 📦 Directorio de agentes | Descarga un catálogo curado de agentes listos para usar. |

**Visual sugerido:** Grid de 6 tarjetas con icono + título + descripción breve.

---

## SLIDE 6 — Cómo funciona (flujo)

**Título:** De la idea al agente en menos de un minuto

**Pasos (timeline horizontal):**

1. **Describe** qué necesitas en lenguaje natural  
   *"Quiero un agente que revise mis commits antes de hacer push"*

2. **La IA genera** el system prompt completo y optimizado

3. **Asignas** el agente al nivel adecuado (global, categoría, proyecto...)

4. **Sincronizas** — la app copia el agente a todos los proyectos correspondientes

5. **Usas** el agente en Claude Code o GitHub Copilot directamente desde tu editor

**Visual sugerido:** Diagrama de flujo horizontal con 5 pasos numerados y flechas.

---

## SLIDE 7 — El repositorio colaborativo de agentes

**Título:** Un catálogo compartido, siempre actualizado

**Idea central:**
Agent Hub se conecta a un repositorio central de agentes (GitHub). Todos los miembros del equipo descargan automáticamente los mismos agentes, en su última versión, sin hacer nada manualmente.

**Cómo funciona:**

```
Repositorio central (GitHub)
        │
        │  sync automático al arrancar la app
        ▼
  Agent Hub (cada miembro del equipo)
        │
        │  sync a cada proyecto
        ▼
  .claude/agents/  (en tu proyecto)
```

**Beneficios clave:**
- 📥 **Un solo punto de verdad** — el equipo siempre trabaja con la misma versión de cada agente.
- 🔄 **Actualizaciones automáticas** — cuando alguien mejora un agente, todos lo reciben en el siguiente arranque.
- ⚠️ **Control de conflictos** — si alguien modificó un agente localmente, la app detecta el conflicto y permite elegir qué versión conservar.
- 🌍 **Contribución abierta** — cualquier miembro puede proponer nuevos agentes al repositorio.

**Dato importante:** los agentes son archivos `.md` en GitHub. Cualquiera puede revisarlos, proponer mejoras o añadir nuevos mediante pull request. El proceso de mejora es colaborativo y transparente.

**Visual sugerido:** Diagrama central tipo "hub and spoke": repositorio GitHub en el centro, flechas hacia múltiples instancias de Agent Hub (personas del equipo), y de cada una hacia sus proyectos.

---

## SLIDE 8 — Compatibilidad y tecnología

**Título:** Funciona con tu stack actual

**Providers de IA soportados:**
- **Claude CLI** — usa tu suscripción de Claude.ai sin coste adicional
- **Anthropic API** — acceso directo a los modelos de Claude
- **GitHub Copilot** — compatible con tu cuenta de GitHub (capa gratuita)

**Compatibilidad de proyectos:**
- Cualquier lenguaje o framework
- Claude Code (`.claude/agents/`)
- GitHub Copilot (`.github/agents/`)

**Distribución:**
- App de escritorio Windows (portable `.exe`, sin instalación)
- Actualizaciones automáticas

**Visual sugerido:** Logos de Anthropic, GitHub, VS Code sobre fondo de tarjetas.

---

## SLIDE 9 — Estado actual y roadmap

**Título:** v1.6.1 — En uso activo

**Hecho (v1.6.x):**
- ✅ Gestión completa de agentes en 4 niveles
- ✅ Sync automático a proyectos
- ✅ Directorio de agentes externo con versionado
- ✅ Chat con historial por proyecto y @mention de agentes
- ✅ Generación y optimización de prompts con IA
- ✅ Generación de CLAUDE.md / copilot-instructions con IA

**Próximos pasos (roadmap):**
- 🔲 Soporte multi-usuario / equipos
- 🔲 Exportar / compartir packs de agentes
- 🔲 Integración con más herramientas (Cursor, Windsurf…)
- 🔲 Versión macOS / Linux

**Visual sugerido:** Timeline vertical con dos columnas: "Hecho" (verde) vs "Próximo" (violeta).

---

## SLIDE 10 — Por qué Agent Hub

**Título:** La ventaja competitiva

**Tres pilares:**

**1. Conocimiento compartido**
El repositorio central garantiza que todo el equipo trabaja con los mismos agentes, en la misma versión. El know-how de cómo usar bien la IA deja de vivir en la cabeza de una persona y pasa a ser un activo del equipo.

**2. Eficiencia multiplicada**
Un agente mejorado en el repositorio se propaga automáticamente a todos. Un cambio, efecto global sobre todos los proyectos y todos los miembros.

**3. Control total**
Los agentes son archivos `.md` en GitHub. Versionados, auditables, sin vendor lock-in. El equipo es dueño de su conocimiento.

**Visual sugerido:** Tres columnas con icono grande + título + dos líneas de texto.

---

## SLIDE 11 — Cierre

**Título:** Agent Hub

**Call to action:** Descarga la app · Prueba el directorio de agentes · Empieza a trabajar con IA de forma estructurada.

**Frase de cierre:**
*"No se trata de usar más IA. Se trata de usarla mejor."*

**Datos de contacto / repositorio:** (completar según contexto de la presentación)

**Visual sugerido:** Pantalla de la app (screenshot o mockup) sobre fondo oscuro. Logo y tagline.

---

## Notas para el diseño del PPT

- **Paleta de colores:** fondo `#0d0d0f` (oscuro), acento `#7c6af7` (violeta), texto `#f0f0f5`
- **Tipografía sugerida:** Syne (títulos) + JetBrains Mono (bloques de código/datos)
- **Iconografía:** Tabler Icons (disponibles en tabler.io/icons)
- **Estilo:** minimalista, dark mode, sin exceso de texto por slide
- **Duración estimada:** 8-12 minutos a ritmo de pitch
- **Screenshots disponibles en:** `docs/screenshots/` (wizard, vista-proyectos, vista-agentes, chat)
