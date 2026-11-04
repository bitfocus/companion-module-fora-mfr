import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandQueue } from '../queue.js'

const after500 = (): number => 500

describe('CommandQueue', () => {
	let sent: string[]
	let connected: boolean
	const send = (command: string): boolean => {
		if (!connected) return false
		sent.push(command)
		return true
	}

	beforeEach(() => {
		vi.useFakeTimers()
		sent = []
		connected = true
	})
	afterEach(() => vi.useRealTimers())

	it('sends the first command immediately and holds the rest until acknowledged', () => {
		const queue = new CommandQueue(send, after500)
		queue.enqueue('a')
		queue.enqueue('b')
		queue.enqueue('c')
		expect(sent).toEqual(['a'])
		expect(queue.pending).toBe('a')

		queue.acknowledge()
		expect(sent).toEqual(['a', 'b'])
		queue.acknowledge()
		queue.acknowledge()
		expect(sent).toEqual(['a', 'b', 'c'])
		expect(queue.pending).toBeUndefined()
	})

	it('moves on after the timeout for that command if no prompt arrives', () => {
		const queue = new CommandQueue(send, (command) => (command === 'long' ? 5000 : 1000))
		queue.enqueue('long')
		queue.enqueue('short')
		queue.enqueue('next')
		vi.advanceTimersByTime(4999)
		expect(sent).toEqual(['long'])
		vi.advanceTimersByTime(1)
		expect(sent).toEqual(['long', 'short'])
		vi.advanceTimersByTime(1000)
		expect(sent).toEqual(['long', 'short', 'next'])
	})

	it('ignores a prompt when nothing is pending', () => {
		const queue = new CommandQueue(send, after500)
		expect(() => queue.acknowledge()).not.toThrow()
		queue.enqueue('a')
		expect(sent).toEqual(['a'])
	})

	it('does not let a stale timer release the next command early', () => {
		const queue = new CommandQueue(send, after500)
		queue.enqueue('a')
		queue.enqueue('b')
		vi.advanceTimersByTime(400)
		queue.acknowledge() // sends b, new 500ms timer
		queue.enqueue('c')
		vi.advanceTimersByTime(200) // old timer would have fired here
		expect(sent).toEqual(['a', 'b'])
		vi.advanceTimersByTime(300)
		expect(sent).toEqual(['a', 'b', 'c'])
	})

	it('drops everything when clear is called', () => {
		const queue = new CommandQueue(send, after500)
		queue.enqueue('a')
		queue.enqueue('b')
		queue.clear()
		vi.advanceTimersByTime(5000)
		expect(sent).toEqual(['a'])
		expect(queue.pending).toBeUndefined()
	})

	it('abandons the queue if the connection is gone', () => {
		const queue = new CommandQueue(send, after500)
		connected = false
		queue.enqueue('a')
		queue.enqueue('b')
		expect(sent).toEqual([])
		expect(queue.pending).toBeUndefined()

		connected = true
		queue.enqueue('c')
		expect(sent).toEqual(['c'])
	})

	it('refuses commands once full', () => {
		const queue = new CommandQueue(send, after500, 2)
		expect(queue.enqueue('a')).toBe(true) // goes straight out
		expect(queue.enqueue('b')).toBe(true)
		expect(queue.enqueue('c')).toBe(true)
		expect(queue.enqueue('d')).toBe(false)
	})
})

describe('CommandQueue.drop', () => {
	it('removes only queued commands that match, never the one in flight', () => {
		vi.useFakeTimers()
		const sent: string[] = []
		const queue = new CommandQueue((c) => (sent.push(c), true), after500)
		queue.enqueue('@ F? 0')
		queue.enqueue('@ F? 1')
		queue.enqueue('@ S?0')
		queue.drop((c) => c.startsWith('@ F?'))
		queue.acknowledge()
		expect(sent).toEqual(['@ F? 0', '@ S?0'])
		vi.useRealTimers()
	})
})

describe('CommandQueue urgent lane', () => {
	it('sends urgent commands ahead of queued ones, in order, without interrupting the one in flight', () => {
		vi.useFakeTimers()
		const sent: string[] = []
		const queue = new CommandQueue((c) => (sent.push(c), true), after500)
		queue.enqueue('read1')
		queue.enqueue('read2')
		queue.enqueue('read3')
		queue.enqueue('cut1', true)
		queue.enqueue('cut2', true)
		expect(sent).toEqual(['read1'])
		queue.acknowledge()
		queue.acknowledge()
		queue.acknowledge()
		queue.acknowledge()
		expect(sent).toEqual(['read1', 'cut1', 'cut2', 'read2', 'read3'])
		vi.useRealTimers()
	})
})

describe('CommandQueue timeouts', () => {
	it('reports a command that got no prompt, but not one that did', () => {
		vi.useFakeTimers()
		const onTimeout = vi.fn()
		const queue = new CommandQueue(
			() => true,
			() => 500,
			undefined,
			onTimeout,
		)
		queue.enqueue('a')
		queue.acknowledge()
		queue.enqueue('b')
		vi.advanceTimersByTime(500)
		expect(onTimeout.mock.calls).toEqual([['b', 500]])
		vi.useRealTimers()
	})
})
