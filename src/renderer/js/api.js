async function req(method, ep, body) {
  const r = await fetch(API + ep, {
    method,
    headers: {'Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}
