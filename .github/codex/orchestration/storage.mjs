import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, file)
}
export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const nonce = randomUUID(), fd = fs.openSync(file, 'wx', 0o600)
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() }))
  fs.closeSync(fd)
  return () => { if (fs.existsSync(file) && readJSON(file).nonce === nonce) fs.unlinkSync(file) }
}
