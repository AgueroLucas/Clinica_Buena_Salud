/** Cliente HTTP del navegador. Adjunta el token de sesion si existe. */
export async function api(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cbs_token') : null
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error de red')
  return data
}
