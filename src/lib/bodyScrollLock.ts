const locks = new WeakMap<{ style: { overflow: string } }, { count: number; previous: string }>()

/** Focus mode and its nested dialogs must not release each other's scroll lock. */
export function lockBodyScroll(body: { style: { overflow: string } }): () => void {
  const lock = locks.get(body) ?? { count: 0, previous: body.style.overflow }
  locks.set(body, lock)
  lock.count++
  body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    if (--lock.count === 0) {
      body.style.overflow = lock.previous
      locks.delete(body)
    }
  }
}
