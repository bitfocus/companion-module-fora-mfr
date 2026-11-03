import { describe, expect, it } from 'vitest'
import { RouterState } from '../state.js'
import { selectionValues } from '../variables.js'

describe('what flashes', () => {
	it('flashes the selected source only while it would change the selected destination', () => {
		const state = routerWith()
		state.selectSrc(5)
		expect(state.nextSrc).toBeUndefined() // no destination to compare with
		state.selectDst(1)
		expect(state.nextSrc).toBe(5)
		state.selectSrc(3) // already routed
		expect(state.nextSrc).toBeUndefined()
		state.selectSrc(5)
		state.staged = true
		expect(state.nextSrc).toBeUndefined()
		state.selectDst(2) // the next destination reuses the source
		expect(state.nextSrc).toBe(5)
	})

	it('counts only staged routes that a take would change', () => {
		const state = routerWith()
		expect(state.hasStagedRoutes).toBe(false)
		state.presets.set(1, 3) // already routed
		expect(state.hasStagedRoutes).toBe(false)
		state.presets.set(2, 5)
		expect(state.hasStagedRoutes).toBe(true)
	})
})

function routerWith(): RouterState {
	const state = new RouterState()
	state.setSize(4, 8)
	state.setName('dst', 1, 'MON1')
	state.setName('src', 3, 'CAM3')
	state.routes.set(1, 3)
	return state
}

describe('RouterState selection', () => {
	it('selecting a destination keeps the source and marks destination active', () => {
		const state = routerWith()
		state.selectSrc(2)
		state.selectDst(1)
		expect(state.selectedSrc).toBe(2)
		expect(state.active).toBe('dst')
		expect(state.isDstSelected(1)).toBe(true)
		expect(state.isDstSelected(0)).toBe(false)
	})

	it('highlights the source routed to the selected destination', () => {
		const state = routerWith()
		state.selectDst(1)
		expect(state.isRoutedSrc(3)).toBe(true)
		expect(state.isRoutedSrc(2)).toBe(false)
	})

	it('highlights destinations carrying the selected source', () => {
		const state = routerWith()
		state.routes.set(2, 3)
		state.selectSrc(3)
		expect(state.isRoutedDst(1)).toBe(true)
		expect(state.isRoutedDst(2)).toBe(true)
		expect(state.isRoutedDst(0)).toBe(false)
	})

	it('does not report routed destinations when no source is selected', () => {
		const state = routerWith()
		state.selectDst(0)
		expect(state.isRoutedDst(0)).toBe(false)
	})

	it('keeps both ends of the pair, whichever is selected first', () => {
		const state = routerWith()
		state.selectSrc(3)
		state.selectDst(1)
		expect(state.isSrcSelected(3)).toBe(true)
		expect(state.isDstSelected(1)).toBe(true)
		state.selectDst(2)
		expect(state.isSrcSelected(3)).toBe(true)
		expect(state.isDstSelected(1)).toBe(false)
		expect(state.isDstSelected(2)).toBe(true)
	})

	it('clearing the selection resets everything', () => {
		const state = routerWith()
		state.selectDst(1)
		state.selectSrc(3)
		state.clearSelection()
		expect(state.active).toBeUndefined()
		expect(state.selectedDstSrc).toBeUndefined()
	})

	it('expects a cut to be refused when locked for all, or for others by another unit', () => {
		const state = routerWith()
		state.routerId = '15'
		expect(state.refusesCut(0)).toBe(false)
		state.locks.set(0, 1)
		state.lockOwners.set(0, '15')
		expect(state.refusesCut(0)).toBe(true)
		state.locks.set(0, 2)
		expect(state.refusesCut(0)).toBe(false)
		state.lockOwners.set(0, '20')
		expect(state.refusesCut(0)).toBe(true)
		state.locks.set(0, 0)
		expect(state.refusesCut(0)).toBe(false)
	})

	it('treats any lock mode above zero as locked', () => {
		const state = routerWith()
		state.locks.set(0, 1)
		state.locks.set(1, 2)
		state.locks.set(2, 0)
		expect(state.isLocked(0)).toBe(true)
		expect(state.isLocked(1)).toBe(true)
		expect(state.isLocked(2)).toBe(false)
		expect(state.isLocked(3)).toBe(false)
	})

	it('falls back to a numbered name until the router supplies one', () => {
		const state = routerWith()
		expect(state.dstName(0)).toBe('DST-1')
		expect(state.srcName(3)).toBe('CAM3')
	})

	it('reports whether a size or name actually changed', () => {
		const state = new RouterState()
		expect(state.setSize(4, 8)).toBe(true)
		expect(state.setSize(4, 8)).toBe(false)
		expect(state.setName('dst', 0, 'A')).toBe(true)
		expect(state.setName('dst', 0, 'A')).toBe(false)
	})
})

describe('pendingSrc', () => {
	it('is the staged source only while it differs from the routed one', () => {
		const state = routerWith()
		state.routes.set(1, 3)
		expect(state.pendingSrc(1)).toBeUndefined()
		state.presets.set(1, 2)
		expect(state.pendingSrc(1)).toBe(2)
		state.routes.set(1, 2)
		expect(state.pendingSrc(1)).toBeUndefined()
	})
})

describe('selectionValues', () => {
	it('is null, apart from the lock button text, with nothing selected', () => {
		const {
			selected_dst_lock_text: lockText,
			selected_dst_label: dstLabel,
			selected_src_label: srcLabel,
			...values
		} = selectionValues(routerWith())
		expect(lockText).toBe('[UN]LOCK\nDST')
		expect([dstLabel, srcLabel]).toEqual(['DST', 'SRC'])
		expect(Object.values(values).every((v) => v === null)).toBe(true)
	})

	it('exposes the same variables and formats as v1', () => {
		const state = routerWith()
		state.selectDst(1)
		expect(selectionValues(state)).toEqual({
			selected_dst_id: '01',
			selected_dst_lock_action: 'LOCK',
			selected_dst_preset_src_id: null,
			selected_dst_preset_src_name: null,
			selected_dst_lock_text: 'LOCK\nMON1',
			selected_dst_label: 'MON1',
			selected_src_label: 'SRC',
			selected_dst_name: 'MON1',
			selected_dst_src_id: '03',
			selected_dst_src_name: 'CAM3',
			selected_src_id: null,
			selected_src_name: null,
			active_selected_id: '01',
			active_selected_name: 'MON1',
			active_selected_type: 'dst',
		})
		state.selectSrc(3)
		expect(selectionValues(state)).toMatchObject({
			selected_src_id: '03',
			selected_src_name: 'CAM3',
			active_selected_id: '03',
			active_selected_name: 'CAM3',
			active_selected_type: 'src',
		})
	})
})
