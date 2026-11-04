import { describe, expect, it, vi } from 'vitest'
import type { CompanionHTTPRequest } from '@companion-module/base'
import { handleNamesRequest, type NamesHost } from '../names-page.js'
import { RouterState } from '../state.js'

function setup(connected = true): NamesHost & { rename: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } {
	const state = new RouterState()
	state.setSize(2, 3)
	state.setName('dst', 0, 'MON 1')
	state.setName('src', 2, 'CAM <3>')
	return { state, connected, rename: vi.fn(), log: vi.fn() }
}

function request(method: string, path: string, body?: unknown, headers = {}): CompanionHTTPRequest {
	return {
		method,
		path,
		baseUrl: '',
		originalUrl: path,
		hostname: 'companion.local',
		ip: '127.0.0.1',
		query: {},
		headers: { host: 'companion.local:8000', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	}
}

const post = (host: NamesHost, changes: unknown, headers = {}) =>
	handleNamesRequest(host, request('POST', '/names', { changes }, headers))

describe('the port names page', () => {
	it('serves the page, with or without a trailing slash', () => {
		for (const path of ['/', '']) {
			const response = handleNamesRequest(setup(), request('GET', path))
			expect(response.status).toBe(200)
			expect(response.headers?.['Content-Type']).toContain('text/html')
			expect(response.body).toContain('MFR port names')
		}
	})

	it('never writes names into the page as markup', () => {
		const { body } = handleNamesRequest(setup(), request('GET', '/'))
		expect(body).not.toContain('innerHTML')
	})

	it('lists every port in order, as json', () => {
		const response = handleNamesRequest(setup(), request('GET', '/names'))
		expect(JSON.parse(response.body!)).toEqual({
			connected: true,
			dst: ['MON 1', 'DST-2'],
			src: ['SRC-1', 'SRC-2', 'CAM <3>'],
		})
	})

	it('renames by the port number people see, sending the hex id the module uses', () => {
		const host = setup()
		const response = post(host, [
			{ kind: 'dst', port: 2, name: 'MON 2' },
			{ kind: 'src', port: 1, name: 'CAM 1' },
		])
		expect(response.status).toBe(200)
		expect(JSON.parse(response.body!)).toEqual({ sent: 2 })
		expect(host.rename.mock.calls).toEqual([
			['dst', '01', 'MON 2'],
			['src', '00', 'CAM 1'],
		])
	})

	it('accepts the body already parsed, as Companion passes a JSON request', () => {
		const host = setup()
		const changes = [{ kind: 'dst', port: 1, name: 'MON' }]
		const parsed = { ...request('POST', '/names'), body: { changes } as unknown as string }
		expect(handleNamesRequest(host, parsed).status).toBe(200)
		expect(host.rename).toHaveBeenCalledWith('dst', '00', 'MON')
		const empty = { ...request('POST', '/names'), body: undefined }
		expect(handleNamesRequest(host, empty).status).toBe(400)
	})

	it('logs how many names it is sending, and nothing when there are none', () => {
		const host = setup()
		post(host, [])
		expect(host.log).not.toHaveBeenCalled()
		post(host, [{ kind: 'dst', port: 1, name: 'A' }])
		expect(host.log).toHaveBeenLastCalledWith('Names page: sending 1 name')
		post(host, [
			{ kind: 'dst', port: 1, name: 'A' },
			{ kind: 'src', port: 1, name: 'B' },
		])
		expect(host.log).toHaveBeenLastCalledWith('Names page: sending 2 names')
	})

	it.each([
		['a port beyond the router', { kind: 'dst', port: 3, name: 'x' }, 'No such port: dst 3'],
		['port zero', { kind: 'src', port: 0, name: 'x' }, 'No such port: src 0'],
		['a fractional port', { kind: 'src', port: 1.5, name: 'x' }, 'Unknown port: src 1.5'],
		['an unknown kind', { kind: 'foo', port: 1, name: 'x' }, 'Unknown port: foo 1'],
		['an empty name', { kind: 'dst', port: 1, name: '  ' }, 'Empty name for dst 1'],
		['a name that is not text', { kind: 'dst', port: 1, name: 5 }, 'Empty name for dst 1'],
		['a row that is not an object', null, 'Unknown port: undefined undefined'],
	])('sends nothing at all if one row has %s', (_, bad, error) => {
		const host = setup()
		const response = post(host, [{ kind: 'dst', port: 1, name: 'good' }, bad])
		expect(response.status).toBe(400)
		expect(JSON.parse(response.body!)).toEqual({ error })
		expect(host.rename).not.toHaveBeenCalled()
	})

	it('rejects a body it cannot read', () => {
		const host = setup()
		expect(handleNamesRequest(host, request('POST', '/names', 'not json')).status).toBe(400)
		expect(handleNamesRequest(host, request('POST', '/names', { changes: 'x' })).status).toBe(400)
		expect(host.rename).not.toHaveBeenCalled()
	})

	it('sends nothing while disconnected', () => {
		const host = setup(false)
		expect(post(host, [{ kind: 'dst', port: 1, name: 'x' }]).status).toBe(503)
		expect(host.rename).not.toHaveBeenCalled()
	})

	it('refuses a rename from another site, but not from its own page', () => {
		const host = setup()
		const change = [{ kind: 'dst', port: 1, name: 'x' }]
		expect(post(host, change, { origin: 'https://evil.example' }).status).toBe(403)
		expect(post(host, change, { origin: 'nonsense' }).status).toBe(403)
		expect(host.rename).not.toHaveBeenCalled()
		expect(post(host, change, { origin: 'http://companion.local:8000' }).status).toBe(200)
	})

	it('answers anything else with not found', () => {
		const host = setup()
		expect(handleNamesRequest(host, request('GET', '/other')).status).toBe(404)
		expect(handleNamesRequest(host, request('DELETE', '/names')).status).toBe(404)
	})
})
