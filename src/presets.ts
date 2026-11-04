import type {
	CompanionButtonStepActions,
	CompanionButtonStyleProps,
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import { BUTTON_PNG_BASE64 } from './button-image.js'
import type { FeedbacksSchema } from './feedbacks.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { toHex } from './protocol.js'
import { dstVar, srcVar, xptNameVar, xptPendingVar } from './variables.js'

// Companion swaps this for the connection's label wherever it appears in preset text
const VAR = '$(fora-mfr:'
/** Companion's own feedback, lit for as long as the button is held */
const PUSHED = 'internal:buttonPushed'

const CONTROL = 0xdadada
const CONTROL_PUSHED = 0xffffff
const DESTINATION = 0x808000
const SOURCE = 0x008000
const SELECTED_DST = 0xffff00
const SELECTED_SRC = 0x00ff00
const STAGED = 0xff8000
const LOCKED = 0xff0000

/** Text starts large and shrinks to fit its layer */
const FONT_SIZE = 100
/** For text that changes while the button is in use, so its size doesn't jump */
const CHANGING_TEXT_FONT_SIZE = 32

interface Bounds {
	x: number
	y: number
	width: number
	height: number
}

/** The whole button, inside its margin */
const FULL: Bounds = { x: 5, y: 5, width: 90, height: 90 }
/** Layout, in percent of the button, of the stacked destination button */
const STACK = {
	dst: { x: 5, y: 5, width: 90, height: 30 },
	cross: { x: 40, y: 25, width: 20, height: 20 },
	current: { x: 5, y: 35, width: 90, height: 30 },
	arrow: { x: 40, y: 55, width: 20, height: 20 },
	pending: { x: 5, y: 65, width: 90, height: 30 },
}

const textLayer = (id: string, name: string, text: string, bounds: Bounds, enabled = true, fontsize = FONT_SIZE) =>
	({
		type: 'text',
		id,
		name,
		enabled,
		...bounds,
		text,
		color: 0x000000,
		halign: 'center',
		valign: 'center',
		fontsize,
		fontsizeAllowShrink: true,
		font: 'companion-mono',
		outlineColor: 0xff000000,
	}) as const

type PresetActions = CompanionButtonStepActions<ModuleSchema>['down']

type PresetFeedback = (
	| { [K in keyof FeedbacksSchema]: { feedbackId: K; options: FeedbacksSchema[K]['options'] } }[keyof FeedbacksSchema]
	| { feedbackId: typeof PUSHED; options: Record<string, never> }
) & {
	background: number
	/** Layers hidden until this feedback is true */
	shows?: string[]
}

interface ButtonSpec {
	name: string
	background: number
	/** Text size of the plain fallback button */
	size?: CompanionButtonStyleProps['size']
	actions: PresetActions
	feedbacks?: PresetFeedback[]
}

/**
 * A button in the module style: the MFR image on a coloured background with the given layers, plus a
 * plain text version for hosts without layered buttons.
 */
function moduleButton(
	spec: ButtonSpec & { layers: ReturnType<typeof textLayer>[]; fallbackText: string },
): CompanionPresetDefinitions<ModuleSchema>[string] {
	const steps = [{ down: spec.actions, up: [] }]
	const feedbacks = spec.feedbacks ?? []
	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name: spec.name,
				elements: [
					{ type: 'box', id: 'box0', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: spec.background },
					{
						type: 'image',
						id: 'image0',
						name: 'Image',
						x: 0,
						y: 0,
						width: 100,
						height: 100,
						base64Image: `data:image/png;base64,${BUTTON_PNG_BASE64}`,
						fillMode: 'fill',
					},
					...spec.layers,
				],
				feedbacks: feedbacks.map(({ background, shows, ...feedback }) => ({
					...feedback,
					styleOverrides: [
						{ elementId: 'box0', elementProperty: 'color', override: background },
						...(shows ?? []).map((elementId) => ({ elementId, elementProperty: 'enabled', override: true })),
					],
				})),
				steps,
			},
			{
				type: 'simple',
				name: spec.name,
				style: {
					text: spec.fallbackText,
					size: spec.size ?? 'auto',
					color: 0x000000,
					bgcolor: spec.background,
					png64: BUTTON_PNG_BASE64,
				},
				steps,
				feedbacks: feedbacks.map(({ background, shows: _shows, ...feedback }) => ({
					...feedback,
					style: { bgcolor: background, color: 0x000000 },
				})),
			},
		],
	}
}

interface Line {
	text: string
	/** Exact position and size in percent, default the whole button */
	bounds?: Bounds
	/** Starting text size, default `FONT_SIZE` */
	fontsize?: number
}

/** A module style button whose text is one layer per line */
function styledButton(
	spec: ButtonSpec & { lines: (Line | string)[] },
): CompanionPresetDefinitions<ModuleSchema>[string] {
	const lines = spec.lines.map((line): Line => (typeof line === 'string' ? { text: line } : line))
	return moduleButton({
		...spec,
		layers: lines.map((line, index) =>
			textLayer(`line${index}`, `line ${index + 1}`, line.text, line.bounds ?? FULL, true, line.fontsize),
		),
		fallbackText: lines.map((line) => line.text).join('\n'),
	})
}

/**
 * A destination button, stacked: destination, `x`, the source routed now, and, only while a route is
 * staged for it, `v` and the staged source in brackets.
 */
function routedDestinationPreset(i: number): CompanionPresetDefinitions<ModuleSchema>[string] {
	const options = { dst: toHex(i) }
	const dst = `${VAR}${dstVar(i)})`
	const current = `${VAR}${xptNameVar(i)})`
	const pending = `[${VAR}${xptPendingVar(i)})]`
	return moduleButton({
		name: `Dest ${i + 1} with its routed source`,
		background: DESTINATION,
		layers: [
			textLayer('dst', 'this dst', dst, STACK.dst),
			textLayer('cross', 'xpt', 'x', STACK.cross),
			textLayer('current', 'current src', current, STACK.current),
			textLayer('arrow', 'next xpt', 'v', STACK.arrow, false),
			textLayer('pending', 'pending src', pending, STACK.pending, false),
		],
		fallbackText: `${dst}\n${current}\n${pending}`,
		actions: [{ actionId: 'setDst', options }],
		feedbacks: [
			{ feedbackId: 'SelectedDestination', options, background: SELECTED_DST },
			{ feedbackId: PUSHED, options: {}, background: SELECTED_DST },
			{ feedbackId: 'PresetDestination', options, background: STAGED, shows: ['arrow', 'pending'] },
			{ feedbackId: 'LockedDestination', options, background: LOCKED },
		],
	})
}

/** Always last on a control button, so a press shows whatever colour the button has */
const controlPushed: PresetFeedback = { feedbackId: PUSHED, options: {}, background: CONTROL_PUSHED }

export function UpdatePresets(self: ModuleInstance): void {
	const { state } = self
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const control = (
		id: string,
		name: string,
		lines: (Line | string)[],
		actions: PresetActions,
		size: ButtonSpec['size'] = '7',
	): void => {
		presets[id] = styledButton({ name, background: CONTROL, lines, size, actions, feedbacks: [controlPushed] })
	}

	presets.blank = styledButton({
		name: 'Blank button in the module style: place it, use Convert to Normal Button, then add your own actions',
		background: CONTROL,
		lines: [''],
		actions: [],
		feedbacks: [controlPushed],
	})
	// source above destination, laid out as restyled in Companion; the `v` overlaps the two names slightly
	const stacked = (label: string): Line[] => [
		{ text: label, bounds: { x: 5, y: 5, width: 90, height: 25 } },
		{ text: `${VAR}selected_src_label)`, bounds: { x: 5, y: 30, width: 90, height: 30 } },
		{ text: 'v', bounds: { x: 40, y: 52, width: 20, height: 15 } },
		{ text: `${VAR}selected_dst_label)`, bounds: { x: 5, y: 60, width: 90, height: 30 } },
	]
	control('cut_xpt', 'Cut selected source to selected destination', stacked('CUT'), [
		{ actionId: 'switchXpt', options: {} },
	])
	control('preset_xpt', 'Stage selected source to selected destination', stacked('STAGE'), [
		{ actionId: 'presetXpt', options: {} },
	])
	presets.switch_preset_xpts = styledButton({
		name: 'Salvo switch staged routes',
		background: CONTROL,
		lines: ['CUT\nSTAGED\nXPTs'],
		size: '7',
		actions: [{ actionId: 'switchPresetXpts', options: {} }],
		feedbacks: [{ feedbackId: 'StagedRoutes', options: {}, background: STAGED }, controlPushed],
	})
	control(
		'clear_preset_xpts',
		'Clear the staged routes',
		['CLEAR\nSTAGED\nXPTs'],
		[{ actionId: 'clearPresetXpts', options: {} }],
	)
	presets.auto_route = styledButton({
		name: 'Step the auto-route mode: off, stage, cut',
		background: CONTROL,
		lines: [{ text: `AUTO\n${VAR}auto_route_mode)`, fontsize: CHANGING_TEXT_FONT_SIZE }],
		actions: [{ actionId: 'setAutoRoute', options: { mode: 'next' } }],
		feedbacks: [
			{ feedbackId: 'AutoRouteMode', options: { mode: 'preset' }, background: STAGED },
			{ feedbackId: 'AutoRouteMode', options: { mode: 'cut' }, background: LOCKED },
			controlPushed,
		],
	})
	control(
		'lock_dst',
		'Lock / unlock a destination',
		[{ text: `${VAR}selected_dst_lock_text)`, fontsize: CHANGING_TEXT_FONT_SIZE }],
		[{ actionId: 'lockDst', options: { dst: '00', mode: 'toggle', useSelected: true } }],
		'auto',
	)

	const dstIds: string[] = []
	for (let i = 0; i < state.dstCount; i++) {
		const id = `dst_${i}`
		const options = { dst: toHex(i) }
		dstIds.push(id)
		presets[id] = styledButton({
			name: `Dest ${i + 1}`,
			background: DESTINATION,
			lines: [`${VAR}${dstVar(i)})`],
			actions: [{ actionId: 'setDst', options }],
			feedbacks: [
				{ feedbackId: 'RoutedDestination', options, background: SELECTED_DST },
				{ feedbackId: 'SelectedDestination', options, background: SELECTED_DST },
				{ feedbackId: PUSHED, options: {}, background: SELECTED_DST },
				{ feedbackId: 'PresetDestination', options, background: STAGED },
				{ feedbackId: 'LockedDestination', options, background: LOCKED },
			],
		})
	}

	const routedIds: string[] = []
	for (let i = 0; i < state.dstCount; i++) {
		const id = `routed_${i}`
		routedIds.push(id)
		presets[id] = routedDestinationPreset(i)
	}

	const srcIds: string[] = []
	for (let i = 0; i < state.srcCount; i++) {
		const id = `src_${i}`
		const options = { src: toHex(i) }
		srcIds.push(id)
		presets[id] = styledButton({
			name: `Src ${i + 1}`,
			background: SOURCE,
			lines: [`${VAR}${srcVar(i)})`],
			actions: [{ actionId: 'setSrc', options }],
			feedbacks: [
				{ feedbackId: 'RoutedSource', options, background: SELECTED_SRC },
				{ feedbackId: 'SelectedSource', options, background: SELECTED_SRC },
				{ feedbackId: PUSHED, options: {}, background: SELECTED_SRC },
				{ feedbackId: 'PresetSource', options, background: STAGED },
			],
		})
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'control',
			name: 'Control',
			definitions: [
				{
					id: 'switching',
					type: 'simple',
					name: 'Switching',
					presets: [
						'blank',
						'cut_xpt',
						'preset_xpt',
						'switch_preset_xpts',
						'clear_preset_xpts',
						'lock_dst',
						'auto_route',
					],
				},
			],
		},
		{
			id: 'destinations',
			name: 'Destinations',
			definitions: [
				{ id: 'destinations', type: 'simple', name: 'Destinations', presets: dstIds },
				{ id: 'routed', type: 'simple', name: 'Destinations showing their routed source', presets: routedIds },
			],
		},
		{
			id: 'sources',
			name: 'Sources',
			definitions: [{ id: 'sources', type: 'simple', name: 'Sources', presets: srcIds }],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
