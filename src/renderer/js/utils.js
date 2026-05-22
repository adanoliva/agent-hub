function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first, then apply markdown
  let s = esc(text);
  // Fenced code blocks (```...```)
  s = s.replace(/```([^`]*?)```/gs, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  // Inline code (`...`)
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  // Bold (**text**)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (_text_ or *text*)
  s = s.replace(/(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g, '<em>$2</em>');
  // Line breaks
  s = s.replace(/\n/g, '<br>');
  return s;
}
