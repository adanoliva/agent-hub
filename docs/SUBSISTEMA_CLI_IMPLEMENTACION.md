# Subsistema CLI: Documento de Implementación

> **Versión:** 1.0  
> **Fecha:** 2026-05-28  
> **Estado:** Especificación técnica funcional  
> **Alcance:** Implementación de CLI virtual para proveedores API/GitHub

---

## Tabla de contenidos

1. [Visión general](#1-visión-general)
2. [Arquitectura](#2-arquitectura)
3. [Componentes](#3-componentes)
4. [Interfaces y contratos](#4-interfaces-y-contratos)
5. [Algoritmos y lógica core](#5-algoritmos-y-lógica-core)
6. [Flujos de ejecución](#6-flujos-de-ejecución)
7. [Validaciones y seguridad](#7-validaciones-y-seguridad)
8. [Manejo de errores](#8-manejo-de-errores)
9. [Integración con Agent Hub](#9-integración-con-agent-hub)
10. [Ejemplos de uso](#10-ejemplos-de-uso)
11. [Testing](#11-testing)
12. [Roadmap futuro](#12-roadmap-futuro)

---

## 1. Visión general

### Problema

Los proveedores de IA sin CLI nativo (Anthropic API, GitHub Copilot) no tienen acceso directo al filesystem del proyecto. Esto limita:

- Orquestación multiagente con cambios en cascada
- Validación de cambios reales en el código
- Workflows secuenciales con contexto actualizado

### Solución

Un **Subsistema CLI** que emula la interfaz de Claude Code CLI pero traduce operaciones a llamadas HTTP contra el servicio API-FS.

```
Agente (API/GitHub) → Subsistema CLI → API-FS → Filesystem
```

### Objetivos

- ✅ Abstracción uniforme: CLI real y virtual tienen la misma interfaz
- ✅ Control total: validaciones robustas en cada operación
- ✅ Compatibilidad: funciona con CLI, Anthropic API, GitHub Copilot
- ✅ Escalabilidad: habilita workflows complejos multiagente
- ✅ Seguridad: validaciones de integridad, permisos, sintaxis
- ✅ Observabilidad: auditoría completa de operaciones

---

## 2. Arquitectura

### Diagrama de componentes

```
┌──────────────────────────────────────────────────────────────┐
│                    Capa de ejecución de IA                   │
│  (Claude CLI / Anthropic API / GitHub Copilot)              │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────▼──────────────────┐
         │    Dispatcher / Routing          │
         │  (Selecciona CLI real o virtual) │
         └────────┬────────────────┬────────┘
                  │                │
        ┌─────────▼────┐  ┌────────▼──────────┐
        │   CLI Real   │  │  Subsistema CLI   │
        │ (Claude Code)│  │  (CLI Virtual)    │
        ├──────────────┤  ├───────────────────┤
        │ Bash/Read/   │  │ Parser            │
        │ Write/Grep   │  │ (parseToolCall)   │
        │ (nativas)    │  │                   │
        └──────┬───────┘  │ Executor          │
               │          │ (executeOperation)│
               │          │                   │
               │          │ HTTP Router       │
               │          │ (to API-FS)       │
               └──────┬───┴───────────────────┘
                      │
         ┌────────────▼──────────────┐
         │      API-FS Service       │
         │  (/api-fs/projects/...)   │
         ├───────────────────────────┤
         │ • read(path)              │
         │ • write(path, content)    │
         │ • list(pattern)           │
         │ • validate(path, content) │
         │ • diff(path, newContent)  │
         │ • rollback(backupPath)    │
         └────────────┬──────────────┘
                      │
         ┌────────────▼──────────────┐
         │  Filesystem del Proyecto  │
         │  + .agent-hub/backups/    │
         └───────────────────────────┘
```

### Flujo de decisión

```
request ejecutar agente
  │
  ├─ aiProvider === 'cli' ?
  │  │
  │  ├─ SÍ → Usar CLI Real
  │  │       (callCLI directo)
  │  │
  │  └─ NO → Usar Subsistema CLI
  │           ├─ callAIWithSubsystemCLI()
  │           ├─ parseAgentResponse()
  │           ├─ executeOperation() vía API-FS
  │           └─ loop turnos hasta max_turns
  │
  └─ Resultado final igual en ambos casos
```

---

## 3. Componentes

### 3.1 Componente: Parser

**Responsabilidad:** Extraer intenciones (tool calls) de respuestas de IA.

**Entrada:** Texto libre de IA  
**Salida:** Array de operaciones parsed

**Formato de herramientas en respuesta IA:**

```
TOOL: read
PATH: src/main.ts

---

TOOL: write
PATH: src/main.ts
CONTENT:
[aquí el contenido completo del archivo]

---

TOOL: bash
COMMAND: find src -name "*.ts" -type f

---

TOOL: grep
PATTERN: export const
FILE: src/**/*.ts
```

**Formato de salida parsed:**

```typescript
interface ParsedToolCall {
  id: string;                    // UUID para trazabilidad
  tool: 'read' | 'write' | 'bash' | 'grep';
  args: Record<string, string>;  // { path, content, command, pattern, file }
  raw: string;                   // Texto original de la IA
  lineNumber: number;            // En respuesta original
}

interface ParsedResponse {
  text: string;                  // Texto completo de respuesta
  toolCalls: ParsedToolCall[];   // Operaciones detectadas
  hasClosed: boolean;            // ¿Terminó sin pedir herramientas?
}
```

**Algoritmo de parsing:**

```
1. Dividir respuesta por "---" (separadores)
2. Para cada bloque:
   a) Detectar "TOOL: <tipo>"
   b) Leer línea siguiente: "PATH: ..." o "COMMAND: ..."
   c) Si hay "CONTENT:", capturar hasta siguiente "---" o fin
   d) Validar estructura (campos requeridos por tipo)
   e) Crear ParsedToolCall
3. Devolver ParsedResponse con todos los tool calls
```

**Validación de estructura por tipo:**

| Tool | Campos requeridos | Campos opcionales |
|---|---|---|
| `read` | `PATH` | - |
| `write` | `PATH`, `CONTENT` | - |
| `bash` | `COMMAND` | - |
| `grep` | `PATTERN`, `FILE` | - |

### 3.2 Componente: Executor

**Responsabilidad:** Ejecutar operaciones traduciendo a API-FS.

**Entrada:** ParsedToolCall  
**Salida:** OperationResult

```typescript
interface OperationResult {
  toolCall: ParsedToolCall;
  success: boolean;
  data?: any;           // Resultado de operación
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  executionTime: number; // ms
  filesAffected?: string[]; // Paths modificados
}
```

**Por cada tipo de herramienta:**

#### Read
```
Entrada:  { tool: 'read', args: { path: 'src/main.ts' } }
Llamada: GET /api-fs/projects/{projectId}/files/read?path=src/main.ts
Salida:  {
  path, content, size, hash, language, modified, encoding
}
```

#### Write
```
Entrada:  { 
  tool: 'write',
  args: { 
    path: 'src/main.ts',
    content: '[contenido]'
  }
}
Llamada: POST /api-fs/projects/{projectId}/files/write
Body:    {
  path, content, originalHash (del último read), metadata: {
    reason, agentName, stepNumber
  }
}
Salida:  {
  saved: true,
  hash (nuevo),
  changes: { linesAdded, linesRemoved, diff },
  backupPath,
  validations: { syntax, filesize, conflicts }
}
```

#### Bash
```
Entrada:  { tool: 'bash', args: { command: 'find src -name "*.ts"' } }
Soportados: ls, find, grep (ejecutados vía API-FS)
No soportados: npm install, git clone, etc. (rechazados)
Salida:    {
  stdout: "[resultado del comando]",
  stderr?: "[errores si existen]",
  exitCode: 0
}
```

#### Grep
```
Entrada:  {
  tool: 'grep',
  args: { pattern: 'export const', file: 'src/**/*.ts' }
}
Llamada: Lectura vía API-FS + grep local
Salida:  {
  matches: [
    { file, lineNumber, line },
    ...
  ],
  count: number
}
```

### 3.3 Componente: Loop multi-turno

**Responsabilidad:** Mantener conversación iterativa con IA hasta finalización.

**Estados:**

```
INICIAL
  │
  ├─ Enviar prompt a IA
  ├─ Recibir respuesta
  ├─ Parsear tool calls
  │
  ├─ ¿Hay tool calls?
  │  │
  │  ├─ NO → FINALIZADO
  │  │
  │  └─ SÍ
  │      ├─ Ejecutar operaciones
  │      ├─ Construir mensaje de resultados
  │      ├─ ¿turn_count >= maxTurns?
  │      │  │
  │      │  ├─ SÍ → FINALIZADO (máximo alcanzado)
  │      │  │
  │      │  └─ NO → Siguiente iteración
  │
  └─ FINALIZADO
```

**Límites:**

- `maxTurns`: 10 (default)
- `timeout`: 5 minutos por workflow
- `contextSize`: 200K tokens (incluida historia de mensajes)

---

## 4. Interfaces y contratos

### 4.1 API del Subsistema CLI

```typescript
// src/backend/subsystem-cli.ts

interface SubsystemCLIConfig {
  projectId: string;
  maxTurns: number;         // default: 10
  timeout: number;          // ms, default: 300000 (5 min)
  apiFsClient: APIFSClient;
  logger: Logger;
}

interface SubsystemCLI {
  // Main entry point
  execute(
    prompt: string,
    systemPrompt: string,
    options: SubsystemCLIConfig
  ): Promise<SubsystemCLIResult>;

  // Internos (pueden ser públicos para testing)
  parseAgentResponse(
    text: string
  ): ParsedResponse;

  executeToolCall(
    toolCall: ParsedToolCall,
    projectId: string
  ): Promise<OperationResult>;

  buildToolResultsMessage(
    results: OperationResult[]
  ): string;
}

interface SubsystemCLIResult {
  success: boolean;
  finalResponse: string;        // Respuesta final del agente
  turns: number;                // Turnos ejecutados
  toolCalls: ParsedToolCall[];  // Todas las operaciones
  results: OperationResult[];   // Resultados de operaciones
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  duration: number;             // ms
  filesModified: string[];      // Paths que fueron modificados
  backups: string[];            // Paths de backup creados
  errors: ToolExecutionError[]; // Errores durante ejecución
}

interface ToolExecutionError {
  toolCall: ParsedToolCall;
  error: string;
  recoverable: boolean;  // ¿Puede continuar?
}
```

### 4.2 Integración con AI Module

```typescript
// src/backend/ai.js (modificado)

async function callAI(prompt, systemPrompt, opts) {
  // Determinar ejecutor
  if (opts.aiProvider === 'cli') {
    // Usar CLI real (código existente)
    return await callCLI(prompt, systemPrompt, opts);
  } else if (opts.aiProvider === 'api' || opts.aiProvider === 'github') {
    // Usar Subsistema CLI
    return await callAIWithSubsystemCLI(prompt, systemPrompt, opts);
  }
}

async function callAIWithSubsystemCLI(prompt, systemPrompt, opts) {
  const subsystemCLI = new SubsystemCLI();
  
  const result = await subsystemCLI.execute(prompt, systemPrompt, {
    projectId: opts.projectId,
    maxTurns: opts.maxTurns || 10,
    timeout: opts.timeout || 300000,
    apiFsClient: new APIFSClient(opts.projectId),
    logger: logger
  });

  // Aplicar tracking de tokens
  trackUsage({
    inputTokens: result.tokens.input,
    outputTokens: result.tokens.output,
    costUSD: calculateCost(result.tokens, opts.aiProvider)
  });

  return {
    result: result.finalResponse,
    tokens: result.tokens,
    duration: result.duration,
    filesModified: result.filesModified,
    backups: result.backups
  };
}
```

### 4.3 System Prompt para IA

```
Eres un {especialidad} de código.

HERRAMIENTAS DISPONIBLES:
─────────────────────────

Para interactuar con el proyecto, usa estas herramientas:

1. READ - Leer contenido de archivo
   TOOL: read
   PATH: src/main.ts

2. WRITE - Escribir o modificar archivo
   TOOL: write
   PATH: src/main.ts
   CONTENT:
   [aquí el contenido COMPLETO del archivo]

3. BASH - Ejecutar comandos (solo lectura: ls, find, grep)
   TOOL: bash
   COMMAND: find src -name "*.ts" -type f

4. GREP - Buscar patrones en archivos
   TOOL: grep
   PATTERN: export const
   FILE: src/**/*.ts

IMPORTANTE:
───────────
- Cada herramienta debe estar en su propia sección (separadas por ---)
- Al usar WRITE, incluye el contenido COMPLETO del archivo
- Los cambios se validan automáticamente antes de guardar
- Si encuentras errores, se te reportarán en el siguiente turno
- Puedes hacer múltiples operaciones por turno
- Si no necesitas más herramientas, solo da tu respuesta final

CONTEXTO DEL PROYECTO:
──────────────────────
{projectContext}

TAREA:
──────
{userPrompt}
```

---

## 5. Algoritmos y lógica core

### 5.1 Algoritmo: Parsing de respuesta

```
FUNCIÓN parseAgentResponse(responseText: string) -> ParsedResponse

  toolCalls = []
  
  // Dividir por separador "---"
  bloques = responseText.split(/^---\s*$/m)
  
  PARA CADA bloque EN bloques:
    
    // Detectar línea TOOL: <tipo>
    toolMatch = bloque.match(/^TOOL:\s*(\w+)$/m)
    
    SI toolMatch EXISTE:
      tipo = toolMatch[1]
      
      // Validar tipo
      SI tipo NO EN ['read', 'write', 'bash', 'grep']:
        CONTINUAR  // Ignorar herramientas desconocidas
      
      // Extraer campos según tipo
      SI tipo === 'read':
        pathMatch = bloque.match(/^PATH:\s*(.+)$/m)
        SI NO pathMatch: CONTINUAR
        
        toolCall = {
          id: uuid(),
          tool: 'read',
          args: { path: pathMatch[1] },
          raw: bloque,
          lineNumber: contarLineasHasta(bloque)
        }
      
      SI tipo === 'write':
        pathMatch = bloque.match(/^PATH:\s*(.+)$/m)
        contentMatch = bloque.match(/^CONTENT:\s*\n([\s\S]*)$/m)
        
        SI NO pathMatch O NO contentMatch: CONTINUAR
        
        toolCall = {
          id: uuid(),
          tool: 'write',
          args: { 
            path: pathMatch[1],
            content: contentMatch[1]
          },
          raw: bloque,
          lineNumber: contarLineasHasta(bloque)
        }
      
      SI tipo === 'bash':
        commandMatch = bloque.match(/^COMMAND:\s*(.+)$/m)
        SI NO commandMatch: CONTINUAR
        
        toolCall = {
          id: uuid(),
          tool: 'bash',
          args: { command: commandMatch[1] },
          raw: bloque,
          lineNumber: contarLineasHasta(bloque)
        }
      
      SI tipo === 'grep':
        patternMatch = bloque.match(/^PATTERN:\s*(.+)$/m)
        fileMatch = bloque.match(/^FILE:\s*(.+)$/m)
        SI NO patternMatch O NO fileMatch: CONTINUAR
        
        toolCall = {
          id: uuid(),
          tool: 'grep',
          args: { 
            pattern: patternMatch[1],
            file: fileMatch[1]
          },
          raw: bloque,
          lineNumber: contarLineasHasta(bloque)
        }
      
      toolCalls.append(toolCall)
  
  RETORNAR {
    text: responseText,
    toolCalls: toolCalls,
    hasClosed: toolCalls.length === 0
  }

FIN FUNCIÓN
```

### 5.2 Algoritmo: Ejecución de operación

```
FUNCIÓN executeOperation(toolCall: ParsedToolCall, projectId: string) -> OperationResult

  startTime = ahora()
  
  INTENTA:
    
    SI toolCall.tool === 'read':
      response = GET /api-fs/projects/{projectId}/files/read
                 ?path={toolCall.args.path}
      RETORNAR {
        toolCall: toolCall,
        success: true,
        data: response,
        executionTime: ahora() - startTime,
        filesAffected: [response.path]
      }
    
    SI toolCall.tool === 'write':
      // Validar contenido antes de enviar
      SI toolCall.args.content.length > 10MB:
        LANZAR Error("Archivo demasiado grande")
      
      response = POST /api-fs/projects/{projectId}/files/write
                 Body: {
                   path: toolCall.args.path,
                   content: toolCall.args.content,
                   metadata: {
                     reason: toolCall.raw,
                     toolCallId: toolCall.id
                   }
                 }
      
      SI response.status === 'validation_error':
        RETORNAR {
          toolCall: toolCall,
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: response.validations,
            details: response.details
          },
          executionTime: ahora() - startTime
        }
      
      RETORNAR {
        toolCall: toolCall,
        success: true,
        data: response,
        executionTime: ahora() - startTime,
        filesAffected: [response.path]
      }
    
    SI toolCall.tool === 'bash':
      // Validar comando permitido
      comando = toolCall.args.command
      SI comando.match(forbiddenPatterns):
        LANZAR Error("Comando no permitido")
      
      // Ejecutar vía API-FS
      response = POST /api-fs/projects/{projectId}/bash
                 Body: { command: comando }
      
      RETORNAR {
        toolCall: toolCall,
        success: response.exitCode === 0,
        data: { stdout: response.stdout, stderr: response.stderr },
        executionTime: ahora() - startTime
      }
    
    SI toolCall.tool === 'grep':
      response = POST /api-fs/projects/{projectId}/grep
                 Body: { 
                   pattern: toolCall.args.pattern,
                   file: toolCall.args.file
                 }
      
      RETORNAR {
        toolCall: toolCall,
        success: true,
        data: response.matches,
        executionTime: ahora() - startTime
      }

  CAPTURAR error:
    RETORNAR {
      toolCall: toolCall,
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: error.message,
        details: error.stack
      },
      executionTime: ahora() - startTime
    }

FIN FUNCIÓN
```

### 5.3 Algoritmo: Loop multi-turno

```
FUNCIÓN execute(prompt, systemPrompt, config) -> SubsystemCLIResult

  messages = [{ role: 'user', content: prompt }]
  allToolCalls = []
  allResults = []
  allErrors = []
  startTime = ahora()
  turn = 0
  
  MIENTRAS turn < config.maxTurns Y (ahora() - startTime) < config.timeout:
    
    turn++
    
    // 1. Llamar a IA
    INTENTA:
      response = callAI(
        systemPrompt: systemPrompt,
        messages: messages,
        model: config.aiProvider
      )
      finalResponse = response.content
    
    CAPTURAR error:
      RETORNAR {
        success: false,
        finalResponse: '',
        turns: turn,
        error: error.message,
        tokens: response.tokens || { input: 0, output: 0, total: 0 },
        duration: ahora() - startTime,
        ...
      }
    
    // 2. Parsear respuesta
    parsed = parseAgentResponse(finalResponse)
    
    // 3. ¿Hay herramientas a ejecutar?
    SI parsed.toolCalls.length === 0:
      // Agente terminó sin pedir herramientas
      RETORNAR {
        success: true,
        finalResponse: finalResponse,
        turns: turn,
        toolCalls: allToolCalls,
        results: allResults,
        errors: allErrors,
        tokens: response.tokens,
        duration: ahora() - startTime,
        ...
      }
    
    // 4. Ejecutar operaciones
    turnResults = []
    PARA CADA toolCall EN parsed.toolCalls:
      
      INTENTA:
        result = await executeOperation(toolCall, config.projectId)
        turnResults.append(result)
        allToolCalls.append(toolCall)
        allResults.append(result)
        
        SI result.success === false:
          SI result.error.code === 'VALIDATION_FAILED':
            // Error recuperable: continuar
            allErrors.append({
              toolCall: toolCall,
              error: result.error.message,
              recoverable: true
            })
      
      CAPTURAR error:
        result = {
          toolCall: toolCall,
          success: false,
          error: { code: 'EXECUTOR_ERROR', message: error.message }
        }
        turnResults.append(result)
        allErrors.append({
          toolCall: toolCall,
          error: error.message,
          recoverable: true
        })
    
    // 5. Construir mensaje de resultados
    resultMessage = buildToolResultsMessage(turnResults)
    
    // 6. Preparar siguiente turno
    messages.append({ role: 'assistant', content: finalResponse })
    messages.append({ role: 'user', content: resultMessage })
    
    // 7. Verificar tamaño de contexto
    SI messages.length > config.contextSizeLimit:
      // Comprimir historial antiguo
      messages = compressHistory(messages, keepLast: 10)
  
  // Timeout alcanzado
  RETORNAR {
    success: false,
    finalResponse: finalResponse,
    turns: turn,
    error: 'TIMEOUT_EXCEEDED',
    toolCalls: allToolCalls,
    results: allResults,
    errors: allErrors,
    duration: ahora() - startTime,
    ...
  }

FIN FUNCIÓN
```

### 5.4 Construcción de mensaje de resultados

```
FUNCIÓN buildToolResultsMessage(results: OperationResult[]) -> string

  message = "RESULTADOS DE OPERACIONES:\n"
            "═══════════════════════════\n\n"
  
  PARA CADA result EN results:
    
    message += "▶ " + result.toolCall.tool.upper() + "\n"
    message += "  Path: " + result.toolCall.args.path + "\n"
    
    SI result.success === true:
      message += "  ✓ EXITOSO\n"
      
      SI result.toolCall.tool === 'read':
        message += "  Tamaño: " + result.data.size + " bytes\n"
        message += "  Lenguaje: " + result.data.language + "\n"
        message += "  Hash: " + result.data.hash + "\n"
      
      SI result.toolCall.tool === 'write':
        message += "  ✓ Guardado\n"
        message += "  Validaciones: " + JSON.stringify(result.data.validations) + "\n"
        message += "  Cambios: +" + result.data.changes.linesAdded 
                 + " -" + result.data.changes.linesRemoved + "\n"
      
      SI result.toolCall.tool === 'bash':
        message += "  Salida:\n"
        message += "  " + result.data.stdout.split('\n').join('\n  ') + "\n"
    
    SINO:
      message += "  ✗ ERROR\n"
      message += "  Código: " + result.error.code + "\n"
      message += "  Mensaje: " + result.error.message + "\n"
    
    message += "  Tiempo: " + result.executionTime + "ms\n\n"
  
  message += "PRÓXIMO PASO:\n"
             "Si necesitas más operaciones, pide más herramientas.\n"
             "Si terminaste, da tu respuesta final.\n"
  
  RETORNAR message

FIN FUNCIÓN
```

---

## 6. Flujos de ejecución

### 6.1 Flujo: Ejecución individual de agente (API)

```
Usuario: "Ejecutar agente refactor-expert sobre proyecto"

1. Frontend: POST /api/projects/:id/execute-task
   Body: { agent: { name: "refactor-expert", ... } }

2. Backend (server.js):
   ├─ GET /api/projects/:id/context → Leer CLAUDE.md
   ├─ Detectar: aiProvider === 'api'
   └─ Llamar ai.callAIWithSubsystemCLI()

3. ai.js:
   ├─ Crear SubsystemCLI instance
   ├─ Build systemPrompt
   └─ Llamar subsystemCLI.execute()

4. subsystem-cli.js (Turno 1):
   ├─ callAI(systemPrompt, mensajes)
   │  └─ Anthropic API devuelve respuesta
   │
   ├─ parseAgentResponse()
   │  └─ Detecta: TOOL: read, TOOL: write, TOOL: grep
   │
   ├─ executeOperation() para cada herramienta:
   │  ├─ GET /api-fs/projects/:id/files/read (src/main.ts)
   │  ├─ POST /api-fs/projects/:id/files/write (src/main.ts mejorado)
   │  └─ POST /api-fs/projects/:id/grep (buscar patrones)
   │
   └─ buildToolResultsMessage()
      └─ "RESULTADOS: read OK (2000 bytes), write OK (2100 bytes), grep OK (5 matches)"

5. subsystem-cli.js (Turno 2):
   ├─ messages = [inicial, respuesta_agente, resultados_operaciones]
   ├─ callAI(systemPrompt, mensajes)
   │  └─ API devuelve: "Los cambios están listos. Refactoricé..."
   │
   ├─ parseAgentResponse()
   │  └─ No hay TOOL calls (hasClosed: true)
   │
   └─ RETORNAR resultado final

6. Backend:
   └─ Devolver resultado al frontend

7. Frontend:
   ├─ Mostrar resultado en AgentExecutePanel
   ├─ Mostrar backups disponibles
   └─ Botones: "Copiar", "Discutir en chat", "Volver"
```

### 6.2 Flujo: Workflow secuencial (API + múltiples agentes)

```
Usuario: [Ejecutar Workflow "Análisis → Refactor → Testing"]

1. Frontend: POST /api/projects/:id/workflows/:wfId/execute

2. Backend (workflows.js):
   agents = [code-reviewer, refactor-expert, test-generator]
   
   PARA CADA agent EN agents:
     
     PASO 1: code-reviewer (análisis)
     ─────────────────────────────────
     ├─ Leer context (CLAUDE.md)
     ├─ Llamar execute con system prompt + agent.tools
     ├─ Agent: "TOOL: read (main.ts), TOOL: grep (duplicated logic)"
     ├─ Operaciones ejecutadas ✓
     ├─ Agente responde: "Encontré 3 áreas con lógica duplicada"
     └─ result1 = { análisis, cambios: 0, insights: [...] }
     
     PASO 2: refactor-expert (refactoring)
     ──────────────────────────────────────
     ├─ Build systemPrompt incluyendo result1 como contexto
     ├─ Leer archivos ACTUALIZADOS (del paso 1)
     ├─ Llamar execute
     ├─ Agent: "TOOL: read (main.ts con cambios de P1)"
     ├─ Agent: "TOOL: write (main.ts refactorizado)"
     ├─ Agent: "TOOL: write (utils.ts mejorado)"
     ├─ Operaciones ejecutadas ✓
     ├─ API-FS: validación, backup, confirmación
     ├─ Agente responde: "Refactoricé 2 funciones, reducción 15% LoC"
     └─ result2 = { cambios: 2, líneasAhorradas: 45, ... }
     
     PASO 3: test-generator (testing)
     ────────────────────────────────
     ├─ Build systemPrompt incluyendo result1 + result2
     ├─ Leer archivos FINALES (refactorizados en P2)
     ├─ Llamar execute
     ├─ Agent: "TOOL: read (main.ts refactorizado)"
     ├─ Agent: "TOOL: write (__tests__/main.test.ts nuevos tests)"
     ├─ Agent: "TOOL: bash (npm test para verificar)"
     ├─ Tests ejecutados via bash ✓
     ├─ Agente responde: "Tests creados, coverage 92%"
     └─ result3 = { testsCreados: 45, coverage: 92, ... }

3. Compilar resultado final:
   ├─ Resumen multiturno:
   │  "Paso 1 (code-reviewer): Análisis completado, 3 insights"
   │  "Paso 2 (refactor-expert): 2 archivos refactorizados"
   │  "Paso 3 (test-generator): 45 tests creados, coverage 92%"
   │
   ├─ Archivos modificados:
   │  - src/main.ts (backup: .agent-hub/backups/src_main_step1.ts)
   │  - src/utils.ts (backup: .agent-hub/backups/src_utils_step2.ts)
   │  - __tests__/main.test.ts (nuevo)
   │
   ├─ Backups disponibles:
   │  .agent-hub/backups/src_main_step1.ts
   │  .agent-hub/backups/src_main_step2.ts
   │  .agent-hub/backups/src_utils_step2.ts
   │
   └─ Opciones: [Aceptar todo] [Descartar] [Rollback a paso 1] [Rollback a paso 2]

4. Frontend:
   └─ Mostrar workflow result completo con historial multiturno
```

---

## 7. Validaciones y seguridad

### 7.1 Validaciones en Parser

```typescript
// Validar estructura de tool call

function validateToolCall(toolCall: ParsedToolCall): ValidationError[] {
  const errors = [];

  // Validar que tool sea conocido
  if (!['read', 'write', 'bash', 'grep'].includes(toolCall.tool)) {
    errors.push({ code: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolCall.tool}` });
  }

  // Validar campos requeridos por tipo
  switch (toolCall.tool) {
    case 'read':
      if (!toolCall.args.path) {
        errors.push({ code: 'MISSING_PATH', message: 'read requires PATH' });
      }
      break;
    
    case 'write':
      if (!toolCall.args.path) {
        errors.push({ code: 'MISSING_PATH', message: 'write requires PATH' });
      }
      if (!toolCall.args.content) {
        errors.push({ code: 'MISSING_CONTENT', message: 'write requires CONTENT' });
      }
      if (toolCall.args.content.length > 10 * 1024 * 1024) {
        errors.push({ code: 'CONTENT_TOO_LARGE', message: 'Content > 10MB' });
      }
      break;
    
    case 'bash':
      if (!toolCall.args.command) {
        errors.push({ code: 'MISSING_COMMAND', message: 'bash requires COMMAND' });
      }
      // Validar comando permitido
      if (isCommandForbidden(toolCall.args.command)) {
        errors.push({ 
          code: 'FORBIDDEN_COMMAND',
          message: `Command not allowed: ${toolCall.args.command}` 
        });
      }
      break;
    
    case 'grep':
      if (!toolCall.args.pattern) {
        errors.push({ code: 'MISSING_PATTERN', message: 'grep requires PATTERN' });
      }
      if (!toolCall.args.file) {
        errors.push({ code: 'MISSING_FILE', message: 'grep requires FILE' });
      }
      break;
  }

  return errors;
}
```

### 7.2 Validaciones en Executor

```typescript
// Validar operación antes de ejecutar

async function validateBeforeExecution(
  toolCall: ParsedToolCall,
  projectPath: string
): Promise<ValidationError[]> {
  const errors = [];

  // 1. Path traversal prevention
  if (toolCall.args.path?.includes('..')) {
    errors.push({ 
      code: 'PATH_TRAVERSAL',
      message: 'Path traversal not allowed'
    });
  }

  // 2. Path dentro del proyecto
  const resolvedPath = path.resolve(projectPath, toolCall.args.path);
  if (!resolvedPath.startsWith(path.resolve(projectPath))) {
    errors.push({ 
      code: 'PATH_OUT_OF_BOUNDS',
      message: 'Path is outside project directory'
    });
  }

  // 3. Directorio excluido
  const excludedDirs = ['node_modules', 'dist', '.git', '.next', 'build'];
  if (excludedDirs.some(dir => resolvedPath.includes(dir))) {
    errors.push({ 
      code: 'EXCLUDED_DIRECTORY',
      message: 'Cannot modify files in excluded directories'
    });
  }

  // 4. Archivo binario
  if (toolCall.tool === 'write' || toolCall.tool === 'read') {
    const language = detectLanguage(toolCall.args.path);
    if (language === 'binary') {
      errors.push({ 
        code: 'BINARY_FILE',
        message: 'Binary files not supported'
      });
    }
  }

  return errors;
}

// Comandos bash permitidos
const ALLOWED_BASH_COMMANDS = [
  'ls', 'find', 'grep', 'cat', 'wc', 'head', 'tail', 'file'
];

const FORBIDDEN_PATTERNS = [
  /rm\s+-rf/i,
  /\|\s*sudo/i,
  /npm\s+install/i,
  /git\s+push/i,
  /curl|wget/i
];

function isCommandForbidden(command: string): boolean {
  // Check blacklist patterns
  if (FORBIDDEN_PATTERNS.some(p => p.test(command))) {
    return true;
  }
  
  // Check if command is in whitelist
  const baseCommand = command.split(/\s+/)[0];
  return !ALLOWED_BASH_COMMANDS.includes(baseCommand);
}
```

### 7.3 Validaciones en API-FS

```typescript
// Validaciones que ejecuta API-FS antes de guardar

async function validateWrite(
  projectPath: string,
  filePath: string,
  content: string,
  originalHash: string
): Promise<WriteValidationResult> {
  const validations = {
    pathTraversal: true,
    binaryFile: true,
    fileSize: true,
    syntaxValid: true,
    conflictDetected: false
  };
  const errors = [];

  // 1. Path traversal
  const resolved = path.resolve(projectPath, filePath);
  if (!resolved.startsWith(projectPath)) {
    validations.pathTraversal = false;
    errors.push('Path traversal detected');
  }

  // 2. No es archivo binario
  const ext = path.extname(filePath);
  if (['.exe', '.bin', '.o', '.so'].includes(ext)) {
    validations.binaryFile = false;
    errors.push('Binary files not supported');
  }

  // 3. Tamaño razonable
  if (content.length > 10 * 1024 * 1024) {
    validations.fileSize = false;
    errors.push('File too large (max 10MB)');
  }

  // 4. Sintaxis válida (según lenguaje)
  const language = detectLanguage(filePath);
  if (language === 'typescript') {
    const syntaxResult = validateTypeScript(content);
    validations.syntaxValid = syntaxResult.valid;
    if (!syntaxResult.valid) {
      errors.push(`Syntax error: ${syntaxResult.error}`);
    }
  }
  if (language === 'json') {
    try {
      JSON.parse(content);
    } catch (e) {
      validations.syntaxValid = false;
      errors.push(`JSON parse error: ${e.message}`);
    }
  }

  // 5. Detectar conflicto: ¿fue modificado externamente?
  const currentContent = fs.readFileSync(path.resolve(projectPath, filePath), 'utf-8');
  const currentHash = sha256(currentContent);
  if (currentHash !== originalHash) {
    validations.conflictDetected = true;
    errors.push('File was modified externally');
  }

  return {
    valid: errors.length === 0,
    validations,
    errors
  };
}
```

---

## 8. Manejo de errores

### 8.1 Categoría: Errores de parsing

```
PARSE_ERROR
├─ MALFORMED_TOOL_CALL
│  └─ Tool call no tiene estructura esperada
├─ UNKNOWN_TOOL
│  └─ Herramienta no existe
└─ MISSING_FIELD
   └─ Campo requerido ausente
```

**Tratamiento:** Log + ignorar tool call + continuar

### 8.2 Categoría: Errores de validación

```
VALIDATION_ERROR
├─ PATH_TRAVERSAL
│  └─ Intento de acceso fuera del proyecto
├─ FORBIDDEN_COMMAND
│  └─ Comando bash no permitido
├─ SYNTAX_INVALID
│  └─ El código no es válido (TypeScript, JSON, etc.)
└─ FILE_TOO_LARGE
   └─ Archivo > límite permitido
```

**Tratamiento:** Retornar error al agente, permitir retry

### 8.3 Categoría: Errores de ejecución

```
EXECUTION_ERROR
├─ API_FS_UNAVAILABLE
│  └─ Servicio API-FS no responde
├─ NETWORK_ERROR
│  └─ Error de conectividad
└─ INTERNAL_ERROR
   └─ Error inesperado en backend
```

**Tratamiento:** Retornar error al agente, marcar workflow como fallido, crear snapshot

### 8.4 Estrategia: Rollback y recuperación

```
SI agente encuentra error:
  
  1. Documentar error:
     ├─ Tool call que falló
     ├─ Error específico
     ├─ Timestamp
     └─ Contexto (archivos afectados)
  
  2. Restauración disponible:
     └─ .agent-hub/backups/ contiene snapshots antes de cada operación
  
  3. Opciones de usuario:
     ├─ [Reintentar] → Agente intenta de nuevo
     ├─ [Ignorar] → Continuar sin esa operación
     ├─ [Rollback a paso anterior] → Restaurar backup
     └─ [Cancelar workflow] → Parar todo
```

---

## 9. Integración con Agent Hub

### 9.1 Cambios en endpoints existentes

#### POST /api/projects/:id/execute-task

```
Comportamiento antes:
  ├─ Si CLI: usa callCLI directo
  └─ Si API/GitHub: error (no soportado)

Comportamiento después:
  ├─ Si CLI: usa callCLI directo (sin cambios)
  └─ Si API/GitHub: usa callAIWithSubsystemCLI
```

#### POST /api/projects/:id/workflows/:wfId/execute

```
Nuevo comportamiento:
  ├─ Para cada agente en workflow:
  │  ├─ Si CLI: callCLI
  │  └─ Si API/GitHub: callAIWithSubsystemCLI
  ├─ Compilar results de todos los agentes
  ├─ Guardacompile workflow execution log
  └─ Devolver resultado final con opciones de rollback
```

### 9.2 Nuevos endpoints de API-FS

```
GET  /api-fs/projects/:id/files/read
GET  /api-fs/projects/:id/files/list
GET  /api-fs/projects/:id/files/status
POST /api-fs/projects/:id/files/write
POST /api-fs/projects/:id/files/validate
POST /api-fs/projects/:id/files/diff
POST /api-fs/projects/:id/files/rollback
POST /api-fs/projects/:id/bash
POST /api-fs/projects/:id/grep
```

### 9.3 Estructura de directorios en .agent-hub

```
.agent-hub/
├── agent-orchestrator.js          (existente)
├── workflows/
│  └── workflow-{id}.json          (nuevo)
├── executions/
│  └── exec-{timestamp}/           (nuevo)
│     ├── metadata.json
│     ├── logs.jsonl
│     └── changes.json
└── backups/                       (existente, expandido)
   ├── src_main_exec1_step1.ts
   ├── src_main_exec1_step2.ts
   └── ...
```

### 9.4 Configuración en CLAUDE.md

```yaml
# Subsistema CLI configuration
subsystem-cli:
  enabled: true
  maxTurns: 10
  timeout: 300000  # 5 minutos
  
  # Validadores ejecutar antes de guardar
  validators:
    typescript: true
    eslint: true
    prettier: true
  
  # Backups
  backups:
    enabled: true
    retention: 30  # días
    maxBackups: 50  # por archivo
  
  # Comandos bash permitidos (whitelist)
  allowedCommands:
    - ls
    - find
    - grep
    - cat
    - wc
    - head
    - tail
```

---

## 10. Ejemplos de uso

### 10.1 Ejemplo 1: API refactoriza código

**Setup:**
- Proyecto: myapp
- Agente: refactor-expert
- Provider: Anthropic API (no CLI)

**Ejecución:**

```
Frontend: Ejecutar agente

Backend:
├─ Detectar aiProvider === 'api'
└─ Usar Subsistema CLI

Subsistema CLI (Turno 1):

  Sistema: "Eres experto en refactoring. Puedes leer/escribir archivos.
            Lee src/main.ts, analiza, refactoriza."
  
  IA responde:
    "Voy a leer el archivo para analizar su estructura.
    
    TOOL: read
    PATH: src/main.ts
    
    ---
    
    TOOL: grep
    PATTERN: export const
    FILE: src/**/*.ts"
  
  Backend:
  ├─ GET /api-fs/projects/myapp/files/read?path=src/main.ts
  │  └─ Devuelve: { content: "...", size: 2048, language: "typescript" }
  ├─ POST /api-fs/projects/myapp/grep
  │  └─ Devuelve: { matches: [{ file, line }, ...], count: 5 }
  
  Construcción de resultado:
  "RESULTADOS:
   ▶ read: ✓ EXITOSO (2048 bytes, TypeScript)
   ▶ grep: ✓ EXITOSO (5 matches encontrados)"
  
  Siguiente mensaje:
  "Aquí está el contenido de src/main.ts y los puntos con `export const`.
   Continúa con la refactorización."

Subsistema CLI (Turno 2):

  IA responde:
    "Veo que hay lógica duplicada en líneas 45-50 y 100-105.
    La voy a refactorizar.
    
    TOOL: write
    PATH: src/main.ts
    CONTENT:
    export function factorial(n: number): number {
      if (n <= 1) return 1;
      return n * factorial(n - 1);
    }
    
    export const helpers = {
      extractNumber: (str: string) => parseInt(str),
      validateInput: (val: any) => val !== null
    };
    ..."
  
  Backend:
  ├─ POST /api-fs/projects/myapp/files/write
  │  Body: {
  │    path: "src/main.ts",
  │    content: "[contenido refactorizado]",
  │    metadata: { reason: "Remove duplicate logic" }
  │  }
  │  └─ Validaciones: ✓ sintaxis TS OK, ✓ tamaño OK, ✓ no conflictos
  │  └─ Guarda: src/main.ts (nuevo)
  │  └─ Backup: .agent-hub/backups/src_main_exec1_step1.ts
  │  └─ Devuelve: { saved: true, changes: { linesAdded: 10, linesRemoved: 15 } }
  
  Resultado:
  "▶ write: ✓ EXITOSO
    Guardado en src/main.ts
    Cambios: +10 -15 líneas
    Validación TypeScript: OK
    Backup: .agent-hub/backups/src_main_exec1_step1.ts"

Subsistema CLI (Turno 3):

  IA responde:
    "La refactorización está completa. He:
    1. Extraído funciones duplicadas
    2. Mejorado la legibilidad
    3. Reducido 5 líneas de código
    
    El archivo src/main.ts ahora es más mantenible."
  
  parseAgentResponse() → No hay TOOL calls
  → Workflow termina

Frontend:

Resultado mostrado:
"✓ Refactorización completada
  Archivo modificado: src/main.ts
  Cambios: +10 -15 líneas
  
  [Ver cambios] [Copiar resultado] [Discutir en chat] [Rollback]"
```

### 10.2 Ejemplo 2: Workflow multiagente (API)

**Workflow:** Análisis → Refactor → Testing

```
Agent 1: code-reviewer (análisis)
─────────────────────────────────

TURNO 1:
IA: "Voy a analizar el código
    TOOL: read
    PATH: src/main.ts
    
    TOOL: grep
    PATTERN: if.*==
    FILE: src/**/*.ts"

Backend ejecuta operaciones → resultados

TURNO 2:
IA: "He encontrado 3 puntos de mejora: [...]"
    (No hay TOOL calls → termina)

Result1: { analysis: "...", suggestions: 3 }


Agent 2: refactor-expert (refactoring)
───────────────────────────────────────

System prompt incluye result1:
"Agent anterior encontró: [suggestions]. Ahora refactoriza."

TURNO 1:
IA: "Basándome en el análisis anterior, voy a refactorizar.
    TOOL: read
    PATH: src/main.ts
    (ve el CONTENIDO ACTUAL, ya analizado por Agent 1)
    
    TOOL: write
    PATH: src/main.ts
    CONTENT: [código refactorizado]"

Backend ejecuta → API-FS guarda + backup

TURNO 2:
IA: "Refactorización completada. He mejorado [...]"

Result2: { filesModified: 1, linesRemoved: 20 }


Agent 3: test-generator (testing)
──────────────────────────────────

System prompt incluye result1 + result2:
"Los 2 agentes anteriores: [cambios]. Ahora genera tests."

TURNO 1:
IA: "Voy a generar tests para el código refactorizado.
    TOOL: read
    PATH: src/main.ts
    (ve CONTENIDO FINAL, refactorizado por Agent 2)
    
    TOOL: write
    PATH: __tests__/main.test.ts
    CONTENT: [nuevos tests]
    
    TOOL: bash
    COMMAND: npm test"

Backend ejecuta → tests corren

TURNO 2:
IA: "Tests creados. Coverage: 92%. Todos pasan."

Result3: { testsCreated: 45, coverage: 92 }


RESULTADO FINAL:
─────────────────

Workflow execution log:

Step 1 (code-reviewer):
  ✓ Analysis completed
  Insights: 3

Step 2 (refactor-expert):
  ✓ Files modified: 1
  Δ Lines: -20
  Backup: .agent-hub/backups/src_main_step2.ts

Step 3 (test-generator):
  ✓ Tests created: 45
  Coverage: 92%
  All passing

Files modified:
  - src/main.ts (analyzed, refactored)
  - __tests__/main.test.ts (new)

Backups:
  - .agent-hub/backups/src_main_step1.ts
  - .agent-hub/backups/src_main_step2.ts

Options: [Accept All] [Discard] [Rollback to Step 1] [Rollback to Step 2]
```

---

## 11. Testing

### 11.1 Test de parsing

```typescript
describe('SubsystemCLI - Parser', () => {
  
  it('debe parsear TOOL: read', () => {
    const response = `
      TOOL: read
      PATH: src/main.ts
    `;
    const parsed = parseAgentResponse(response);
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].tool).toBe('read');
    expect(parsed.toolCalls[0].args.path).toBe('src/main.ts');
  });
  
  it('debe parsear múltiples TOOL calls', () => {
    const response = `
      TOOL: read
      PATH: src/main.ts
      ---
      TOOL: grep
      PATTERN: export const
      FILE: src/**/*.ts
    `;
    const parsed = parseAgentResponse(response);
    expect(parsed.toolCalls).toHaveLength(2);
  });
  
  it('debe ignorar herramientas desconocidas', () => {
    const response = `
      TOOL: unknown
      PARAM: value
    `;
    const parsed = parseAgentResponse(response);
    expect(parsed.toolCalls).toHaveLength(0);
  });
  
  it('debe validar campos requeridos', () => {
    const toolCall = { tool: 'write', args: { path: 'file.ts' } };
    const errors = validateToolCall(toolCall);
    expect(errors).toContainEqual({ code: 'MISSING_CONTENT' });
  });
});
```

### 11.2 Test de ejecución

```typescript
describe('SubsystemCLI - Executor', () => {
  
  it('debe leer archivo vía API-FS', async () => {
    const toolCall = {
      tool: 'read',
      args: { path: 'src/main.ts' }
    };
    const result = await executeOperation(toolCall, 'project1');
    expect(result.success).toBe(true);
    expect(result.data.content).toBeDefined();
  });
  
  it('debe validar path traversal', async () => {
    const toolCall = {
      tool: 'read',
      args: { path: '../../../etc/passwd' }
    };
    const result = await executeOperation(toolCall, 'project1');
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('PATH_TRAVERSAL');
  });
  
  it('debe rechazar comandos bash peligrosos', async () => {
    const toolCall = {
      tool: 'bash',
      args: { command: 'rm -rf /' }
    };
    const result = await executeOperation(toolCall, 'project1');
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('FORBIDDEN_COMMAND');
  });
});
```

### 11.3 Test de integración e2e

```typescript
describe('SubsystemCLI - E2E', () => {
  
  it('debe ejecutar workflow completo (lectura → escritura)', async () => {
    const config = {
      projectId: 'test-project',
      maxTurns: 10,
      apiFsClient: mockAPIFS
    };
    
    const result = await subsystemCLI.execute(
      'Refactoriza src/main.ts',
      'Eres un experto en refactoring',
      config
    );
    
    expect(result.success).toBe(true);
    expect(result.turns).toBeLessThanOrEqual(10);
    expect(result.filesModified).toContain('src/main.ts');
  });
  
  it('debe manejar timeout', async () => {
    // Simular IA que nunca termina
    const config = {
      projectId: 'test-project',
      maxTurns: 100,
      timeout: 1000  // 1 segundo
    };
    
    const result = await subsystemCLI.execute(prompt, system, config);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('TIMEOUT');
  });
});
```

---

## 12. Roadmap futuro

### Fase 2: Extensiones

- [ ] **Ejecución paralela de agentes:** Workflows con múltiples agentes en paralelo
- [ ] **Merge de cambios:** Resolver conflictos cuando múltiples agentes modifican el mismo archivo
- [ ] **Integración de usuario:** Pausar workflow, mostrar diff, pedir confirmación
- [ ] **Ejecución de tests:** Auto-run tests después de cada paso
- [ ] **CI/CD integrado:** Publicar cambios a repositorio GitHub automáticamente

### Fase 3: Optimizaciones

- [ ] **Caché de contexto:** Cachear lecturas frecuentes para reducir latencia
- [ ] **Compresión de historial:** Comprimir conversación antigua en workflow largo
- [ ] **Paralelización de I/O:** Leer múltiples archivos en paralelo
- [ ] **Estadísticas:** Dashboard de métricas de ejecución

### Fase 4: Observabilidad

- [ ] **Trazas detalladas:** OpenTelemetry para debugging
- [ ] **Visualización:** Timeline de ejecución de workflow
- [ ] **Alertas:** Notificaciones si operación tarda > umbral
- [ ] **Auditoría:** Logs inmutables de todos los cambios

---

## Apéndices

### A. Restricciones de seguridad

```
Archivos excluidos de lectura/escritura:
  - node_modules/**
  - dist/**
  - .git/**
  - .env
  - secrets.json
  - __pycache__/**

Comandos bash prohibidos:
  - rm -rf
  - sudo
  - npm install
  - git push
  - curl (para no cargar datos externos)

Límites de recursos:
  - Archivo máximo: 10 MB
  - Total por proyecto: 1 GB
  - Tiempo por operación: 30 segundos
  - Tiempo total workflow: 5 minutos
  - Context window: 200K tokens
```

### B. Variables de entorno

```
SUBSYSTEM_CLI_ENABLED=true
SUBSYSTEM_CLI_MAX_TURNS=10
SUBSYSTEM_CLI_TIMEOUT=300000
SUBSYSTEM_CLI_DEBUG=false
API_FS_URL=http://localhost:3737/api-fs
API_FS_TIMEOUT=30000
```

### C. Esquema de base de datos

```
workflows:
  id: UUID
  projectId: UUID
  name: string
  agents: Agent[]
  enabled: boolean
  createdAt: timestamp
  updatedAt: timestamp

executions:
  id: UUID
  workflowId: UUID
  projectId: UUID
  startedAt: timestamp
  finishedAt: timestamp
  status: 'pending' | 'running' | 'success' | 'failed'
  steps: Step[]
  
steps:
  id: UUID
  executionId: UUID
  agentName: string
  status: 'pending' | 'running' | 'success' | 'failed'
  toolCalls: ParsedToolCall[]
  results: OperationResult[]
  tokens: { input, output }
  duration: number
```

---

**Fin del documento**

*Última actualización: 2026-05-28*
*Versión: 1.0*
