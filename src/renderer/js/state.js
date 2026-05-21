const API = 'http://localhost:3737/api';

const ALL_TOOLS = ['Bash','Read','Write','Grep','Edit','MultiEdit','WebFetch','WebSearch','TodoRead','TodoWrite'];

const S = {
  view: 'projects',
  config: null,
  projects: [],
  appVersion: null,
  // agents view
  treeExpanded: new Set(['global','cats','projs']),
  selectedNode: { level:'global', categoryId:null, techId:null, projectId:null },
  agents: [],
  suggestions: [],
  suggestionsLoading: false,
  selectedAgent: null,
  editorAgent: null,
  editorIsNew: false,
  editorDirty: false,
  editorLang: 'en',
  // drawer
  drawerProject: null,
  drawerTab: 'claude',
  // settings
  settingsTab: 'general',
  // wizard
  wizStep: 0,
  cliFound: false,
  cliPath: null,
  aiChoice: 'cli',
};
