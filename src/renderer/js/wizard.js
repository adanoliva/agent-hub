const WIZ_STEPS = [
  {
    title: '¡Bienvenido a Agent Hub!',
    sub: 'Gestiona agentes de Claude Code, organiza proyectos y genera contexto con IA.',
    body: () => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${[['🤖','Agentes en 4 niveles','Global → Categoría → Tech → Proyecto'],
         ['✨','IA integrada','Genera system prompts con Claude'],
         ['🔄','Sync inteligente','Propaga cambios a todos los proyectos'],
         ['📁','Proyectos autónomos','Cada proyecto lleva sus propios agentes']
        ].map(([e,t,s]) => `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-size:18px;margin-bottom:6px">${e}</div>
        <div style="font-size:12px;font-weight:600;color:var(--text0);margin-bottom:3px">${t}</div>
        <div style="font-size:11px;color:var(--text1)">${s}</div>
      </div>`).join('')}</div>`,
    next: 'Comenzar', skip: 'Omitir todo',
  },
  {
    title: 'Conectar con Claude',
    sub: 'Elige cómo quieres que la app acceda a Claude para generar agentes y sugerencias.',
    body: () => `<div id="wiz-ai-body"><div class="setup-item"><div class="spin"></div><span>Detectando Claude CLI…</span></div></div>`,
    onMount: detectAndRenderAIStep,
    next: 'Continuar', skip: 'Configurar más tarde',
  },
  {
    title: 'Generando estructura base',
    sub: 'Creando carpetas y cargando agentes por defecto…',
    body: () => `<div id="setup-log"></div>`,
    onMount: runSetup,
    next: 'Finalizar', skip: '',
    autoNext: true,
  },
];

function openWizard() {
  S.wizStep = 0;
  document.getElementById('wizard').style.display = 'flex';
  renderWizStep();
}

function renderWizStep() {
  const step  = WIZ_STEPS[S.wizStep];
  const total = WIZ_STEPS.length;
  for (let i = 0; i < total; i++) {
    const d = document.getElementById(`wd${i}`);
    if (d) d.className = 'wiz-dot ' + (i < S.wizStep ? 'done' : i === S.wizStep ? 'cur' : '');
  }
  document.getElementById('wiz-title').textContent = step.title;
  document.getElementById('wiz-sub').textContent   = step.sub;
  document.getElementById('wiz-body').innerHTML    = step.body();
  document.getElementById('wiz-next').innerHTML    = `${step.next} <i class="ti ti-arrow-right"></i>`;
  document.getElementById('wiz-next').disabled     = step.autoNext || false;
  const skip = document.getElementById('wiz-skip');
  skip.textContent      = step.skip || '';
  skip.style.visibility = step.skip ? 'visible' : 'hidden';
  if (step.onMount) step.onMount();
}

async function wizNext() {
  if (S.wizStep === 1) await saveAIProviderChoice();
  S.wizStep++;
  if (S.wizStep >= WIZ_STEPS.length) { closeWizard(); return; }
  renderWizStep();
}

function wizSkip() { closeWizard(); }

function closeWizard() {
  document.getElementById('wizard').style.display = 'none';
  localStorage.setItem('cdm-wizard-done', '1');
}

async function detectAndRenderAIStep() {
  let found = false, cpath = null;
  try { const r = await req('GET', '/detect-cli'); found = r.found; cpath = r.path; } catch {}
  S.cliFound = found; S.cliPath = cpath;
  if (!S.aiChoice) S.aiChoice = found ? 'cli' : 'api';
  renderAIBody();
}

function renderAIBody() {
  const b = document.getElementById('wiz-ai-body');
  if (!b) return;
  b.innerHTML = `
    <div class="ai-opt ${S.aiChoice === 'cli' ? 'on' : ''}" onclick="S.aiChoice='cli';renderAIBody()">
      <div class="ai-opt-head">
        <div class="ai-radio ${S.aiChoice === 'cli' ? 'on' : ''}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text0);display:flex;align-items:center;gap:8px">
            Claude CLI
            ${S.cliFound ? `<span class="badge green">✓ detectado</span>` : `<span class="badge gray">no encontrado</span>`}
          </div>
          <div style="font-size:11px;color:var(--text1);margin-top:2px">Usa tu suscripción de Claude.ai. Sin coste adicional.</div>
          ${S.cliFound && S.cliPath ? `<div style="font-size:10px;color:var(--text2);font-family:var(--mono);margin-top:3px">${esc(S.cliPath)}</div>` : ''}
        </div>
      </div>
      ${!S.cliFound ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" onclick="event.stopPropagation();openCLIInstall()"><i class="ti ti-download"></i> Instalar Claude CLI</button>
        <button class="btn sm" onclick="event.stopPropagation();wizRecheckCLI()"><i class="ti ti-refresh"></i> Ya lo instalé</button>
      </div>` : ''}
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span style="font-size:11px;color:var(--text2)">o</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>

    <div class="ai-opt ${S.aiChoice === 'github' ? 'on' : ''}" onclick="S.aiChoice='github';renderAIBody()">
      <div class="ai-opt-head">
        <div class="ai-radio ${S.aiChoice === 'github' ? 'on' : ''}"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--text0);display:flex;align-items:center;gap:8px">
            GitHub Copilot
            <span class="badge blue">Models API</span>
          </div>
          <div style="font-size:11px;color:var(--text1);margin-top:2px">Usa tu cuenta de GitHub. Capa gratuita disponible.</div>
        </div>
      </div>
      ${S.aiChoice === 'github' ? `<div style="margin-top:12px">
        <div class="field" style="margin-bottom:8px">
          <label>GitHub Personal Access Token</label>
          <input id="wiz-ghtoken" type="password" placeholder="ghp_…" onclick="event.stopPropagation()" style="font-family:var(--mono)"/>
          <div class="hint">github.com → Settings → Developer settings → Personal access tokens → Fine-grained → <strong>Models: Read</strong></div>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Modelo</label>
          <select id="wiz-ghmodel" onclick="event.stopPropagation()">
            <option value="gpt-4o-mini" selected>gpt-4o-mini (rápido, gratuito)</option>
            <option value="gpt-4o">gpt-4o (potente)</option>
            <option value="o1-mini">o1-mini (razonamiento)</option>
          </select>
        </div>
      </div>` : ''}
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span style="font-size:11px;color:var(--text2)">o</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>

    <div class="ai-opt ${S.aiChoice === 'api' ? 'on' : ''}" onclick="S.aiChoice='api';renderAIBody()">
      <div class="ai-opt-head">
        <div class="ai-radio ${S.aiChoice === 'api' ? 'on' : ''}"></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text0)">API key de Anthropic</div>
          <div style="font-size:11px;color:var(--text1);margin-top:2px">Acceso directo a Claude. Requiere cuenta en console.anthropic.com.</div>
        </div>
      </div>
      ${S.aiChoice === 'api' ? `<div style="margin-top:12px">
        <div class="field" style="margin-bottom:0">
          <label>API key</label>
          <input id="wiz-apikey" type="password" placeholder="sk-ant-api03-…" onclick="event.stopPropagation()" style="font-family:var(--mono)"/>
        </div>
      </div>` : ''}
    </div>`;
}

async function wizRecheckCLI() {
  try {
    const r = await req('GET', '/detect-cli');
    S.cliFound = r.found; S.cliPath = r.path;
    if (r.found) { S.aiChoice = 'cli'; toast('Claude CLI detectado'); }
    else toast('CLI no encontrado aún', 'err');
  } catch {}
  renderAIBody();
}

async function saveAIProviderChoice() {
  const provider = S.aiChoice || 'cli';
  const body     = {aiProvider: provider};
  if (provider === 'api') {
    body.apiKey = document.getElementById('wiz-apikey')?.value?.trim() || '';
  }
  if (provider === 'github') {
    body.githubToken = document.getElementById('wiz-ghtoken')?.value?.trim() || '';
    body.githubModel = document.getElementById('wiz-ghmodel')?.value || 'gpt-4o-mini';
  }
  await req('PUT', '/config', body);
  if (S.config) Object.assign(S.config, body);
}

async function runSetup() {
  const log = document.getElementById('setup-log');
  const item = (icon, color, msg) => {
    const d = document.createElement('div');
    d.className = 'setup-item';
    d.innerHTML = `<i class="ti ${icon}" style="font-size:14px;color:${color}"></i><span>${msg}</span>`;
    log.appendChild(d);
  };
  const spinner = () => {
    const d = document.createElement('div');
    d.className = 'setup-item';
    d.innerHTML = `<div class="spin"></div><span>Creando estructura de carpetas…</span>`;
    log.appendChild(d); return d;
  };
  const el = spinner();
  try {
    const r = await req('POST', '/setup', {});
    el.innerHTML = `<i class="ti ti-check" style="font-size:14px;color:var(--green)"></i><span>Estructura creada · ${r.agentsCreated} agentes cargados</span>`;
    await new Promise(res => setTimeout(res, 400));
    item('ti-check', 'var(--green)', '¡Todo listo!');
    document.getElementById('wiz-next').disabled = false;
    document.getElementById('wiz-sub').textContent = 'La aplicación está configurada y lista para usar.';
    S.config   = await req('GET', '/config');
    S.projects = await req('GET', '/projects');
    toast('Configuración completada');
  } catch(e) {
    el.innerHTML = `<i class="ti ti-x" style="font-size:14px;color:var(--coral)"></i><span style="color:var(--coral)">Error: ${e.message}</span>`;
  }
}
