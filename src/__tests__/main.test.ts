import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A router connection and host API we can drive from the test
const sockets: FakeSocket[] = []

class FakeSocket extends EventEmitter {
	isConnected = true
	sent: string[] = []
	destroyed = false
	constructor() {
		super()
		sockets.push(this)
	}
	send(message: string): boolean {
		this.sent.push(message)
		return true
	}
	destroy(): void {
		this.destroyed = true
	}
	/** Router sends text to the module */
	receive(text: string): void {
		this.emit('data', Buffer.from(text, 'latin1'))
	}
}

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
		saveConfig = vi.fn()
	}
	return { ...actual, InstanceBase: StubInstanceBase, TCPHelper: FakeSocket }
})

const { default: ModuleInstance } = await import('../main.js')

const hex = (text: string): string => Buffer.from(text, 'latin1').toString('hex').toUpperCase()

/** Echo the command the module is waiting on, deliver any replies, then the prompt with no line break after it */
function reply(socket: FakeSocket, echo: string, ...lines: string[]): void {
	socket.receive([echo, ...lines].join('\r\n') + '\r\n>')
}

describe('ModuleInstance against a simulated router', () => {
	let module: InstanceType<typeof ModuleInstance>
	let socket: FakeSocket

	beforeEach(async () => {
		vi.useFakeTimers()
		sockets.length = 0
		module = new ModuleInstance({})
		await module.init({ host: '10.0.0.1', port: 23 })
		socket = sockets[0]
		socket.emit('connect')
	})

	afterEach(async () => {
		await module.destroy()
		vi.useRealTimers()
	})

	/** Walk the startup exchange for a 4 output, 8 input router */
	function startUp(): void {
		reply(socket, '@ A?', '@ A:01')
		reply(socket, '@ F?0', 'F:003F,3F/03,07')
	}

	it('sends one command at a time, waiting for the prompt rather than the echo', () => {
		expect(socket.sent).toEqual(['@ A?\r'])
		socket.receive('@ A?\r\r\n')
		expect(socket.sent).toEqual(['@ A?\r'])
		socket.receive('A:01\r\n\r\n>')
		expect(socket.sent).toEqual(['@ A?\r', '@ F?0\r'])
	})

	it('does not send the next command in the middle of a long reply', () => {
		startUp()
		expect(socket.sent.at(-1)).toBe('@ S?0\r')
		socket.receive('@ S?0\r\r\nS:00,1\r\n\r\n')
		expect(socket.sent.at(-1)).toBe('@ S?0\r')
		socket.receive('S:01,2\r\n\r\n>')
		expect(socket.sent.at(-1)).toBe('@ V?0\r')
	})

	it('waits longer for a long reply than a short one when no prompt arrives', () => {
		expect(socket.sent.at(-1)).toBe('@ A?\r')
		vi.advanceTimersByTime(1000)
		expect(socket.sent.at(-1)).toBe('@ F?0\r')
		socket.receive('@ F?0\rF:003F,3F/03,07\r\r\n>')
		expect(socket.sent.at(-1)).toBe('@ S?0\r')
		vi.advanceTimersByTime(4999)
		expect(socket.sent.at(-1)).toBe('@ S?0\r')
		vi.advanceTimersByTime(1)
		expect(socket.sent.at(-1)).toBe('@ V?0\r')
	})

	it('warns when the router rejects a video format change', () => {
		startUp()
		socket.receive('UR!E\r\n')
		expect(module.log).toHaveBeenCalledWith('warn', expect.stringContaining('rejected'))
	})

	it('learns the router size, then requests crosspoints, names and locks without the other level probes', () => {
		startUp()
		expect(module.state.level).toBe('0')
		expect(module.state.dstCount).toBe(4)
		expect(module.state.srcCount).toBe(8)
		expect(module.state.routerId).toBe('01')

		// drain the queue by echoing whatever the module sends next
		const requested: string[] = []
		for (let i = 0; i < 20; i++) {
			const next = socket.sent.at(-1)!.trim()
			if (requested.includes(next)) break
			requested.push(next)
			reply(socket, next)
		}
		expect(requested).toEqual([
			'@ S?0',
			'@ V?0',
			'@ K?SA,000',
			'@ K?DA,000',
			'@ W?0,00',
			'@ W?0,01',
			'@ W?0,02',
			'@ W?0,03',
		])
	})

	it('re-reads routes and staged presets periodically once idle, and replaces what was staged', () => {
		startUp()
		for (let i = 0; i < 20; i++) {
			const next = socket.sent.at(-1)!.trim()
			reply(socket, next)
			if (next === '@ W?0,03') break
		}
		module.state.presets.set(1, 5)
		const before = socket.sent.length
		vi.advanceTimersByTime(5000)
		expect(socket.sent.slice(before)).toEqual(['@ S?0\r'])
		reply(socket, '@ S?0')
		expect(socket.sent.at(-1)).toBe('@ V?0\r')
		// nothing is replaced until the whole list has arrived, so the buttons don't flicker
		socket.receive('@ V?0\r\r\n')
		expect(module.state.presets.get(1)).toBe(5)
		socket.receive('>')
		// the router listed no staged routes
		expect(module.state.presets.size).toBe(0)
	})

	it('takes the staged list from the reply to V?, and keeps what it has if the prompt never comes', () => {
		startUp()
		reply(socket, '@ S?0')
		reply(socket, '@ V?0', 'V:01,05', 'V:02,06')
		expect([...module.state.presets]).toEqual([
			[1, 5],
			[2, 6],
		])

		// the next read gets part way, then times out: the partial list must not replace the staged routes
		module.state.presets.set(3, 7)
		for (let i = 0; i < 20 && !socket.sent.at(-1)!.startsWith('@ W?0,03'); i++)
			reply(socket, socket.sent.at(-1)!.trim())
		reply(socket, '@ W?0,03')
		vi.advanceTimersByTime(5000)
		reply(socket, '@ S?0')
		socket.receive('@ V?0\r\r\nV:01,05\r\n')
		vi.advanceTimersByTime(5000)
		expect(module.state.presets.size).toBe(3)
	})

	it('does not touch variables or feedbacks when a refresh finds nothing changed', () => {
		startUp()
		socket.receive('S:01,05\r\n')
		const setVars = module.setVariableValues as unknown as ReturnType<typeof vi.fn>
		const check = module.checkFeedbacks as unknown as ReturnType<typeof vi.fn>
		setVars.mockClear()
		check.mockClear()
		socket.receive('S:01,05\r\n')
		expect(setVars).not.toHaveBeenCalled()
		expect(check).not.toHaveBeenCalled()
	})

	it('defines variables for the ports once the size is known', () => {
		startUp()
		const defs = module.setVariableDefinitions as unknown as ReturnType<typeof vi.fn>
		const latest = defs.mock.calls.at(-1)![0] as Record<string, unknown>
		expect(Object.keys(latest)).toEqual(
			expect.arrayContaining(['id', 'selected_dst_name', 'dst01', 'dst04', 'xpt04', 'dst04_locked', 'src01', 'src08']),
		)
		expect(latest).not.toHaveProperty('dst05')
		expect(latest).not.toHaveProperty('src09')
	})

	it('applies names, routes and locks as they arrive, and rebuilds dropdowns once names settle', () => {
		startUp()
		const actions = module.setActionDefinitions as unknown as ReturnType<typeof vi.fn>
		const before = actions.mock.calls.length

		socket.receive(`K:DA001,${hex('MON1')}\r\nK:SA003,${hex('CAM3')}\r\nS:001,03\r\nW!002,01,1\r\n`)

		expect(module.state.dstName(1)).toBe('MON1')
		expect(module.state.srcName(3)).toBe('CAM3')
		expect(module.state.routes.get(1)).toBe(3)
		expect(module.state.isLocked(2)).toBe(true)
		expect(module.setVariableValues).toHaveBeenCalledWith(expect.objectContaining({ dst02: 'MON1' }))
		expect(module.setVariableValues).toHaveBeenCalledWith(expect.objectContaining({ xpt02: '03' }))
		expect(module.setVariableValues).toHaveBeenCalledWith({ dst03_locked: 1 })

		// rebuilt once, after the debounce, not once per name
		expect(actions.mock.calls.length).toBe(before)
		vi.advanceTimersByTime(150)
		expect(actions.mock.calls.length).toBe(before + 1)
		const setDst = actions.mock.calls.at(-1)![0].setDst
		expect(setDst.options[0].choices[1]).toEqual({ id: '01', label: '2: MON1' })
	})

	it('ignores messages for ports beyond the router size or a different level', () => {
		startUp()
		socket.receive('S:009,01\r\nS:101,01\r\nK:DA0FF,41\r\n')
		expect(module.state.routes.size).toBe(0)
		expect(module.state.dstNames.size).toBe(0)
	})

	it('survives a message split across packets', () => {
		startUp()
		socket.receive('S:00')
		socket.receive('2,05\r\n')
		expect(module.state.routes.get(2)).toBe(5)
	})

	it('cuts the selected source to the selected destination, ahead of the startup reads, then clears the selection', () => {
		startUp()
		module.selectDestination('02')
		module.selectSource('05')
		expect(module.state.selectedSrc).toBe(5)

		module.routeSelection('cut')
		expect(module.state.selectedSrc).toBeUndefined()

		// the command in flight finishes first (the S? read), then the cut, before the V? read queued earlier
		reply(socket, socket.sent.at(-1)!.trim())
		expect(socket.sent.at(-1)).toBe('@ X:0/02,05\r')
	})

	it('keeps operator commands in the order they were issued', () => {
		startUp()
		module.setVideoFormat('04', 'RA', 'SO')
		module.applyVideoFormat()
		reply(socket, socket.sent.at(-1)!.trim())
		expect(socket.sent.at(-1)).toBe('@ UF:04/RA,SO\r')
		reply(socket, '@ UF:04/RA,SO')
		expect(socket.sent.at(-1)).toBe('@ UE:A\r')
	})

	it('refuses to cut without both ends selected', () => {
		startUp()
		module.selectDestination('02')
		module.routeSelection('cut')
		expect(module.log).toHaveBeenCalledWith('warn', expect.stringContaining('Select a destination'))
		expect(module.state.selectedDst).toBe(2)
	})

	it('rejects ports outside the router size', () => {
		startUp()
		module.selectDestination('09')
		expect(module.state.selectedDst).toBeUndefined()
		expect(module.log).toHaveBeenCalledWith('warn', expect.stringContaining('outside'))
	})

	it('stages several routes into a salvo, then takes them together', () => {
		startUp()
		module.config.autoRoute = 'preset'
		module.selectSource('05')
		module.selectDestination('01')
		module.selectDestination('02')
		expect(module.state.presets.get(1)).toBe(5)
		expect(module.state.presets.get(2)).toBe(5)
		// the pair stays on show; the next destination reuses the source, the next source starts afresh
		expect(module.state.selectedSrc).toBe(5)
		expect(module.state.selectedDst).toBe(2)
		module.selectSource('06')
		expect(module.state.selectedDst).toBeUndefined()
		expect(module.state.presets.size).toBe(2)
		module.selectSource('05')
		module.cutPresets()
		expect(module.state.presets.size).toBe(0)
		expect(module.state.selectedSrc).toBeUndefined()
	})

	/** Answer whatever the module sends until it stops, returning the routing commands in order */
	function drainRouting(): string[] {
		for (let i = 0; i < 40; i++) {
			const sentBefore = socket.sent.length
			reply(socket, socket.sent.at(-1)!.trim())
			if (socket.sent.length === sentBefore) break
		}
		return socket.sent.map((command) => command.trim()).filter((command) => /^@ (?:X:|P:|B:)/.test(command))
	}

	it('removes a cut destination from the staged routes, keeping the others', () => {
		startUp()
		module.routeExplicit('preset', '01', '05')
		module.routeExplicit('preset', '02', '06')
		module.routeExplicit('cut', '01', '03')
		expect([...module.state.presets]).toEqual([[2, 6]])
		expect(drainRouting()).toEqual(['@ P:0/01,05', '@ P:0/02,06', '@ X:0/01,03', '@ B:C', '@ P:0/02,06'])
	})

	it('refuses a cut to a locked destination, keeping the selection and the staged route', () => {
		startUp()
		socket.receive('W!001,01,1\r\n')
		module.selectSource('05')
		module.selectDestination('01')
		module.routeSelection('preset')
		module.routeSelection('cut')
		module.routeExplicit('cut', '01', '03')
		expect(module.log).toHaveBeenCalledWith('warn', expect.stringContaining('is locked'))
		expect(module.state.selectedDst).toBe(1)
		expect(module.state.selectedSrc).toBe(5)
		expect(module.state.presets.get(1)).toBe(5)
		expect(drainRouting()).toEqual(['@ P:0/01,05'])

		socket.receive('W!001,0,0\r\n')
		module.routeSelection('cut')
		expect(module.state.selectedDst).toBeUndefined()
	})

	it('leaves the staged routes alone when the cut destination has none', () => {
		startUp()
		module.routeExplicit('preset', '02', '06')
		module.routeExplicit('cut', '01', '03')
		expect(drainRouting()).toEqual(['@ P:0/02,06', '@ X:0/01,03'])
	})

	describe('logging', () => {
		const log = (level: string): string[] =>
			(module.log as unknown as ReturnType<typeof vi.fn>).mock.calls
				.filter(([l]) => l === level)
				.map(([, text]) => text as string)
		/** Answer until nothing is left to send, so the first read has finished */
		const finishRead = (): void => {
			for (let i = 0; i < 400; i++) {
				const before = socket.sent.length
				reply(socket, socket.sent.at(-1)!.trim())
				if (socket.sent.length === before) break
			}
		}

		it('logs routes changed elsewhere, but not its own or those from the first read', () => {
			startUp()
			socket.receive('S:00,1\r\n')
			finishRead()
			expect(log('info').filter((text) => text.includes(' now on '))).toEqual([])

			socket.receive('S:01,5\r\n')
			expect(log('info')).toContain('DST 2 now on SRC 6')

			module.routeExplicit('cut', '02', '03')
			socket.receive('S:02,3\r\n')
			expect(log('info')).not.toContain('DST 3 now on SRC 4')
			// the same route later, from elsewhere, is logged once this module has seen its own
			socket.receive('S:02,4\r\n')
			socket.receive('S:02,3\r\n')
			expect(log('info')).toContain('DST 3 now on SRC 4')
		})

		it('does not log the routes of its own salvo', () => {
			startUp()
			finishRead()
			module.routeExplicit('preset', '01', '05')
			module.cutPresets()
			socket.receive('S:01,5\r\n')
			expect(log('info')).not.toContain('DST 2 now on SRC 6')
		})

		it('logs the auto-route mode, using the word on the button', () => {
			module.setAutoRouteMode('preset')
			expect(log('info')).toContain('Auto-route mode: STAGE')
		})

		it('logs how long a lost connection took to come back', () => {
			startUp()
			vi.advanceTimersByTime(6000)
			vi.advanceTimersByTime(8000)
			sockets.at(-1)!.emit('connect')
			expect(log('info')).toContain('Reconnected after 8 s')
		})

		it('logs operator commands and timeouts at debug, but not routine reads', () => {
			startUp()
			finishRead()
			const before = log('debug').length
			vi.advanceTimersByTime(5000) // a refresh
			expect(log('debug').slice(before)).toEqual([])
			finishRead()
			module.routeExplicit('cut', '01', '02')
			expect(log('debug')).toContain('Sending @ X:0/01,02')
			vi.advanceTimersByTime(5000)
			expect(log('debug').some((text) => /^No prompt for @ .* moving on$/.test(text))).toBe(true)
		})

		it('logs a line it did not recognise at debug, but not echoes or C: lines', () => {
			startUp()
			socket.receive('C:00102,15\r\n@ S?0\r\n')
			expect(log('debug').filter((text) => text.startsWith('Ignored'))).toEqual([])
			socket.receive('Q:NEW THING\r\n')
			expect(log('debug')).toContain('Ignored from router: Q:NEW THING')
		})
	})

	describe('a lost connection', () => {
		const status = (): unknown => (module.updateStatus as unknown as ReturnType<typeof vi.fn>).mock.lastCall?.[0]
		/** Connect and answer the startup, leaving the module with nothing outstanding */
		const idle = (): void => {
			startUp()
			for (let i = 0; i < 200 && !module.state.locks.size; i++) reply(socket, socket.sent.at(-1)!.trim())
			for (let i = 0; i < 200; i++) {
				const before = socket.sent.length
				reply(socket, socket.sent.at(-1)!.trim())
				if (socket.sent.length === before) break
			}
		}

		it('reconnects after 6 s without a byte while a command is unanswered', () => {
			startUp()
			vi.advanceTimersByTime(5999)
			expect(sockets).toHaveLength(1)
			vi.advanceTimersByTime(1)
			expect(socket.destroyed).toBe(true)
			expect(sockets).toHaveLength(2)
			expect(status()).toBe('connection_failure')
		})

		it('notices within one refresh and 6 s when the router goes quiet while idle', () => {
			idle()
			vi.advanceTimersByTime(4999)
			expect(sockets).toHaveLength(1)
			vi.advanceTimersByTime(1 + 6000)
			expect(sockets).toHaveLength(2)
		})

		it('keeps the connection while bytes keep arriving, even if the prompt is slow', () => {
			startUp()
			vi.advanceTimersByTime(4000)
			socket.receive('@ S?0\r\r\nS:00,1\r\n')
			vi.advanceTimersByTime(4000)
			expect(sockets).toHaveLength(1)
		})

		it('stays connected while the router answers', () => {
			idle()
			for (let i = 0; i < 12; i++) {
				vi.advanceTimersByTime(5000)
				for (let j = 0; j < 4; j++) reply(socket, socket.sent.at(-1)!.trim())
			}
			expect(sockets).toHaveLength(1)
		})

		it('starts a fresh attempt every 5 s until one connects, and then reads the router again', () => {
			startUp()
			vi.advanceTimersByTime(6000)
			const retry = sockets[1]
			vi.advanceTimersByTime(4999)
			expect(sockets).toHaveLength(2)
			vi.advanceTimersByTime(1)
			expect(retry.destroyed).toBe(true)
			expect(sockets).toHaveLength(3)
			sockets[2].emit('connect')
			expect(sockets[2].sent).toEqual(['@ A?\r'])
			reply(sockets[2], '@ A?', 'A:01')
			vi.advanceTimersByTime(5000)
			expect(sockets).toHaveLength(3)
		})

		it('tests the link when the refresh is off, without refreshing', async () => {
			await module.configUpdated({ ...module.config, pollInterval: 0 })
			socket = sockets[1]
			socket.emit('connect')
			idle()
			const before = socket.sent.length
			vi.advanceTimersByTime(5000)
			expect(socket.sent.slice(before)).toEqual(['@ A?\r'])
		})
	})

	describe('flashing', () => {
		const defined = (): any => (module.setFeedbackDefinitions as unknown as ReturnType<typeof vi.fn>).mock.lastCall?.[0]
		const selected = (src: string): boolean => defined().SelectedSource.callback({ options: { src } })
		const takeLit = (): boolean => defined().StagedRoutes.callback({ options: {} })
		const started = (): void => {
			startUp()
			vi.advanceTimersByTime(100) // the definitions go out after a short wait
		}
		/** The selected source's state over one whole flash, and then whether it is back where it began */
		const halves = (src: string): boolean[] => {
			const seen = [selected(src)]
			vi.advanceTimersByTime(500)
			seen.push(selected(src))
			vi.advanceTimersByTime(500)
			seen.push(selected(src))
			return seen
		}

		it('flashes the next source, starting bright', () => {
			started()
			module.selectDestination('01')
			module.selectSource('05')
			expect(halves('05')).toEqual([true, false, true])
		})

		it('holds steady with no destination selected', () => {
			started()
			module.selectSource('05')
			expect(halves('05')).toEqual([true, true, true])
		})

		it('holds steady for the source already routed, whichever way it became routed', () => {
			started()
			reply(socket, '@ S?0', 'S:01,5')
			module.selectDestination('01')
			module.selectSource('05')
			expect(halves('05')).toEqual([true, true, true])

			// the router reports a new route for the destination: 06 was next, and is now current
			module.selectSource('06')
			expect(halves('06')).toEqual([true, false, true])
			socket.receive('S:01,6\r\n\r\n')
			expect(halves('06')).toEqual([true, true, true])
		})

		it('stops the source flash once staged, and flashes the take button until the take', () => {
			started()
			module.selectDestination('01')
			module.selectSource('05')
			module.routeSelection('preset')
			expect(halves('05')).toEqual([true, true, true])
			expect(takeLit()).toBe(true)
			vi.advanceTimersByTime(500)
			expect(takeLit()).toBe(false)
			module.cutPresets()
			expect(takeLit()).toBe(false)
			vi.advanceTimersByTime(1000)
			expect(takeLit()).toBe(false)
		})

		it('runs no timer once nothing is flashing', () => {
			started()
			module.selectDestination('01')
			module.selectSource('05')
			module.routeSelection('cut')
			const check = module.checkFeedbacks as unknown as ReturnType<typeof vi.fn>
			check.mockClear()
			vi.advanceTimersByTime(4000)
			const flashes = check.mock.calls.filter((call) => call.includes('StagedRoutes') && call.length === 2)
			expect(flashes).toEqual([])
		})
	})

	describe('auto-route mode', () => {
		const lastVariables = (): Record<string, unknown> =>
			Object.assign({}, ...(module.setVariableValues as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([v]) => v))

		it('steps off, preset, cut, off, saving and showing each mode', () => {
			startUp()
			const save = module.saveConfig as unknown as ReturnType<typeof vi.fn>
			expect(lastVariables().auto_route_mode).toBe('OFF')
			for (const [mode, text] of [
				['preset', 'STAGE'],
				['cut', 'CUT'],
				['off', 'OFF'],
			]) {
				module.setAutoRouteMode('next')
				expect(module.autoRouteMode).toBe(mode)
				expect(save.mock.lastCall?.[0]).toMatchObject({ host: '10.0.0.1', port: 23, autoRoute: mode })
				expect(lastVariables().auto_route_mode).toBe(text)
				expect(module.checkFeedbacks).toHaveBeenLastCalledWith('AutoRouteMode')
			}
		})

		it('sets a named mode, and ignores the current mode or an unknown one', () => {
			startUp()
			const save = module.saveConfig as unknown as ReturnType<typeof vi.fn>
			module.setAutoRouteMode('cut')
			expect(module.autoRouteMode).toBe('cut')
			module.setAutoRouteMode('cut')
			module.setAutoRouteMode('nonsense')
			expect(module.autoRouteMode).toBe('cut')
			expect(save).toHaveBeenCalledTimes(1)
		})

		it('does not route a pair already selected when the mode changes, only the next selection', () => {
			startUp()
			module.selectSource('05')
			module.selectDestination('01')
			module.setAutoRouteMode('cut')
			expect(drainRouting()).toEqual([])
			module.selectDestination('02')
			expect(drainRouting()).toEqual(['@ X:0/02,05'])
		})

		it('keeps the connection when a save changes only the mode, and reconnects for a new address', async () => {
			startUp()
			module.setAutoRouteMode('cut')
			await module.configUpdated({ ...module.config })
			expect(sockets).toHaveLength(1)
			await module.configUpdated({ ...module.config, autoRoute: 'off' })
			expect(sockets).toHaveLength(1)
			expect(lastVariables().auto_route_mode).toBe('OFF')
			await module.configUpdated({ ...module.config, host: '10.0.0.2' })
			expect(sockets).toHaveLength(2)
		})
	})

	it('records the routes the operator makes while Companion is recording', () => {
		startUp()
		module.config.autoRoute = 'preset'
		module.handleStartStopRecordActions(true)
		module.selectSource('05')
		module.selectDestination('01')
		module.selectDestination('02')
		module.cutPresets()
		const record = module.recordAction as unknown as ReturnType<typeof vi.fn>
		expect(record.mock.calls.map(([action]) => action)).toEqual([
			{ actionId: 'presetRoute', options: { dst: '01', src: '05' } },
			{ actionId: 'presetRoute', options: { dst: '02', src: '05' } },
			{ actionId: 'switchPresetXpts', options: {} },
		])
		module.handleStartStopRecordActions(false)
		module.selectSource('05')
		module.selectDestination('03')
		expect(record).toHaveBeenCalledTimes(3)
	})

	it('keeps every salvo in a recording, and only replaces a repeat within one salvo', () => {
		startUp()
		module.config.autoRoute = 'preset'
		module.handleStartStopRecordActions(true)
		module.selectSource('05')
		module.selectDestination('01')
		module.selectSource('06')
		module.selectDestination('01') // same destination, same salvo
		module.cutPresets()
		module.selectSource('05')
		module.selectDestination('01') // same destination, next salvo
		module.cutPresets()
		module.selectSource('05')
		module.selectDestination('02')
		module.clearPresets()
		const record = module.recordAction as unknown as ReturnType<typeof vi.fn>
		const ids = record.mock.calls.map(([, id]) => id as string)
		expect(ids[0]).toBe(ids[1])
		expect(new Set(ids.slice(1)).size).toBe(ids.length - 1)
		expect(record.mock.calls.at(-1)![0]).toEqual({ actionId: 'clearPresetXpts', options: {} })
	})

	it('does not let a V? already in flight undo a route staged while it waits', () => {
		startUp()
		reply(socket, '@ S?0')
		expect(socket.sent.at(-1)).toBe('@ V?0\r')
		module.routeExplicit('preset', '01', '05')
		reply(socket, '@ V?0', 'V:02,06')
		expect([...module.state.presets]).toEqual([[1, 5]])
		expect(socket.sent.at(-1)).toBe('@ P:0/01,05\r')
	})

	it('refreshes the staged display after a take, even if no route changes', () => {
		startUp()
		module.routeExplicit('preset', '01', '05')
		const setVars = module.setVariableValues as unknown as ReturnType<typeof vi.fn>
		const check = module.checkFeedbacks as unknown as ReturnType<typeof vi.fn>
		setVars.mockClear()
		check.mockClear()
		module.cutPresets()
		expect(setVars).toHaveBeenCalledWith(expect.objectContaining({ xpt02_pending_name: '' }))
		expect(check).toHaveBeenCalledWith('SelectedSource', 'PresetSource', 'PresetDestination', 'StagedRoutes')
	})

	it('does not poll or log while the connection is down', () => {
		startUp()
		for (let i = 0; i < 20; i++) {
			const next = socket.sent.at(-1)!.trim()
			reply(socket, next)
			if (next === '@ W?0,03') break
		}
		socket.isConnected = false
		const before = socket.sent.length
		;(module.log as unknown as ReturnType<typeof vi.fn>).mockClear()
		vi.advanceTimersByTime(20000)
		expect(socket.sent.length).toBe(before)
		expect(module.log).not.toHaveBeenCalled()
	})

	it('shows the name the router reports after a rename, warning if it differs', () => {
		startUp()
		reply(socket, '@ S?0')
		module.rename('dst', '01', 'A very long studio name')
		expect(module.state.dstNames.has(1)).toBe(false)
		reply(socket, '@ V?0')
		expect(socket.sent.at(-1)).toBe(`@ K:DA001,${hex('A very long studio name')}\r`)
		reply(socket, socket.sent.at(-1)!.trim())
		expect(socket.sent.at(-1)).toBe('@ K?DA,001\r')
		reply(socket, '@ K?DA,001', `K:DA001,${hex('A very long stud')}`, `K:DA002,${hex('OTHER')}`)
		expect(module.state.dstName(1)).toBe('A very long stud')
		expect(module.log).toHaveBeenCalledWith('warn', expect.stringContaining('stored'))
	})

	it('does not warn when a read already under way returns the old name during a rename', () => {
		startUp()
		reply(socket, '@ S?0')
		reply(socket, '@ V?0')
		const log = module.log as unknown as ReturnType<typeof vi.fn>
		// the startup read of the destination names is in flight when the rename is asked for
		while (socket.sent.at(-1) !== '@ K?DA,000\r') reply(socket, socket.sent.at(-1)!.trim())
		module.rename('dst', '01', 'NEW')
		reply(socket, '@ K?DA,000', `K:DA001,${hex('OLD')}`)
		expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('stored'))
		expect(socket.sent.at(-1)).toBe(`@ K:DA001,${hex('NEW')}\r`)
		reply(socket, socket.sent.at(-1)!.trim())
		reply(socket, '@ K?DA,001', `K:DA001,${hex('NEW')}`)
		expect(module.state.dstName(1)).toBe('NEW')
		expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining('stored'))
	})

	it('does not warn when the router keeps the name as sent', () => {
		startUp()
		module.rename('src', '02', 'CAM2')
		socket.receive(`K:SA002,${hex('CAM2')}\r\n`)
		expect(module.state.srcName(2)).toBe('CAM2')
		expect(module.log).not.toHaveBeenCalledWith('warn', expect.anything())
	})

	it('stages and cuts explicit routes without touching the selection', () => {
		startUp()
		module.selectSource('01')
		module.routeExplicit('preset', '02', '06')
		expect(module.state.presets.get(2)).toBe(6)
		expect(module.state.selectedSrc).toBe(1)
		expect(module.state.selectedDst).toBeUndefined()
	})

	it('sets the video format from the connection default, and applies it on request', () => {
		startUp()
		module.config.videoFormat = '05'
		module.setVideoFormat('default', 'RT', 'default', true)
		reply(socket, socket.sent.at(-1)!.trim()) // finish the command already in flight
		expect(socket.sent.at(-1)).toBe('@ UF:05/RT,SO\r')
		reply(socket, '@ UF:05/RT,SO')
		expect(socket.sent.at(-1)).toBe('@ UE:A\r')
	})

	it('keeps the source when another destination is selected, until the selection is cut', () => {
		startUp()
		module.selectSource('02')
		module.selectDestination('01')
		module.selectDestination('03')
		expect(module.state.selectedSrc).toBe(2)
		expect(module.state.selectedDst).toBe(3)
	})

	it('forgets partial input and queued commands when the connection drops and returns', () => {
		startUp()
		socket.receive('S:00')
		socket.emit('status_change', 2, 'lost') // not Ok
		socket.emit('connect')
		expect(socket.sent.at(-1)).toBe('@ A?\r')
		socket.receive('2,05\r\n') // the stale half-line must not combine with this
		expect(module.state.routes.has(2)).toBe(false)
	})

	it('cleans up on destroy', async () => {
		startUp()
		module.selectDestination('01')
		module.selectSource('02')
		await module.destroy()
		expect(socket.destroyed).toBe(true)
		expect(vi.getTimerCount()).toBe(0)
	})
})
