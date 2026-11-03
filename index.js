/**
 * Session Cleaner — Host half.
 *
 * Exposes four plain HTTP routes under `/session-cleaner` on the Web carrier:
 *
 *   GET  /session-cleaner/sessions  → stored sessions, their activity, the trash
 *   POST /session-cleaner/delete    → move sessions into the trash
 *   POST /session-cleaner/restore   → move trashed sessions back
 *   POST /session-cleaner/purge     → remove trash entries for good
 *
 * Deleting is a recycle bin, not a shredder: the session directory is renamed
 * into `<DSH_HOME>/session-cleaner/trash/<id>/` with its metadata written
 * beside it, so the bytes survive for a retention window and a mistake stays
 * undoable. Purging is the only irreversible step.
 *
 * Every route sits behind the admission fence the app applies to its own `/api`
 * surface. A route registered on `webServer` does *not* inherit that check —
 * the kernel's `/api` handler calls `connection.admit` itself — so a plugin
 * prefix would otherwise answer any loopback caller, including a web page the
 * user never granted anything.
 *
 * Ordering inside one deletion matters as much as the fence:
 *
 *   1. refuse anything the app reports as busy (turn, job, schedule, subagent),
 *   2. rename the directory into the trash — reversible, and done first,
 *   3. only then detach it from its workspace record,
 *   4. roll the rename back if bookkeeping fails.
 *
 * Doing 3 before 2 is the trap the previous revision fell into: a failed file
 * removal left a session detached from its workspace (invisible in the UI)
 * while its log kept occupying the disk, with no surface left to retry from.
 */
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const PREFIX = '/session-cleaner'
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BODY_LIMIT = 256 * 1024
const DELETE_LIMIT = 500
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const JSON_TYPE = /^application\/(?:[a-z0-9.+-]*\+)?json\b/i
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

export const inject = ['webServer', 'sessionPersistence']

export function apply(ctx) {
  const root = sessionsRoot()
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => {
      route(ctx, root, req, res).catch((error) => {
        sendJson(res, error instanceof HttpError ? error.status : 500, { ok: false, error: messageOf(error) })
      })
    },
  }))
}

/** The session persistence root: `<DSH_HOME>/sessions`, the layout the JSONL backend writes. */
export function sessionsRoot() {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim() !== '') return join(resolve(home), 'sessions')
  return join(homedir(), '.dsh', 'sessions')
}

/**
 * The trash sits beside the session store, never inside it: the persistence
 * backend scans its own first level for session directories, and a deleted
 * session parked there would be served as if it were alive.
 */
export function trashRoot(root) {
  return join(dirname(root), 'session-cleaner', 'trash')
}

async function route(ctx, root, req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '')
  const method = (req.method || 'GET').toUpperCase()

  const rejection = admit(ctx, req)
  if (rejection !== undefined) {
    sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
    return
  }

  if (pathname === `${PREFIX}/sessions` && method === 'GET') return await listSessions(ctx, root, res)
  if (pathname === `${PREFIX}/delete` && method === 'POST') return await deleteSessions(ctx, root, req, res)
  if (pathname === `${PREFIX}/restore` && method === 'POST') return await restoreSessions(ctx, root, req, res)
  if (pathname === `${PREFIX}/purge` && method === 'POST') return await purgeTrash(root, req, res)

  sendJson(res, 404, { ok: false, error: 'not-found' })
}

//#region admission

/**
 * Decide one request, failing closed. The composition's own connection service
 * knows the app's browser-authentication cookie; without it, fall back to the
 * structural fence the app applies to its `/api` surface.
 */
function admit(ctx, req) {
  try {
    const connection = ctx.get('connection')
    if (connection !== undefined) {
      if (typeof connection.admit === 'function') {
        const admission = connection.admit(req)
        return admission !== null && typeof admission === 'object' ? admission.rejection : undefined
      }
      if (typeof connection.requestRejection === 'function') return connection.requestRejection(req)
    }
  } catch {
    // Never fall through to the structural fence when a mounted service fails:
    // that would downgrade authentication to a header heuristic.
    return 503
  }
  return structuralRejection(req)
}

/** Loopback Host, no cross-site fetch, Origin/Referer matching the Host authority. */
function structuralRejection(req) {
  const host = authorityOf(req.headers.host)
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 403
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      // The desktop relay strips both browser markers and forwards only this
      // Referer. It is not an origin grant: a relayed request carrying either
      // marker is not the owned app page.
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) return 403
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return 403
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) return 403
  }
  return undefined
}

function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function authorityOf(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `http://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}

//#endregion

async function listSessions(ctx, root, res) {
  await sweepTrash(root)
  const snapshots = await ctx.sessionPersistence.list()
  const cache = ctx.get('sessionProjectionCache')
  const registry = ctx.get('workspaceRegistry')
  const workspaceByPath = new Map()
  if (registry !== undefined) {
    for (const workspace of registry.list()) workspaceByPath.set(compareKey(workspace.path), workspace)
  }
  const archived = new Set(registry === undefined ? [] : registry.archivedSessionIds)
  const pinned = new Set(registry === undefined ? [] : registry.pinnedSessionIds)

  const sessions = snapshots.map((snapshot) => {
    const header = snapshot.header
    const workspace = header.cwd === undefined ? undefined : workspaceByPath.get(compareKey(header.cwd))
    return {
      id: header.id,
      title: cachedTitle(cache, header),
      cwd: header.cwd ?? null,
      groupKey: header.cwd === undefined ? '' : compareKey(header.cwd),
      workspaceTitle: workspace?.title ?? (header.cwd === undefined ? '' : basename(header.cwd)),
      createdAt: header.createdAt,
      updatedAt: cachedUpdatedAt(cache, header),
      sizeBytes: snapshot.sizeBytes ?? null,
      subagent: header.origin === 'subagent' || header.parentSession !== undefined,
      parentSessionId: header.parentSession ?? null,
      activity: [],
      live: false,
      archived: archived.has(header.id),
      pinned: pinned.has(header.id),
    }
  })

  await Promise.all([fillActivity(ctx, sessions), fillMissingTitles(ctx, sessions)])
  sendJson(res, 200, {
    ok: true,
    sessionsRoot: root,
    trashRoot: trashRoot(root),
    retentionDays: Math.round(RETENTION_MS / 86400000),
    sessions,
    trash: await readTrash(root),
  })
}

/**
 * Mark the sessions the app considers busy. `sessions`/`agents` cover retained
 * scopes; the `workspace/session-activity` waterfall is the same gate the
 * workspace registry consults before archiving, and it is the only one that
 * knows about running turns, jobs, schedules and subagents.
 */
async function fillActivity(ctx, sessions) {
  const live = ctx.get('sessions')
  const agents = ctx.get('agents')
  await Promise.all(sessions.map(async (session) => {
    const activity = await activityOf(ctx, session.id)
    session.activity = activity
    session.live = retained(live, session.id) || retained(agents, session.id) || activity.length > 0
  }))
}

function retained(service, id) {
  if (service === undefined || typeof service.get !== 'function') return false
  try {
    return service.get(id) !== undefined
  } catch {
    return false
  }
}

async function activityOf(ctx, id) {
  if (typeof ctx.waterfall !== 'function') return []
  try {
    const entries = await ctx.waterfall('workspace/session-activity', { sessionId: id }, () => Promise.resolve([]))
    if (!Array.isArray(entries)) return []
    const kinds = new Set()
    for (const entry of entries) {
      if (entry !== null && typeof entry === 'object' && typeof entry.kind === 'string') kinds.add(entry.kind)
    }
    return [...kinds]
  } catch {
    return []
  }
}

/**
 * The projection cache usually carries the latest title, but sessions whose
 * checkpoint was pruned have none. Read those few titles from their logs so the
 * list is identifiable; a failing read only leaves that row untitled.
 */
async function fillMissingTitles(ctx, sessions) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.readTitleSnapshots !== 'function') return
  const missing = sessions.filter((session) => session.title === '').slice(0, 200)
  if (missing.length === 0) return
  let observations
  try {
    observations = await query.readTitleSnapshots(missing.map((session) => session.id))
  } catch {
    return
  }
  const titles = new Map()
  for (const observation of Array.isArray(observations) ? observations : []) {
    if (observation?.status !== 'fulfilled') continue
    const title = observation.value?.title?.title
    if (typeof title === 'string' && title !== '') titles.set(observation.sessionId, title)
  }
  for (const session of sessions) {
    const title = titles.get(session.id)
    if (title !== undefined && session.title === '') session.title = title
  }
}

//#region delete

async function deleteSessions(ctx, root, req, res) {
  const payload = await readJsonBody(req)
  const requested = Array.isArray(payload.sessionIds) ? payload.sessionIds : null
  if (requested === null || requested.length === 0) return sendJson(res, 400, { ok: false, error: 'no-session-ids' })
  if (requested.length > DELETE_LIMIT) return sendJson(res, 400, { ok: false, error: 'too-many-session-ids' })

  const snapshots = await ctx.sessionPersistence.list()
  const byId = new Map(snapshots.map((snapshot) => [snapshot.header.id, snapshot]))
  const childOf = new Map()
  for (const snapshot of snapshots) {
    const parent = snapshot.header.parentSession
    if (parent === undefined) continue
    const children = childOf.get(parent) ?? []
    children.push(snapshot.header.id)
    childOf.set(parent, children)
  }
  const registry = ctx.get('workspaceRegistry')
  const cache = ctx.get('sessionProjectionCache')
  const directories = await sessionDirectoryIndex(root)
  const results = []
  const deleted = new Set()

  for (const id of deletionOrder(requested, byId)) {
    if (!SESSION_ID.test(id)) {
      results.push({ id, ok: false, reason: 'invalid-id' })
      continue
    }
    if (!byId.has(id)) {
      // A prompt target that no longer exists can still own a stale archive entry.
      let pruned = false
      if (registry !== undefined && registry.archivedSessionIds.includes(id)) {
        try {
          await registry.unarchiveSession(id)
          pruned = true
        } catch {
          pruned = false
        }
      }
      results.push({ id, ok: false, reason: 'not-found', ...(pruned ? { prunedArchive: true } : {}) })
      continue
    }

    const activity = await activityOf(ctx, id)
    if (activity.length > 0 || retained(ctx.get('sessions'), id) || retained(ctx.get('agents'), id)) {
      results.push({ id, ok: false, reason: 'live', activity })
      continue
    }
    // Children are ordered first, so a tree selected as a whole deletes cleanly.
    const children = (childOf.get(id) ?? []).filter((child) => !deleted.has(child)).length
    if (children > 0) {
      results.push({ id, ok: false, reason: 'has-children', children })
      continue
    }

    const snapshot = byId.get(id)
    const size = snapshot.sizeBytes ?? 0
    const directory = directories.get(id)
    if (directory === undefined) {
      // The log is already gone; only the workspace bookkeeping still points at it.
      const cleaned = await release(ctx, registry, id)
      results.push({
        id,
        ok: cleaned.ok,
        ...(cleaned.ok
          ? { trashed: false, trashedBytes: 0, note: 'directory-missing' }
          : { reason: 'bookkeeping-failed', note: cleaned.note }),
      })
      if (cleaned.ok) deleted.add(id)
      continue
    }

    const moved = await moveToTrash(root, id, directory, {
      id,
      title: cachedTitle(cache, snapshot.header),
      cwd: snapshot.header.cwd ?? null,
      parentDir: dirname(directory),
      workspaceId: registry === undefined ? undefined : workspaceOf(registry, id)?.id,
      archived: registry === undefined ? false : registry.archivedSessionIds.includes(id),
      pinned: registry === undefined ? false : registry.pinnedSessionIds.includes(id),
      deletedAt: Date.now(),
      sizeBytes: size,
    })
    if (!moved.ok) {
      results.push({ id, ok: false, reason: 'remove-failed', note: moved.note })
      continue
    }

    const released = await release(ctx, registry, id)
    if (!released.ok) {
      // Put the bytes back: a session detached but undelivered is unreachable
      // from every surface, which is worse than a failed deletion.
      const restored = await moveBack(root, id, directory)
      results.push({
        id,
        ok: false,
        reason: 'bookkeeping-failed',
        note: released.note,
        ...(restored ? {} : { stranded: true }),
      })
      continue
    }

    deleted.add(id)
    results.push({ id, ok: true, trashed: true, trashedBytes: size })
  }

  sendJson(res, 200, { ok: true, sessionsRoot: root, results })
}

/** Drop the workspace record and the archive entry for one session. */
async function release(ctx, registry, id) {
  if (registry === undefined) return { ok: true }
  try {
    const workspace = workspaceOf(registry, id)
    if (workspace !== undefined) await workspace.detachSession(id)
    if (registry.archivedSessionIds.includes(id)) await registry.unarchiveSession(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, note: messageOf(error) }
  }
}

/** Rename the session directory into the trash and write its metadata beside it. */
async function moveToTrash(root, id, directory, meta) {
  const trash = trashRoot(root)
  const metaFile = join(trash, `${id}.json`)
  try {
    await mkdir(trash, { recursive: true })
    await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    await rename(directory, join(trash, id))
    return { ok: true }
  } catch (error) {
    await rm(metaFile, { force: true }).catch(() => {})
    return { ok: false, note: messageOf(error) }
  }
}

/** Undo `moveToTrash` after a failed bookkeeping step. */
async function moveBack(root, id, directory) {
  const trash = trashRoot(root)
  try {
    await mkdir(dirname(directory), { recursive: true })
    await rename(join(trash, id), directory)
    await rm(join(trash, `${id}.json`), { force: true })
    return true
  } catch {
    return false
  }
}

//#endregion

//#region restore & purge

async function restoreSessions(ctx, root, req, res) {
  const payload = await readJsonBody(req)
  const requested = Array.isArray(payload.sessionIds) ? payload.sessionIds : null
  if (requested === null || requested.length === 0) return sendJson(res, 400, { ok: false, error: 'no-session-ids' })
  if (requested.length > DELETE_LIMIT) return sendJson(res, 400, { ok: false, error: 'too-many-session-ids' })

  const trash = trashRoot(root)
  const registry = ctx.get('workspaceRegistry')
  const directories = await sessionDirectoryIndex(root)
  const results = []

  for (const id of [...new Set(requested.map(String))]) {
    if (!SESSION_ID.test(id)) {
      results.push({ id, ok: false, reason: 'invalid-id' })
      continue
    }
    const meta = await readMeta(trash, id)
    const source = join(trash, id)
    if (meta === null || !(await isDirectory(source))) {
      results.push({ id, ok: false, reason: 'not-in-trash' })
      continue
    }
    // The backend names the directory after the session id, so it can go back
    // to the exact parent it came from without knowing the cwd encoding.
    const target = directories.get(id) ?? join(typeof meta.parentDir === 'string' ? meta.parentDir : root, id)
    if (await pathExists(target)) {
      results.push({ id, ok: false, reason: 'restore-conflict' })
      continue
    }
    try {
      await mkdir(dirname(target), { recursive: true })
      await rename(source, target)
    } catch (error) {
      results.push({ id, ok: false, reason: 'restore-failed', note: messageOf(error) })
      continue
    }

    const attached = await reattach(ctx, registry, id, meta)
    await rm(join(trash, `${id}.json`), { force: true }).catch(() => {})
    if (!attached.ok) {
      // The bytes are back in the session store — where the user expects them —
      // but the workspace record did not take; report the gap instead of hiding it.
      results.push({ id, ok: false, reason: 'bookkeeping-failed', note: attached.note })
      continue
    }
    results.push({ id, ok: true })
  }

  await pruneEmptyTrash(root)
  sendJson(res, 200, { ok: true, results })
}

/** Put the session back into its workspace, with the archive and pin state it had. */
async function reattach(ctx, registry, id, meta) {
  if (registry === undefined) return { ok: true }
  try {
    const workspace = meta.workspaceId === undefined ? undefined : registry.get(meta.workspaceId)
    if (workspace !== undefined && !workspace.sessionIds.includes(id)) await workspace.attachSession(id)
    if (meta.archived === true && !registry.archivedSessionIds.includes(id)) await registry.archiveSession(id)
    if (meta.pinned === true && !registry.pinnedSessionIds.includes(id)) await registry.pinSession(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, note: messageOf(error) }
  }
}

async function purgeTrash(root, req, res) {
  const payload = await readJsonBody(req)
  const trash = trashRoot(root)
  const purgeAll = payload.all === true
  const requested = Array.isArray(payload.sessionIds)
    ? payload.sessionIds.filter((value) => SESSION_ID.test(String(value)))
    : []
  if (!purgeAll && requested.length === 0) return sendJson(res, 400, { ok: false, error: 'no-session-ids' })
  if (requested.length > DELETE_LIMIT) return sendJson(res, 400, { ok: false, error: 'too-many-session-ids' })

  const entries = purgeAll ? (await readTrash(root)).map((entry) => entry.id) : [...new Set(requested.map(String))]
  const results = []
  for (const id of entries) {
    const meta = await readMeta(trash, id)
    try {
      await rm(join(trash, id), { recursive: true, force: true })
      await rm(join(trash, `${id}.json`), { force: true })
      results.push({ id, ok: true, freedBytes: typeof meta?.sizeBytes === 'number' ? meta.sizeBytes : 0 })
    } catch (error) {
      results.push({ id, ok: false, reason: 'remove-failed', note: messageOf(error) })
    }
  }
  await pruneEmptyTrash(root)
  sendJson(res, 200, { ok: true, results })
}

//#endregion

//#region trash storage

async function readTrash(root) {
  const trash = trashRoot(root)
  let names
  try {
    names = await readdir(trash)
  } catch {
    return []
  }
  const entries = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    if (!SESSION_ID.test(id)) continue
    const meta = await readMeta(trash, id)
    if (meta === null) continue
    if (!(await isDirectory(join(trash, id)))) continue
    entries.push({
      id,
      title: typeof meta.title === 'string' ? meta.title : '',
      cwd: meta.cwd ?? null,
      groupKey: typeof meta.cwd === 'string' ? compareKey(meta.cwd) : '',
      workspaceTitle: typeof meta.cwd === 'string' ? basename(meta.cwd) : '',
      deletedAt: typeof meta.deletedAt === 'number' ? meta.deletedAt : 0,
      sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : 0,
      archived: meta.archived === true,
      pinned: meta.pinned === true,
    })
  }
  entries.sort((left, right) => right.deletedAt - left.deletedAt)
  return entries
}

async function readMeta(trash, id) {
  try {
    const parsed = JSON.parse(await readFile(join(trash, `${id}.json`), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Retention sweep: entries older than the window are the only automatic deletion. */
async function sweepTrash(root) {
  const trash = trashRoot(root)
  let names
  try {
    names = await readdir(trash)
  } catch {
    return
  }
  const now = Date.now()
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    if (!SESSION_ID.test(id)) continue
    const meta = await readMeta(trash, id)
    const deletedAt = typeof meta?.deletedAt === 'number' ? meta.deletedAt : 0
    if (deletedAt === 0 || now - deletedAt < RETENTION_MS) continue
    await rm(join(trash, id), { recursive: true, force: true }).catch(() => {})
    await rm(join(trash, name), { force: true }).catch(() => {})
  }
}

async function pruneEmptyTrash(root) {
  const trash = trashRoot(root)
  try {
    const remaining = await readdir(trash)
    if (remaining.length === 0) await rm(trash, { recursive: true, force: true })
  } catch {
    /* an occupied or vanished trash needs no pruning */
  }
}

//#endregion

//#region helpers

/** The workspace entity accounting one session, if any. */
function workspaceOf(registry, id) {
  for (const workspace of registry.list()) {
    if (workspace.sessionIds.includes(id)) return workspace
  }
  return undefined
}

/** Dedupe requested ids and order them deepest-first so children are removed before their parents. */
function deletionOrder(requested, byId) {
  const ids = [...new Set(requested.map((value) => (typeof value === 'string' ? value : String(value))))]
  const depth = new Map()
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id)
    let current = id
    let level = 0
    while (level < 64) {
      const parent = byId.get(current)?.header.parentSession
      if (parent === undefined || !byId.has(parent)) break
      level += 1
      current = parent
    }
    depth.set(id, level)
    return level
  }
  return ids.sort((left, right) => depthOf(right) - depthOf(left))
}

function cachedTitle(cache, header) {
  if (cache === undefined) return ''
  try {
    const snapshot = cache.cachedSnapshot(header, ['title'])
    const title = snapshot?.values?.title
    return typeof title === 'string' ? title : ''
  } catch {
    return ''
  }
}

function cachedUpdatedAt(cache, header) {
  if (cache === undefined) return header.createdAt
  try {
    const snapshot = cache.cachedSnapshot(header, ['sessionListMetadata'])
    const metadata = snapshot?.values?.sessionListMetadata
    const lastPromptAt = metadata?.lastPromptAt
    return typeof lastPromptAt === 'number' ? lastPromptAt : header.createdAt
  } catch {
    return header.createdAt
  }
}

/** Normalized comparison key for a workspace path: canonical spelling, case-insensitive on Windows. */
function compareKey(path) {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * One pass over the session store: `<root>/<id>` and `<root>/<encoded-cwd>/<id>`
 * both resolve, so a batch never rescans the root per session.
 */
async function sessionDirectoryIndex(root) {
  const index = new Map()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return index
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (SESSION_ID.test(entry.name)) {
      index.set(entry.name, join(root, entry.name))
      continue
    }
    let children
    try {
      children = await readdir(join(root, entry.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (child.isDirectory() && SESSION_ID.test(child.name)) index.set(child.name, join(root, entry.name, child.name))
    }
  }
  return index
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Bodies must be declared JSON. A `text/plain` POST is a CORS *simple request*:
 * the browser sends it cross-origin without a preflight, which is exactly how a
 * hostile page would reach this port. Requiring JSON makes the browser preflight
 * first, and the preflight fails because no CORS headers are served.
 */
async function readJsonBody(req) {
  const type = String(req.headers['content-type'] ?? '').trim()
  if (!JSON_TYPE.test(type)) throw new HttpError(415, 'unsupported-content-type')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new HttpError(413, 'request-body-too-large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid-json')
  }
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

//#endregion
