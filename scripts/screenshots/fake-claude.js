// Stand-in for the `claude` CLI while taking screenshots: no tokens spent, believable output.
// Reads the prompt from stdin, waits FAKE_DELAY_FILE's milliseconds and prints Claude's --output-format json.
// In agent mode it also writes a file per agent, so steps have real changes (and git diffs).
const fs   = require('fs');
const path = require('path');

const RESPONSES = [
  ['refactor', 'He extraído la validación de las rutas de pedidos a `src/middleware/validate.ts` y la he aplicado en `POST /orders` y `PATCH /orders/:id`. El comportamiento no cambia: los mismos errores 400 con el mismo formato.',
    'src/middleware/validate.ts', "import { Request, Response, NextFunction } from 'express';\nimport { ZodSchema } from 'zod';\n\nexport const validate = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {\n  const parsed = schema.safeParse(req.body);\n  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });\n  req.body = parsed.data;\n  next();\n};\n"],
  ['test', 'Añadidos 12 tests para el middleware de validación y las rutas de pedidos (casos válidos, campos ausentes, tipos incorrectos). Todos pasan con `npm test`.',
    'src/__tests__/validate.test.ts', "import { validate } from '../middleware/validate';\n\ndescribe('validate', () => {\n  it('rechaza un pedido sin líneas', () => {\n    // …\n  });\n});\n"],
  ['doc', 'Documentados los endpoints de pedidos en `docs/api.md`, con ejemplos de petición y los errores de validación.',
    'docs/api.md', '# API de pedidos\n\n## POST /orders\n\nCrea un pedido. Devuelve 400 si la validación falla.\n'],
  ['review', 'Revisión completa. El middleware es correcto y los tests cubren los casos límite. Una sugerencia menor: tipar `req.body` con el esquema inferido en lugar de `any` en `orders.ts`.'],
  ['security', 'No he encontrado vulnerabilidades críticas. Recomiendo limitar el tamaño del body (`express.json({ limit: "100kb" })`) y añadir rate limiting a `/auth/login`.'],
];
const CHAT = 'El proyecto es una API REST en **Node.js + Express** con **PostgreSQL**. Los pedidos se gestionan en `src/routes/orders.ts`, que valida el body y llama a `src/services/orderService.ts`; el acceso a datos está en `src/db/`. Los tests usan Jest y se ejecutan con `npm test`.';

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const agentMode = args.includes('--dangerously-skip-permissions');
  const lower = input.toLowerCase();
  // Demo agents carry a [rol:…] marker in their system prompt (see seed.js)
  const hit = RESPONSES.find(([k]) => lower.includes(`[rol:${k}]`));
  let text = agentMode && hit ? hit[1] : (hit ? hit[1] : CHAT);
  if (agentMode && hit?.[2]) {
    const file = path.join(process.cwd(), hit[2]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, hit[3]);
  }
  if (input.includes('HANDOFF:')) {
    text += `\n\nHANDOFF: ${JSON.stringify({ done: text.slice(0, 80), changed: hit?.[2] ? [hit[2]] : [], issues: [], next: 'Continúa con tu parte.' })}`;
  }
  let delay = 1500;
  try { delay = Number(fs.readFileSync(process.env.FAKE_DELAY_FILE, 'utf8')) || delay; } catch {}
  const inputTokens = Math.ceil(input.length / 4);
  const outputTokens = 300 + Math.floor(Math.random() * 900);
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: text,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      total_cost_usd: (inputTokens * 3 + outputTokens * 15) / 1e6,
    }) + '\n');
  }, delay);
});
