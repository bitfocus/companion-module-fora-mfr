/**
 * For.A MFR "Crosspoint remote control 2" protocol.
 *
 * Everything on the wire is hex. Router ports are zero based on the wire; this module converts to
 * zero based numbers at the boundary and only ever formats hex when building a command.
 */

export type NameKind = 'src' | 'dst'

export type Message =
	| { type: 'prompt' }
	| { type: 'videoFormat'; event: 'preset' | 'waiting' | 'applied' | 'cancelled' | 'rejected'; detail: string }
	| { type: 'cpu'; id: string }
	| { type: 'systemSize'; level: string; outputs: number; inputs: number }
	| { type: 'crosspoint'; level: string; dst: number; src: number }
	| { type: 'preset'; level: string; dst: number; src: number }
	| { type: 'name'; kind: NameKind; index: number; name: string }
	| { type: 'lock'; level: string; dst: number; id: string; mode: number }

/** The router sends this at the start of a line when it is ready for the next command */
export const PROMPT = '>'

/** Number of names the router returns for each `K?` request */
export const NAMES_PER_BLOCK = 32

/** Longest name the router accepts in a K: import command */
const MAX_NAME_BYTES = 128

export function toHex(value: number, width = 2): string {
	return value.toString(16).toUpperCase().padStart(width, '0')
}

/** Parse a hex option value such as '0A'. Returns undefined for anything that is not a hex number. */
export function parseHex(value: unknown): number | undefined {
	if (typeof value !== 'string' || !/^[0-9a-f]{1,3}$/i.test(value.trim())) return undefined
	return parseInt(value, 16)
}

export function decodeName(hex: string): string {
	return Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '').trim()
}

/** Names are imported as upper case hex of UTF-8 bytes */
export function encodeName(name: string): string {
	return Buffer.from(name, 'utf8').toString('hex').toUpperCase()
}

/** The longest start of `name` the router accepts, without cutting a character in half */
export function fitName(name: string): string {
	let fitted = ''
	let bytes = 0
	for (const char of name) {
		bytes += Buffer.byteLength(char, 'utf8')
		if (bytes > MAX_NAME_BYTES) break
		fitted += char
	}
	return fitted
}

// First recognisable response token on a line. Names are hex, so these can't appear inside the data.
const TOKEN = /(?:[SFAKWCV]:|W!|U[FR]!)/

const RE_CPU = /^A:(\S+)/
const RE_SIZE = /^F:([0-9A-F])[0-9A-F]+,[0-9A-F]+\/([0-9A-F]+),([0-9A-F]+)/i
const RE_XPT = /^S:([0-9A-F])([0-9A-F]+),([0-9A-F]+)/i
const RE_PRESET = /^V:([0-9A-F])([0-9A-F]+),([0-9A-F]+)/i
const RE_NAME = /^K:([SD])[AK]([0-9A-F]+),([0-9A-F]*)/i
const RE_LOCK = /^W!([0-9A-F])([0-9A-F]+),([^,]+),([0-2])/i
const RE_VIDEO = /^U([FR])!(.*)/i

// Replies that can run to many lines get the longer of the two timeouts the protocol asks for
const LONG_REPLY = /^@ (?:S\?|V\?|K\?|B:E|Z:)/
const SHORT_TIMEOUT_MS = 1000
const LONG_TIMEOUT_MS = 5000

/** How long to wait for the prompt after sending `command` */
export function commandTimeoutMs(command: string): number {
	return LONG_REPLY.test(command) ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS
}

/**
 * Parse one line received from the router, or the `PROMPT` from `LineBuffer`, into a message if
 * there is one to act on. `pendingCommand` is the command currently awaiting its prompt, if any.
 * Echoes and lines this module doesn't act on (C:, ...) produce no message.
 *
 * The router may not break the line between an echo and the first reply, so an echo is matched
 * by content and anything following it is still parsed.
 */
export function parseLine(line: string, pendingCommand?: string): Message | undefined {
	let body = line.trim()
	if (!body) return undefined
	if (body === PROMPT) return { type: 'prompt' }

	const pending = pendingCommand?.trim()
	if (pending && body.includes(pending)) {
		body = body.slice(body.indexOf(pending) + pending.length)
	} else if (body.startsWith('@') && !/^@\s*A:/.test(body)) {
		// an echo that doesn't match the pending command
		return undefined
	}

	return parseResponse(body)
}

/** A line `parseLine` made nothing of that isn't an echo, or a response this module knowingly ignores */
export function isUnrecognised(line: string, pendingCommand?: string): boolean {
	const body = line.trim()
	if (!body || body === PROMPT || body.startsWith('@')) return false
	const pending = pendingCommand?.trim()
	if (pending && body.includes(pending)) return false
	return !/^C:/i.test(body)
}

function parseResponse(text: string): Message | undefined {
	const start = text.search(TOKEN)
	if (start < 0) return undefined
	const body = text.slice(start)

	let m: RegExpExecArray | null
	if ((m = RE_XPT.exec(body))) {
		return { type: 'crosspoint', level: m[1], dst: parseInt(m[2], 16), src: parseInt(m[3], 16) }
	}
	if ((m = RE_PRESET.exec(body))) {
		return { type: 'preset', level: m[1], dst: parseInt(m[2], 16), src: parseInt(m[3], 16) }
	}
	if ((m = RE_NAME.exec(body))) {
		return {
			type: 'name',
			kind: m[1].toUpperCase() === 'S' ? 'src' : 'dst',
			index: parseInt(m[2], 16),
			name: decodeName(m[3]),
		}
	}
	if ((m = RE_LOCK.exec(body))) {
		return { type: 'lock', level: m[1], dst: parseInt(m[2], 16), id: m[3], mode: parseInt(m[4], 10) }
	}
	if ((m = RE_SIZE.exec(body))) {
		// the router reports highest port index, so size is index + 1
		return { type: 'systemSize', level: m[1], outputs: parseInt(m[2], 16) + 1, inputs: parseInt(m[3], 16) + 1 }
	}
	if ((m = RE_CPU.exec(body))) {
		return { type: 'cpu', id: m[1] }
	}
	if ((m = RE_VIDEO.exec(body))) {
		const detail = m[2].trim()
		if (m[1].toUpperCase() === 'F') return { type: 'videoFormat', event: 'preset', detail }
		if (detail === 'W') return { type: 'videoFormat', event: 'waiting', detail }
		if (detail === 'C') return { type: 'videoFormat', event: 'cancelled', detail }
		if (detail === 'E') return { type: 'videoFormat', event: 'rejected', detail }
		return { type: 'videoFormat', event: 'applied', detail }
	}
	return undefined
}

/**
 * Splits a TCP byte stream into lines. Messages can span packets, and several can share one.
 * A prompt is returned on its own as `PROMPT`: the router sends no line break after it, so it
 * would otherwise wait in the buffer, stuck to the front of the next echo.
 */
export class LineBuffer {
	#pending = ''
	#atLineStart = true

	push(chunk: Buffer | string): string[] {
		const lines: string[] = []
		for (const char of typeof chunk === 'string' ? chunk : chunk.toString('latin1')) {
			if (char === '\r' || char === '\n') {
				if (this.#pending.trim() !== '') lines.push(this.#pending)
				this.reset()
			} else if (this.#atLineStart && char === PROMPT) {
				lines.push(PROMPT)
				this.#atLineStart = false
			} else {
				this.#pending += char
				this.#atLineStart = false
			}
		}
		// a router that never sends a line break must not grow this without bound
		if (this.#pending.length > 4096) this.reset()
		return lines
	}

	reset(): void {
		this.#pending = ''
		this.#atLineStart = true
	}
}

/** Command builders. Each returns the command text without the terminator. */
export const Cmd = {
	cpuStatus: (): string => '@ A?',
	systemSize: (level: number): string => `@ F?${level}`,
	names: (kind: NameKind, offset: number): string => `@ K?${kind === 'src' ? 'S' : 'D'}A,${toHex(offset, 3)}`,
	crosspoints: (level: string): string => `@ S?${level}`,
	lockStatus: (level: string, dst: number): string => `@ W?${level},${toHex(dst)}`,
	cut: (level: string, dst: number, src: number): string => `@ X:${level}/${toHex(dst)},${toHex(src)}`,
	preset: (level: string, dst: number, src: number): string => `@ P:${level}/${toHex(dst)},${toHex(src)}`,
	presetStatus: (level: string): string => `@ V?${level}`,
	clearPresets: (): string => '@ B:C',
	cutPresets: (): string => '@ B:E',
	setVideoFormat: (format: string, reference: string, point: string): string => `@ UF:${format}/${reference},${point}`,
	applyVideoFormat: (): string => '@ UE:A',
	cancelVideoFormat: (): string => '@ UE:C',
	rename: (kind: NameKind, index: number, name: string): string =>
		`@ K:${kind === 'src' ? 'S' : 'D'}A${toHex(index, 3)},${encodeName(name)}`,
	lock: (level: string, dst: number, routerId: string, mode: string): string =>
		`@ W:${level}/${toHex(dst)},${routerId},${mode}`,
}
