/**
 * Sends commands one at a time. The MFR asks clients to send the next command only after the prompt
 * that follows the previous command and its replies, so the next command is released on the prompt,
 * or after `timeoutFor(command)` if the prompt never arrives.
 */
export class CommandQueue {
	readonly #send: (command: string) => boolean
	readonly #timeoutFor: (command: string) => number
	readonly #maxLength: number
	readonly #onTimeout: (command: string, timeoutMs: number) => void
	/** Operator commands, always sent ahead of the bulk reads in `#queue` */
	#urgent: string[] = []
	#queue: string[] = []
	#inFlight: string | undefined
	#timer: ReturnType<typeof setTimeout> | undefined

	constructor(
		send: (command: string) => boolean,
		timeoutFor: (command: string) => number,
		maxLength = 1024,
		onTimeout: (command: string, timeoutMs: number) => void = () => undefined,
	) {
		this.#send = send
		this.#timeoutFor = timeoutFor
		this.#maxLength = maxLength
		this.#onTimeout = onTimeout
	}

	/** The command currently waiting for its prompt */
	get pending(): string | undefined {
		return this.#inFlight
	}

	/** Nothing is waiting for a prompt or queued */
	get idle(): boolean {
		return this.#inFlight === undefined && this.#urgent.length === 0 && this.#queue.length === 0
	}

	/**
	 * Returns false if the queue is full and the command was dropped.
	 * `urgent` commands go ahead of everything not urgent, keeping their order among themselves.
	 */
	enqueue(command: string, urgent = false): boolean {
		if (this.#urgent.length + this.#queue.length >= this.#maxLength) return false
		;(urgent ? this.#urgent : this.#queue).push(command)
		if (this.#inFlight === undefined) this.#next()
		return true
	}

	/** Call when the router's prompt for the pending command has been seen */
	acknowledge(): void {
		if (this.#inFlight === undefined) return
		this.#inFlight = undefined
		this.#clearTimer()
		this.#next()
	}

	/** Remove commands that haven't been sent yet and match `predicate` */
	drop(predicate: (command: string) => boolean): void {
		this.#queue = this.#queue.filter((command) => !predicate(command))
	}

	/** Drop everything, e.g. when the connection is lost */
	clear(): void {
		this.#urgent = []
		this.#queue = []
		this.#inFlight = undefined
		this.#clearTimer()
	}

	#next(): void {
		const command = this.#urgent.shift() ?? this.#queue.shift()
		if (command === undefined) return
		this.#inFlight = command
		const timeoutMs = this.#timeoutFor(command)
		this.#timer = setTimeout(() => {
			this.#onTimeout(command, timeoutMs)
			this.acknowledge()
		}, timeoutMs)
		if (!this.#send(command)) {
			// not connected: no prompt will ever arrive
			this.clear()
		}
	}

	#clearTimer(): void {
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = undefined
	}
}
