exports.label       = 'Resumen del proyecto';
exports.description = 'Genera un resumen rápido del proyecto: lenguaje, archivos por extensión y tamaño total.';

exports.run = async ({ projectPath, prevResult, fs, path }) => {
  // Leer package.json si existe
  let projectName = path.basename(projectPath);
  let projectVersion = null;
  const hasPkg = await fs.exists('package.json');
  if (hasPkg) {
    try {
      const pkg = await fs.readJSON('package.json');
      projectName    = pkg.name    || projectName;
      projectVersion = pkg.version || null;
    } catch {}
  }

  // Contar archivos por extensión (solo src/)
  const hasSrc = await fs.exists('src');
  const baseDir = hasSrc ? 'src' : '.';

  async function walk(dir, depth = 0) {
    if (depth > 4) return [];
    const items = await fs.listDir(dir).catch(() => []);
    const results = [];
    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules' || item === 'dist') continue;
      const rel = `${dir}/${item}`;
      const ext = item.includes('.') ? item.split('.').pop() : null;
      if (ext) {
        results.push(ext.toLowerCase());
      } else {
        results.push(...await walk(rel, depth + 1));
      }
    }
    return results;
  }

  const exts = await walk(baseDir);
  const counts = exts.reduce((acc, e) => { acc[e] = (acc[e] || 0) + 1; return acc; }, {});
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // Detectar lenguaje principal
  const langMap = { ts: 'TypeScript', tsx: 'TypeScript/React', js: 'JavaScript', py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cs: 'C#' };
  const mainLang = langMap[sorted[0]?.[0]] || 'Desconocido';

  // Construir informe
  const lines = [
    `Proyecto: ${projectName}${projectVersion ? ` v${projectVersion}` : ''}`,
    `Lenguaje principal: ${mainLang}`,
    ``,
    `Archivos por extensión (${baseDir}/):`,
    ...sorted.slice(0, 8).map(([ext, n]) => `  .${ext}: ${n} archivo${n !== 1 ? 's' : ''}`),
  ];

  if (prevResult?.output?.response) {
    lines.push(``, `Contexto del paso anterior: disponible (${prevResult.output.response.length} chars)`);
  }

  const output = lines.join('\n');

  return {
    output,
    filesModified: [],
    data: { projectName, projectVersion, mainLang, extCounts: counts },
  };
};
