import type { CompanionHTTPRequest, CompanionHTTPResponse } from '@companion-module/base'
import { portNumber, type NameKind } from './protocol.js'
import type { RouterState } from './state.js'

export interface NamesHost {
	readonly state: RouterState
	readonly connected: boolean
	/** How many more commands the module can queue */
	readonly queueSpace: number
	rename(kind: NameKind, value: string, name: string): void
	log(message: string): void
}

/** The commands queued by one rename: the rename and the read-back */
const RENAME_COMMANDS = 2

const json = (status: number, body: unknown): CompanionHTTPResponse => ({
	status,
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
})

const portCount = (state: RouterState, kind: NameKind): number => (kind === 'dst' ? state.dstCount : state.srcCount)

function listNames(host: NamesHost): CompanionHTTPResponse {
	const { state } = host
	const names = (kind: NameKind): string[] =>
		Array.from({ length: portCount(state, kind) }, (_, index) =>
			kind === 'dst' ? state.dstName(index) : state.srcName(index),
		)
	return json(200, { connected: host.connected, dst: names('dst'), src: names('src') })
}

/** Companion answers cross-origin requests, so a web page elsewhere must not be able to rename ports */
function fromAnotherSite(request: CompanionHTTPRequest): boolean {
	const { origin, host } = request.headers
	if (!origin) return false
	try {
		return new URL(origin).host !== host
	} catch {
		return true
	}
}

/** All or nothing: one bad row sends nothing, so a mistake can't leave the router half renamed */
function applyNames(host: NamesHost, request: CompanionHTTPRequest): CompanionHTTPResponse {
	if (fromAnotherSite(request)) return json(403, { error: 'Requests from another site are not allowed' })
	if (!host.connected) return json(503, { error: 'Not connected to the router' })

	// typed as a string, but Companion has already parsed a body sent as JSON
	const body: unknown = request.body
	let changes: unknown
	try {
		changes = (typeof body === 'string' ? (JSON.parse(body) as { changes?: unknown }) : (body as { changes?: unknown }))
			?.changes
	} catch {
		return json(400, { error: 'The request is not valid JSON' })
	}
	if (!Array.isArray(changes)) return json(400, { error: 'The request has no list of changes' })

	const valid: { kind: NameKind; index: number; name: string }[] = []
	for (const change of changes as { kind?: unknown; port?: unknown; name?: unknown }[]) {
		const { kind, port, name } = change ?? {}
		const label = `${String(kind)} ${String(port)}`
		if ((kind !== 'dst' && kind !== 'src') || typeof port !== 'number' || !Number.isInteger(port)) {
			return json(400, { error: `Unknown port: ${label}` })
		}
		if (port < 1 || port > portCount(host.state, kind)) return json(400, { error: `No such port: ${label}` })
		if (typeof name !== 'string' || !name.trim()) return json(400, { error: `Empty name for ${label}` })
		valid.push({ kind, index: port - 1, name })
	}
	// each rename is sent with a read-back; refuse the lot rather than send only some
	if (valid.length * RENAME_COMMANDS > host.queueSpace) {
		return json(503, { error: 'Too many names at once, apply them in smaller batches' })
	}
	if (valid.length) host.log(`Names page: sending ${valid.length} name${valid.length === 1 ? '' : 's'}`)
	for (const { kind, index, name } of valid) host.rename(kind, portNumber(index), name)
	return json(200, { sent: valid.length })
}

/** The table of port names, served by Companion at /instance/<connection label>/ */
export function handleNamesRequest(host: NamesHost, request: CompanionHTTPRequest): CompanionHTTPResponse {
	const path = request.path.replace(/\/+$/, '')
	if (path === '' && request.method === 'GET') {
		return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: PAGE }
	}
	if (path === '/names' && request.method === 'GET') return listNames(host)
	if (path === '/names' && request.method === 'POST') return applyNames(host, request)
	return json(404, { error: 'Not found' })
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MFR port names</title>
<style>
:root { color-scheme: light dark; --line: #8884; --changed: #ff800033; --bad: #d33; --good: #2a8a3a; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: Canvas; border-bottom: 1px solid var(--line); }
h1 { font-size: 16px; margin: 0 auto 0 0; }
button { font: inherit; padding: 4px 12px; }
#message { width: 100%; }
#message:empty { display: none; }
.problem { color: var(--bad); }
main { padding: 0 16px 24px; }
details { margin-top: 12px; max-width: 800px; }
summary { cursor: pointer; font-size: 15px; font-weight: 600; padding: 4px 0; }
summary .count { font-weight: 400; }
summary .waiting { color: #c60; font-weight: 400; }
table { border-collapse: collapse; width: 100%; max-width: 800px; }
th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); }
th.port { width: 5.5em; white-space: nowrap; font-weight: 500; }
td.current { width: 30%; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
td.status { width: 30%; }
input { font: inherit; width: 100%; padding: 2px 6px; }
tr.changed { background: var(--changed); }
.saved { color: var(--good); }
@media (max-width: 600px) {
	html, body { max-width: 100vw; overflow-x: clip; }
	header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
	main, details, table, tbody, tr, th, td, input { min-width: 0; max-width: 100%; }
	h1, #message { grid-column: 1 / -1; }
	button { min-width: 0; }
	thead { display: none; }
	table, tbody { display: block; }
	tr { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 2px 8px; align-items: baseline; padding: 6px 4px; border-bottom: 1px solid var(--line); }
	th, td { padding: 0; border: 0; }
	th.port, td.current, td.status { width: auto; }
	td.edit, td.status { grid-column: 1 / -1; }
	td.status:empty { display: none; }
	input { font-size: 16px; padding: 6px; }
}
</style>
</head>
<body>
<header>
<h1>MFR port names</h1>
<button id="apply" disabled>Apply</button>
<button id="clear">Clear</button>
<button id="revert" disabled title="Fill in the names from before the last Apply">Revert last Apply</button>
<button id="copy" title="Copy every port and name, to paste into a spreadsheet">Copy all</button>
<div id="message"></div>
</header>
<main>
<details id="section-dst" open>
<summary>Destinations <span class="count"></span> <span class="waiting"></span></summary>
<table>
<thead><tr><th>Port</th><th>On the router</th><th>New name</th><th></th></tr></thead>
<tbody></tbody>
</table>
</details>
<details id="section-src" open>
<summary>Sources <span class="count"></span> <span class="waiting"></span></summary>
<table>
<thead><tr><th>Port</th><th>On the router</th><th>New name</th><th></th></tr></thead>
<tbody></tbody>
</table>
</details>
</main>
<script>
const base = location.pathname.replace(/\/?$/, '/') + 'names'
const REPLY_TIMEOUT_MS = 20000
const rows = new Map()
const order = []
let connected = false
let lastApplied = new Map()

const $ = (id) => document.getElementById(id)
const key = (kind, port) => kind + ' ' + port
const label = (kind, port) => kind.toUpperCase() + ' ' + port

function say(text, problem) {
	$('message').textContent = text
	$('message').className = problem ? 'problem' : ''
}

function refreshRow(row) {
	const value = row.input.value.trim()
	const changed = value !== '' && value !== row.name
	row.tr.classList.toggle('changed', changed || row.waiting !== undefined)
	row.changed = changed
	$('apply').disabled = !connected || !order.some((r) => r.changed)
	refreshSection(row.kind)
}

/** A folded section still says how many ports it has and how many changes are waiting for Apply */
function refreshSection(kind) {
	const section = $('section-' + kind)
	const inSection = order.filter((row) => row.kind === kind)
	const changed = inSection.filter((row) => row.changed).length
	section.querySelector('.count').textContent = '(' + inSection.length + ')'
	section.querySelector('.waiting').textContent = changed ? changed + ' to apply' : ''
}

function restoreFolding() {
	for (const kind of ['dst', 'src']) {
		const section = $('section-' + kind)
		const key = 'fold-' + kind
		try {
			if (localStorage.getItem(key) === 'closed') section.open = false
		} catch {}
		section.addEventListener('toggle', () => {
			try {
				localStorage.setItem(key, section.open ? 'open' : 'closed')
			} catch {}
		})
	}
}

function setStatus(row, text, className) {
	row.status.textContent = text
	row.status.className = 'status ' + (className || '')
}

function addRow(kind, port) {
	const tr = document.createElement('tr')
	const th = document.createElement('th')
	th.className = 'port'
	th.textContent = label(kind, port)
	const current = document.createElement('td')
	current.className = 'current'
	const edit = document.createElement('td')
	edit.className = 'edit'
	const input = document.createElement('input')
	input.setAttribute('aria-label', 'New name for ' + label(kind, port))
	edit.append(input)
	const status = document.createElement('td')
	status.className = 'status'
	tr.append(th, current, edit, status)
	$('section-' + kind).querySelector('tbody').append(tr)
	const row = { kind, port, tr, current, input, status, name: '', changed: false }
	input.addEventListener('input', () => {
		setStatus(row, '')
		refreshRow(row)
	})
	input.addEventListener('paste', (event) => {
		const text = event.clipboardData.getData('text')
		if (!/[\r\n\t]/.test(text.trim()) && !parseKeyed(text)) return
		event.preventDefault()
		pasteFrom(row, text)
	})
	rows.set(key(kind, port), row)
	order.push(row)
}

/** "DST 1 = Name", or two columns from a spreadsheet: "DST 1<tab>Name" */
function parseKeyed(line) {
	const m = /^\s*(dst|src)[\s-]*0*(\d+)\s*(?:=|\t|,)\s*(.*?)\s*$/i.exec(line)
	return m ? { row: rows.get(key(m[1].toLowerCase(), Number(m[2]))), name: m[3], known: true } : undefined
}

/** Keyed lines go to their own port; plain lines fill downward from the cell pasted into, within its section */
function pasteFrom(start, text) {
	const section = order.filter((row) => row.kind === start.kind)
	let index = section.indexOf(start)
	let missed = 0
	for (const line of text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')) {
		const keyed = parseKeyed(line)
		if (keyed) {
			if (keyed.row) {
				keyed.row.input.value = keyed.name
				setStatus(keyed.row, '')
				refreshRow(keyed.row)
			} else {
				missed++
			}
			continue
		}
		const row = section[index++]
		if (!row) {
			missed++
			continue
		}
		row.input.value = line.split('\t').pop().trim()
		setStatus(row, '')
		refreshRow(row)
	}
	say(missed ? missed + ' pasted line(s) did not match a port and were ignored' : '', missed > 0)
}

function checkWaiting(row) {
	const waiting = row.waiting
	if (!waiting) return
	if (row.name === waiting.sent) {
		row.waiting = undefined
		row.input.value = ''
		setStatus(row, 'Saved', 'saved')
	} else if (row.name !== waiting.previous) {
		row.waiting = undefined
		row.input.value = ''
		setStatus(row, 'Router kept "' + row.name + '"', 'problem')
	} else if (Date.now() - waiting.at > REPLY_TIMEOUT_MS) {
		row.waiting = undefined
		setStatus(row, 'No reply: press Apply to retry', 'problem')
	}
	refreshRow(row)
}

async function refresh() {
	let data
	try {
		const response = await fetch(base)
		if (!response.ok) throw new Error(String(response.status))
		data = await response.json()
	} catch {
		connected = false
		say('Cannot reach Companion. Retrying...', true)
		$('apply').disabled = true
		return
	}
	connected = data.connected
	if (!connected) say('Companion is not connected to the router. Names may be out of date.', true)
	else if ($('message').className === 'problem' && /not connected|Cannot reach/.test($('message').textContent)) say('')
	for (const kind of ['dst', 'src']) {
		data[kind].forEach((name, index) => {
			const port = index + 1
			if (!rows.has(key(kind, port))) addRow(kind, port)
			const row = rows.get(key(kind, port))
			row.name = name
			row.current.textContent = name
			checkWaiting(row)
			refreshRow(row)
		})
	}
}

$('apply').addEventListener('click', async () => {
	const changes = order.filter((row) => row.changed)
	if (!changes.length) return
	$('apply').disabled = true
	let response
	try {
		response = await fetch(base, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				changes: changes.map((row) => ({ kind: row.kind, port: row.port, name: row.input.value.trim() })),
			}),
		})
	} catch {
		say('Cannot reach Companion, nothing was sent.', true)
		refreshRow(changes[0])
		return
	}
	if (!response.ok) {
		const reply = await response.json().catch(() => ({}))
		say('Nothing was sent: ' + (reply.error || response.status), true)
		refreshRow(changes[0])
		return
	}
	lastApplied = new Map(changes.map((row) => [row, row.name]))
	$('revert').disabled = false
	const at = Date.now()
	for (const row of changes) {
		row.waiting = { sent: row.input.value.trim(), previous: row.name, at }
		setStatus(row, 'Sent, waiting for the router...')
	}
	say('Sent ' + changes.length + ' name(s).')
	refresh()
})

$('clear').addEventListener('click', () => {
	for (const row of order) {
		if (row.waiting) continue
		row.input.value = ''
		setStatus(row, '')
		refreshRow(row)
	}
	say('')
})

$('revert').addEventListener('click', () => {
	for (const [row, previous] of lastApplied) {
		row.input.value = previous
		setStatus(row, 'Press Apply to restore')
		refreshRow(row)
	}
	say('The old names are filled in. Press Apply to send them.')
})

$('copy').addEventListener('click', async () => {
	const text = order.map((row) => label(row.kind, row.port) + '\t' + row.name).join('\n')
	try {
		await navigator.clipboard.writeText(text)
		say('Copied ' + order.length + ' ports.')
	} catch {
		// the clipboard needs a secure page, which a plain http address on the network isn't
		const area = document.createElement('textarea')
		area.value = text
		document.body.append(area)
		area.select()
		const copied = document.execCommand('copy')
		area.remove()
		say(copied ? 'Copied ' + order.length + ' ports.' : 'The browser would not allow copying.', !copied)
	}
})

restoreFolding()
refresh()
setInterval(refresh, 2000)
</script>
</body>
</html>
`
