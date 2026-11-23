// Regista o service worker (só na versão publicada) e avisa a app quando há uma versão nova.

type Listener = (apply: () => void) => void
let listener: Listener | null = null
let pending: (() => void) | null = null

/** A app chama isto para mostrar o aviso "Há uma versão nova". */
export function onUpdateReady(fn: Listener) {
  listener = fn
  if (pending) fn(pending)
}

export function registerServiceWorker() {
  // Na app Android os ficheiros já estão dentro da app: não é preciso service worker.
  if (!import.meta.env.PROD || import.meta.env.MODE === 'android' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', async () => {
    try {
      // Na primeira visita o service worker toma conta da página (controllerchange) sem haver versão nova:
      // recarregar aí interrompia o que o utilizador estava a fazer. Só se recarrega numa troca de versão.
      const hadController = Boolean(navigator.serviceWorker.controller)
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !hadController) return
        reloading = true
        window.location.reload()
      })
      const ready = (w: ServiceWorker) => {
        const apply = () => w.postMessage('SKIP_WAITING')
        pending = apply
        listener?.(apply)
      }
      if (reg.waiting && navigator.serviceWorker.controller) ready(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w)
        })
      })
      // Procura versão nova quando a app volta ao ecrã.
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}))
    } catch {
      /* sem service worker: a app funciona na mesma, só não abre sem rede */
    }
  })
}
