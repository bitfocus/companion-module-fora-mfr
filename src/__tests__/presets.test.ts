import { describe, expect, it, vi } from 'vitest'
import type ModuleInstance from '../main.js'
import { UpdatePresets } from '../presets.js'
import { RouterState } from '../state.js'

function build(dstCount: number, srcCount: number): Record<string, any> {
	const state = new RouterState()
	state.setSize(dstCount, srcCount)
	const setPresetDefinitions = vi.fn()
	UpdatePresets({ state, setPresetDefinitions } as unknown as ModuleInstance)
	return setPresetDefinitions.mock.calls[0][1] as Record<string, any>
}

describe('presets', () => {
	it('offers a layered stacked destination button with a plain text fallback under one id', () => {
		const presets = build(2, 2)
		const routed = presets.routed_1
		expect(routed.type).toBe('alternatives')
		const [layered, simple] = routed.variants
		expect(layered.type).toBe('layered')
		expect(simple.type).toBe('simple')

		// the arrow and staged source are hidden until a route is staged for the destination
		const hidden = layered.elements.filter((e: any) => e.enabled === false).map((e: any) => e.id)
		expect(hidden).toEqual(['arrow', 'pending'])
		const staged = layered.feedbacks.find((f: any) => f.feedbackId === 'PresetDestination')
		expect(staged.options).toEqual({ dst: '01' })
		expect(staged.styleOverrides).toEqual(
			expect.arrayContaining([
				{ elementId: 'arrow', elementProperty: 'enabled', override: true },
				{ elementId: 'pending', elementProperty: 'enabled', override: true },
			]),
		)
		// every override points at an element that exists
		const ids = new Set(layered.elements.map((e: any) => e.id))
		for (const feedback of layered.feedbacks) {
			for (const o of feedback.styleOverrides) expect(ids.has(o.elementId)).toBe(true)
		}
	})

	it('steps the auto-route mode from one button that shows and colours the mode', () => {
		const [layered, simple] = build(2, 2).auto_route.variants
		expect(layered.steps).toEqual([{ down: [{ actionId: 'setAutoRoute', options: { mode: 'next' } }], up: [] }])
		expect(layered.elements.at(-1).text).toBe('AUTO\n$(fora-mfr:auto_route_mode)')
		expect(layered.elements.at(-1).fontsize).toBe(32)
		expect(layered.feedbacks.slice(0, 2).map((f: any) => [f.options.mode, f.styleOverrides[0].override])).toEqual([
			['preset', 0xff8000],
			['cut', 0xff0000],
		])
		expect(simple.feedbacks).toHaveLength(3)
	})

	it('flashes the salvo button while routes are staged, and lets a staged source show orange', () => {
		const presets = build(2, 2)
		const take = presets.switch_preset_xpts.variants[0]
		expect(take.feedbacks.map((f: any) => f.feedbackId)).toEqual(['StagedRoutes', 'internal:buttonPushed'])
		expect(take.feedbacks[0].styleOverrides[0].override).toBe(0xff8000)
		const source = presets.src_0.variants[0]
		expect(source.feedbacks.map((f: any) => f.feedbackId)).toEqual([
			'RoutedSource',
			'SelectedSource',
			'internal:buttonPushed',
			'PresetSource',
		])
	})

	it('lights a port button while it is held, below the staged and locked colours', () => {
		const presets = build(2, 2)
		const order = (id: string): string[] => presets[id].variants[0].feedbacks.map((f: any) => f.feedbackId)
		expect(order('dst_0')).toEqual([
			'RoutedDestination',
			'SelectedDestination',
			'internal:buttonPushed',
			'PresetDestination',
			'LockedDestination',
		])
		expect(order('routed_0')).toEqual([
			'SelectedDestination',
			'internal:buttonPushed',
			'PresetDestination',
			'LockedDestination',
		])
		expect(order('src_0')).toContain('internal:buttonPushed')
	})

	it('lights every button while it is held', () => {
		const presets = build(2, 2)
		for (const [id, preset] of Object.entries(presets)) {
			const ids = preset.variants[0].feedbacks.map((f: any) => f.feedbackId)
			expect(ids, id).toContain('internal:buttonPushed')
		}
		for (const id of ['blank', 'cut_xpt', 'switch_preset_xpts', 'auto_route', 'lock_dst']) {
			const feedbacks = presets[id].variants[0].feedbacks
			expect(feedbacks.at(-1).feedbackId, id).toBe('internal:buttonPushed')
			expect(feedbacks.at(-1).styleOverrides[0].override, id).toBe(0xffffff)
		}
	})

	it('keeps stable preset ids', () => {
		const presets = build(2, 3)
		expect(Object.keys(presets).sort()).toEqual(
			[
				'blank',
				'cut_xpt',
				'preset_xpt',
				'switch_preset_xpts',
				'clear_preset_xpts',
				'lock_dst',
				'auto_route',
				'dst_0',
				'dst_1',
				'routed_0',
				'routed_1',
				'src_0',
				'src_1',
				'src_2',
			].sort(),
		)
	})
})
