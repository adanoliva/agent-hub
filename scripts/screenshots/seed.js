// Demo data for the screenshots: invented projects, agents and history. Nothing from the user's own data.
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const DAY  = 86_400_000;
const ago  = (ms) => new Date(Date.now() - ms).toISOString();

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};

const agentMd = ({ name, description, model, tools, system, optimized = true }) => [
  '---', `name: ${name}`, `description: ${description}`, `model: ${model}`, 'tools:', ...tools.map(t => `  - ${t}`),
  `optimized: ${optimized}`, '---', '', system, '',
].join('\n');

// [level dir, agent]; [rol:…] markers drive fake-claude.js's answers
const AGENTS = [
  ['global', { name: 'code-reviewer', description: 'Revisa código en busca de bugs, problemas de seguridad, rendimiento y claridad', model: 'sonnet', tools: ['Read', 'Grep'],
    system: '[rol:review] Eres un revisor de código senior. Revisa los cambios recientes: corrección, seguridad, rendimiento y legibilidad. Señala cada problema con fichero y línea, y propone el arreglo mínimo.' }],
  ['global', { name: 'test-writer', description: 'Genera tests unitarios y de integración', model: 'haiku', tools: ['Read', 'Write', 'Bash'],
    system: '[rol:test] Escribes tests unitarios y de integración siguiendo el framework del proyecto. Cubre casos válidos, límites y errores. Ejecuta la suite antes de terminar.' }],
  ['global', { name: 'doc-writer', description: 'Documentación técnica clara en Markdown', model: 'haiku', tools: ['Read', 'Write', 'Grep', 'Glob'],
    system: '[rol:doc] Escribes documentación técnica concisa en Markdown: qué hace, cómo se usa, ejemplos reales del código.' }],
  ['global', { name: 'security-audit', description: 'Seguridad web: OWASP Top 10, auth y vulnerabilidades', model: 'sonnet', tools: ['Read', 'Grep', 'Bash'],
    system: '[rol:security] Auditas la seguridad del proyecto con el OWASP Top 10 como guía: inyección, autenticación, exposición de datos, dependencias vulnerables.' }],
  ['global', { name: 'refactor-expert', description: 'Refactoriza código manteniendo la funcionalidad', model: 'sonnet', tools: ['Read', 'Write', 'Edit', 'Grep', 'Bash'],
    system: '[rol:refactor] Refactorizas sin cambiar el comportamiento: extraes funciones, eliminas duplicación y mejoras nombres. Ejecuta los tests antes y después.' }],
  ['global', { name: 'debugger', description: 'Depuración sistemática de bugs y comportamientos inesperados', model: 'sonnet', tools: ['Read', 'Edit', 'Bash', 'Grep'],
    system: 'Depuras de forma sistemática: reproduce el fallo, formula hipótesis, verifica con logs o tests y aplica el arreglo mínimo.', optimized: false }],
  ['section-frontend', { name: 'react-dev', description: 'React 19, hooks, rendimiento y patrones de composición', model: 'sonnet', tools: ['Read', 'Write', 'Edit', 'Grep'],
    system: 'Desarrollas componentes React funcionales con hooks, accesibles y con buen rendimiento (memo, lazy, suspense).' }],
  ['section-frontend', { name: 'css-designer', description: 'Tailwind, diseño responsive y sistemas de diseño', model: 'haiku', tools: ['Read', 'Write', 'Edit'],
    system: 'Implementas diseños responsive con Tailwind respetando el sistema de diseño del proyecto.' }],
  ['section-frontend', { name: 'accessibility', description: 'Accesibilidad WCAG 2.1 AA en interfaces web', model: 'haiku', tools: ['Read', 'Write'],
    system: 'Revisas y corriges la accesibilidad (WCAG 2.1 AA): semántica, foco, contraste y ARIA.' }],
  ['section-backend', { name: 'api-designer', description: 'Diseño de APIs REST y GraphQL', model: 'sonnet', tools: ['Read', 'Write'],
    system: 'Diseñas APIs REST coherentes: recursos, verbos, códigos de estado, paginación y versionado.' }],
  ['section-backend', { name: 'db-optimizer', description: 'Optimiza consultas y esquemas SQL', model: 'sonnet', tools: ['Read', 'Bash', 'Grep'],
    system: 'Optimizas consultas SQL con EXPLAIN, índices y cambios de esquema mínimos.' }],
  ['section-mobile', { name: 'flutter-dev', description: 'Apps Flutter con Riverpod y arquitectura limpia', model: 'sonnet', tools: ['Read', 'Write', 'Edit'],
    system: 'Desarrollas pantallas Flutter con Riverpod, widgets reutilizables y tests de widget.' }],
  ['section-data', { name: 'data-analyst', description: 'Análisis de datos con pandas y SQL', model: 'sonnet', tools: ['Read', 'Write', 'Bash'],
    system: 'Analizas datos con pandas y SQL y explicas los resultados con tablas y conclusiones accionables.' }],
];

const PROJECTS = [
  { id: 'p-api', name: 'api-pedidos', categoryId: 'backend', status: 'active', git: true, description: 'API REST de pedidos y pagos',
    files: {
      'package.json': { name: 'api-pedidos', version: '1.4.0', scripts: { test: 'jest' },
        dependencies: { express: '^4.19.2', pg: '^8.11.0', zod: '^3.23.0', jsonwebtoken: '^9.0.2' },
        devDependencies: { typescript: '^5.6.0', jest: '^29.7.0' } },
      'Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "dist/index.js"]\n',
      '.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm test\n',
      'src/routes/orders.ts': "import { Router } from 'express';\nexport const orders = Router();\n\norders.post('/', async (req, res) => {\n  if (!req.body.lines?.length) return res.status(400).json({ error: 'lines required' });\n  res.status(201).json({ id: 1 });\n});\n",
      'src/services/orderService.ts': 'export async function createOrder(lines: unknown[]) {\n  return { id: 1, lines };\n}\n',
      'AGENTS.md': '# api-pedidos\n\nAPI REST de pedidos y pagos en Node.js 20 + Express + PostgreSQL.\n\n## Estructura\n- `src/routes/` — rutas Express\n- `src/services/` — lógica de negocio\n- `src/db/` — acceso a datos (pg)\n\n## Convenciones\n- Validación con zod en el borde de la API\n- Tests con Jest: `npm test`\n- Errores: `{ error }` con el código HTTP adecuado\n',
    },
    projectAgents: [{ name: 'pedidos-domain', description: 'Experto en el dominio de pedidos, stock y pagos de esta API', model: 'sonnet', tools: ['Read', 'Write', 'Edit', 'Grep'],
      system: 'Conoces el dominio de pedidos: estados (borrador, pagado, enviado, cancelado), reglas de stock y reembolsos. Aplica los cambios respetando esas reglas.' }] },
  { id: 'p-tienda', name: 'tienda-online', categoryId: 'frontend', status: 'active', description: 'Tienda online en React',
    files: {
      'package.json': { name: 'tienda-online', private: true,
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', '@tanstack/react-query': '^5.59.0', tailwindcss: '^4.0.0' },
        devDependencies: { typescript: '^5.6.0', vite: '^6.0.0', vitest: '^2.1.0', '@playwright/test': '^1.48.0' } },
      'AGENTS.md': '# tienda-online\n\nTienda online en React 19 + Vite + Tailwind. Datos con TanStack Query contra `api-pedidos`.\n\n- Componentes en `src/components/`, páginas en `src/pages/`\n- Tests unitarios con Vitest y e2e con Playwright\n',
    } },
  { id: 'p-reservas', name: 'app-reservas', categoryId: 'mobile', status: 'active', description: 'App móvil de reservas',
    files: { 'pubspec.yaml': 'name: app_reservas\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_riverpod: ^2.5.0\n' } },   // no context file on purpose: the dashboard flags it
  { id: 'p-ventas', name: 'pipeline-ventas', categoryId: 'data', status: 'active', description: 'ETL y API de métricas de ventas',
    files: {
      'requirements.txt': 'pandas==2.2.3\nfastapi==0.115.0\npytest==8.3.3\n',
      'AGENTS.md': '# pipeline-ventas\n\nETL diario de ventas con pandas y una API de métricas en FastAPI.\n',
    } },
  { id: 'p-juego', name: 'juego-plataformas', categoryId: 'games', status: 'paused', description: 'Plataformas 2D en Godot',
    files: { 'project.godot': '[application]\nconfig/name="Juego Plataformas"\n', 'AGENTS.md': '# juego-plataformas\n\nPlataformas 2D en Godot 4 con GDScript.\n\n- Escenas en `scenes/`, scripts en `scripts/`\n- Física con CharacterBody2D; niveles con TileMap\n' } },
];

function seed(root) {
  fs.rmSync(root, { recursive: true, force: true });
  const data = path.join(root, 'data');

  for (const [level, a] of AGENTS) write(path.join(data, 'agents', level, `${a.name}.md`), agentMd(a));
  // The real skills catalog, so the Skills view and the detection look like the product
  const skillsSrc = path.join(REPO, 'agents', 'skills');
  const skillsDst = path.join(data, 'agents', 'skills');
  fs.mkdirSync(skillsDst, { recursive: true });
  for (const f of fs.readdirSync(skillsSrc).filter(f => f.endsWith('.md'))) fs.copyFileSync(path.join(skillsSrc, f), path.join(skillsDst, f));

  const projects = PROJECTS.map((p, i) => {
    const dir = path.join(root, 'projects', p.name);
    for (const [rel, content] of Object.entries(p.files)) write(path.join(dir, rel), content);
    if (p.files['AGENTS.md']) write(path.join(dir, 'CONTEXTO.md'), p.files['AGENTS.md']);
    for (const a of p.projectAgents || []) write(path.join(dir, '.claude', 'agents', `${a.name}.md`), agentMd(a));
    if (p.git) {
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      git('init', '-q');
      git('-c', 'user.name=demo', '-c', 'user.email=demo@local', 'add', '-A');
      git('-c', 'user.name=demo', '-c', 'user.email=demo@local', 'commit', '-qm', 'Versión inicial');
    }
    return {
      id: p.id, name: p.name, categoryId: p.categoryId, path: dir, description: p.description, status: p.status,
      aiProviders: ['claude'], skills: p.id === 'p-api' ? ['owasp', 'api-rest'] : [], selectedAgents: [], excludedAgents: [],
      agentHashes: {}, gitEnabled: !!p.git, createdAt: ago((40 - i * 6) * DAY),
    };
  });

  write(path.join(data, 'config.json'), {
    aiProvider: 'cli', closeAction: 'tray', agentsDirectoryEnabled: false,
    projects,
    mcpServers: {
      github:   { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '$env:GITHUB_TOKEN' }, description: 'Repositorios, issues y pull requests de GitHub' },
      postgres: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/pedidos'], description: 'Consultas de solo lectura a la base de datos de pedidos' },
    },
  });

  write(path.join(data, 'cache', 'ai-usage.json'), { calls: 214, inputTokens: 1_826_400, outputTokens: 412_780, estimatedCostUSD: 11.84, since: ago(30 * DAY) });
  write(path.join(data, 'cache', 'chat-p-api.json'), { messages: [
    { role: 'user', content: '¿Dónde se valida el body de los pedidos y qué pasa si falta un campo?' },
    { role: 'assistant', content: 'La validación está en `src/routes/orders.ts`: `POST /orders` comprueba que `lines` exista y no esté vacío, y si no responde **400** con `{ error: "lines required" }`.\n\nEl resto de campos no se valida todavía: un pedido sin `customerId` llegaría a `createOrder` en `src/services/orderService.ts`. Te recomiendo un esquema **zod** (ya es dependencia del proyecto) aplicado como middleware, así todas las rutas devuelven el mismo formato de error.' },
    { role: 'user', content: '@refactor-expert extrae esa validación a un middleware reutilizable' },
    { role: 'assistant', content: 'Hecho. He creado `src/middleware/validate.ts` con un middleware `validate(schema)` basado en zod y lo he aplicado en `POST /orders` y `PATCH /orders/:id`. Los errores mantienen el formato `{ error }` con código 400, así que los clientes no cambian.' },
  ] });

  return { dataDir: data, projects };
}

module.exports = { seed };
