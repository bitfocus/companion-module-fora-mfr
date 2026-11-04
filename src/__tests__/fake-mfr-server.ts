/**
 * Runs the fake router on its own, for trying the module in Companion without hardware:
 * yarn fake-router [--port 2323] [--size 64x64]
 */
/* eslint-disable n/no-process-exit -- a command line script */
import { parseArgs } from 'node:util'
import { FakeMfr } from './fake-mfr.js'

const { values } = parseArgs({
	options: { port: { type: 'string', default: '2323' }, size: { type: 'string', default: '64x64' } },
})

const port = Number(values.port)
const size = /^(\d+)x(\d+)$/.exec(values.size)
if (!Number.isInteger(port) || port < 1 || port > 65535 || !size) {
	console.error('Usage: yarn fake-router [--port 2323] [--size 64x64]')
	process.exit(1)
}

const [dst, src] = [Number(size[1]), Number(size[2])]
const router = new FakeMfr({ levels: { 0: { dst, src } } })
try {
	await router.start(port)
} catch (err) {
	console.error(`Could not listen on port ${port}: ${(err as Error).message}`)
	process.exit(1)
}
console.log(`Fake MFR router, ${dst} destinations and ${src} sources, at 127.0.0.1:${port}. Ctrl+C to stop.`)

process.on('SIGINT', () => {
	void router.stop().then(() => process.exit(0))
})
