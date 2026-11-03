import {
	InstanceBase,
	InstanceStatus,
	TCPHelper,
	type CompanionVariableValues,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { NEXT_AUTO_ROUTE, USE_DEFAULT, videoFormatLabel } from './choices.js'
import { AUTO_ROUTE_ORDER, DEFAULT_VIDEO, GetConfigFields, type AutoRouteMode, type ModuleConfig } from './config.js'
import { SELECTION_FEEDBACKS, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import {
	Cmd,
	LineBuffer,
	commandTimeoutMs,
	fitName,
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

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly state = new RouterState()

	#socket: TCPHelper | undefined
	readonly #lines = new LineBuffer()
	readonly #queue = new CommandQueue((command) => this.#write(command), commandTimeoutMs)
	#awaitingSize = true
	/** Names just sent to the router, to compare with what it reports back */
	readonly #renames = new Map<string, string>()
	#recording = false
	/** Counts what has been recorded, so only a repeat within one salvo replaces an earlier action */
	#recordStep = 0
	/** Staged routes collected from the reply to the V? in progress */
	#presetSweep: Map<number, number> | undefined
	#pollTimer: ReturnType<typeof setInterval> | undefined
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
		return GetConfigFields()
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
		this.#publishAutoRouteMode()
	}

	#publishAutoRouteMode(): void {
		this.setVariableValues({ auto_route_mode: this.autoRouteMode.toUpperCase() })
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
		this.#renames.set(`${kind}${index}`, fitted)
		this.#send(Cmd.rename(kind, index, fitted))
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

	#connect(): void {
		this.#disconnect()

		const { host, port } = this.config
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host configured')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		const socket = new TCPHelper(host, port)
		this.#socket = socket

		socket.on('status_change', (status, message) => {
			this.updateStatus(status, message)
			if (status !== InstanceStatus.Ok) this.#queue.clear()
		})
		socket.on('error', (err) => this.log('error', `Network error: ${err.message}`))
		socket.on('connect', () => {
			this.#lines.reset()
			this.#queue.clear()
			this.#awaitingSize = true
			this.#requestInitialState()
		})
		socket.on('data', (data) => {
			for (const line of this.#lines.push(data)) {
				const message = parseLine(line, this.#queue.pending)
				if (message) this.#handleMessage(message)
			}
		})
	}

	#disconnect(): void {
		this.#stopPolling()
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
		this.#socket.send(`${command}\r`)
		return true
	}

	/** Operator commands jump ahead of the bulk reads made while syncing with the router */
	#send(command: string, urgent = true): void {
		if (!this.#socket?.isConnected) {
			this.log('warn', `Not connected, dropped command: ${command}`)
			return
		}
		if (!this.#queue.enqueue(command, urgent)) this.log('warn', `Command queue full, dropped command: ${command}`)
	}

	/** Ask which CPU is active and how big each level is; the rest is requested once the size is known */
	#requestInitialState(): void {
		this.#send(Cmd.cpuStatus(), false)
		for (let level = 0; level < MAX_LEVELS; level++) this.#send(Cmd.systemSize(level), false)
	}

	#requestRouterContents(level: string): void {
		this.#send(Cmd.crosspoints(level), false)
		this.#send(Cmd.presetStatus(level), false)
		for (const kind of ['src', 'dst'] as const) {
			const count = kind === 'src' ? this.state.srcCount : this.state.dstCount
			for (let block = 0; block < Math.ceil(count / NAMES_PER_BLOCK); block++) {
				this.#send(Cmd.names(kind, block * NAMES_PER_BLOCK), false)
			}
		}
		for (let dst = 0; dst < this.state.dstCount; dst++) this.#send(Cmd.lockStatus(level, dst), false)
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
		const seconds = Number(this.config.pollInterval ?? 5)
		if (!(seconds > 0)) return
		this.#pollTimer = setInterval(() => {
			if (this.#queue.idle && this.#socket?.isConnected) this.#refreshRoutes()
		}, seconds * 1000)
	}

	#stopPolling(): void {
		if (this.#pollTimer) clearInterval(this.#pollTimer)
		this.#pollTimer = undefined
	}

	// ---- incoming messages ------------------------------------------------------------------

	#handleMessage(message: Message): void {
		const { state } = this
		switch (message.type) {
			case 'prompt':
				if (this.#isPresetRead(this.#queue.pending)) this.#finishPresetSweep()
				this.#queue.acknowledge()
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
				this.setVariableValues({
					[xptVar(message.dst)]: toHex(message.src),
					[xptNameVar(message.dst)]: state.routedSrcName(message.dst),
					[xptPendingVar(message.dst)]: pendingText(state, message.dst),
				})
				if (message.dst === state.selectedDst) this.setVariableValues(selectionValues(state))
				this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'PresetSource', 'PresetDestination')
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
				if (state.setName(message.kind, message.index, message.name)) this.#nameChanged(message.kind, message.index)
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
		this.checkFeedbacks(...SELECTION_FEEDBACKS)
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
		this.checkFeedbacks('PresetSource', 'PresetDestination')
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
