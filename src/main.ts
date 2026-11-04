import {
	InstanceBase,
	InstanceStatus,
	TCPHelper,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
	type CompanionVariableValues,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { NEXT_AUTO_ROUTE, USE_DEFAULT, videoFormatLabel } from './choices.js'
import {
	AUTO_ROUTE_LABELS,
	AUTO_ROUTE_ORDER,
	DEFAULT_VIDEO,
	GetConfigFields,
	type AutoRouteMode,
	type ModuleConfig,
} from './config.js'
import { SELECTION_FEEDBACKS, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { handleNamesRequest } from './names-page.js'
import { UpdatePresets } from './presets.js'
import {
	Cmd,
	LineBuffer,
	commandTimeoutMs,
	fitName,
	isUnrecognised,
	NAMES_PER_BLOCK,
	parseHex,
	parseLine,
	toHex,
	type Message,
	type NameKind,
} from './protocol.js'
import { CommandQueue } from './queue.js'
import { RouterState } from './state.js'
import { UpgradeScripts } from './upgrades.js'
import {
	UpdateVariableDefinitions,
	dstVar,
	lockVar,
	selectionValues,
	srcVar,
	pendingText,
	xptNameVar,
	xptPendingVar,
	xptVar,
	routedNameValues,
	type VariablesSchema,
} from './variables.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** The router has at most 8 levels; each is probed to find the one in use */
const MAX_LEVELS = 8
const DEFINITIONS_DEBOUNCE_MS = 100
const FLASH_MS = 500
/** Longer than the manual's slowest command (5 s). TCP alone can take minutes to report a lost network. */
const LINK_TIMEOUT_MS = 6000
/** A fresh attempt gets through as soon as the network returns; one left running backs off for over a minute */
const CONNECT_TIMEOUT_MS = 5000
/** How often the link is tested when the refresh is off or slower than this */
const HEARTBEAT_MS = 5000

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly state = new RouterState()

	#socket: TCPHelper | undefined
	readonly #lines = new LineBuffer()
	readonly #queue = new CommandQueue(
		(command) => this.#write(command),
		commandTimeoutMs,
		undefined,
		(command, timeoutMs) => this.log('debug', `No prompt for ${command} after ${timeoutMs / 1000} s, moving on`),
	)
	/** Still on the first read after connecting, when every name and route is new and not worth logging */
	#reading = false
	/** When the connection was lost, to report how long it took to come back */
	#lostAt: number | undefined
	/** Routes this module asked for, so that only changes from elsewhere are logged */
	readonly #ownRoutes = new Map<number, number>()
	#awaitingSize = true
	/** Names just sent to the router, to compare with what it reports back */
	readonly #renames = new Map<string, string>()
	/** Renames still queued, by command. A read already under way can't include them, so they aren't compared yet. */
	readonly #queuedRenames = new Map<string, { port: string; name: string }>()
	#recording = false
	/** Counts what has been recorded, so only a repeat within one salvo replaces an earlier action */
	#recordStep = 0
	/** Staged routes collected from the reply to the V? in progress */
	#presetSweep: Map<number, number> | undefined
	#pollTimer: ReturnType<typeof setInterval> | undefined
	#flashTimer: ReturnType<typeof setInterval> | undefined
	#linkTimer: ReturnType<typeof setTimeout> | undefined
	#connectTimer: ReturnType<typeof setTimeout> | undefined
	#definitionsTimer: ReturnType<typeof setTimeout> | undefined
	#choicesDirty = false
	#portsDirty = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.#publishDefinitions(true)
		this.setVariableValues(selectionValues(this.state))
		this.#publishVideoDefault()
		this.#publishAutoRouteMode()
		this.#connect()
	}

	async destroy(): Promise<void> {
		this.#disconnect()
		this.#stopFlash()
		if (this.#definitionsTimer) clearTimeout(this.#definitionsTimer)
		this.#definitionsTimer = undefined
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const previous = this.config
		this.config = config
		this.#publishVideoDefault()
		this.#publishAutoRouteMode()
		// the other settings don't touch the connection, so changing them needn't re-read the router
		if (config.host === previous.host && config.port === previous.port && config.pollInterval === previous.pollInterval)
			return
		this.#connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.label)
	}

	handleHttpRequest(request: CompanionHTTPRequest): CompanionHTTPResponse {
		return handleNamesRequest(
			{
				state: this.state,
				connected: !!this.#socket?.isConnected,
				rename: (kind, value, name) => this.rename(kind, value, name),
				log: (message) => this.log('info', message),
			},
			request,
		)
	}

	// ---- actions ----------------------------------------------------------------------------

	selectDestination(value: string): void {
		const dst = this.#port(value, this.state.dstCount)
		if (dst === undefined) return
		this.state.selectDst(dst)
		this.#selectionChanged()
		this.#autoRoute()
	}

	selectSource(value: string): void {
		const src = this.#port(value, this.state.srcCount)
		if (src === undefined) return
		this.state.selectSrc(src)
		this.#selectionChanged()
		this.#autoRoute()
	}

	#autoRoute(): void {
		const mode = this.autoRouteMode
		if (mode === 'off') return
		if (this.state.selectedDst === undefined || this.state.selectedSrc === undefined) return
		this.routeSelection(mode)
	}

	get autoRouteMode(): AutoRouteMode {
		return this.config.autoRoute ?? 'off'
	}

	/**
	 * Change the auto-route mode and save it in the connection settings. It applies from the next
	 * selection, so a pair already selected is not routed by changing the mode.
	 */
	setAutoRouteMode(value: string): void {
		const current = AUTO_ROUTE_ORDER.indexOf(this.autoRouteMode)
		const mode =
			value === NEXT_AUTO_ROUTE
				? AUTO_ROUTE_ORDER[(current + 1) % AUTO_ROUTE_ORDER.length]
				: AUTO_ROUTE_ORDER.find((candidate) => candidate === value)
		if (mode === undefined || mode === this.autoRouteMode) return
		this.config = { ...this.config, autoRoute: mode }
		this.saveConfig(this.config)
		this.log('info', `Auto-route mode: ${AUTO_ROUTE_LABELS[mode]}`)
		this.#publishAutoRouteMode()
	}

	#publishAutoRouteMode(): void {
		this.setVariableValues({ auto_route_mode: AUTO_ROUTE_LABELS[this.autoRouteMode] })
		this.checkFeedbacks('AutoRouteMode')
	}

	/** Cut or preset the selected source to the selected destination */
	routeSelection(mode: 'cut' | 'preset'): void {
		const { selectedDst, selectedSrc } = this.state
		if (this.state.level === undefined || selectedDst === undefined || selectedSrc === undefined) {
			this.log('warn', 'Select a destination and a source before switching')
			return
		}
		if (mode === 'cut' && this.#cutRefused(selectedDst)) return
		this.#route(mode, selectedDst, selectedSrc)
		this.#record(mode === 'cut' ? 'cutRoute' : 'presetRoute', selectedDst, selectedSrc)
		if (mode === 'cut') {
			this.state.clearSelection()
			this.#selectionChanged()
		} else {
			// the pair stays on show; the next destination reuses the source to add to the salvo
			this.state.staged = true
			this.#selectionChanged()
		}
	}

	/** Cut or preset one route given explicitly, leaving the selection alone */
	routeExplicit(mode: 'cut' | 'preset', dstValue: string, srcValue: string): void {
		const dst = this.#port(dstValue, this.state.dstCount)
		const src = this.#port(srcValue, this.state.srcCount)
		if (dst === undefined || src === undefined) return
		if (this.state.level === undefined) {
			this.log('warn', 'Cannot route yet: the router has not reported its level')
			return
		}
		if (mode === 'cut' && this.#cutRefused(dst)) return
		this.#route(mode, dst, src)
	}

	/** The router ignores a cut to a locked destination, so don't act as if it happened */
	#cutRefused(dst: number): boolean {
		if (!this.state.refusesCut(dst)) return false
		this.log('warn', `Cut refused: ${this.state.dstName(dst)} is locked`)
		return true
	}

	#route(mode: 'cut' | 'preset', dst: number, src: number): void {
		const level = this.state.level
		if (level === undefined) return
		if (mode === 'cut') {
			this.#ownRoutes.set(dst, src)
			this.#send(Cmd.cut(level, dst, src))
			this.#unstage(level, dst)
		} else {
			this.#send(Cmd.preset(level, dst, src))
			// the router doesn't answer P:, so track what was staged ourselves
			this.state.presets.set(dst, src)
			this.#presetsChanged()
		}
		this.#refreshRoutes()
	}

	/**
	 * A cut doesn't remove a route staged for that destination, so a later take would undo the cut.
	 * The router can only clear everything it has staged, so the other routes are staged again.
	 */
	#unstage(level: string, dst: number): void {
		const { presets } = this.state
		if (!presets.delete(dst)) return
		this.#send(Cmd.clearPresets())
		for (const [stagedDst, src] of presets) this.#send(Cmd.preset(level, stagedDst, src))
		this.#presetsChanged()
	}

	cutPresets(): void {
		for (const [dst, src] of this.state.presets) this.#ownRoutes.set(dst, src)
		this.#send(Cmd.cutPresets())
		this.#record('switchPresetXpts')
		this.state.presets.clear()
		this.#presetsChanged()
		this.#refreshRoutes()
		this.state.clearSelection()
		this.#selectionChanged()
	}

	clearPresets(): void {
		this.#send(Cmd.clearPresets())
		this.#record('clearPresetXpts')
		this.state.presets.clear()
		this.#presetsChanged()
		this.#refreshRoutes()
	}

	/** `default` for any of the three means the value from the connection settings */
	setVideoFormat(format: string, reference: string, point: string, apply = false): void {
		const wanted = this.#videoDefaults()
		this.#send(
			Cmd.setVideoFormat(
				format === USE_DEFAULT ? wanted.format : format,
				reference === USE_DEFAULT ? wanted.reference : reference,
				point === USE_DEFAULT ? wanted.point : point,
			),
		)
		if (apply) this.#send(Cmd.applyVideoFormat())
	}

	#videoDefaults(): { format: string; reference: string; point: string } {
		const { videoFormat, videoReference, videoPoint } = this.config
		return {
			format: videoFormat || DEFAULT_VIDEO.format,
			reference: videoReference || DEFAULT_VIDEO.reference,
			point: videoPoint || DEFAULT_VIDEO.point,
		}
	}

	#publishVideoDefault(): void {
		const { format, reference, point } = this.#videoDefaults()
		this.setVariableValues({ video_format_default: videoFormatLabel(format, reference, point) })
	}

	applyVideoFormat(): void {
		this.#send(Cmd.applyVideoFormat())
	}

	cancelVideoFormat(): void {
		this.#send(Cmd.cancelVideoFormat())
	}

	rename(kind: NameKind, value: string, name: string): void {
		const index = this.#port(value, kind === 'dst' ? this.state.dstCount : this.state.srcCount)
		const trimmed = name.trim()
		if (index === undefined) return
		if (!trimmed) {
			this.log('warn', 'Cannot rename to an empty name')
			return
		}
		// the router may shorten a name or drop characters, so show what it reports back
		const fitted = fitName(trimmed).trim()
		const command = Cmd.rename(kind, index, fitted)
		this.#queuedRenames.set(command, { port: `${kind}${index}`, name: fitted })
		this.#send(command)
		this.#send(Cmd.names(kind, index))
	}

	lockDestination(value: string, mode: string, useSelected = false): void {
		const dst = useSelected ? this.state.selectedDst : this.#port(value, this.state.dstCount)
		const { level, routerId } = this.state
		if (dst === undefined) {
			if (useSelected) this.log('warn', 'Select a destination before locking')
			return
		}
		if (level === undefined || routerId === undefined) {
			this.log('warn', 'Cannot lock yet: the router has not reported its level and unit ID')
			return
		}
		const lockMode = mode === 'toggle' ? (this.state.isLocked(dst) ? '0' : '1') : mode
		this.#send(Cmd.lock(level, dst, routerId, lockMode))
		this.#send(Cmd.lockStatus(level, dst))
	}

	// ---- connection -------------------------------------------------------------------------

	#connect(retrying = false): void {
		this.#disconnect()
		if (!retrying) this.#lostAt = undefined

		const { host, port } = this.config
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		if (!retrying) this.updateStatus(InstanceStatus.Connecting)
		const socket = new TCPHelper(host, port)
		this.#socket = socket
		this.#armConnectTimer()

		socket.on('status_change', (status, message) => {
			this.updateStatus(status, message)
			if (status !== InstanceStatus.Ok) {
				this.#lostAt ??= Date.now()
				this.#queue.clear()
				this.#stopLinkTimer()
				this.#armConnectTimer()
			}
		})
		socket.on('error', (err) => this.log('error', `Network error: ${err.message}`))
		socket.on('connect', () => {
			this.#stopConnectTimer()
			if (this.#lostAt !== undefined) {
				this.log('info', `Reconnected after ${Math.round((Date.now() - this.#lostAt) / 1000)} s`)
				this.#lostAt = undefined
			}
			this.#reading = true
			this.#lines.reset()
			this.#queue.clear()
			this.#awaitingSize = true
			this.#requestInitialState()
		})
		socket.on('data', (data) => {
			for (const line of this.#lines.push(data)) {
				const message = parseLine(line, this.#queue.pending)
				if (message) this.#handleMessage(message)
				else if (isUnrecognised(line, this.#queue.pending)) this.log('debug', `Ignored from router: ${line.trim()}`)
			}
			// the router is there: wait afresh for whatever is still unanswered
			this.#stopLinkTimer()
			if (this.#queue.pending !== undefined) this.#armLinkTimer()
		})
	}

	#armLinkTimer(): void {
		this.#linkTimer ??= setTimeout(() => {
			this.#linkTimer = undefined
			this.#lostAt ??= Date.now()
			this.log('warn', 'No reply from the router, reconnecting')
			this.updateStatus(InstanceStatus.ConnectionFailure, 'No reply from the router')
			this.#connect(true)
		}, LINK_TIMEOUT_MS)
	}

	#stopLinkTimer(): void {
		if (this.#linkTimer) clearTimeout(this.#linkTimer)
		this.#linkTimer = undefined
	}

	#armConnectTimer(): void {
		this.#connectTimer ??= setTimeout(() => {
			this.#connectTimer = undefined
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach the router, retrying')
			this.#connect(true)
		}, CONNECT_TIMEOUT_MS)
	}

	#stopConnectTimer(): void {
		if (this.#connectTimer) clearTimeout(this.#connectTimer)
		this.#connectTimer = undefined
	}

	#disconnect(): void {
		this.#queuedRenames.clear()
		this.#renames.clear()
		this.#ownRoutes.clear()
		this.#reading = false
		this.#stopPolling()
		this.#stopLinkTimer()
		this.#stopConnectTimer()
		this.#presetSweep = undefined
		this.#queue.clear()
		this.#lines.reset()
		this.#socket?.destroy()
		this.#socket = undefined
	}

	#write(command: string): boolean {
		if (!this.#socket?.isConnected) return false
		// the reply to V? lists only what is staged now; collect it and compare at the prompt.
		// Any other command means a V? that never got its prompt, so its partial list is dropped.
		this.#presetSweep = this.#isPresetRead(command) ? new Map() : undefined
		const rename = this.#queuedRenames.get(command)
		if (rename) {
			this.#queuedRenames.delete(command)
			this.#renames.set(rename.port, rename.name)
		}
		this.#socket.send(`${command}\r`)
		this.#armLinkTimer()
		return true
	}

	/** Operator commands jump ahead of the bulk reads made while syncing with the router */
	#send(command: string, urgent = true): void {
		if (!this.#socket?.isConnected) {
			this.log('warn', `Not connected, dropped command: ${command}`)
			return
		}
		if (!this.#queue.enqueue(command, urgent)) {
			this.log('warn', `Command queue full, dropped command: ${command}`)
		} else if (urgent) {
			this.log('debug', `Sending ${command}`)
		}
	}

	/** Ask which CPU is active and how big each level is; the rest is requested once the size is known */
	#requestInitialState(): void {
		this.#send(Cmd.cpuStatus(), false)
		for (let level = 0; level < MAX_LEVELS; level++) this.#send(Cmd.systemSize(level), false)
	}

	#requestRouterContents(level: string): void {
		this.#send(Cmd.crosspoints(level), false)
		this.#send(Cmd.presetStatus(level), false)
		this.#readNames()
		for (let dst = 0; dst < this.state.dstCount; dst++) this.#send(Cmd.lockStatus(level, dst), false)
	}

	/** The router doesn't announce a name changed on its own panel or web interface, so names are read too */
	#readNames(): void {
		for (const kind of ['src', 'dst'] as const) {
			const count = kind === 'src' ? this.state.srcCount : this.state.dstCount
			for (let block = 0; block < Math.ceil(count / NAMES_PER_BLOCK); block++) {
				this.#send(Cmd.names(kind, block * NAMES_PER_BLOCK), false)
			}
		}
	}

	/**
	 * Read the routes and staged presets back from the router, so what Companion shows is what the
	 * router holds even when changes come from elsewhere or an unsolicited update is missed.
	 */
	#refreshRoutes(): void {
		const { level } = this.state
		if (level === undefined) return
		this.#send(Cmd.crosspoints(level), false)
		this.#send(Cmd.presetStatus(level), false)
	}

	#isPresetRead(command: string | undefined): boolean {
		return this.state.level !== undefined && command === Cmd.presetStatus(this.state.level)
	}

	#finishPresetSweep(): void {
		const sweep = this.#presetSweep
		this.#presetSweep = undefined
		if (!sweep) return
		const { presets } = this.state
		const same = sweep.size === presets.size && [...sweep].every(([dst, src]) => presets.get(dst) === src)
		if (same) return
		presets.clear()
		for (const [dst, src] of sweep) presets.set(dst, src)
		this.#presetsChanged()
	}

	#startPolling(): void {
		this.#stopPolling()
		const refreshMs = Number(this.config.pollInterval ?? 5) * 1000
		const tickMs = refreshMs > 0 ? Math.min(refreshMs, HEARTBEAT_MS) : HEARTBEAT_MS
		let sinceRefreshMs = 0
		this.#pollTimer = setInterval(() => {
			sinceRefreshMs += tickMs
			if (!this.#queue.idle || !this.#socket?.isConnected) return
			this.#finishFirstRead()
			if (refreshMs > 0 && sinceRefreshMs >= refreshMs) {
				sinceRefreshMs = 0
				this.#refreshRoutes()
				this.#readNames()
			} else {
				this.#send(Cmd.cpuStatus(), false)
			}
		}, tickMs)
	}

	#stopPolling(): void {
		if (this.#pollTimer) clearInterval(this.#pollTimer)
		this.#pollTimer = undefined
	}

	#finishFirstRead(): void {
		if (!this.#reading || !this.#queue.idle || this.state.level === undefined) return
		this.#reading = false
		const { dstCount, srcCount, level, routerId } = this.state
		this.log(
			'info',
			`Router found: ${dstCount} destinations, ${srcCount} sources, level ${level}, unit ${routerId ?? 'unknown'}`,
		)
	}

	// ---- incoming messages ------------------------------------------------------------------

	#handleMessage(message: Message): void {
		const { state } = this
		switch (message.type) {
			case 'prompt':
				if (this.#isPresetRead(this.#queue.pending)) this.#finishPresetSweep()
				this.#queue.acknowledge()
				this.#finishFirstRead()
				break

			case 'videoFormat':
				if (message.event === 'rejected') {
					this.log('warn', 'The router rejected the video format change (UR!E)')
				} else {
					this.log('info', `Video format ${message.event}: ${message.detail}`)
				}
				break

			case 'cpu':
				if (state.routerId !== message.id) {
					state.routerId = message.id
					this.setVariableValues({ id: message.id })
				}
				break

			case 'systemSize': {
				// levels are probed in order; the first to answer is the one in use
				if (!this.#awaitingSize) break
				this.#awaitingSize = false
				this.#queue.drop((command) => command.startsWith('@ F?'))
				state.level = message.level
				const changed = state.setSize(message.outputs, message.inputs)
				if (changed) {
					this.#portsDirty = true
					this.#publishVariableDefinitions()
					this.#scheduleDefinitions()
				}
				this.setVariableValues({
					...routedNameValues(state),
					level: message.level,
					outputs: message.outputs,
					inputs: message.inputs,
				})
				this.#requestRouterContents(message.level)
				this.#startPolling()
				break
			}

			case 'crosspoint': {
				if (message.level !== state.level || message.dst >= state.dstCount) break
				if (state.routes.get(message.dst) === message.src) break
				state.routes.set(message.dst, message.src)
				if (this.#ownRoutes.get(message.dst) === message.src) {
					this.#ownRoutes.delete(message.dst)
				} else if (!this.#reading) {
					this.log('info', `DST ${message.dst + 1} now on SRC ${message.src + 1}`)
				}
				this.#syncFlash()
				this.setVariableValues({
					[xptVar(message.dst)]: toHex(message.src),
					[xptNameVar(message.dst)]: state.routedSrcName(message.dst),
					[xptPendingVar(message.dst)]: pendingText(state, message.dst),
				})
				if (message.dst === state.selectedDst) this.setVariableValues(selectionValues(state))
				this.checkFeedbacks(
					'SelectedSource',
					'RoutedSource',
					'RoutedDestination',
					'PresetSource',
					'PresetDestination',
					'StagedRoutes',
				)
				break
			}

			case 'preset': {
				if (message.level !== state.level || message.dst >= state.dstCount) break
				this.#presetSweep?.set(message.dst, message.src)
				break
			}

			case 'name': {
				const count = message.kind === 'dst' ? state.dstCount : state.srcCount
				if (message.index >= count) break
				const renamed = `${message.kind}${message.index}`
				const sent = this.#renames.get(renamed)
				if (sent !== undefined) {
					this.#renames.delete(renamed)
					if (sent !== message.name) this.log('warn', `The router stored "${sent}" as "${message.name}"`)
				}
				const previous = message.kind === 'dst' ? state.dstName(message.index) : state.srcName(message.index)
				if (state.setName(message.kind, message.index, message.name)) {
					if (sent === undefined && !this.#reading) {
						const port = `${message.kind.toUpperCase()} ${message.index + 1}`
						this.log('info', `${port} renamed on the router: "${previous}" to "${message.name}"`)
					}
					this.#nameChanged(message.kind, message.index)
				}
				break
			}

			case 'lock': {
				if (message.level !== state.level || message.dst >= state.dstCount) break
				state.lockOwners.set(message.dst, message.id)
				if (state.locks.get(message.dst) === message.mode) break
				state.locks.set(message.dst, message.mode)
				this.setVariableValues({ [lockVar(message.dst)]: message.mode })
				if (message.dst === state.selectedDst) this.setVariableValues(selectionValues(state))
				this.checkFeedbacks('LockedDestination')
				break
			}
		}
	}

	// ---- derived updates --------------------------------------------------------------------

	#port(value: string, count: number): number | undefined {
		const port = parseHex(value)
		if (port === undefined) {
			this.log('warn', `Invalid port: ${String(value)}`)
			return undefined
		}
		if (count > 0 && port >= count) {
			this.log('warn', `Port ${port + 1} is outside the router's size (${count})`)
			return undefined
		}
		return port
	}

	#selectionChanged(): void {
		this.setVariableValues(selectionValues(this.state))
		// start from the bright half, so a press shows straight away
		this.#stopFlash()
		this.#syncFlash()
		this.checkFeedbacks(...SELECTION_FEEDBACKS)
	}

	/** The flash only runs while a source is about to change a route or routes are staged */
	#syncFlash(): void {
		const { state } = this
		if (state.nextSrc === undefined && !state.hasStagedRoutes) {
			if (!this.#flashTimer) return
			this.#stopFlash()
			this.checkFeedbacks('SelectedSource', 'StagedRoutes')
			return
		}
		this.#flashTimer ??= setInterval(() => {
			state.flashOn = !state.flashOn
			this.checkFeedbacks('SelectedSource', 'StagedRoutes')
		}, FLASH_MS)
	}

	#stopFlash(): void {
		if (this.#flashTimer) clearInterval(this.#flashTimer)
		this.#flashTimer = undefined
		this.state.flashOn = true
	}

	/** While Companion is recording, what the operator does becomes actions they can put on a button */
	#record(actionId: string, dst?: number, src?: number): void {
		if (!this.#recording) return
		const options = dst === undefined || src === undefined ? {} : { dst: toHex(dst), src: toHex(src) }
		// Companion replaces a recorded action with the same id in place, which only suits staging a
		// destination again before the salvo is taken. Anything else is a new step, kept in order.
		if (actionId === 'presetRoute') {
			this.recordAction({ actionId, options }, `${actionId}-${this.#recordStep}-${options.dst}`)
		} else {
			this.#recordStep++
			this.recordAction({ actionId, options }, `${actionId}-${this.#recordStep}`)
		}
	}

	handleStartStopRecordActions(isRecording: boolean): void {
		this.#recording = isRecording
	}

	#presetsChanged(): void {
		// a V? already in flight can't include this change; the refresh that follows every change will
		this.#presetSweep = undefined
		this.setVariableValues({ ...selectionValues(this.state), ...routedNameValues(this.state) })
		this.#syncFlash()
		this.checkFeedbacks('SelectedSource', 'PresetSource', 'PresetDestination', 'StagedRoutes')
	}

	#nameChanged(kind: NameKind, index: number): void {
		const values: CompanionVariableValues =
			kind === 'dst' ? { [dstVar(index)]: this.state.dstName(index) } : { [srcVar(index)]: this.state.srcName(index) }
		this.setVariableValues({
			...values,
			...selectionValues(this.state),
			...(kind === 'src' ? routedNameValues(this.state) : {}),
		})
		this.#choicesDirty = true
		this.#scheduleDefinitions()
	}

	// ---- definitions ------------------------------------------------------------------------

	#publishVariableDefinitions(): void {
		UpdateVariableDefinitions((definitions) => this.setVariableDefinitions(definitions), this.state)
	}

	/** Names arrive one block at a time; batch the resulting dropdown/preset rebuilds */
	#scheduleDefinitions(): void {
		this.#definitionsTimer ??= setTimeout(() => {
			this.#definitionsTimer = undefined
			this.#publishDefinitions(false)
		}, DEFINITIONS_DEBOUNCE_MS)
	}

	#publishDefinitions(all: boolean): void {
		if (all) this.#publishVariableDefinitions()
		// presets are validated against the action and feedback definitions, so those go first
		if (all || this.#portsDirty || this.#choicesDirty) {
			UpdateActions(this)
			UpdateFeedbacks(this)
		}
		if (all || this.#portsDirty) UpdatePresets(this)
		this.#portsDirty = false
		this.#choicesDirty = false
		this.checkAllFeedbacks()
	}
}
