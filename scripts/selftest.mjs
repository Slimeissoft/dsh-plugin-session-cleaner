/**
 * Self-test for the Host half, no test runner and no real DSH needed.
 *
 * Builds a throwaway DSH_HOME, fabricates the services the plugin touches, and
 * drives the registered HTTP routes directly: the fence, the trash cycle, the
 * parent/child ordering, and the rollback when workspace bookkeeping fails.
 *
 *   node scripts/selftest.mjs
 */
import { mkdtemp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const results = []
function check(name, condition, extra) {
  results.push({ name, pass: Boolean(condition) })
  if (!condition) console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra))
}

const SESSION_A = 'session-11111111-2222-3333-4444-555555555555'
const SESSION_B = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const encoded = '--D-CODE-demo--'
const ORIGIN = 'http://127.0.0.1:5173'

/** Install one fake context and hand back a `call(method, path, body)` driver. */
async function harness({ sessions, failDetach = false }) {
  const home = await mkdtemp(join(tmpdir(), 'session-cleaner-test-'))
  process.env.DSH_HOME = home
  const { apply, sessionsRoot } = await import(`../index.js?t=${Date.now()}-${Math.random()}`)
  const root = sessionsRoot()

  for (const header of sessions) {
    await mkdir(join(root, encoded, header.id), { recursive: true })
    await writeFile(join(root, encoded, header.id, 'session.v4.jsonl.zstd'), 'x'.repeat(1024))
  }

  const handlers = []
  const seen = { detached: [], attached: [] }
  const workspace = {
    id: 'ws-1',
    path: 'D:\\CODE\\demo',
    title: 'demo',
    sessionIds: sessions.map((header) => header.id),
    detachSession: async (id) => {
      if (failDetach) throw new Error('registry write failed')
      seen.detached.push(id)
      workspace.sessionIds = workspace.sessionIds.filter((value) => value !== id)
    },
    attachSession: async (id) => {
      seen.attached.push(id)
      if (!workspace.sessionIds.includes(id)) workspace.sessionIds = [...workspace.sessionIds, id]
    },
  }
  const registry = {
    archivedSessionIds: [],
    pinnedSessionIds: [],
    list: () => [workspace],
    get: () => workspace,
    unarchiveSession: async () => {},
    archiveSession: async () => {},
    pinSession: async () => {},
  }
  const state = { activity: [] }

  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { handlers.push(route); return () => {} } },
    sessionPersistence: {
      list: async () => {
        const headers = new Map(sessions.map((header) => [header.id, header]))
        const listed = []
        for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          for (const child of await readdir(join(root, entry.name), { withFileTypes: true })) {
            const header = headers.get(child.name)
            if (header !== undefined) listed.push({ header, sizeBytes: 1024, formatStatus: 'current' })
          }
        }
        return listed
      },
    },
    get: (name) => ({ workspaceRegistry: registry, connection: undefined })[name],
    waterfall: async () => state.activity,
  }

  apply(ctx)
  const route = handlers[0]

  async function call(method, path, { body, headers } = {}) {
    const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    stream.method = method
    stream.url = path
    stream.headers = headers ?? {
      host: '127.0.0.1:5173',
      origin: ORIGIN,
      'content-type': 'application/json',
    }
    const res = {
      statusCode: 0,
      headers: {},
      headersSent: false,
      setHeader(name, value) { this.headers[name] = value },
      end(value) { this.body = value; this.headersSent = true },
    }
    await new Promise((resolve) => {
      route.handler(stream, res)
      setTimeout(resolve, 60)
    })
    let data
    try { data = JSON.parse(res.body) } catch { data = undefined }
    return { status: res.statusCode, data }
  }

  return { home, root, call, seen, state, workspace }
}

//#region happy path
{
  const sessions = [
    { id: SESSION_A, cwd: 'D:\\CODE\\demo', createdAt: 1 },
    { id: SESSION_B, cwd: 'D:\\CODE\\demo', createdAt: 2 },
  ]
  const { home, root, call, seen, state } = await harness({ sessions })

  let r = await call('GET', '/session-cleaner/sessions')
  check('list returns every session', r.status === 200 && r.data.sessions.length === 2, r.data)
  check('list reports the retention window', r.data.retentionDays === 7)
  check('trash starts empty', r.data.trash.length === 0)

  r = await call('GET', '/session-cleaner/sessions', { headers: { host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' } })
  check('cross-site read is refused', r.status === 403, r)

  r = await call('GET', '/session-cleaner/sessions', { headers: { host: 'evil.example:5173' } })
  check('non-loopback host is refused', r.status === 403, r)

  r = await call('POST', '/session-cleaner/delete', {
    body: { sessionIds: [SESSION_A] },
    headers: { host: '127.0.0.1:5173', origin: ORIGIN },
  })
  check('non-JSON body is refused', r.status === 415, r)

  r = await call('POST', '/session-cleaner/delete', { body: { sessionIds: [SESSION_A] } })
  check('delete reports a trash move', r.data.results[0].ok === true && r.data.results[0].trashed === true, r.data)
  check('workspace detached after the move', seen.detached.includes(SESSION_A))
  check('session directory left the store', await stat(join(root, encoded, SESSION_A)).then(() => false, () => true))
  check('trash holds the directory', await stat(join(home, 'session-cleaner', 'trash', SESSION_A, 'session.v4.jsonl.zstd')).then(() => true, () => false))
  check('trash holds the metadata', await stat(join(home, 'session-cleaner', 'trash', `${SESSION_A}.json`)).then(() => true, () => false))

  r = await call('GET', '/session-cleaner/sessions')
  check('trash is listed', r.data.trash.length === 1 && r.data.trash[0].id === SESSION_A, r.data.trash)
  check('one session remains', r.data.sessions.length === 1)

  state.activity = [{ kind: 'turn' }]
  r = await call('POST', '/session-cleaner/delete', { body: { sessionIds: [SESSION_B] } })
  check('busy session is refused', r.data.results[0].reason === 'live', r.data)
  state.activity = []

  r = await call('POST', '/session-cleaner/restore', { body: { sessionIds: [SESSION_A] } })
  check('restore succeeds', r.data.results[0].ok === true, r.data)
  check('session directory is back', await stat(join(root, encoded, SESSION_A, 'session.v4.jsonl.zstd')).then(() => true, () => false))
  check('workspace re-attached', seen.attached.includes(SESSION_A))
  check('trash metadata removed', await stat(join(home, 'session-cleaner', 'trash', `${SESSION_A}.json`)).then(() => false, () => true))

  await call('POST', '/session-cleaner/delete', { body: { sessionIds: [SESSION_A] } })
  r = await call('POST', '/session-cleaner/purge', { body: { all: true } })
  check('purge succeeds', r.data.results[0].ok === true, r.data)
  check('trash entry removed', await stat(join(home, 'session-cleaner', 'trash', SESSION_A)).then(() => false, () => true))

  r = await call('GET', '/session-cleaner/nope')
  check('unknown route answers 404', r.status === 404)
}
//#endregion

//#region ordering and rollback
{
  const parent = 'session-11111111-1111-1111-1111-111111111111'
  const child = 'session-22222222-2222-2222-2222-222222222222'
  const tree = [
    { id: parent, cwd: 'D:\\CODE\\demo', createdAt: 1 },
    { id: child, cwd: 'D:\\CODE\\demo', createdAt: 2, parentSession: parent },
  ]

  const { root, call } = await harness({ sessions: tree })

  let r = await call('POST', '/session-cleaner/delete', { body: { sessionIds: [parent] } })
  check('parent is refused while a child exists', r.data.results[0].reason === 'has-children' && r.data.results[0].children === 1, r.data)

  r = await call('POST', '/session-cleaner/delete', { body: { sessionIds: [parent, child] } })
  check('a whole tree deletes', r.data.results.every((entry) => entry.ok === true), r.data)
  check('the child is removed first', r.data.results[0].id === child, r.data.results.map((entry) => entry.id))
  check('both directories left the store', await stat(join(root, encoded, parent)).then(() => false, () => true))
}

{
  const broken = 'session-33333333-3333-3333-3333-333333333333'
  const { home, root, call, workspace } = await harness({
    failDetach: true,
    sessions: [{ id: broken, cwd: 'D:\\CODE\\demo', createdAt: 3 }],
  })

  const r = await call('POST', '/session-cleaner/delete', { body: { sessionIds: [broken] } })
  check('bookkeeping failure is reported', r.data.results[0].reason === 'bookkeeping-failed', r.data)
  check('the directory is rolled back', await stat(join(root, encoded, broken, 'session.v4.jsonl.zstd')).then(() => true, () => false))
  check('no residue in the trash', await stat(join(home, 'session-cleaner', 'trash', broken)).then(() => false, () => true))
  check('the workspace still owns it', workspace.sessionIds.includes(broken))
}
//#endregion

const failed = results.filter((entry) => !entry.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
