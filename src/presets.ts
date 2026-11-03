import type {
	CompanionButtonStyleProps,
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import { BUTTON_PNG_BASE64 } from './button-image.js'
import type { ActionsSchema } from './actions.js'
import type { FeedbacksSchema } from './feedbacks.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { toHex } from './protocol.js'
import { dstVar, srcVar, xptNameVar, xptPendingVar } from './variables.js'

// Companion swaps this for the connection's label wherever it appears in preset text
const VAR = '$(fora-mfr:'

const baseStyle = (text: string): CompanionButtonStyleProps => ({
	text,
	size: '7',
	color: 0x000000,
	bgcolor: 0xdadada,
	png64: BUTTON_PNG_BASE64,
})

/** Layout, in percent of the button, of the stacked destination button */
const STACK = {
	dst: { x: 5, y: 5, width: 90, height: 30 },
	cross: { x: 40, y: 25, width: 20, height: 20 },
	current: { x: 5, y: 35, width: 90, height: 30 },
	arrow: { x: 40, y: 55, width: 20, height: 20 },
	pending: { x: 5, y: 65, width: 90, height: 30 },
}

/** Text starts large and shrinks to fit its layer */
const FONT_SIZE = 100
/** For text that changes while the button is in use, so its size doesn't jump */
const CHANGING_TEXT_FONT_SIZE = 32

const textLayer = (
	id: string,
	name: string,
	text: string,
	bounds: (typeof STACK)['dst'],
	enabled = true,
	fontsize = FONT_SIZE,
) =>
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

/**
 * A destination button, stacked: destination, `x`, the source routed now, and, only while a route is
 * staged for it, `v` and the staged source in brackets. A plain text version follows for hosts without
 * layered buttons.
 */
function routedDestinationPreset(i: number): CompanionPresetDefinitions<ModuleSchema>[string] {
	const port = toHex(i)
	const options = { dst: port }
	const showStaged = [
		{ elementId: 'arrow', elementProperty: 'enabled', override: true },
		{ elementId: 'pending', elementProperty: 'enabled', override: true },
	]
	const colour = (bgcolor: number) => [{ elementId: 'box0', elementProperty: 'color', override: bgcolor }]
	const steps = [{ down: [{ actionId: 'setDst' as const, options }], up: [] }]
	const name = `Dest ${i + 1} with its routed source`

	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				elements: [
					{ type: 'box', id: 'box0', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: 0x808000 },
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
					textLayer('dst', 'this dst', `${VAR}${dstVar(i)})`, STACK.dst),
					textLayer('cross', 'xpt', 'x', STACK.cross),
					textLayer('current', 'current src', `${VAR}${xptNameVar(i)})`, STACK.current),
					textLayer('arrow', 'next xpt', 'v', STACK.arrow, false),
					textLayer('pending', 'pending src', `[${VAR}${xptPendingVar(i)})]`, STACK.pending, false),
				],
				feedbacks: [
					{ feedbackId: 'SelectedDestination', options, styleOverrides: colour(0xffff00) },
					{ feedbackId: 'PresetDestination', options, styleOverrides: [...colour(0xff8000), ...showStaged] },
					{ feedbackId: 'LockedDestination', options, styleOverrides: colour(0xff0000) },
				],
				steps,
			},
			{
				type: 'simple',
				name,
				style: {
					...baseStyle(`${VAR}${dstVar(i)})\n${VAR}${xptNameVar(i)})\n[${VAR}${xptPendingVar(i)})]`),
					size: 'auto',
					bgcolor: 0x808000,
				},
				steps,
				feedbacks: [
					{ feedbackId: 'SelectedDestination', options, style: { bgcolor: 0xffff00, color: 0x000000 } },
					{ feedbackId: 'PresetDestination', options, style: { bgcolor: 0xff8000, color: 0x000000 } },
					{ feedbackId: 'LockedDestination', options, style: { bgcolor: 0xff0000, color: 0x000000 } },
				],
			},
		],
	}
}

type FeedbackId = keyof FeedbacksSchema

interface Line {
	text: string
	/** Small centred separator such as `v`, instead of a full width line of text */
	symbol?: boolean
	/** Share of the height among the text lines, default 2 */
	weight?: number
	/** Exact position and size in percent, instead of sharing the height */
	bounds?: { x: number; y: number; width: number; height: number }
	/** Starting text size, default `FONT_SIZE` */
	fontsize?: number
}

interface ButtonSpec {
	name: string
	background: number
	/** Text lines, top to bottom; a plain string is one line that may contain line breaks */
	lines: (Line | string)[]
	/** Text size of the plain fallback button */
	size?: CompanionButtonStyleProps['size']
	actions: { actionId: keyof ActionsSchema; options: Record<string, string | boolean> }[]
	feedbacks?: { feedbackId: FeedbackId; options: Record<string, string>; background: number }[]
}

/**
 * A button in the module style: the MFR image on a coloured background with black mono text that
 * shrinks to fit, one layer per line, plus a plain text version for hosts without layered buttons.
 */
function styledButton(spec: ButtonSpec): CompanionPresetDefinitions<ModuleSchema>[string] {
	const lines = spec.lines.map((line): Line => (typeof line === 'string' ? { text: line } : line))
	const symbols = lines.filter((line) => line.symbol).length
	const totalWeight = lines.reduce((sum, line) => sum + (line.symbol ? 0 : (line.weight ?? 2)), 0)
	const room = 90 - 15 * symbols
	let y = 5
	const layers = lines.map((line, index) => {
		if (line.bounds) return textLayer(`line${index}`, `line ${index + 1}`, line.text, line.bounds)
		const height = line.symbol ? 15 : (room * (line.weight ?? 2)) / totalWeight
		const bounds = line.symbol ? { x: 40, width: 20 } : { x: 5, width: 90 }
		const layer = textLayer(
			`line${index}`,
			`line ${index + 1}`,
			line.text,
			{ ...bounds, y, height },
			true,
			line.fontsize,
		)
		y += height
		return layer
	})

	const steps = [{ down: spec.actions, up: [] }] as never
	const overrides = (background: number) => [{ elementId: 'box0', elementProperty: 'color', override: background }]
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
					...layers,
				],
				feedbacks: (spec.feedbacks ?? []).map((f) => ({
					feedbackId: f.feedbackId,
					options: f.options,
					styleOverrides: overrides(f.background),
				})) as never,
				steps,
			},
			{
				type: 'simple',
				name: spec.name,
				style: {
					...baseStyle(lines.map((line) => line.text).join('\n')),
					size: spec.size ?? 'auto',
					bgcolor: spec.background,
				},
				steps,
				feedbacks: (spec.feedbacks ?? []).map((f) => ({
					feedbackId: f.feedbackId,
					options: f.options,
					style: { bgcolor: f.background, color: 0x000000 },
				})) as never,
			},
		],
	}
}

const CONTROL = 0xdadada
const DESTINATION = 0x808000
const SOURCE = 0x008000
const SELECTED_DST = 0xffff00
const SELECTED_SRC = 0x00ff00
const STAGED = 0xff8000
const LOCKED = 0xff0000

export function UpdatePresets(self: ModuleInstance): void {
	const { state } = self
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const control = (
		id: string,
		name: string,
		lines: ButtonSpec['lines'],
		actionId: ButtonSpec['actions'][number]['actionId'],
		options: ButtonSpec['actions'][number]['options'] = {},
		size: ButtonSpec['size'] = '7',
	): void => {
		presets[id] = styledButton({ name, background: CONTROL, lines, size, actions: [{ actionId, options }] })
	}

	presets.blank = styledButton({
		name: 'Blank button in the module style, for your own actions',
		background: CONTROL,
		lines: [''],
		actions: [],
	})
	// source above destination, laid out as restyled in Companion; the `v` overlaps the two names slightly
	const stacked = (label: string): Line[] => [
		{ text: label, bounds: { x: 5, y: 5, width: 90, height: 25 } },
		{ text: `${VAR}selected_src_label)`, bounds: { x: 5, y: 30, width: 90, height: 30 } },
		{ text: 'v', symbol: true, bounds: { x: 40, y: 52, width: 20, height: 15 } },
		{ text: `${VAR}selected_dst_label)`, bounds: { x: 5, y: 60, width: 90, height: 30 } },
	]
	control('cut_xpt', 'Cut selected source to selected destination', stacked('CUT'), 'switchXpt')
	control('preset_xpt', 'Stage selected source to selected destination', stacked('STAGE'), 'presetXpt')
	presets.switch_preset_xpts = styledButton({
		name: 'Salvo switch staged routes',
		background: CONTROL,
		lines: ['CUT\nSTAGED\nXPTs'],
		size: '7',
		actions: [{ actionId: 'switchPresetXpts', options: {} }],
		feedbacks: [{ feedbackId: 'StagedRoutes', options: {}, background: STAGED }],
	})
	control('clear_preset_xpts', 'Clear the staged routes', ['CLEAR\nSTAGED\nXPTs'], 'clearPresetXpts')
	presets.auto_route = styledButton({
		name: 'Step the auto-route mode: off, stage, cut',
		background: CONTROL,
		lines: [{ text: `AUTO\n${VAR}auto_route_mode)`, fontsize: CHANGING_TEXT_FONT_SIZE }],
		actions: [{ actionId: 'setAutoRoute', options: { mode: 'next' } }],
		feedbacks: [
			{ feedbackId: 'AutoRouteMode', options: { mode: 'preset' }, background: STAGED },
			{ feedbackId: 'AutoRouteMode', options: { mode: 'cut' }, background: LOCKED },
		],
	})
	control('rename_dst', 'Rename a destination', ['RENAME\nDST'], 'renameDst', { dst: '00', name: 'new name' })
	control('rename_src', 'Rename a source', ['RENAME\nSRC'], 'renameSrc', { src: '00', name: 'new name' })
	control(
		'lock_dst',
		'Lock / unlock a destination',
		[{ text: `${VAR}selected_dst_lock_text)`, fontsize: CHANGING_TEXT_FONT_SIZE }],
		'lockDst',
		{ dst: '00', mode: 'toggle', useSelected: true },
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
				{ id: 'naming', type: 'simple', name: 'Naming', presets: ['rename_dst', 'rename_src'] },
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
