export type ActiveSelection = 'src' | 'dst'

/**
 * What we know about the router and what the operator has selected.
 * Ports are zero based numbers; formatting for display or the wire happens elsewhere.
 */
export class RouterState {
	routerId: string | undefined
	level: string | undefined
	dstCount = 0
	srcCount = 0
	readonly dstNames = new Map<number, string>()
	readonly srcNames = new Map<number, string>()
	/** destination -> source currently routed */
	readonly routes = new Map<number, number>()
	/** destination -> source staged by a preset, waiting for the salvo to be taken */
	readonly presets = new Map<number, number>()
	/** destination -> lock mode (0 unlocked, 1 lock all, 2 lock others) */
	readonly locks = new Map<number, number>()
	/** destination -> unit ID that set the lock */
	readonly lockOwners = new Map<number, string>()

	selectedDst: number | undefined
	selectedSrc: number | undefined
	/** The pair on show has been staged; the next source starts a new pair, the next destination reuses the source */
	staged = false
	active: ActiveSelection | undefined
	/** Which half of the flash is showing; stays true while nothing is flashing */
	flashOn = true

	setSize(outputs: number, inputs: number): boolean {
		const changed = outputs !== this.dstCount || inputs !== this.srcCount
		this.dstCount = outputs
		this.srcCount = inputs
		return changed
	}

	/** Returns true if the name changed */
	setName(kind: 'src' | 'dst', index: number, name: string): boolean {
		const names = kind === 'src' ? this.srcNames : this.dstNames
		if (names.get(index) === name) return false
		names.set(index, name)
		return true
	}

	dstName(index: number): string {
		return this.dstNames.get(index) ?? `DST-${index + 1}`
	}

	srcName(index: number): string {
		return this.srcNames.get(index) ?? `SRC-${index + 1}`
	}

	selectDst(index: number): void {
		this.selectedDst = index
		this.staged = false
		this.active = 'dst'
	}

	selectSrc(index: number): void {
		if (this.staged) this.selectedDst = undefined
		this.staged = false
		this.selectedSrc = index
		this.active = 'src'
	}

	clearSelection(): void {
		this.staged = false
		this.selectedDst = undefined
		this.selectedSrc = undefined
		this.active = undefined
	}

	/** The source routed to the selected destination */
	get selectedDstSrc(): number | undefined {
		return this.selectedDst === undefined ? undefined : this.routes.get(this.selectedDst)
	}

	isSrcSelected(src: number): boolean {
		return this.selectedSrc === src
	}

	/** The selected source, while it is chosen for the selected destination but not routed or staged yet */
	get nextSrc(): number | undefined {
		const { selectedDst, selectedSrc } = this
		if (selectedDst === undefined || selectedSrc === undefined || this.staged) return undefined
		return this.routes.get(selectedDst) === selectedSrc ? undefined : selectedSrc
	}

	/** Routes are staged that a take would change */
	get hasStagedRoutes(): boolean {
		return [...this.presets.keys()].some((dst) => this.pendingSrc(dst) !== undefined)
	}

	isDstSelected(dst: number): boolean {
		return this.selectedDst === dst
	}

	/** Name of the source routed to `dst`, or '' while the route is not known */
	routedSrcName(dst: number): string {
		const src = this.routes.get(dst)
		return src === undefined ? '' : this.srcName(src)
	}

	/** True for the source routed to the selected destination */
	isRoutedSrc(src: number): boolean {
		return this.active === 'dst' && this.selectedDstSrc === src
	}

	/** True for each destination carrying the selected source */
	isRoutedDst(dst: number): boolean {
		return this.active === 'src' && this.selectedSrc !== undefined && this.routes.get(dst) === this.selectedSrc
	}

	/** The source staged for `dst`, if it differs from what is routed now */
	pendingSrc(dst: number): number | undefined {
		const staged = this.presets.get(dst)
		return staged !== undefined && staged !== this.routes.get(dst) ? staged : undefined
	}

	isLocked(dst: number): boolean {
		return (this.locks.get(dst) ?? 0) > 0
	}

	/** The router won't switch this destination for us: locked for all units, or for others by another unit */
	refusesCut(dst: number): boolean {
		const mode = this.locks.get(dst)
		return mode === 1 || (mode === 2 && this.lockOwners.get(dst) !== this.routerId)
	}
}
