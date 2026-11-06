# Session Cleaner

English | [中文](README.md)

A DSH Web plugin that lists every session on your machine grouped by workspace, so you can delete the ones you no longer need in bulk and free disk space. Deleting moves a session to a recycle bin where it stays restorable for 7 days.

> Community plugin, not affiliated with DeepSeek. MIT licensed.

## What it does

- Adds a trash-can icon at the bottom of the sidebar; clicking it opens the panel in the main column.
- Lists sessions grouped by workspace path, with title, last update, size, session id, and badges for running / subagent / archived / pinned.
- Select all, select many, or delete one at a time. Requests are batched automatically past 200 ids.
- **Delete moves the session directory into `<DSH_HOME>/session-cleaner/trash/<id>/`** and drops its workspace record. The session disappears from the list while its log file keeps sitting in the bin.
- The bin at the bottom of the panel lists deleted sessions, each with **Restore** and **Delete forever**; entries older than 7 days are swept the next time the panel opens.
- Only **Empty bin** physically removes files, and that cannot be undone.
- Running sessions cannot be deleted — the checkbox is disabled. Two signals count: the Agent status is `running`, or the `workspace/session-activity` waterfall reports a live turn, job, or schedule.
- A session that was merely *loaded* by the UI is not running: the session controller keeps a scope for everything a client has displayed. Those rows carry a grey **Open** badge and stay deletable.
- A session with children cannot be deleted alone; selecting parent and children together deletes the children first.
- Stale archive entries (session file already gone) are cleaned up on the next delete attempt.

## How it works

The Host half (`index.js`) registers four routes on the web server:

| Route | Purpose |
|---|---|
| `GET /session-cleaner/sessions` | `sessionPersistence.list()`, titles from the projection cache, the workspace registry, the activity gate, plus the bin contents |
| `POST /session-cleaner/delete` | validate ids → refuse running / has-children → rename into the bin with a `.json` sidecar → `workspace.detachSession()`; a bookkeeping failure renames the directory back |
| `POST /session-cleaner/restore` | rename the directory back to its original parent → `attachSession()`, restoring the archived and pinned flags |
| `POST /session-cleaner/purge` | remove bin entries (given ids, or `{ "all": true }`) |

The Client half (`client.js`) registers the `main` panel and the `sidebar.panellist` icon; it only renders and calls those routes.

### Admission

The plugin registers its own path prefix, and `webServer` does not authenticate it — the kernel's own `/api` handler calls `connection.admit(req)` itself. Every request here therefore passes the same fence:

1. When the composition mounts a `connection` service, its decision wins (it knows the browser-auth cookie); a service error is a hard 503, never a downgrade.
2. Without it, the structural fence applies: loopback `Host` only, `sec-fetch-site: cross-site` refused, and `Origin`/`Referer` must match the `Host` authority (the desktop `dsh-app://app` relay is the only exception).
3. Write bodies must be `application/json` — that forces a CORS preflight, which fails because the server sends no CORS headers, closing the "any web page can POST a delete" hole.

## Install

```powershell
dsh plugin add github:Slimeissoft/dsh-plugin-session-cleaner
```

Or from a local checkout:

```powershell
dsh plugin add D:\CODE\harnes\dsh-plugin-session-cleaner
```

Restart DSH afterwards. The Host half is `index.js`, the browser half is `client.js`; both ship in the same package.

### Install from a plugin market

This repository ships its own index at `market/index.json`. Enable GitHub Pages (branch `main`, directory `/`), then add

```
https://slimeissoft.github.io/dsh-plugin-session-cleaner/market/index.json
```

as an index source under **Plugins → Discover → Add index source**, and the plugin becomes searchable and one-click installable.

## Compatibility

Built and tested against **DSH 0.2.1-rc.5**. It depends on host services (`sessionPersistence`, `workspaceRegistry`, the `workspace/session-activity` waterfall); if those contracts move in a later release, the plugin needs to follow.

## Notes

- Deleting also removes the workspace record; the file stays in the bin for 7 days.
- Purging is irreversible.
- Stale rows in the projection cache and search index fall away once the session is missing; they do not break anything.
- Session storage defaults to `%DSH_HOME%\sessions` (`~/.dsh/sessions` when unset); the panel footer shows the resolved path, and the bin lives beside it in `session-cleaner/trash`.

## License

MIT
