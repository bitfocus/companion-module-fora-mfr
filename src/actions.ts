import {
	AUTO_ROUTE_MODES,
	LOCK_MODES,
	NEXT_AUTO_ROUTE,
	REFERENCE_CHOICES,
	SWITCHING_POINT_CHOICES,
	USE_DEFAULT,
	VIDEO_FORMAT_CHOICES,
	destinationChoices,
	portDropdown,
	sourceChoices,
} from './choices.js'
import type ModuleInstance from './main.js'

type NoOptions = Record<string, never>

export type ActionsSchema = {
	setDst: { options: { dst: string } }
	setSrc: { options: { src: string } }
	switchXpt: { options: NoOptions }
	presetXpt: { options: NoOptions }
	switchPresetXpts: { options: NoOptions }
	clearPresetXpts: { options: NoOptions }
	setAutoRoute: { options: { mode: string } }
	presetRoute: { options: { dst: string; src: string } }
	cutRoute: { options: { dst: string; src: string } }
	setVideoFormat: { options: { format: string; ref: string; point: string; apply?: boolean } }
	applyVideoFormat: { options: NoOptions }
	cancelVideoFormat: { options: NoOptions }
	renameDst: { options: { dst: string; name: string } }
	renameSrc: { options: { src: string; name: string } }
	lockDst: { options: { dst: string; mode: string; useSelected?: boolean } }
}

export function UpdateActions(self: ModuleInstance): void {
	const dst = destinationChoices(self.state)
	const src = sourceChoices(self.state)

	self.setActionDefinitions({
		setDst: {
			name: 'Set destination',
			options: [portDropdown('dst', 'Select destination :', dst)],
			callback: (action) => self.selectDestination(action.options.dst),
		},
		setSrc: {
			name: 'Set source',
			options: [portDropdown('src', 'Select source :', src)],
			callback: (action) => self.selectSource(action.options.src),
		},
		switchXpt: {
			name: 'Cut selected source to selected destination',
			options: [],
			callback: () => self.routeSelection('cut'),
		},
		presetXpt: {
			name: 'Stage selected source to selected destination',
			options: [],
			callback: () => self.routeSelection('preset'),
		},
		switchPresetXpts: {
			name: 'Switch staged crosspoint(s)',
			options: [],
			callback: () => self.cutPresets(),
		},
		presetRoute: {
			name: 'Stage a route: this source to this destination',
			description: 'Stage one route without using the selection. Add several, then Switch staged crosspoint(s).',
			options: [portDropdown('dst', 'Destination :', dst), portDropdown('src', 'Source :', src)],
			callback: (action) => self.routeExplicit('preset', action.options.dst, action.options.src),
		},
		cutRoute: {
			name: 'Cut a route: switch this source to this destination now',
			options: [portDropdown('dst', 'Destination :', dst), portDropdown('src', 'Source :', src)],
			callback: (action) => self.routeExplicit('cut', action.options.dst, action.options.src),
		},
		clearPresetXpts: {
			name: 'Clear staged crosspoint(s)',
			options: [],
			callback: () => self.clearPresets(),
		},
		setAutoRoute: {
			name: 'Set auto-route mode',
			description: 'What happens when a destination and a source are both selected. Saved in the connection settings.',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode :',
					default: NEXT_AUTO_ROUTE,
					choices: [{ id: NEXT_AUTO_ROUTE, label: 'Next mode (off, stage, cut, off)' }, ...AUTO_ROUTE_MODES],
				},
			],
			callback: (action) => self.setAutoRouteMode(action.options.mode),
		},
		setVideoFormat: {
			name: 'Preset video format',
			options: [
				{
					type: 'dropdown',
					id: 'format',
					label: 'Set video format :',
					default: USE_DEFAULT,
					choices: VIDEO_FORMAT_CHOICES,
				},
				{
					type: 'dropdown',
					id: 'ref',
					label: 'Set reference type :',
					default: USE_DEFAULT,
					choices: REFERENCE_CHOICES,
				},
				{
					type: 'dropdown',
					id: 'point',
					label: 'Set switching point :',
					default: USE_DEFAULT,
					choices: SWITCHING_POINT_CHOICES,
				},
				{
					type: 'checkbox',
					id: 'apply',
					label: 'Apply straight away (otherwise press Apply preset video format)',
					default: false,
					disableAutoExpression: true,
				},
			],
			callback: (action) =>
				self.setVideoFormat(
					action.options.format,
					action.options.ref,
					action.options.point,
					action.options.apply === true,
				),
		},
		applyVideoFormat: {
			name: 'Apply preset video format',
			options: [],
			callback: () => self.applyVideoFormat(),
		},
		cancelVideoFormat: {
			name: 'Cancel preset video format',
			options: [],
			callback: () => self.cancelVideoFormat(),
		},
		renameDst: {
			name: 'Rename a destination',
			options: [
				portDropdown('dst', 'Select destination :', dst),
				{ type: 'textinput', id: 'name', label: 'New name', default: 'New name' },
			],
			callback: (action) => self.rename('dst', action.options.dst, action.options.name),
		},
		renameSrc: {
			name: 'Rename a source',
			options: [
				portDropdown('src', 'Select source :', src),
				{ type: 'textinput', id: 'name', label: 'New name', default: 'New name' },
			],
			callback: (action) => self.rename('src', action.options.src, action.options.name),
		},
		lockDst: {
			name: 'Lock/Unlock a destination',
			options: [
				{
					type: 'checkbox',
					id: 'useSelected',
					label: 'Use the selected destination',
					default: false,
					disableAutoExpression: true,
				},
				{ ...portDropdown('dst', 'Destination :', dst), isVisibleExpression: '!$(options:useSelected)' },
				{ type: 'dropdown', id: 'mode', label: 'Lock mode :', default: '0', choices: LOCK_MODES },
			],
			callback: (action) =>
				self.lockDestination(action.options.dst, action.options.mode, action.options.useSelected === true),
		},
	})
}
