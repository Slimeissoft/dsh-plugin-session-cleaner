/**
 * Session Cleaner — Client half.
 *
 * Adds a "会话清理" panel to the sidebar panel list and renders the management
 * page in the main column. Data, the trash and every write live in the Host
 * half; this module only renders and calls the package's four routes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-session-cleaner',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-cleaner'
    const BASE = '/session-cleaner'
    const CHUNK = 200

    const ZH = {
      'panel.title': '会话清理',
      'panel.desc': '按工作区分组列出本机全部会话。删除会把会话移入回收站并保留 {days} 天，期间随时可以恢复；只有清空回收站才会真正释放磁盘。',
      'action.selectAll': '全选',
      'action.refresh': '刷新',
      'action.delete': '移入回收站',
      'action.deleteOne': '删除',
      'action.restore': '恢复',
      'action.purge': '彻底删除',
      'action.purgeAll': '清空回收站',
      'action.working': '正在处理…',
      'summary.selected': '已选 {selected} / {total} 个可删除会话',
      'summary.size': '约 {size}',
      'summary.live': '另有 {count} 个会话正在使用，无法删除',
      'badge.live': '运行中',
      'badge.subagent': '子会话',
      'badge.archived': '已归档',
      'badge.pinned': '已置顶',
      'badge.activity.turn': '回合进行中',
      'badge.activity.job': '有任务在跑',
      'badge.activity.schedule': '有定时任务',
      'badge.activity.subagent': '子会话在跑',
      'untitled': '未命名会话',
      'empty': '当前没有可管理的会话。',
      'loading': '正在读取会话…',
      'error.list': '读取会话列表失败：{message}',
      'error.action': '操作失败：{message}',
      'confirm.one': '确定删除会话“{title}”吗？\n\n它会移到回收站并保留 {days} 天，期间可以恢复。',
      'confirm.many': '确定删除选中的 {count} 个会话吗？\n\n它们会移到回收站并保留 {days} 天，期间可以恢复。',
      'confirm.purgeOne': '彻底删除会话“{title}”吗？\n\n这会立刻删掉磁盘上的日志文件，无法撤销。',
      'confirm.purgeAll': '彻底清空回收站吗？\n\n{count} 项会话会被立刻删除，无法撤销。',
      'result.trashed': '已移入回收站 {count} 个会话（约 {size}），{days} 天内可恢复。',
      'result.purged': '已彻底删除 {count} 项，释放约 {size}。',
      'result.restored': '已恢复 {count} 个会话。',
      'result.cleaned': '{count} 个会话的日志早已不存在，已清理残留记录。',
      'result.failed': '{count} 项未能完成：{reasons}',
      'result.sep': '、',
      'reason.live': '有任务在运行',
      'reason.has-children': '还有子会话',
      'reason.not-found': '会话不存在',
      'reason.invalid-id': '无效的会话 ID',
      'reason.remove-failed': '文件操作失败',
      'reason.bookkeeping-failed': '工作区记录更新失败',
      'reason.not-in-trash': '回收站里没有这一项',
      'reason.restore-conflict': '原位置已有同名目录',
      'reason.restore-failed': '文件恢复失败',
      'trash.title': '回收站（{count} 项 · {size}）',
      'trash.hint': '删除的会话在这里保留 {days} 天，到期自动清理。',
      'trash.empty': '回收站是空的。',
      'trash.deletedAt': '删除于 {time}',
      'root.label': '会话存储位置：{path}',
    }

    const EN = {
      'panel.title': 'Session Cleaner',
      'panel.desc': 'Every session on this machine, grouped by workspace. Deleting moves a session to the recycle bin for {days} days, where it can be restored; only emptying the bin frees disk space.',
      'action.selectAll': 'Select all',
      'action.refresh': 'Refresh',
      'action.delete': 'Move to bin',
      'action.deleteOne': 'Delete',
      'action.restore': 'Restore',
      'action.purge': 'Delete forever',
      'action.purgeAll': 'Empty bin',
      'action.working': 'Working…',
      'summary.selected': '{selected} / {total} deletable sessions selected',
      'summary.size': 'about {size}',
      'summary.live': '{count} more are in use and cannot be deleted',
      'badge.live': 'Running',
      'badge.subagent': 'Subagent',
      'badge.archived': 'Archived',
      'badge.pinned': 'Pinned',
      'badge.activity.turn': 'turn in progress',
      'badge.activity.job': 'job running',
      'badge.activity.schedule': 'schedule active',
      'badge.activity.subagent': 'subagent running',
      'untitled': 'Untitled session',
      'empty': 'There are no sessions to manage.',
      'loading': 'Reading sessions…',
      'error.list': 'Could not read the session list: {message}',
      'error.action': 'Action failed: {message}',
      'confirm.one': 'Delete the session "{title}"?\n\nIt moves to the recycle bin for {days} days and can be restored meanwhile.',
      'confirm.many': 'Delete the {count} selected sessions?\n\nThey move to the recycle bin for {days} days and can be restored meanwhile.',
      'confirm.purgeOne': 'Delete the session "{title}" forever?\n\nThis removes its log files from disk immediately and cannot be undone.',
      'confirm.purgeAll': 'Empty the recycle bin?\n\n{count} sessions will be deleted immediately and cannot be recovered.',
      'result.trashed': 'Moved {count} sessions to the recycle bin (about {size}); restorable for {days} days.',
      'result.purged': 'Deleted {count} items permanently and freed about {size}.',
      'result.restored': 'Restored {count} sessions.',
      'result.cleaned': 'Cleared {count} leftover records whose logs were already gone.',
      'result.failed': '{count} could not be completed: {reasons}',
      'result.sep': ', ',
      'reason.live': 'work is running',
      'reason.has-children': 'has child sessions',
      'reason.not-found': 'not found',
      'reason.invalid-id': 'invalid id',
      'reason.remove-failed': 'file operation failed',
      'reason.bookkeeping-failed': 'workspace bookkeeping failed',
      'reason.not-in-trash': 'not in the recycle bin',
      'reason.restore-conflict': 'a directory already exists at the original path',
      'reason.restore-failed': 'file restore failed',
      'trash.title': 'Recycle bin ({count} items · {size})',
      'trash.hint': 'Deleted sessions stay here for {days} days and are then cleaned up automatically.',
      'trash.empty': 'The recycle bin is empty.',
      'trash.deletedAt': 'deleted {time}',
      'root.label': 'Session storage: {path}',
    }

    const CSS = `
      .sc-page { height: 100%; overflow-y: auto; padding: 28px 32px 48px; color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base); font-size: 13px; line-height: 1.5; }
      .sc-inner { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
      .sc-head { display: flex; flex-direction: column; gap: 6px; }
      .sc-title { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: 0.01em; }
      .sc-sub { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .sc-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1); position: sticky; top: 0; z-index: 2; }
      .sc-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
        color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
      .sc-count { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .sc-spacer { flex: 1 1 auto; }
      .sc-btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 7px; cursor: pointer;
        color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1); }
      .sc-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
      .sc-btn:disabled { opacity: 0.5; cursor: default; }
      .sc-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); background: transparent; }
      .sc-danger:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .sc-error { padding: 8px 10px; border-radius: 8px; font-size: 12px;
        color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-state-error-primary); }
      .sc-result { padding: 8px 10px; border-radius: 8px; font-size: 12px;
        color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; gap: 4px; }
      .sc-group { display: flex; flex-direction: column; gap: 6px; }
      .sc-group-head { display: flex; align-items: baseline; gap: 8px; padding: 4px 2px;
        border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .sc-group-title { font-size: 12.5px; font-weight: 600; }
      .sc-group-path { font-size: 11px; color: var(--dsw-alias-label-tertiary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-rows { display: flex; flex-direction: column; }
      .sc-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px;
        content-visibility: auto; contain-intrinsic-size: auto 54px; }
      .sc-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .sc-row-off .sc-row-title { color: var(--dsw-alias-label-tertiary); }
      .sc-row-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; }
      .sc-row-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .sc-badge { padding: 1px 6px; border-radius: 999px; font-size: 10.5px;
        border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
      .sc-badge-live { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
      .sc-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
      .sc-size { flex: none; font-size: 11.5px; color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums; }
      .sc-link { flex: none; font: inherit; font-size: 11.5px; padding: 3px 8px; border-radius: 6px;
        cursor: pointer; background: transparent; border: 1px solid transparent; }
      .sc-link:hover:not(:disabled) { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
      .sc-link:disabled { opacity: 0.5; cursor: default; }
      .sc-danger-text { color: var(--dsw-alias-state-error-primary); }
      .sc-muted { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .sc-trash { display: flex; flex-direction: column; gap: 6px; margin-top: 10px;
        padding: 12px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1); }
      .sc-trash-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .sc-trash-title { font-size: 12.5px; font-weight: 600; }
      .sc-foot { font-size: 11px; color: var(--dsw-alias-label-tertiary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `

    function detectLang() {
      try {
        const lang = String(navigator.language || '')
        if (lang.toLowerCase().startsWith('en')) return 'en'
      } catch {
        /* keep the product's default language */
      }
      return 'zh'
    }

    function makeTranslate(ctx) {
      let bound
      try {
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'session-cleaner locale')
          bound = locale.bind(NS)
        }
      } catch {
        bound = undefined
      }
      return function translate(key, params) {
        let text
        if (bound !== undefined) {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value !== '' && value !== key) text = value
          } catch {
            text = undefined
          }
        }
        if (text === undefined) text = (detectLang() === 'en' ? EN : ZH)[key]
        if (text === undefined) text = key
        if (params === undefined) return text
        return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      }
    }

    function formatSize(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
    }

    function formatTime(time) {
      if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return '—'
      try {
        return new Date(time).toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      } catch {
        return new Date(time).toISOString().slice(0, 16).replace('T', ' ')
      }
    }

    async function call(path, body) {
      const init = body === undefined
        ? { cache: 'no-store', credentials: 'same-origin' }
        : {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
      const response = await fetch(path, init)
      let data
      try {
        data = await response.json()
      } catch {
        data = undefined
      }
      if (data === undefined || data === null) throw new Error(`HTTP ${response.status}`)
      if (response.ok !== true || data.ok !== true) throw new Error(String(data.error || `HTTP ${response.status}`))
      return data
    }

    function chunk(list, size) {
      const chunks = []
      for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size))
      return chunks
    }

    function groupSessions(sessions) {
      const groups = new Map()
      for (const session of sessions) {
        const key = session.groupKey !== undefined && session.groupKey !== '' ? String(session.groupKey) : (session.cwd === null ? '' : String(session.cwd))
        let group = groups.get(key)
        if (group === undefined) {
          group = {
            key,
            title: session.workspaceTitle || (session.cwd === null ? '—' : String(session.cwd)),
            path: session.cwd,
            items: [],
          }
          groups.set(key, group)
        }
        group.items.push(session)
      }
      const ordered = [...groups.values()]
      ordered.sort((left, right) => left.title.localeCompare(right.title))
      for (const group of ordered) group.items.sort((left, right) => right.updatedAt - left.updatedAt)
      return ordered
    }

    function Panel({ t }) {
      const [sessions, setSessions] = React.useState([])
      const [trash, setTrash] = React.useState([])
      const [days, setDays] = React.useState(7)
      const [root, setRoot] = React.useState('')
      const [phase, setPhase] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [selected, setSelected] = React.useState({})
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setPhase('loading')
        setError('')
        try {
          const data = await call(`${BASE}/sessions`)
          setSessions(Array.isArray(data.sessions) ? data.sessions : [])
          setTrash(Array.isArray(data.trash) ? data.trash : [])
          setDays(typeof data.retentionDays === 'number' ? data.retentionDays : 7)
          setRoot(typeof data.sessionsRoot === 'string' ? data.sessionsRoot : '')
          setSelected({})
          setPhase('ready')
        } catch (cause) {
          setError(t('error.list', { message: String(cause && cause.message ? cause.message : cause) }))
          setPhase('ready')
        }
      }, [t])

      React.useEffect(() => {
        load()
      }, [load])

      const deletable = sessions.filter((session) => session.live !== true)
      const running = sessions.length - deletable.length
      const chosen = deletable.filter((session) => selected[session.id] === true)
      const chosenSize = chosen.reduce((total, session) => total + (session.sizeBytes || 0), 0)
      const allChosen = deletable.length > 0 && chosen.length === deletable.length
      const groups = groupSessions(sessions)
      const trashSize = trash.reduce((total, entry) => total + (entry.sizeBytes || 0), 0)

      function toggle(id) {
        setSelected((current) => {
          const next = { ...current }
          if (next[id] === true) delete next[id]
          else next[id] = true
          return next
        })
      }

      function toggleAll() {
        if (allChosen) {
          setSelected({})
          return
        }
        const next = {}
        for (const session of deletable) next[session.id] = true
        setSelected(next)
      }

      function summarize(results) {
        const done = results.filter((entry) => entry.ok === true)
        const failures = results.filter((entry) => entry.ok !== true)
        return { done, failures }
      }

      function failureText(failures) {
        if (failures.length === 0) return ''
        const reasons = [...new Set(failures.map((entry) => t(`reason.${entry.reason}`)))].join(t('result.sep'))
        return t('result.failed', { count: failures.length, reasons })
      }

      /** Activity kinds are an open set; an unknown one still means "busy". */
      function activityLabel(kind) {
        const key = `badge.activity.${kind}`
        const text = t(key)
        return text === key ? t('badge.live') : text
      }

      async function guarded(task) {
        setBusy(true)
        setError('')
        setNotice(null)
        try {
          await task()
          await load()
        } catch (cause) {
          setError(t('error.action', { message: String(cause && cause.message ? cause.message : cause) }))
        } finally {
          setBusy(false)
        }
      }

      async function remove(ids, titles) {
        if (ids.length === 0) return
        const confirmed = ids.length === 1
          ? window.confirm(t('confirm.one', { title: titles[0] || t('untitled'), days }))
          : window.confirm(t('confirm.many', { count: ids.length, days }))
        if (!confirmed) return
        await guarded(async () => {
          const results = []
          for (const batch of chunk(ids, CHUNK)) {
            const data = await call(`${BASE}/delete`, { sessionIds: batch })
            if (Array.isArray(data.results)) results.push(...data.results)
          }
          const { done, failures } = summarize(results)
          const trashed = done.filter((entry) => entry.trashed === true)
          const cleaned = done.filter((entry) => entry.trashed === false)
          const freed = trashed.reduce((total, entry) => total + (entry.trashedBytes || 0), 0)
          const lines = []
          if (trashed.length > 0) lines.push(t('result.trashed', { count: trashed.length, size: formatSize(freed), days }))
          if (cleaned.length > 0) lines.push(t('result.cleaned', { count: cleaned.length }))
          const failed = failureText(failures)
          if (failed !== '') lines.push(failed)
          setNotice(lines)
          setSelected({})
        })
      }

      async function restore(ids) {
        if (ids.length === 0) return
        await guarded(async () => {
          const results = []
          for (const batch of chunk(ids, CHUNK)) {
            const data = await call(`${BASE}/restore`, { sessionIds: batch })
            if (Array.isArray(data.results)) results.push(...data.results)
          }
          const { done, failures } = summarize(results)
          const lines = []
          if (done.length > 0) lines.push(t('result.restored', { count: done.length }))
          const failed = failureText(failures)
          if (failed !== '') lines.push(failed)
          setNotice(lines)
        })
      }

      async function purge(ids, titles) {
        const confirmed = ids === null
          ? window.confirm(t('confirm.purgeAll', { count: trash.length }))
          : ids.length === 1
            ? window.confirm(t('confirm.purgeOne', { title: titles[0] || t('untitled') }))
            : window.confirm(t('confirm.purgeAll', { count: ids.length }))
        if (!confirmed) return
        await guarded(async () => {
          const results = []
          const batches = ids === null ? [null] : chunk(ids, CHUNK)
          for (const batch of batches) {
            const data = await call(`${BASE}/purge`, batch === null ? { all: true } : { sessionIds: batch })
            if (Array.isArray(data.results)) results.push(...data.results)
          }
          const { done, failures } = summarize(results)
          const freed = done.reduce((total, entry) => total + (entry.freedBytes || 0), 0)
          const lines = []
          if (done.length > 0) lines.push(t('result.purged', { count: done.length, size: formatSize(freed) }))
          const failed = failureText(failures)
          if (failed !== '') lines.push(failed)
          setNotice(lines)
        })
      }

      const rows = []
      for (const group of groups) {
        const items = group.items.map((session) => {
          const isLive = session.live === true
          const badges = []
          if (isLive) {
            const kinds = Array.isArray(session.activity) ? session.activity : []
            const label = kinds.length === 0
              ? t('badge.live')
              : [...new Set(kinds.map(activityLabel))].join(t('result.sep'))
            badges.push(h('span', {
              key: 'live',
              className: 'sc-badge sc-badge-live',
              title: kinds.length === 0 ? t('badge.live') : label,
            }, label))
          }
          if (session.subagent) badges.push(h('span', { key: 'sub', className: 'sc-badge' }, t('badge.subagent')))
          if (session.archived) badges.push(h('span', { key: 'arc', className: 'sc-badge sc-badge-warn' }, t('badge.archived')))
          if (session.pinned) badges.push(h('span', { key: 'pin', className: 'sc-badge' }, t('badge.pinned')))
          return h('div', { key: session.id, className: `sc-row${isLive ? ' sc-row-off' : ''}` },
            h('input', {
              type: 'checkbox',
              checked: selected[session.id] === true,
              disabled: isLive || busy,
              onChange: () => toggle(session.id),
              'aria-label': session.title || t('untitled'),
            }),
            h('div', { className: 'sc-row-main' },
              h('div', { className: 'sc-row-title', title: session.title || t('untitled') }, session.title || t('untitled')),
              h('div', { className: 'sc-row-meta' },
                h('span', null, formatTime(session.updatedAt)),
                h('span', null, session.id),
                ...badges,
              ),
            ),
            h('span', { className: 'sc-size' }, formatSize(session.sizeBytes)),
            h('button', {
              type: 'button',
              className: 'sc-link sc-danger-text',
              disabled: isLive || busy,
              onClick: () => remove([session.id], [session.title]),
            }, t('action.deleteOne')),
          )
        })
        rows.push(h('section', { key: group.key, className: 'sc-group' },
          h('div', { className: 'sc-group-head' },
            h('span', { className: 'sc-group-title' }, group.title),
            h('span', { className: 'sc-group-path' }, group.path || ''),
          ),
          h('div', { className: 'sc-rows' }, ...items),
        ))
      }

      const trashRows = trash.map((entry) => h('div', { key: entry.id, className: 'sc-row' },
        h('div', { className: 'sc-row-main' },
          h('div', { className: 'sc-row-title' }, entry.title || t('untitled')),
          h('div', { className: 'sc-row-meta' },
            h('span', null, t('trash.deletedAt', { time: formatTime(entry.deletedAt) })),
            entry.workspaceTitle !== '' ? h('span', null, entry.workspaceTitle) : null,
            h('span', null, entry.id),
          ),
        ),
        h('span', { className: 'sc-size' }, formatSize(entry.sizeBytes)),
        h('button', {
          type: 'button',
          className: 'sc-link',
          disabled: busy,
          onClick: () => restore([entry.id]),
        }, t('action.restore')),
        h('button', {
          type: 'button',
          className: 'sc-link sc-danger-text',
          disabled: busy,
          onClick: () => purge([entry.id], [entry.title]),
        }, t('action.purge')),
      ))

      return h('div', { className: 'sc-page' },
        h('style', null, CSS),
        h('div', { className: 'sc-inner' },
          h('header', { className: 'sc-head' },
            h('h1', { className: 'sc-title' }, t('panel.title')),
            h('p', { className: 'sc-sub' }, t('panel.desc', { days })),
          ),
          h('div', { className: 'sc-toolbar' },
            h('label', { className: 'sc-check' },
              h('input', {
                type: 'checkbox',
                checked: allChosen,
                disabled: deletable.length === 0 || busy,
                onChange: toggleAll,
              }),
              h('span', null, t('action.selectAll')),
            ),
            h('span', { className: 'sc-count' }, t('summary.selected', { selected: chosen.length, total: deletable.length })),
            chosenSize > 0 ? h('span', { className: 'sc-count' }, t('summary.size', { size: formatSize(chosenSize) })) : null,
            running > 0 ? h('span', { className: 'sc-count' }, t('summary.live', { count: running })) : null,
            h('span', { className: 'sc-spacer' }),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              disabled: busy || phase === 'loading',
              onClick: load,
            }, t('action.refresh')),
            h('button', {
              type: 'button',
              className: 'sc-btn sc-danger',
              disabled: busy || chosen.length === 0,
              onClick: () => remove(chosen.map((session) => session.id), chosen.map((session) => session.title)),
            }, busy ? t('action.working') : t('action.delete')),
          ),
          error !== '' ? h('div', { className: 'sc-error' }, error) : null,
          notice !== null && notice.length > 0
            ? h('div', { className: 'sc-result' }, ...notice.map((line, index) => h('div', { key: index }, line)))
            : null,
          phase === 'loading' && sessions.length === 0
            ? h('div', { className: 'sc-muted' }, t('loading'))
            : groups.length === 0
              ? h('div', { className: 'sc-muted' }, t('empty'))
              : rows,
          h('section', { className: 'sc-trash' },
            h('div', { className: 'sc-trash-head' },
              h('span', { className: 'sc-trash-title' }, t('trash.title', { count: trash.length, size: formatSize(trashSize) })),
              h('span', { className: 'sc-count' }, t('trash.hint', { days })),
              h('span', { className: 'sc-spacer' }),
              h('button', {
                type: 'button',
                className: 'sc-btn sc-danger',
                disabled: busy || trash.length === 0,
                onClick: () => purge(null, []),
              }, t('action.purgeAll')),
            ),
            trash.length === 0
              ? h('div', { className: 'sc-muted' }, t('trash.empty'))
              : trashRows,
          ),
          root !== '' ? h('div', { className: 'sc-foot' }, t('root.label', { path: root })) : null,
        ),
      )
    }

    function PanelEntry(props) {
      return h(Panel, props)
    }

    function TrashIcon({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 20
      return h('svg', {
        width: edge, height: edge, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', { d: 'M4.5 7.5h15' }),
        h('path', { d: 'M9.5 7.5V5.6A1.6 1.6 0 0 1 11.1 4h1.8a1.6 1.6 0 0 1 1.6 1.6v1.9' }),
        h('path', { d: 'M6.8 7.5l.8 11.2A1.8 1.8 0 0 0 9.4 20.4h5.2a1.8 1.8 0 0 0 1.8-1.7l.8-11.2' }),
        h('path', { d: 'M10.3 10.8v5.4M13.7 10.8v5.4' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = makeTranslate(ctx)

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'session-cleaner',
          locale: NS,
        }, (props) => h(PanelEntry, { ...props, t }))), 'session-cleaner panel')

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'session-cleaner',
          order: 30,
          label: () => t('panel.title'),
          locale: NS,
        }, (props) => h(TrashIcon, { size: props.size }))), 'session-cleaner icon')
      },
    }
  },
})
