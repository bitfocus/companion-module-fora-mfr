import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { REFERENCES, SWITCHING_POINTS, VIDEO_FORMATS } from './choices.js'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval?: number
	autoRoute?: AutoRouteMode
	videoFormat?: string
	videoReference?: string
	videoPoint?: string
}

export type AutoRouteMode = 'off' | 'cut' | 'preset'

/** The order the mode button steps through: the live mode comes last, after the safer one */
export const AUTO_ROUTE_ORDER: AutoRouteMode[] = ['off', 'preset', 'cut']

/** Shown on buttons. The id stays `preset` so saved connections keep working. */
export const AUTO_ROUTE_LABELS: Record<AutoRouteMode, string> = { off: 'OFF', preset: 'STAGE', cut: 'CUT' }

export const DEFAULT_VIDEO = { format: '04', reference: 'RA', point: 'SO' }

export function GetConfigFields(label: string): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'Connects to a For.A MFR routing switcher. In the router web interface set the TCP/IP "Default Function" to ' +
				'"Crosspoint remote control 2" and enable the Echo, C and S responses.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'MFR IP',
			width: 6,
			regex: Regex.IP,
		},
		{
			type: 'number',
			id: 'port',
			label: 'MFR Port',
			width: 4,
			min: 1,
			max: 65535,
			step: 1,
			default: 23,
			asInteger: true,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Refresh router data every (seconds, 0 = never)',
			width: 6,
			min: 0,
			max: 3600,
			default: 5,
		},
		{
			type: 'dropdown',
			id: 'autoRoute',
			label: 'When a destination and a source are both selected',
			width: 12,
			default: 'off',
			choices: [
				{ id: 'off', label: 'Wait for the cut or stage button' },
				{ id: 'cut', label: 'Cut straight away' },
				{ id: 'preset', label: 'Stage straight away (build a salvo, then take it)' },
			],
		},
		{
			type: 'static-text',
			id: 'namesInfo',
			width: 12,
			label: 'Port names',
			value: `To edit many port names at once, open /instance/${label}/ at this Companion's web address, for example http://127.0.0.1:8000/instance/${label}/`,
		},
		{
			type: 'static-text',
			id: 'videoInfo',
			width: 12,
			label: 'Video format',
			value:
				'The video format, reference and switching point used by the "Preset video format" action when ' +
				'it is set to "Use the connection default". The module never changes the router\'s format by itself.',
		},
		{
			type: 'dropdown',
			id: 'videoFormat',
			label: 'Default video format',
			width: 4,
			default: DEFAULT_VIDEO.format,
			choices: VIDEO_FORMATS,
		},
		{
			type: 'dropdown',
			id: 'videoReference',
			label: 'Default reference',
			width: 4,
			default: DEFAULT_VIDEO.reference,
			choices: REFERENCES,
		},
		{
			type: 'dropdown',
			id: 'videoPoint',
			label: 'Default switching point',
			width: 4,
			default: DEFAULT_VIDEO.point,
			choices: SWITCHING_POINTS,
		},
	]
}
