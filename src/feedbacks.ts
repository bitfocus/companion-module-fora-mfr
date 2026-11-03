import { AUTO_ROUTE_MODES, destinationChoices, sourceChoices } from './choices.js'
import type ModuleInstance from './main.js'
import { parseHex } from './protocol.js'

export const SELECTION_FEEDBACKS = [
	'SelectedSource',
	'SelectedDestination',
	'RoutedSource',
	'RoutedDestination',
	'PresetSource',
	'StagedRoutes',
] as const

export type FeedbacksSchema = {
	SelectedSource: { type: 'boolean'; options: { src: string } }
	SelectedDestination: { type: 'boolean'; options: { dst: string } }
	RoutedSource: { type: 'boolean'; options: { src: string } }
	RoutedDestination: { type: 'boolean'; options: { dst: string } }
	PresetSource: { type: 'boolean'; options: { src: string } }
	PresetDestination: { type: 'boolean'; options: { dst: string } }
	LockedDestination: { type: 'boolean'; options: { dst: string } }
	AutoRouteMode: { type: 'boolean'; options: { mode: string } }
	StagedRoutes: { type: 'boolean'; options: Record<string, never> }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const dst = destinationChoices(self.state)
	const src = sourceChoices(self.state)
	const { state } = self

	self.setFeedbackDefinitions({
		SelectedSource: {
			name: 'Show selected source',
			type: 'boolean',
			description:
				'If this source is selected the button will be highlighted irrespective of routing. It flashes while it is the next source for the selected destination.',
			defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'src', label: 'Source :', default: '00', choices: src }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.src)
				if (port === undefined || !state.isSrcSelected(port)) return false
				return port !== state.nextSrc || state.flashOn
			},
		},
		SelectedDestination: {
			name: 'Show selected destination',
			type: 'boolean',
			description: 'If this destination is selected the button will be highlighted irrespective of routing',
			defaultStyle: { bgcolor: 0xff0000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'dst', label: 'Destination :', default: '00', choices: dst }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.dst)
				return port !== undefined && state.isDstSelected(port)
			},
		},
		RoutedSource: {
			name: 'Routed source',
			type: 'boolean',
			description: 'True if this source is routed to the selected destination',
			defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'src', label: 'Source :', default: '00', choices: src }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.src)
				return port !== undefined && state.isRoutedSrc(port)
			},
		},
		RoutedDestination: {
			name: 'Routed destination',
			type: 'boolean',
			description: 'True if the selected source is routed to this destination',
			defaultStyle: { bgcolor: 0xff0000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'dst', label: 'Destination :', default: '00', choices: dst }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.dst)
				return port !== undefined && state.isRoutedDst(port)
			},
		},
		PresetSource: {
			name: 'Staged source',
			type: 'boolean',
			description: 'True if this source is staged for the selected destination',
			defaultStyle: { bgcolor: 0xff8000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'src', label: 'Source :', default: '00', choices: src }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.src)
				return port !== undefined && state.selectedDst !== undefined && state.pendingSrc(state.selectedDst) === port
			},
		},
		PresetDestination: {
			name: 'Staged destination',
			type: 'boolean',
			description: 'True if a route is staged for this destination and has not been taken yet',
			defaultStyle: { bgcolor: 0xff8000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'dst', label: 'Destination :', default: '00', choices: dst }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.dst)
				return port !== undefined && state.pendingSrc(port) !== undefined
			},
		},
		LockedDestination: {
			name: 'Locked destination',
			type: 'boolean',
			description: 'True if this destination is locked',
			defaultStyle: { bgcolor: 0x800000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'dst', label: 'Destination :', default: '00', choices: dst }],
			callback: (feedback) => {
				const port = parseHex(feedback.options.dst)
				return port !== undefined && state.isLocked(port)
			},
		},
		StagedRoutes: {
			name: 'Staged routes waiting',
			type: 'boolean',
			description: 'Flashes while routes are staged and have not been taken',
			defaultStyle: { bgcolor: 0xff8000, color: 0x000000 },
			options: [],
			callback: () => state.hasStagedRoutes && state.flashOn,
		},
		AutoRouteMode: {
			name: 'Auto-route mode',
			type: 'boolean',
			description: 'True if the auto-route mode is this one',
			defaultStyle: { bgcolor: 0xff0000, color: 0x000000 },
			options: [{ type: 'dropdown', id: 'mode', label: 'Mode :', default: 'cut', choices: AUTO_ROUTE_MODES }],
			callback: (feedback) => feedback.options.mode === self.autoRouteMode,
		},
	})
}
