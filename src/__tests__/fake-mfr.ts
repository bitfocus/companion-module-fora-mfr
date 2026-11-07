/**
 * A fake For.A MFR router for tests and `yarn fake-router`: a real TCP server that answers the
 * "Crosspoint remote control 2" protocol byte for byte the way a real router was measured to.
 *
 * Test fixture only. It lives in `src/__tests__/`, which the build excludes, so it never ships.
 *
 * Measured behaviour reproduced here (`\r` and `\n` are literal bytes, commands end with `\r`):
 * - the echo of each command, then the reply, then the prompt `>` with no line break after it
 * - `F?` puts its reply after a single `\r`; every other reply starts on a new line
 * - `X:` and `B:E` answer with the prompt first, then push `C:`/`S:` to every connected client
 * - `W:` answers directly, then pushes one `W!` line per level to every connected client
 * - routes staged with `P:` belong to the connection that staged them
 * - a cut to a destination locked with mode 1 is refused
 * - a salvo leaves a locked destination's route alone and still drops its staged route
 * - a name written with `K:` loses its non-ASCII bytes and is kept to 16 characters
 * - more connections than `maxClients` are reset (the limit of 2 is inferred, not documented)
 *
 * Where the measurements say nothing (several routes taken in one salvo), the behaviour here is
 * a best guess and the tests don't rely on it.
 */
import net from 'node:net'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'

/** Longest name the measured router kept, whatever the protocol's 128 byte limit allows */
const MAX_STORED_NAME = 16

const LEVEL_COUNT = 8
const NAMES_PER_BLOCK = 32

export type Size = { dst: number; src: number }
export type Lock = { id: string; mode: number }

export interface FakeMfrOptions {
	/** Size of each level. Levels not listed answer `F?` with no size. Default: level 0, 40 x 36 */
	levels?: Record<number, Size>
	/** The unit ID the router reports for `A?` and uses in `C:` responses */
	unitId?: string
	/** Connections beyond this are reset */
	maxClients?: number
}

/** Unpadded upper case hex, as the router writes ports in S:, V:, C: and W! responses */
const hex = (value: number): string => value.toString(16).toUpperCase()
const hexPad = (value: number, width: number): string => hex(value).padStart(width, '0')

/**
 * How long `until` waits by default. Well under vitest's 5 s test timeout, so a wait that never ends
 * fails with its own message rather than as a timed out test.
 */
export const UNTIL_TIMEOUT_MS = 2000

/**
 * Wait for `predicate` without relying on `setTimeout`, so it still works while a test fakes the
 * timers. Gives the event loop a turn between checks.
 */
export async function until(predicate: () => boolean, what = 'condition', timeoutMs = UNTIL_TIMEOUT_MS): Promise<void> {
	const deadline = performance.now() + timeoutMs
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
		await nextTurn()
	}
}

/** Pauses one reply part way through, so a test can look at what the client did with the first part */
export class Hold {
	readonly #matches: (command: string) => boolean
	readonly at: number
	#claimed = false
	#reached = false
	#isReleased = false
	#release: (() => void) | undefined
	readonly #released: Promise<void>
	readonly #onRelease: (hold: Hold) => void

	constructor(matches: (command: string) => boolean, at: number, onRelease: (hold: Hold) => void = () => undefined) {
		this.#matches = matches
		this.at = at
		this.#onRelease = onRelease
		this.#released = new Promise((resolve) => (this.#release = resolve))
	}

	/** Not yet given to a reply, and this command is the one to hold */
	matches(command: string): boolean {
		return !this.#claimed && !this.#isReleased && this.#matches(command)
	}

	/** @internal called by the router when a reply takes this hold */
	claim(): void {
		this.#claimed = true
	}

	/** True once the first `at` bytes of the reply have been written */
	get reached(): boolean {
		return this.#reached
	}

	/** @internal called by the connection */
	async pause(): Promise<void> {
		this.#reached = true
		await this.#released
	}

	get released(): boolean {
		return this.#isReleased
	}

	release(): void {
		if (this.#isReleased) return
		this.#isReleased = true
		this.#release?.()
		this.#onRelease(this)
	}
}

export class FakeMfrConnection {
	readonly id: number
	readonly socket: net.Socket
	readonly remotePort: number
	/** level -> destination -> source staged by this connection */
	readonly staged = new Map<string, Map<number, number>>()
	bytesIn = 0
	bytesOut = 0
	/** A command was received and its prompt has not been written yet */
	awaitingPrompt = false
	#input = ''
	#queued = 0
	#chain: Promise<void> = Promise.resolve()
	readonly #router: FakeMfr

	constructor(id: number, socket: net.Socket, router: FakeMfr) {
		this.id = id
		this.socket = socket
		this.remotePort = socket.remotePort ?? 0
		this.#router = router
		socket.setNoDelay(true)
		// no encoding is set on the socket, so data is always a Buffer
		socket.on('data', (data) => this.#receive(Buffer.from(data)))
		// a client going away mid-write is normal here
		socket.on('error', () => undefined)
	}

	/** Something is still waiting to be written */
	get busy(): boolean {
		return this.#queued > 0
	}

	get open(): boolean {
		return !this.socket.destroyed
	}

	stagedOn(level: string): Map<number, number> {
		let staged = this.staged.get(level)
		if (!staged) {
			staged = new Map()
			this.staged.set(level, staged)
		}
		return staged
	}

	/** Queue text for this client after anything already queued */
	write(text: string, options: { promptAt?: number; hold?: Hold } = {}): void {
		this.#queued++
		this.#chain = this.#chain
			.then(async () => {
				const { promptAt, hold } = options
				const cut = hold ? Math.min(hold.at, text.length) : text.length
				await this.#emit(text.slice(0, cut), promptAt)
				if (hold) {
					await hold.pause()
					await this.#emit(text.slice(cut), promptAt === undefined ? undefined : promptAt - cut)
				}
			})
			.finally(() => this.#queued--)
	}

	/** Write now, one byte at a time when the router drips. `promptAt` marks the prompt byte. */
	async #emit(text: string, promptAt: number | undefined): Promise<void> {
		if (!text) return
		const pieces = this.#router.drip ? [...text] : [text]
		let offset = 0
		for (const piece of pieces) {
			if (this.socket.destroyed) return
			this.socket.write(Buffer.from(piece, 'latin1'))
			this.bytesOut += piece.length
			offset += piece.length
			if (promptAt !== undefined && promptAt >= 0 && offset > promptAt) this.awaitingPrompt = false
			if (this.#router.drip) await nextTurn()
		}
	}

	#receive(data: Buffer): void {
		this.bytesIn += data.length
		this.#input += data.toString('latin1')
		let end: number
		while ((end = this.#input.indexOf('\r')) >= 0) {
			const command = this.#input.slice(0, end).replace(/^\n+/, '')
			this.#input = this.#input.slice(end + 1)
			if (command) this.#router.handle(this, command)
		}
	}
}

/** What one client sent the router */
export type Received = { connection: number; command: string }

export class FakeMfr {
	readonly unitId: string
	maxClients: number
	/** Write every reply one byte at a time, giving the event loop a turn between bytes */
	drip = false
	/** Commands matching this get no answer at all, as if the router had stopped responding */
	ignore: (command: string) => boolean = () => false

	/** level -> size; a level with no entry has no size */
	readonly sizes = new Map<string, Size>()
	/** level -> destination -> source */
	readonly routes = new Map<string, number[]>()
	/** destination -> lock. A lock applies to the destination on every level. */
	readonly locks = new Map<number, Lock>()
	/** Name bytes, as latin1 strings, exactly as the router would store them */
	readonly srcNames: string[] = []
	readonly dstNames: string[] = []

	/** Every command received, in order */
	readonly received: Received[] = []
	/** Commands that arrived before the prompt for the previous command on that connection */
	readonly violations: string[] = []
	/** Connections reset for going over `maxClients` */
	rejected = 0
	readonly connections: FakeMfrConnection[] = []

	readonly #server: net.Server
	/** Every hold, waiting for its reply or pausing one, until it is released */
	readonly #holds = new Set<Hold>()
	#nextId = 1

	constructor(options: FakeMfrOptions = {}) {
		this.unitId = options.unitId ?? '15'
		this.maxClients = options.maxClients ?? 2
		const levels = options.levels ?? { 0: { dst: 40, src: 36 } }
		let names = 0
		for (const [level, size] of Object.entries(levels)) {
			this.sizes.set(level, size)
			// a recognisable default: destination n carries source n + 1
			this.routes.set(
				level,
				Array.from({ length: size.dst }, (_, dst) => (dst + 1) % size.src),
			)
			names = Math.max(names, size.dst, size.src)
		}
		for (let i = 0; i < names; i++) {
			this.srcNames.push(`SRC ${i + 1}`)
			this.dstNames.push(`DST ${i + 1}`)
		}
		this.#server = net.createServer((socket) => this.#accept(socket))
	}

	/** Listens on `port`, or on any free port */
	async start(port = 0): Promise<number> {
		await new Promise<void>((resolve, reject) => {
			this.#server.once('error', reject)
			this.#server.listen(port, '127.0.0.1', () => resolve())
		})
		return this.port
	}

	get port(): number {
		const address = this.#server.address()
		if (!address || typeof address === 'string') throw new Error('Not listening')
		return address.port
	}

	async stop(): Promise<void> {
		this.dropClients()
		// a paused reply too, so a failed test can't leave one stuck
		for (const hold of [...this.#holds]) hold.release()
		await new Promise<void>((resolve) => this.#server.close(() => resolve()))
	}

	/** Close every client connection from the router's end */
	dropClients(): void {
		for (const connection of this.openConnections) connection.socket.destroy()
	}

	get openConnections(): FakeMfrConnection[] {
		return this.connections.filter((connection) => connection.open)
	}

	/** The open connection from a client's local port */
	connectionFrom(localPort: number | undefined): FakeMfrConnection | undefined {
		return this.openConnections.find((connection) => connection.remotePort === localPort)
	}

	/** Commands received on one connection */
	commandsFrom(connection: FakeMfrConnection | undefined): string[] {
		return this.received.filter((r) => r.connection === connection?.id).map((r) => r.command)
	}

	/** Pause the direct reply to the next command matching `matches` after its first `at` bytes */
	hold(matches: string | ((command: string) => boolean), at: number): Hold {
		const hold = new Hold(typeof matches === 'string' ? (command) => command === matches : matches, at, (released) =>
			this.#holds.delete(released),
		)
		this.#holds.add(hold)
		return hold
	}

	route(level: string, dst: number): number | undefined {
		return this.routes.get(level)?.[dst]
	}

	setName(kind: 'src' | 'dst', index: number, name: string): void {
		;(kind === 'src' ? this.srcNames : this.dstNames)[index] = name
	}

	/** Connect a client of our own, e.g. a second control panel */
	async connectClient(): Promise<RawClient> {
		const client = new RawClient(this)
		await client.connected
		return client
	}

	#accept(socket: net.Socket): void {
		if (this.openConnections.length >= this.maxClients) {
			this.rejected++
			socket.on('error', () => undefined)
			socket.resetAndDestroy()
			return
		}
		this.connections.push(new FakeMfrConnection(this.#nextId++, socket, this))
	}

	#broadcast(text: string): void {
		for (const connection of this.openConnections) connection.write(text)
	}

	/** @internal called by a connection for each command it receives */
	handle(connection: FakeMfrConnection, command: string): void {
		this.received.push({ connection: connection.id, command })
		if (this.ignore(command)) return
		if (connection.awaitingPrompt) {
			this.violations.push(`connection ${connection.id}: ${command} sent before the previous prompt`)
		}
		connection.awaitingPrompt = true

		const { direct, after } = this.#respond(connection, command)
		const hold = [...this.#holds].find((candidate) => candidate.matches(command))
		hold?.claim()
		connection.write(direct, { promptAt: direct.lastIndexOf('>'), hold })
		if (after) this.#broadcast(after)
	}

	/** The reply to the client that sent `command`, ending with the prompt, and what goes to everyone after it */
	#respond(connection: FakeMfrConnection, echo: string): { direct: string; after?: string } {
		const command = echo.replace(/^@\s?/, '')
		const lines = (replies: string[]): string => replies.map((line) => `${line}\r\n\r\n`).join('')
		const plain = { direct: `${echo}\r\r\n>` }
		let m: RegExpExecArray | null

		if (command === 'A?') {
			return { direct: `${echo}\r\r\n${lines([`A:${this.unitId}`])}>` }
		}

		if ((m = /^F\?([0-7])$/.exec(command))) {
			const size = this.sizes.get(m[1])
			if (!size) return plain
			const dims = `${hexPad(size.dst - 1, 2)},${hexPad(size.src - 1, 2)}`
			return { direct: `${echo}\rF:${m[1]}${dims}/${dims}\r\r\n>` }
		}

		if ((m = /^S\?([0-7])$/.exec(command))) {
			const routes = this.routes.get(m[1]) ?? []
			const level = m[1]
			return { direct: `${echo}\r\r\n${lines(routes.map((src, dst) => `S:${level}${hex(dst)},${hex(src)}`))}>` }
		}

		if ((m = /^V\?([0-7])$/.exec(command))) {
			const level = m[1]
			const staged = [...connection.stagedOn(level)].sort(([a], [b]) => a - b)
			return { direct: `${echo}\r\r\n${lines(staged.map(([dst, src]) => `V:${level}${hex(dst)},${hex(src)}`))}>` }
		}

		if ((m = /^P:([0-7])\/([0-9A-F]+),([0-9A-F]+)$/i.exec(command))) {
			const [level, dst, src] = [m[1], parseInt(m[2], 16), parseInt(m[3], 16)]
			if (this.#valid(level, dst, src)) connection.stagedOn(level).set(dst, src)
			return plain
		}

		if (command === 'B:C') {
			connection.staged.clear()
			return plain
		}

		if (command === 'B:E') {
			const taken: string[] = []
			for (const [level, staged] of connection.staged) {
				for (const [dst, src] of [...staged].sort(([a], [b]) => a - b)) {
					if (this.#switch(level, dst, src)) taken.push(this.#switched(level, dst, src))
				}
			}
			const hadStaged = [...connection.staged.values()].some((staged) => staged.size > 0)
			connection.staged.clear()
			if (!hadStaged) return { direct: `${echo}\r\r\n\r\n>` }
			return { direct: `${echo}\r\r\n>`, after: taken.join('') || undefined }
		}

		if ((m = /^X:([0-7])\/([0-9A-F]+),([0-9A-F]+)$/i.exec(command))) {
			const [level, dst, src] = [m[1], parseInt(m[2], 16), parseInt(m[3], 16)]
			if (!this.#switch(level, dst, src)) return plain
			return { direct: `${echo}\r\r\n>`, after: this.#switched(level, dst, src) }
		}

		if ((m = /^W:([0-7])\/([0-9A-F]+),([^,]+),([0-2])$/i.exec(command))) {
			const [level, dst, mode] = [m[1], parseInt(m[2], 16), parseInt(m[4], 10)]
			if (!this.#valid(level, dst)) return plain
			const lock = mode === 0 ? { id: '0', mode: 0 } : { id: m[3], mode }
			if (mode === 0) this.locks.delete(dst)
			else this.locks.set(dst, lock)
			const status = (lv: string | number): string => `W!${lv}${hex(dst)},${lock.id},${lock.mode}`
			const everyLevel = Array.from({ length: LEVEL_COUNT }, (_, lv) => `${status(lv)}\r\n`).join('')
			return { direct: `${echo}\r\r\n${status(level)}\r\r\n>`, after: `\r\n${everyLevel}` }
		}

		if ((m = /^W\?([0-7]),([0-9A-F]+)$/i.exec(command))) {
			const [level, dst] = [m[1], parseInt(m[2], 16)]
			if (!this.#valid(level, dst)) return plain
			const lock = this.locks.get(dst) ?? { id: '0', mode: 0 }
			return { direct: `${echo}\r\r\n${lines([`W!${level}${hex(dst)},${lock.id},${lock.mode}`])}>` }
		}

		if ((m = /^K\?([SD])([AK]),([0-9A-F]{1,3})$/i.exec(command))) {
			const kind = m[1].toUpperCase()
			const names = kind === 'S' ? this.srcNames : this.dstNames
			const sizes = [...this.sizes.values()]
			const count = Math.max(0, ...sizes.map((size) => (kind === 'S' ? size.src : size.dst)))
			const offset = parseInt(m[3], 16)
			const replies: string[] = []
			for (let index = offset; index < Math.min(offset + NAMES_PER_BLOCK, count); index++) {
				const data = Buffer.from(names[index] ?? '', 'latin1')
					.toString('hex')
					.toUpperCase()
				replies.push(`K:${kind}${m[2].toUpperCase()}${hexPad(index, 3)},${data}`)
			}
			return { direct: `${echo}\r\r\n${lines(replies)}>` }
		}

		if ((m = /^K:([SD])[SLA]([0-9A-F]{1,3}),([0-9A-F]*)$/i.exec(command))) {
			const index = parseInt(m[2], 16)
			const bytes = Buffer.from(m[3], 'hex').filter((byte) => byte < 0x80)
			const name = Buffer.from(bytes).subarray(0, MAX_STORED_NAME).toString('latin1')
			this.setName(m[1].toUpperCase() === 'S' ? 'src' : 'dst', index, name)
			return plain
		}

		return plain
	}

	#valid(level: string, dst: number, src = 0): boolean {
		const size = this.sizes.get(level)
		return !!size && dst < size.dst && src < size.src
	}

	/** Make a route unless the destination is locked against it. Returns true if switched. */
	#switch(level: string, dst: number, src: number): boolean {
		if (!this.#valid(level, dst, src)) return false
		const lock = this.locks.get(dst)
		if (lock && (lock.mode === 1 || (lock.mode === 2 && lock.id !== this.unitId))) return false
		this.routes.get(level)![dst] = src
		return true
	}

	#switched(level: string, dst: number, src: number): string {
		return `\r\nC:${level}/${hex(dst)},${hex(src)}:I${this.unitId}\r\n\r\nS:${level}${hex(dst)},${hex(src)}\r\n`
	}
}

/** A plain TCP client for the fake router, standing in for another control panel */
export class RawClient {
	readonly socket: net.Socket
	readonly connected: Promise<void>
	output = ''
	bytesIn = 0
	bytesOut = 0
	error: NodeJS.ErrnoException | undefined
	closed = false
	readonly #router: FakeMfr

	constructor(router: FakeMfr) {
		this.#router = router
		this.socket = net.connect(router.port, '127.0.0.1')
		this.socket.on('data', (data) => {
			this.bytesIn += data.length
			this.output += data.toString('latin1')
		})
		this.socket.on('error', (err) => (this.error = err))
		this.socket.on('close', () => (this.closed = true))
		this.connected = new Promise((resolve, reject) => {
			this.socket.once('connect', resolve)
			this.socket.once('error', reject)
		})
		// a client the router resets may never be awaited
		this.connected.catch(() => undefined)
	}

	/** The router's end of this connection */
	get connection(): FakeMfrConnection | undefined {
		return this.#router.connectionFrom(this.socket.localPort)
	}

	send(command: string): void {
		const text = `${command}\r`
		this.bytesOut += text.length
		this.socket.write(text, 'latin1')
	}

	/** Everything has been delivered both ways and the router has nothing left to write */
	get settled(): boolean {
		const connection = this.connection
		return (
			!!connection && !connection.busy && connection.bytesIn === this.bytesOut && connection.bytesOut === this.bytesIn
		)
	}

	/** Send a command and return everything received until the router has finished answering it */
	async request(command: string): Promise<string> {
		await until(() => this.connection !== undefined, 'the router to accept the client')
		const start = this.output.length
		this.send(command)
		await until(() => this.settled, `the reply to ${command}`)
		return this.output.slice(start)
	}

	close(): void {
		this.socket.destroy()
	}
}
