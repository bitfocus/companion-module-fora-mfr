import type { CompanionMigrationOptionValues, CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'
import { portNumber } from './protocol.js'

const ACTION_PORT_OPTIONS: Record<string, string[]> = {
	setDst: ['dst'],
	setSrc: ['src'],
	presetRoute: ['dst', 'src'],
	cutRoute: ['dst', 'src'],
	renameDst: ['dst'],
	renameSrc: ['src'],
	lockDst: ['dst'],
}

const FEEDBACK_PORT_OPTIONS: Record<string, string[]> = {
	SelectedSource: ['src'],
	SelectedDestination: ['dst'],
	RoutedSource: ['src'],
	RoutedDestination: ['dst'],
	PresetSource: ['src'],
	PresetDestination: ['dst'],
	LockedDestination: ['dst'],
}

/** Convert saved dropdown picks. An expression can't be rewritten reliably, so it is left as it is. */
function convertPorts(options: CompanionMigrationOptionValues, ids: string[] | undefined): boolean {
	let changed = false
	for (const id of ids ?? []) {
		const option = options[id]
		if (!option || option.isExpression || typeof option.value !== 'string') continue
		if (!/^[0-9a-f]{1,3}$/i.test(option.value.trim())) continue
		options[id] = { isExpression: false, value: portNumber(parseInt(option.value, 16)) }
		changed = true
	}
	return changed
}

/** Port options held zero based hex ids ('0A') up to v2; they now hold the port number shown ('11') */
export const portsToDecimal: CompanionStaticUpgradeScript<ModuleConfig> = (_context, props) => ({
	updatedConfig: null,
	updatedActions: props.actions.filter((action) => convertPorts(action.options, ACTION_PORT_OPTIONS[action.actionId])),
	updatedFeedbacks: props.feedbacks.filter((feedback) =>
		convertPorts(feedback.options, FEEDBACK_PORT_OPTIONS[feedback.feedbackId]),
	),
})

/*
 * Remember that once a script has been added it cannot be removed!
 */
export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [portsToDecimal]
