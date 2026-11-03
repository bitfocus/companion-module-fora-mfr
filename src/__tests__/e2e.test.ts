/**
 * Drives the module against the fake router over a real TCP connection on localhost.
 *
 * Companion's `InstanceBase` is stubbed as in main.test.ts, but the module's socket is the real
 * `TCPHelper`, wrapped only to count bytes. The timers are faked (I/O is not), so the 1 s and 5 s
 * command timeouts, the 5 s refresh and the 2 s reconnect only run when a test moves the clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { InstanceStatus, type TCPHelper } from '@companion-module/base'
import { FakeMfr, until, type FakeMfrConnection, type FakeMfrOptions } from './fake-mfr.js'

interface RecordingSocket extends TCPHelper {
	/** Everything the module sent on the current connection */
	sent: string[]
	sentBytes: number
	receivedBytes: number
}

const sockets = vi.hoisted(() => [] as RecordingSocket[])

vi.mock('@companion-module/base', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@companion-module/base')>()
	class StubInstanceBase {
		log = vi.fn()
		updateStatus = vi.fn()
		setVariableValues = vi.fn()
		setVariableDefinitions = vi.fn()
		setActionDefinitions = vi.fn()
		setFeedbackDefinitions = vi.fn()
		setPresetDefinitions = vi.fn()
		checkFeedbacks = vi.fn()
		checkAllFeedbacks = vi.fn()
		recordAction = vi.fn()
	}
	class RecordingTCPHelper extends actual.TCPHelper {
		sent: string[] = []
		sentBytes = 0
		receivedBytes = 0
		constructor(...args: ConstructorParameters<typeof actual.TCPHelper>) {
			super(...args)
			// registered before the module's own handlers, so the counts are reset before it sends
			this.on('connect', () => {
				this.sent = []
				this.sentBytes = 0
				this.receivedBytes = 0
			})
			this.on('data', (data: Buffer) => (this.receivedBytes += data.length))
			sockets.push(this)
		}
		override send(message: string | Buffer): boolean {
			const ok = super.send(message)
			if (ok) {
				this.sent.push(message.toString())
				this.sentBytes += message.length
			}
			return ok
		}
	}
	return { ...actual, InstanceBase: StubInstanceBase, TCPHelper: RecordingTCPHelper }
})

const { default: ModuleInstance } = await import('../main.js')
type Module = InstanceType<typeof ModuleInstance>

const mock = (fn: unknown): Mock => fn as Mock
const LEVEL = '0'
const DST = 40
const SRC = 36
/** For the tests that run a reply split at every byte, or the whole startup one byte per packet */
const HEAVY = { timeout: 30_000 }
/** How long the startup may take when the router drips one byte per packet */
const DRIP_STARTUP_MS = 15_000

describe('ModuleInstance against the fake router over TCP', () => {
	let router: FakeMfr
	let module: Module | undefined

	/** The module's current socket */
	const socket = (): RecordingSocket => sockets.at(-1)!
	/** The router's end of the module's connection */
	const connection = (): FakeMfrConnection | undefined => router.connectionFrom(socket()?._socket.localPort)
	/** Commands the module sent on its current connection, without the terminator */
	const sent = (): string[] => socket().sent.map((command) => command.replace(/\r$/, ''))

	/**
	 * Wait until nothing is in flight: the router has read everything the module sent and has
	 * nothing left to write, and the module has read everything the router wrote. With the timers
	 * faked, the module can't do anything more until the next packet or a move of the clock.
	 */
	async function settle(): Promise<void> {
		await until(() => {
			const s = socket()
			const c = connection()
			return !!s?.isConnected && !!c && !c.busy && c.bytesIn === s.sentBytes && c.bytesOut === s.receivedBytes
		}, 'the module and the router to settle')
	}

	async function startRouter(options?: FakeMfrOptions): Promise<void> {
		router = new FakeMfr(options)
		await router.start()
	}

	/** Start the module and wait until it has read everything from the router */
	async function startModule(startupMs?: number): Promise<Module> {
		module = new ModuleInstance({})
		await module.init({ host: '127.0.0.1', port: router.port, pollInterval: 5 })
		await until(() => socket()?.isConnected && connection() !== undefined, 'the module to connect')
		await until(
			() => sent().at(-1) === `@ W?${LEVEL},${(DST - 1).toString(16).toUpperCase()}`,
			'the startup reads',
			startupMs,
		)
		await settle()
		return module
	}

	/** Let the refresh timer fire once and wait for its S? and V? to be answered */
	async function refresh(): Promise<void> {
		const before = socket().sent.length
		vi.advanceTimersByTime(5000)
		expect(socket().sent.length).toBeGreaterThan(before)
		await until(() => sent().at(-1) === `@ V?${LEVEL}`, 'the refresh')
		await settle()
	}

	const routes = (m: Module): Record<number, number> => Object.fromEntries(m.state.routes)
	const routerRoutes = (): Record<number, number> => Object.fromEntries(router.routes.get(LEVEL)!.entries())

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
		sockets.length = 0
		module = undefined
	})

	afterEach(async () => {
		await module?.destroy()
		await router?.stop()
		vi.useRealTimers()
	})

	describe('startup', () => {
		beforeEach(async () => startRouter())

		it('reads the CPU, size, routes, staged routes, names and locks, one command per prompt', HEAVY, async () => {
			router.drip = true
			router.locks.set(3, { id: '15', mode: 1 })
			router.setName('src', 33, 'CAM 34')
			const m = await startModule(DRIP_STARTUP_MS)

			expect(router.violations).toEqual([])
			expect(sent()).toEqual([
				'@ A?',
				'@ F?0',
				'@ S?0',
				'@ V?0',
				'@ K?SA,000',
				'@ K?SA,020',
				'@ K?DA,000',
				'@ K?DA,020',
				...Array.from({ length: DST }, (_, dst) => `@ W?0,${dst.toString(16).toUpperCase().padStart(2, '0')}`),
			])
			expect(router.commandsFrom(connection())).toEqual(sent())

			expect(m.state.routerId).toBe('15')
			expect(m.state.level).toBe('0')
			expect(m.state.dstCount).toBe(DST)
			expect(m.state.srcCount).toBe(SRC)
			expect(routes(m)).toEqual(routerRoutes())
			expect(m.state.srcName(33)).toBe('CAM 34')
			expect(m.state.dstName(39)).toBe('DST 40')
			expect(m.state.srcNames.size).toBe(SRC)
			expect(m.state.dstNames.size).toBe(DST)
			expect(m.state.locks.get(3)).toBe(1)
			expect(m.state.lockOwners.get(3)).toBe('15')
			expect(m.state.locks.get(4)).toBe(0)
			expect(m.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.Ok, undefined)
		})

		it('never sends a command before the previous prompt, even with every byte in its own packet', HEAVY, async () => {
			router.drip = true
			const m = await startModule(DRIP_STARTUP_MS)
			m.routeExplicit('preset', '01', '05')
			m.routeExplicit('preset', '02', '06')
			m.routeExplicit('cut', '01', '03')
			m.cutPresets()
			m.lockDestination('07', '1')
			await until(() => sent().at(-1) === '@ V?0' && sent().includes('@ W?0,07'))
			await settle()
			await refresh()
			expect(router.violations).toEqual([])
		})

		it('probes the levels in order and uses the first that reports a size', async () => {
			await router.stop()
			await startRouter({ levels: { 2: { dst: 4, src: 8 } } })
			module = new ModuleInstance({})
			await module.init({ host: '127.0.0.1', port: router.port, pollInterval: 5 })
			await until(() => sent().at(-1) === '@ W?2,03', 'the startup reads')
			await settle()
			expect(sent().slice(0, 6)).toEqual(['@ A?', '@ F?0', '@ F?1', '@ F?2', '@ S?2', '@ V?2'])
			expect(sent().filter((command) => command.startsWith('@ F?'))).toHaveLength(3)
			expect(module.state.level).toBe('2')
			expect(module.state.dstCount).toBe(4)
			expect(module.state.srcCount).toBe(8)
			expect(Object.fromEntries(module.state.routes)).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4 })
		})
	})

	describe('replies split across packets', () => {
		beforeEach(async () => startRouter({ levels: { 0: { dst: 20, src: 20 } } }))

		const DST20 = 20
		async function start20(): Promise<Module> {
			module = new ModuleInstance({})
			await module.init({ host: '127.0.0.1', port: router.port, pollInterval: 5 })
			await until(() => sent().at(-1) === '@ W?0,13', 'the startup reads')
			await settle()
			return module
		}

		/**
		 * Hold the next reply to `command` after `at` bytes, check the module has read those and sent
		 * nothing, then let the rest through
		 */
		async function splitAt(command: string, at: number, whileHeld: () => void): Promise<void> {
			const hold = router.hold(command, at)
			const before = socket().sent.length
			vi.advanceTimersByTime(5000)
			await until(() => hold.reached, `the first ${at} bytes of the reply to ${command}`)
			await until(() => connection()!.bytesOut === socket().receivedBytes, 'the first part to arrive')
			whileHeld()
			const sentWhileHeld = socket()
				.sent.slice(before)
				.map((c) => c.trim())
			expect(sentWhileHeld.at(-1), `split at ${at}`).toBe(command)
			hold.release()
			await until(() => sent().at(-1) === '@ V?0', 'the refresh')
			await settle()
		}

		it('handles the S? reply split at every byte, including right before the prompt', HEAVY, async () => {
			const m = await start20()
			const replyLength = (): number =>
				`@ S?0\r\r\n${router.routes
					.get('0')!
					.map((src, dst) => `S:0${dst.toString(16).toUpperCase()},${src.toString(16).toUpperCase()}\r\n\r\n`)
					.join('')}>`.length

			const length = replyLength()
			expect(length).toBeGreaterThan(150)
			for (let at = 1; at < length; at++) {
				// change every route the router holds, without telling the module
				const table = router.routes.get('0')!
				for (let dst = 0; dst < DST20; dst++) table[dst] = (at * 7 + dst * 3) % 20
				expect(replyLength(), 'the reply length stays the same').toBe(length)
				await splitAt('@ S?0', at, () => undefined)
				expect(routes(m), `split at ${at}`).toEqual(routerRoutes())
			}
			expect(router.violations).toEqual([])
		})

		it('handles the V? reply split at every byte, replacing the staged list only at the prompt', HEAVY, async () => {
			const m = await start20()
			const sets = [
				new Map([
					[1, 5],
					[0x12, 6],
					[7, 0x13],
				]),
				new Map([
					[2, 0xa],
					[0x11, 3],
					[9, 0x12],
				]),
			]
			const staged = connection()!.stagedOn('0')
			const reply = (set: Map<number, number>): string =>
				`@ V?0\r\r\n${[...set]
					.sort(([a], [b]) => a - b)
					.map(([d, s]) => `V:0${d.toString(16).toUpperCase()},${s.toString(16).toUpperCase()}\r\n\r\n`)
					.join('')}>`
			expect(reply(sets[0]).length).toBe(reply(sets[1]).length)

			// start with the first set known to the module
			for (const [dst, src] of sets[0]) staged.set(dst, src)
			await refresh()
			expect(Object.fromEntries(m.state.presets)).toEqual(Object.fromEntries(sets[0]))

			const length = reply(sets[0]).length
			for (let at = 1; at < length; at++) {
				const [was, next] = at % 2 ? [sets[0], sets[1]] : [sets[1], sets[0]]
				staged.clear()
				for (const [dst, src] of next) staged.set(dst, src)
				await splitAt('@ V?0', at, () => {
					expect(Object.fromEntries(m.state.presets), `split at ${at}`).toEqual(Object.fromEntries(was))
				})
				expect(Object.fromEntries(m.state.presets), `split at ${at}`).toEqual(Object.fromEntries(next))
			}
		})
	})

	describe('connection', () => {
		beforeEach(async () => startRouter())

		it('reconnects after the router drops it, reads everything again and forgets what it staged', async () => {
			const m = await startModule()
			m.routeExplicit('preset', '01', '05')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(m.state.presets.get(1)).toBe(5)
			const first = connection()!

			router.dropClients()
			await until(() => !socket().isConnected, 'the module to see the drop')
			expect(m.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.Disconnected, undefined)
			m.routeExplicit('cut', '02', '03')
			expect(m.log).toHaveBeenCalledWith('warn', 'Not connected, dropped command: @ X:0/02,03')

			// changed while the module was away
			router.routes.get('0')![4] = 30

			vi.advanceTimersByTime(2000)
			await until(() => socket().isConnected && connection() !== undefined && connection() !== first)
			await until(() => sent().at(-1) === '@ W?0,27', 'the startup reads')
			await settle()

			expect(sent()[0]).toBe('@ A?')
			expect(sockets).toHaveLength(1)
			expect(routes(m)).toEqual(routerRoutes())
			expect(m.state.routes.get(4)).toBe(30)
			// the staged list belonged to the old connection, and the router has let it go
			expect(m.state.presets.size).toBe(0)
			expect(router.violations).toEqual([])
		})

		it('does not join half a line from before a drop to what comes after', async () => {
			const m = await startModule()
			const hold = router.hold('@ S?0', '@ S?0\r\r\nS:0'.length)
			vi.advanceTimersByTime(5000)
			await until(() => hold.reached)
			await until(() => connection()!.bytesOut === socket().receivedBytes)
			router.dropClients()
			hold.release()
			await until(() => !socket().isConnected)

			// the reconnected router answers with a different table
			const table = router.routes.get('0')!
			for (let dst = 0; dst < DST; dst++) table[dst] = (dst + 5) % SRC
			vi.advanceTimersByTime(2000)
			await until(() => socket().isConnected && sent().at(-1) === '@ W?0,27', 'the startup reads')
			await settle()
			expect(routes(m)).toEqual(routerRoutes())
		})

		it('retries when the router turns it away for having too many clients', async () => {
			const panels = [await router.connectClient(), await router.connectClient()]
			module = new ModuleInstance({})
			await module.init({ host: '127.0.0.1', port: router.port, pollInterval: 5 })
			await until(() => router.rejected === 1 && !socket().isConnected, 'the module to be turned away')
			expect(module.log).toHaveBeenCalledWith('error', expect.stringContaining('ECONNRESET'))
			expect(module.state.level).toBeUndefined()

			panels[0].close()
			await until(() => router.openConnections.length === 1)
			vi.advanceTimersByTime(2000)
			await until(() => socket().isConnected && sent().at(-1) === '@ W?0,27', 'the startup reads')
			await settle()
			expect(module.state.level).toBe('0')
			expect(routes(module)).toEqual(routerRoutes())
		})

		it('moves on after 1 s, or 5 s for a long reply, when the router stops answering', async () => {
			router.ignore = () => true
			module = new ModuleInstance({})
			await module.init({ host: '127.0.0.1', port: router.port, pollInterval: 5 })
			await until(() => router.received.length === 1, 'the first command')
			expect(sent()).toEqual(['@ A?'])

			// only F?0 gets an answer from here, so the module learns the size and moves to S?0
			router.ignore = (command) => command !== '@ F?0'
			vi.advanceTimersByTime(999)
			expect(sent()).toEqual(['@ A?'])
			vi.advanceTimersByTime(1)
			expect(sent()).toEqual(['@ A?', '@ F?0'])
			await until(() => sent().at(-1) === '@ S?0', 'S? after the size')
			await settle()

			vi.advanceTimersByTime(4999)
			expect(sent().at(-1)).toBe('@ S?0')
			vi.advanceTimersByTime(1)
			expect(sent().at(-1)).toBe('@ V?0')

			// V? is ignored too: the router comes back only once it has V?, so V? is never answered.
			// Answering it late would land its prompt on the next command and put the rest of the
			// startup one prompt out of step.
			await until(() => router.received.at(-1)?.command === '@ V?0', 'the router to get V?')
			await settle()
			router.ignore = () => false
			expect(router.commandsFrom(connection())).toEqual(['@ A?', '@ F?0', '@ S?0', '@ V?0'])

			// V? has a long reply, so the module waits 5 s before the next command
			vi.advanceTimersByTime(4999)
			expect(sent().at(-1)).toBe('@ V?0')
			vi.advanceTimersByTime(1)
			expect(sent().at(-1)).toBe('@ K?SA,000')

			// everything after that is read normally, one command per prompt
			await until(() => sent().at(-1) === '@ W?0,27', 'the rest of the startup reads')
			await settle()
			expect(router.commandsFrom(connection())).toEqual(sent())
			// The commands the module moved on from were never answered, so nothing was waiting for a
			// prompt when the next one went out: none of the timeouts counts as sending early.
			expect(router.violations).toEqual([])
			expect(module.state.srcNames.size).toBe(SRC)
			expect(module.state.dstNames.size).toBe(DST)
			expect(module.state.locks.size).toBe(DST)
			expect(module.state.routerId).toBeUndefined()
			expect(module.state.routes.size).toBe(0)
			expect(module.state.presets.size).toBe(0)

			// the next refresh reads the routes it missed
			await refresh()
			expect(routes(module)).toEqual(routerRoutes())
			expect(router.violations).toEqual([])
		})
	})

	describe('routing', () => {
		beforeEach(async () => startRouter())

		it('stages a salvo, takes it, then stages and clears another', async () => {
			const m = await startModule()
			m.config.autoRoute = 'preset'
			m.selectSource('05')
			m.selectDestination('01')
			m.selectDestination('02')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			const staged = (): Map<number, number> => connection()!.staged.get('0') ?? new Map()
			expect(Object.fromEntries(staged())).toEqual({ 1: 5, 2: 5 })
			expect(Object.fromEntries(m.state.presets)).toEqual({ 1: 5, 2: 5 })
			expect(m.state.routes.get(1)).toBe(2)

			m.cutPresets()
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(router.route('0', 1)).toBe(5)
			expect(router.route('0', 2)).toBe(5)
			expect(staged().size).toBe(0)
			expect(m.state.presets.size).toBe(0)
			expect(routes(m)).toEqual(routerRoutes())

			m.routeExplicit('preset', '03', '07')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			m.clearPresets()
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(staged().size).toBe(0)
			expect(m.state.presets.size).toBe(0)
			expect(router.route('0', 3)).toBe(4)
			expect(routes(m)).toEqual(routerRoutes())
			expect(sent().filter((c) => /^@ (?:P:|B:|X:)/.test(c))).toEqual([
				'@ P:0/01,05',
				'@ P:0/02,05',
				'@ B:E',
				'@ P:0/03,07',
				'@ B:C',
			])
		})

		it('cuts one destination, keeping the other staged routes, and a later take does not undo the cut', async () => {
			const m = await startModule()
			m.routeExplicit('preset', '01', '05')
			m.routeExplicit('preset', '02', '06')
			m.routeExplicit('cut', '01', '03')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(router.route('0', 1)).toBe(3)
			expect(Object.fromEntries(connection()!.stagedOn('0'))).toEqual({ 2: 6 })
			expect(Object.fromEntries(m.state.presets)).toEqual({ 2: 6 })
			expect(m.state.routes.get(1)).toBe(3)

			m.cutPresets()
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(router.route('0', 1)).toBe(3)
			expect(router.route('0', 2)).toBe(6)
			expect(routes(m)).toEqual(routerRoutes())
			expect(m.state.presets.size).toBe(0)
		})

		it('leaves a locked destination alone in a salvo and clears its staged route', async () => {
			const m = await startModule()
			m.routeExplicit('preset', '07', '14')
			await settle()
			m.lockDestination('07', '1')
			await until(() => m.state.locks.get(7) === 1, 'the lock to reach the module')
			await settle()
			;(m.setVariableValues as Mock).mockClear()
			m.cutPresets()
			await settle()
			expect(router.route('0', 7)).toBe(8)
			expect(m.state.presets.size).toBe(0)
			expect(m.setVariableValues).toHaveBeenCalledWith(expect.objectContaining({ xpt08_pending_name: '' }))
		})

		it('does not cut a destination it knows is locked', async () => {
			const m = await startModule()
			const panel = await router.connectClient()
			await panel.request('@ W:0/07,15,1')
			await until(() => m.state.locks.get(7) === 1, 'the lock to reach the module')
			await settle()
			const before = sent().length

			m.routeExplicit('cut', '07', '01')
			expect(m.log).toHaveBeenCalledWith('warn', expect.stringContaining('is locked'))
			await settle()
			expect(sent().length).toBe(before)
			expect(router.route('0', 7)).toBe(8)
		})

		it('keeps the route when the router refuses a cut to a destination locked behind its back', async () => {
			const m = await startModule()
			// locked on the router without telling anyone, so the module tries the cut
			router.locks.set(9, { id: '15', mode: 1 })
			m.routeExplicit('cut', '09', '01')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			expect(sent()).toContain('@ X:0/09,01')
			expect(router.route('0', 9)).toBe(10)
			expect(m.state.routes.get(9)).toBe(10)
		})

		it('locks and unlocks a destination, and the router tells the other clients', async () => {
			const m = await startModule()
			const panel = await router.connectClient()
			m.lockDestination('07', '1')
			await until(() => sent().at(-1) === '@ W?0,07')
			await settle()
			expect(router.locks.get(7)).toEqual({ id: '15', mode: 1 })
			expect(m.state.locks.get(7)).toBe(1)
			await until(() => panel.settled)
			expect(panel.output).toContain('W!07,15,1\r\n')

			m.lockDestination('07', 'toggle')
			await until(() => sent().at(-1) === '@ W?0,07' && sent().includes('@ W:0/07,15,0'))
			await settle()
			expect(router.locks.has(7)).toBe(false)
			expect(m.state.locks.get(7)).toBe(0)
		})
	})

	describe('another client', () => {
		beforeEach(async () => startRouter())

		it('passes on locks and routes another client makes', async () => {
			const m = await startModule()
			vi.advanceTimersByTime(200)
			const panel = await router.connectClient()
			mock(m.setVariableValues).mockClear()
			mock(m.checkFeedbacks).mockClear()

			await panel.request('@ W:0/07,15,1')
			await until(() => m.state.locks.get(7) === 1, 'the lock')
			expect(m.setVariableValues).toHaveBeenCalledWith({ dst08_locked: 1 })
			expect(m.checkFeedbacks).toHaveBeenCalledWith('LockedDestination')

			await panel.request('@ X:0/03,06')
			await until(() => m.state.routes.get(3) === 6, 'the route')
			expect(m.setVariableValues).toHaveBeenCalledWith(expect.objectContaining({ xpt04: '06', xpt04_name: 'SRC 7' }))
			expect(m.checkFeedbacks).toHaveBeenCalledWith(
				'RoutedSource',
				'RoutedDestination',
				'PresetSource',
				'PresetDestination',
			)

			await panel.request('@ B:E')
			await panel.request('@ P:0/04,09')
			await panel.request('@ B:E')
			await until(() => m.state.routes.get(4) === 9, 'the salvo')

			await panel.request('@ W:0/07,15,0')
			await until(() => m.state.locks.get(7) === 0, 'the unlock')
			await settle()
			expect(sent()).toEqual(expect.arrayContaining(['@ A?']))
			expect(routes(m)).toEqual(routerRoutes())
			// none of that needed the module to ask
			expect(sent().filter((c) => !/^@ (?:A\?|F\?|S\?|V\?|K\?|W\?)/.test(c))).toEqual([])
		})

		it('keeps its staged routes apart from another client', async () => {
			const m = await startModule()
			const panel = await router.connectClient()
			m.routeExplicit('preset', '01', '05')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()

			expect(await panel.request('@ V?0')).toBe('@ V?0\r\r\n>')
			await panel.request('@ P:0/02,07')
			await panel.request('@ B:C')
			await panel.request('@ P:0/03,08')
			await refresh()
			expect(Object.fromEntries(m.state.presets)).toEqual({ 1: 5 })

			await panel.request('@ B:E')
			await refresh()
			expect(router.route('0', 1)).toBe(2)
			expect(router.route('0', 3)).toBe(8)
			expect(Object.fromEntries(m.state.presets)).toEqual({ 1: 5 })
			expect(routes(m)).toEqual(routerRoutes())
		})
	})

	describe('refresh', () => {
		beforeEach(async () => startRouter())

		it('touches no variable, feedback or definition when nothing changed', async () => {
			const m = await startModule()
			m.routeExplicit('preset', '01', '05')
			await until(() => sent().at(-1) === '@ V?0')
			await settle()
			// let the name debounce publish the definitions
			vi.advanceTimersByTime(200)
			const spies = [
				m.setVariableValues,
				m.checkFeedbacks,
				m.checkAllFeedbacks,
				m.setVariableDefinitions,
				m.setActionDefinitions,
				m.setFeedbackDefinitions,
				m.setPresetDefinitions,
			].map(mock)
			for (const spy of spies) spy.mockClear()

			await refresh()
			await refresh()
			for (const spy of spies) expect(spy).not.toHaveBeenCalled()

			// and a change is picked up, alone
			router.routes.get('0')![6] = 20
			await refresh()
			expect(m.setVariableValues).toHaveBeenCalledTimes(1)
			expect(m.setVariableValues).toHaveBeenCalledWith(expect.objectContaining({ xpt07: '14' }))
		})
	})

	describe('names', () => {
		beforeEach(async () => startRouter())

		it('reads a renamed source back from the router after reconnecting', async () => {
			const m = await startModule()
			m.rename('src', '03', 'CAM 4')
			await until(() => sent().includes('@ K:SA003,43414D2034'))
			await settle()
			expect(router.srcNames[3]).toBe('CAM 4')
			router.dropClients()
			await until(() => !socket().isConnected)
			router.setName('src', 4, 'VTR')
			vi.advanceTimersByTime(2000)
			await until(() => socket().isConnected && sent().at(-1) === '@ W?0,27', 'the startup reads')
			await settle()
			expect(m.state.srcName(3)).toBe('CAM 4')
			expect(m.state.srcName(4)).toBe('VTR')
		})

		it('shows what the router kept when it drops non-ASCII characters, and warns', async () => {
			const m = await startModule()
			m.rename('src', '03', 'Café')
			await until(() => m.state.srcName(3) === 'Caf', 'the name to be read back')
			expect(router.srcNames[3]).toBe('Caf')
			expect(m.log).toHaveBeenCalledWith('warn', expect.stringContaining('stored "Café" as "Caf"'))
		})

		it('shows what the router kept when it shortens a long name, and warns', async () => {
			const m = await startModule()
			m.rename('dst', '02', 'A very long studio name')
			await until(() => m.state.dstName(2) === 'A very long stud', 'the name to be read back')
			expect(m.log).toHaveBeenCalledWith('warn', expect.stringContaining('stored'))
		})

		it('does not warn when the router keeps the name as sent', async () => {
			const m = await startModule()
			m.rename('dst', '02', 'MON 3')
			await until(() => m.state.dstName(2) === 'MON 3', 'the name to be read back')
			expect(m.log).not.toHaveBeenCalledWith('warn', expect.stringContaining('stored'))
		})
	})
})
