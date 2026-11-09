import { describe, expect, it } from 'vitest'
import type { CompanionMigrationAction, CompanionMigrationFeedback } from '@companion-module/base'
import type { ModuleConfig } from '../config.js'
import { UpgradeScripts, portsToDecimal } from '../upgrades.js'

const value = (v: unknown): { isExpression: false; value: never } => ({ isExpression: false, value: v as never })
const expression = (v: string): { isExpression: true; value: string } => ({ isExpression: true, value: v })

const action = (actionId: string, options: CompanionMigrationAction['options']): CompanionMigrationAction => ({
	id: actionId,
	controlId: 'bank:1',
	actionId,
	options,
})
const feedback = (feedbackId: string, options: CompanionMigrationFeedback['options']): CompanionMigrationFeedback => ({
	id: feedbackId,
	controlId: 'bank:1',
	feedbackId,
	options,
})

function upgrade(
	actions: CompanionMigrationAction[],
	feedbacks: CompanionMigrationFeedback[] = [],
): ReturnType<typeof portsToDecimal> {
	return portsToDecimal({ currentConfig: {} as ModuleConfig }, { config: null, secrets: undefined, actions, feedbacks })
}

describe('upgrading saved hex port ids to port numbers', () => {
	it('is registered', () => {
		expect(UpgradeScripts).toContain(portsToDecimal)
	})

	it('converts both ports of an action, keeping the port it pointed at', () => {
		const cut = action('cutRoute', { dst: value('0A'), src: value('3F') })
		expect(upgrade([cut]).updatedActions).toEqual([cut])
		expect(cut.options).toEqual({ dst: value('11'), src: value('64') })
	})

	it('converts every action and feedback with a port option', () => {
		const actions = ['setDst', 'renameDst', 'lockDst'].map((id) => action(id, { dst: value('00') }))
		actions.push(...['setSrc', 'renameSrc'].map((id) => action(id, { src: value('00') })))
		actions.push(action('presetRoute', { dst: value('00'), src: value('00') }))
		const feedbacks = ['SelectedDestination', 'RoutedDestination', 'PresetDestination', 'LockedDestination'].map((id) =>
			feedback(id, { dst: value('00') }),
		)
		feedbacks.push(
			...['SelectedSource', 'RoutedSource', 'PresetSource'].map((id) => feedback(id, { src: value('00') })),
		)
		const result = upgrade(actions, feedbacks)
		expect(result.updatedActions).toHaveLength(6)
		expect(result.updatedFeedbacks).toHaveLength(7)
		for (const item of [...actions, ...feedbacks]) {
			for (const option of Object.values(item.options)) expect(option).toEqual(value('1'))
		}
	})

	it('reads a saved hex id, not a decimal one', () => {
		const set = action('setDst', { dst: value('10') })
		upgrade([set])
		expect(set.options.dst).toEqual(value('17'))
	})

	it('accepts lower case', () => {
		const set = action('setDst', { dst: value('0a') })
		upgrade([set])
		expect(set.options.dst).toEqual(value('11'))
	})

	it('leaves expressions, other options and other actions alone', () => {
		const typed = action('setDst', { dst: expression('$(fora:xpt01)') })
		const rename = action('renameDst', { dst: value('01'), name: value('0A') })
		const other = action('setVideoFormat', { format: value('04') })
		const staged = feedback('StagedRoutes', {})
		const result = upgrade([typed, rename, other], [staged])
		expect(result.updatedActions).toEqual([rename])
		expect(result.updatedFeedbacks).toEqual([])
		expect(typed.options.dst).toEqual(expression('$(fora:xpt01)'))
		expect(rename.options).toEqual({ dst: value('2'), name: value('0A') })
		expect(other.options.format).toEqual(value('04'))
	})

	it('leaves a value it cannot read alone', () => {
		const empty = action('setDst', { dst: value('') })
		const junk = action('setSrc', { src: value('zz') })
		const missing = action('cutRoute', {})
		expect(upgrade([empty, junk, missing]).updatedActions).toEqual([])
	})
})
