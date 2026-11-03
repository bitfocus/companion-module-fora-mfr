/**
 * Pins the fake router to the bytes measured on a real MFR, so the end-to-end tests run against
 * something that behaves like the hardware. If one of these fails, the simulator has drifted.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeMfr, RawClient, until } from './fake-mfr.js'

describe('FakeMfr matches the bytes measured on a real router', () => {
	let router: FakeMfr
	let client: RawClient

	beforeEach(async () => {
		router = new FakeMfr({ levels: { 0: { dst: 64, src: 64 } } })
		await router.start()
		client = await router.connectClient()
	})

	afterEach(async () => {
		await router.stop()
	})

	it('answers A? with the unit ID', async () => {
		expect(await client.request('@ A?')).toBe('@ A?\r\r\nA:15\r\n\r\n>')
	})

	it('answers F? after a single CR, as highest index, and with nothing for a level with no size', async () => {
		expect(await client.request('@ F?0')).toBe('@ F?0\rF:03F,3F/3F,3F\r\r\n>')
		expect(await client.request('@ F?1')).toBe('@ F?1\r\r\n>')
	})

	it('puts the next echo straight after the prompt, on the same line', async () => {
		await client.request('@ F?1')
		await client.request('@ F?1')
		expect(client.output).toBe('@ F?1\r\r\n>@ F?1\r\r\n>')
	})

	it('lists every crosspoint for S?, unpadded, with the prompt after the last line', async () => {
		const reply = await client.request('@ S?0')
		expect(reply.startsWith('@ S?0\r\r\nS:00,1\r\n\r\nS:01,2\r\n\r\n')).toBe(true)
		expect(reply.endsWith('S:03F,0\r\n\r\n>')).toBe(true)
		expect(reply.match(/S:/g)).toHaveLength(64)
	})

	it('lists only what this client staged for V?', async () => {
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\n>')
		expect(await client.request('@ P:0/05,02')).toBe('@ P:0/05,02\r\r\n>')
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\nV:05,2\r\n\r\n>')

		const other = await router.connectClient()
		expect(await other.request('@ V?0')).toBe('@ V?0\r\r\n>')
		// the other client can neither clear nor take what this one staged
		expect(await other.request('@ B:C')).toBe('@ B:C\r\r\n>')
		expect(await other.request('@ B:E')).toBe('@ B:E\r\r\n\r\n>')
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\nV:05,2\r\n\r\n>')
		expect(router.route('0', 5)).toBe(6)
	})

	it('clears the staged list with B:C', async () => {
		await client.request('@ P:0/03,06')
		expect(await client.request('@ B:C')).toBe('@ B:C\r\r\n>')
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\n>')
	})

	it('takes the staged list with B:E, prompting before the C: and S: responses, which every client gets', async () => {
		const other = await router.connectClient()
		await client.request('@ P:0/05,02')
		expect(await client.request('@ B:E')).toBe('@ B:E\r\r\n>\r\nC:0/5,2:I15\r\n\r\nS:05,2\r\n')
		await until(() => other.settled)
		expect(other.output).toBe('\r\nC:0/5,2:I15\r\n\r\nS:05,2\r\n')
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\n>')
		expect(await client.request('@ B:E')).toBe('@ B:E\r\r\n\r\n>')
		expect(router.route('0', 5)).toBe(2)
	})

	it('cuts with X:, prompting before the C: and S: responses, which every client gets', async () => {
		const other = await router.connectClient()
		expect(await client.request('@ X:0/03,06')).toBe('@ X:0/03,06\r\r\n>\r\nC:0/3,6:I15\r\n\r\nS:03,6\r\n')
		await until(() => other.settled)
		expect(other.output).toBe('\r\nC:0/3,6:I15\r\n\r\nS:03,6\r\n')
		expect(router.route('0', 3)).toBe(6)
	})

	it('keeps a route staged for a destination after a cut to it', async () => {
		await client.request('@ P:0/03,05')
		await client.request('@ X:0/03,06')
		expect(await client.request('@ V?0')).toBe('@ V?0\r\r\nV:03,5\r\n\r\n>')
	})

	it('locks with W:, answering directly and then telling every client about each level', async () => {
		const other = await router.connectClient()
		const levels = Array.from({ length: 8 }, (_, level) => `W!${level}7,15,1\r\n`).join('')
		expect(await client.request('@ W:0/07,15,1')).toBe(`@ W:0/07,15,1\r\r\nW!07,15,1\r\r\n>\r\n${levels}`)
		await until(() => other.settled)
		expect(other.output).toBe(`\r\n${levels}`)
		expect(await client.request('@ W?0,07')).toBe('@ W?0,07\r\r\nW!07,15,1\r\n\r\n>')
	})

	it('unlocks with mode 0, reporting ID 0', async () => {
		await client.request('@ W:0/07,15,1')
		const reply = await client.request('@ W:0/07,15,0')
		expect(reply.startsWith('@ W:0/07,15,0\r\r\nW!07,0,0\r\r\n>\r\nW!07,0,0\r\n')).toBe(true)
		expect(await client.request('@ W?0,07')).toBe('@ W?0,07\r\r\nW!07,0,0\r\n\r\n>')
	})

	it('refuses a cut to a destination locked with mode 1', async () => {
		await client.request('@ W:0/07,15,1')
		expect(await client.request('@ X:0/07,01')).toBe('@ X:0/07,01\r\r\n>')
		expect(router.route('0', 7)).toBe(8)
	})

	it('returns up to 32 names per K? block, and nothing beyond the system size', async () => {
		const reply = await client.request('@ K?SA,000')
		expect(reply.startsWith('@ K?SA,000\r\r\nK:SA000,5352432031\r\n\r\nK:SA001,5352432032\r\n\r\n')).toBe(true)
		expect(reply.endsWith('\r\n\r\n>')).toBe(true)
		expect(reply.match(/K:SA/g)).toHaveLength(32)
		expect(await client.request('@ K?SA,040')).toBe('@ K?SA,040\r\r\n>')
	})

	it('drops non-ASCII bytes from an imported name and keeps 16 characters', async () => {
		const hexOf = (bytes: string): string => Buffer.from(bytes, 'latin1').toString('hex').toUpperCase()
		expect(await client.request('@ K:DA007,53C3BC6420C3A9')).toBe('@ K:DA007,53C3BC6420C3A9\r\r\n>')
		expect(await client.request('@ K?DA,007')).toContain('K:DA007,536420\r\n')
		await client.request(`@ K:DA007,${hexOf('ABCDEFGHIJKLMNOPQRST')}`)
		expect(await client.request('@ K?DA,007')).toContain(`K:DA007,${hexOf('ABCDEFGHIJKLMNOP')}\r\n`)
	})

	it('resets a third connection while two are open', async () => {
		const second = await router.connectClient()
		const third = new RawClient(router)
		await until(() => third.closed, 'the third connection to close')
		expect(third.error?.code).toBe('ECONNRESET')
		expect(router.rejected).toBe(1)
		// the two that were in still work
		expect(await second.request('@ F?1')).toBe('@ F?1\r\r\n>')
		expect(await client.request('@ F?1')).toBe('@ F?1\r\r\n>')
	})

	it('takes a third connection once one of two closes', async () => {
		const second = await router.connectClient()
		// a client's connect can fire before the server has accepted it
		await until(() => router.openConnections.length === 2)
		second.close()
		await until(() => router.openConnections.length === 1)
		const third = await router.connectClient()
		expect(await third.request('@ F?1')).toBe('@ F?1\r\r\n>')
	})
})

describe('FakeMfr holds', () => {
	it('pauses a reply and lets the rest through on release', async () => {
		const router = new FakeMfr()
		await router.start()
		try {
			const client = await router.connectClient()
			const hold = router.hold('@ A?', 3)
			await until(() => client.connection !== undefined, 'the router to accept the client')
			client.send('@ A?')
			await until(() => hold.reached, 'the hold')
			await until(() => client.output === '@ A', 'the first part')
			hold.release()
			await until(() => client.settled, 'the rest of the reply')
			expect(client.output).toBe('@ A?\r\r\nA:15\r\n\r\n>')
			// a hold is used once
			expect(await client.request('@ A?')).toBe('@ A?\r\r\nA:15\r\n\r\n>')
		} finally {
			await router.stop()
		}
	})

	it('releases a paused reply on stop, so a failing test cannot leave it stuck', async () => {
		const router = new FakeMfr()
		await router.start()
		const client = await router.connectClient()
		const unused = router.hold('@ F?0', 1)
		const hold = router.hold('@ A?', 3)
		await until(() => client.connection !== undefined, 'the router to accept the client')
		const connection = client.connection!
		client.send('@ A?')
		await until(() => hold.reached, 'the hold')
		expect(connection.busy).toBe(true)

		await router.stop()
		expect(hold.released).toBe(true)
		expect(unused.released).toBe(true)
		await until(() => !connection.busy, 'the paused reply to finish')
	})
})
