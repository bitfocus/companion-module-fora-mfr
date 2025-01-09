exports.initActions = function () {
	let self = this

	// self.log('debug', 'initActions is here')
	let actions = {}

	actions['setDst'] = {
		name: 'Set destination',
		options: [
			{
				type: 'dropdown',
				id: 'dst',
				label: 'Select destination :',
				default: '00',
				choices: this.CHOICES_DST,
			},
		],

		callback: (action) => {
			const dst_id = action.options.dst
			const dst_name = [this.CHOICES_DST[parseInt(dst_id, 16)].label]

			this.setVariableValues({
				selected_dst_id: dst_id,
				selected_dst_name: dst_name,
				active_selected_id: dst_id,
				active_selected_name: dst_name,
				active_selected_type: 'dst',
				selected_src_id: null,
				selected_src_name: null,
			})

			// also set the variable values for the source routed to the destination
			const varIdXpt = (parseInt(dst_id, 16) + 1).toString().padStart(2, '0')
			const dst_src_id_decimal = parseInt(this.getVariableValue(`xpt${varIdXpt}`), 16) + 1
			const xpt_src_name = this.getVariableValue(`src${dst_src_id_decimal.toString().padStart(2, '0')}`)
			this.setVariableValues({
				selected_dst_src_id: this.getVariableValue(`xpt${varIdXpt}`),
				selected_dst_src_name: xpt_src_name,
			})
			// update feedbacks
			this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'SelectedSource', 'SelectedDestination')
		},
	}
	actions['setSrc'] = {
		name: 'Set source',
		options: [
			{
				type: 'dropdown',
				id: 'src',
				label: 'Select source :',
				default: '00',
				choices: this.CHOICES_SRC,
			},
		],
		callback: (action) => {
			const src_id = action.options.src
			const src_name = [this.CHOICES_SRC[parseInt(src_id, 16)].label]
			this.setVariableValues({
				selected_src_id: src_id,
				selected_src_name: src_name,
				active_selected_id: src_id,
				active_selected_name: src_name,
				active_selected_type: 'src',
			})
			// update feedbacks
			this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'SelectedSource', 'SelectedDestination')
		},
	}
	actions['switchXpt'] = {
		name: 'Switch crosspoint',
		options: [],
		callback: (action) => {
			// switch a crosspoint
			// @[sp]X:<Lvls>/<Dest>,<Src>
			this.sendCmd(
				`@ X:${this.getVariableValue('level')}/${this.getVariableValue('selected_dst_id')},${this.getVariableValue(
					'selected_src_id'
				)}`
			)
			// update feedbacks
			this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'SelectedSource', 'SelectedDestination')
			// deselect src and dst
			this.setVariableValues({
				selected_src_id: null,
				selected_src_name: null,
				selected_dst_id: null,
				selected_dst_name: null,
				active_selected_id: null,
				active_selected_name: null,
				active_selected_type: null,
			})
		},
	}
	actions['presetXpt'] = {
		name: 'Preset crosspoint',
		options: [],
		callback: (action) => {
			// Preset a crosspoint
			// @[sp]P:<Lvl>/<Dest>,<Src>
			this.sendCmd(
				`@ P:${this.getVariableValue('level')}/${this.getVariableValue('selected_dst_id')},${this.getVariableValue(
					'selected_src_id'
				)}`
			)
			this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'SelectedSource', 'SelectedDestination')
		},
	}
	actions['switchPresetXpts'] = {
		name: 'Switch preset crosspoint(s)',
		options: [],
		callback: (action) => {
			// Set the preset crosspoints simultaneously.
			// @[sp]B:E
			this.sendCmd(`@ B:E`)

			this.checkFeedbacks('RoutedSource', 'RoutedDestination', 'SelectedSource', 'SelectedDestination')
			// deselect src and dst
			this.setVariableValues({
				selected_src_id: null,
				selected_src_name: null,
				selected_dst_id: null,
				selected_dst_name: null,
				active_selected_id: null,
				active_selected_name: null,
				active_selected_type: null,
			})
		},
	}
	;(actions['setVideoFormat'] = {
		name: 'Preset video format',
		options: [
			{
				type: 'dropdown',
				id: 'format',
				label: 'Set video format :',
				default: '00',
				choices: this.CHOICES_VIDEO_FORMAT,
			},
			{
				type: 'dropdown',
				id: 'ref',
				label: 'Set reference type :',
				default: 'RA',
				choices: this.CHOICES_REF,
			},
			{
				type: 'dropdown',
				id: 'point',
				label: 'Set switching point :',
				default: 'SF',
				choices: this.CHOICES_SWITCHING_POINT,
			},
		],
		callback: (action) => {
			// Set video format, reference and switching point
			// @[sp]UF:<YY>/<R#>,<S$>
			this.sendCmd(`@ UF:${action.options.format}/${action.options.ref},${action.options.point}`)
		},
	}),
		(actions['applyVideoFormat'] = {
			name: 'Apply preset video format',
			options: [],
			callback: (action) => {
				// Apply the preset video fromat, reference and switching point.
				// @[sp]UE:A
				this.sendCmd(`@ UE:A`)
			},
		})
	actions['cancelVideoFormat'] = {
		name: 'Cancel preset video format',
		options: [],
		callback: (action) => {
			// Cancel the preset video fromat, reference and switching point.
			// @[sp]UE:C
			this.sendCmd(`@ UE:C`)
		},
	}
	actions['renameDst'] = {
		name: 'Rename a destination',
		options: [
			{
				type: 'dropdown',
				id: 'dst',
				label: 'Select destination :',
				default: '00',
				choices: this.CHOICES_DST,
			},
			{
				id: 'name',
				type: 'textinput',
				label: 'New name',
				default: this.CHOICES_DST[0],
			},
		],

		callback: (action) => {
			const dst_id = action.options.dst.padStart(3, '0')
			const dst_name = action.options.name
			const dst_name_hex = this.asciiToHexBytes(action.options.name)

			this.sendCmd(`@ K:DA${dst_id},${dst_name_hex}`)
			// update selected_dst_name variable if required
			if (this.getVariableValue('selected_dst_id') === action.options.dst) {
				this.setVariableValues({ selected_dst_name: `${dst_name}` })
			}
		},
	}
	actions['renameSrc'] = {
		name: 'Rename a source',
		options: [
			{
				type: 'dropdown',
				id: 'src',
				label: 'Select source :',
				default: '00',
				choices: this.CHOICES_SRC,
			},
			{
				id: 'name',
				type: 'textinput',
				label: 'New name',
				default: this.CHOICES_SRC[0],
			},
		],

		callback: (action) => {
			const src_id = action.options.src.padStart(3, '0')
			const src_name = action.options.name
			const src_name_hex = this.asciiToHexBytes(action.options.name)

			this.sendCmd(`@ K:SA${src_id},${src_name_hex}`)
			// update selected_src_name variable if required
			if (this.getVariableValue('selected_src_id') === action.options.src) {
				this.setVariableValues({ selected_src_name: `${src_name}` })
			}
		},
	}
	actions['lockDst'] = {
		name: 'Lock/Unlock a destination',
		options: [
			{
				type: 'dropdown',
				id: 'dst',
				label: 'Destination :',
				default: '00',
				choices: this.CHOICES_DST,
			},
			{
				type: 'dropdown',
				id: 'mode',
				label: 'Lock mode :',
				default: '0',
				choices: this.CHOICES_LOCK,
			},
		],

		callback: (action) => {
			this.sendCmd(
				`@ W:${this.getVariableValue('level')}/${action.options.dst},${this.getVariableValue('id')},${
					action.options.mode
				}`
			)
		},
	}
}
