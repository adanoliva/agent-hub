export const ALL_TOOLS = [
  'Bash', 'Read', 'Write', 'Grep', 'Edit', 'MultiEdit',
  'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite',
];

export function agentIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('unity'))                                      return 'ti-device-gamepad-2';
  if (n.includes('react') || n.includes('frontend'))           return 'ti-brand-react';
  if (n.includes('test'))                                       return 'ti-player-play';
  if (n.includes('doc'))                                        return 'ti-file-description';
  if (n.includes('git'))                                        return 'ti-git-branch';
  if (n.includes('refactor'))                                   return 'ti-arrows-exchange';
  if (n.includes('review'))                                     return 'ti-eye';
  if (n.includes('db') || n.includes('database') || n.includes('backend')) return 'ti-database';
  if (n.includes('security'))                                   return 'ti-shield';
  if (n.includes('mobile'))                                     return 'ti-device-mobile';
  if (n.includes('shader') || n.includes('css') || n.includes('design'))   return 'ti-palette';
  if (n.includes('perf'))                                       return 'ti-bolt';
  if (n.includes('diagram'))                                    return 'ti-chart-dots';
  return 'ti-robot';
}

export const MODEL_ICON: Record<string, string> = {
  haiku: 'ti-leaf',
  sonnet: 'ti-bolt',
  opus: 'ti-brain',
};

export const LEVEL_COLOR: Record<string, string> = {
  global:  'var(--green)',
  section: 'var(--blue)',
  tech:    'var(--amber)',
  project: 'var(--coral)',
};
