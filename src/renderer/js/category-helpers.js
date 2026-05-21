const CAT_COLORS = {games:'#34d399', web:'#60a5fa', mobile:'#fbbf24', docs:'#fb7185'};

function catColor(id) {
  return CAT_COLORS[id] || (S.config?.categories?.find(c => c.id === id)?.color) || '#888';
}

function catName(id) {
  return S.config?.categories?.find(c => c.id === id)?.name || id;
}

function techName(catId, techId) {
  const cat = S.config?.categories?.find(c => c.id === catId);
  return cat?.technologies?.find(t => t.id === techId)?.name || techId;
}
