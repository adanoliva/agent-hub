import { ProjectProvider } from '../types';

export const PROJECT_PROVIDERS: Record<string, ProjectProvider> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    icon: 'ti-robot',
    agentDir: ['.claude', 'agents'],
    contextFile: 'CLAUDE.md',
    templateType: 'claude'
  },
  github: {
    id: 'github',
    label: 'GitHub Copilot',
    icon: 'ti-brand-github',
    agentDir: ['.github', 'agents'],
    contextFile: '.github/copilot-instructions.md',
    templateType: 'github'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    icon: 'ti-sparkles',
    agentDir: ['.gemini', 'agents'],
    contextFile: 'GEMINI.md',
    templateType: 'gemini'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (Cursor)',
    icon: 'ti-brain',
    agentDir: ['.openai', 'agents'],
    contextFile: '.instructions.md',
    templateType: 'openai'
  }
};

export const PROJECT_PROVIDERS_LIST = Object.values(PROJECT_PROVIDERS);
