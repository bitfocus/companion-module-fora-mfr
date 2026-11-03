import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import { toHex } from './protocol.js'
import type { RouterState } from './state.js'

/** Variable ids are dynamic (dst01, src01, xpt01, ...) so values are an open record */
export type VariablesSchema = CompanionVariableValues

const pad = (index: number): string => String(index + 1).padStart(2, '0')

export const dstVar = (index: number): string => `dst${pad(index)}`
export const srcVar = (index: number): string => `src${pad(index)}`
export const xptVar = (index: number): string => `xpt${pad(index)}`
export const xptNameVar = (index: number): string => `xpt${pad(index)}_name`
export const xptPendingVar = (index: number): string => `xpt${pad(index)}_pending_name`
export const lockVar = (index: number): string => `dst${pad(index)}_locked`

export function UpdateVariableDefinitions(
	setDefinitions: (definitions: CompanionVariableDefinitions<VariablesSchema>) => void,
	state: RouterState,
): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		id: { name: 'Router unit ID' },
		auto_route_mode: { name: 'Auto-route mode (OFF, STAGE or CUT)' },
		video_format_default: { name: 'Default video format, reference and switching point from the connection settings' },
		level: { name: 'Crosspoint level' },
		outputs: { name: 'Number of destinations' },
		inputs: { name: 'Number of sources' },
		selected_dst_id: { name: 'Selected destination id (hex)' },
		selected_dst_name: { name: 'Selected destination name' },
		selected_dst_src_id: { name: 'Source id routed to the selected destination (hex)' },
		selected_dst_src_name: { name: 'Source name routed to the selected destination' },
		selected_dst_lock_action: { name: 'What the lock button will do to the selected destination (LOCK or UNLOCK)' },
		selected_dst_lock_text: { name: 'Lock button text for the selected destination, e.g. LOCK + name' },
		selected_dst_preset_src_id: { name: 'Source id staged for the selected destination (hex)' },
		selected_dst_preset_src_name: { name: 'Source name staged for the selected destination' },
		selected_dst_label: { name: 'Selected destination name, or DST while none is selected (for button text)' },
		selected_src_label: { name: 'Selected source name, or SRC while none is selected (for button text)' },
		selected_src_id: { name: 'Selected source id (hex)' },
		selected_src_name: { name: 'Selected source name' },
		active_selected_id: { name: 'Most recently selected port id (hex)' },
		active_selected_name: { name: 'Most recently selected port name' },
		active_selected_type: { name: 'Most recently selected port type (src or dst)' },
	}
	for (let i = 0; i < state.dstCount; i++) {
		const n = pad(i)
		definitions[dstVar(i)] = { name: `DST-${n} name` }
		definitions[xptVar(i)] = { name: `XPT-${n} routed source id (hex)` }
		definitions[xptNameVar(i)] = { name: `XPT-${n} routed source name` }
		definitions[xptPendingVar(i)] = { name: `XPT-${n} staged source name (empty when none)` }
		definitions[lockVar(i)] = { name: `DST-${n} lock mode` }
	}
	for (let i = 0; i < state.srcCount; i++) {
		definitions[srcVar(i)] = { name: `SRC-${pad(i)} name` }
	}
	setDefinitions(definitions)
}

/** Shown on a destination button while a preset is staged for it */
export function pendingText(state: RouterState, dst: number): string {
	const staged = state.pendingSrc(dst)
	return staged === undefined ? '' : state.srcName(staged)
}

/** The name of the routed source for every destination */
export function routedNameValues(state: RouterState): VariablesSchema {
	const values: VariablesSchema = {}
	for (let dst = 0; dst < state.dstCount; dst++) {
		values[xptNameVar(dst)] = state.routedSrcName(dst)
		values[xptPendingVar(dst)] = pendingText(state, dst)
	}
	return values
}

/** The selection related variables, derived from state */
export function selectionValues(state: RouterState): VariablesSchema {
	const { selectedDst, selectedSrc, selectedDstSrc, active } = state
	const staged = selectedDst === undefined ? undefined : state.pendingSrc(selectedDst)
	const activeIndex = active === 'dst' ? selectedDst : active === 'src' ? selectedSrc : undefined
	return {
		selected_dst_id: selectedDst === undefined ? null : toHex(selectedDst),
		selected_dst_name: selectedDst === undefined ? null : state.dstName(selectedDst),
		selected_dst_src_id: selectedDstSrc === undefined ? null : toHex(selectedDstSrc),
		selected_dst_src_name: selectedDstSrc === undefined ? null : state.srcName(selectedDstSrc),
		selected_dst_lock_action: selectedDst === undefined ? null : state.isLocked(selectedDst) ? 'UNLOCK' : 'LOCK',
		selected_dst_lock_text:
			selectedDst === undefined
				? '[UN]LOCK\nDST'
				: `${state.isLocked(selectedDst) ? 'UNLOCK' : 'LOCK'}\n${state.dstName(selectedDst)}`,
		selected_dst_preset_src_id: staged === undefined ? null : toHex(staged),
		selected_dst_preset_src_name: staged === undefined ? null : state.srcName(staged),
		selected_dst_label: selectedDst === undefined ? 'DST' : state.dstName(selectedDst),
		selected_src_label: selectedSrc === undefined ? 'SRC' : state.srcName(selectedSrc),
		selected_src_id: selectedSrc === undefined ? null : toHex(selectedSrc),
		selected_src_name: selectedSrc === undefined ? null : state.srcName(selectedSrc),
		active_selected_id: activeIndex === undefined ? null : toHex(activeIndex),
		active_selected_name:
			activeIndex === undefined ? null : active === 'dst' ? state.dstName(activeIndex) : state.srcName(activeIndex),
		active_selected_type: active ?? null,
	}
}
