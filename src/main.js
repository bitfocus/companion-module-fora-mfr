const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const { combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
const fs = require('fs')
var buffer = Buffer.alloc(32)

class ForaMfrInstance extends InstanceBase {
	variable_array = [
		{ variableId: 'id', name: 'ID' },
		{ variableId: 'level', name: 'Level' },
		{ variableId: 'outputs', name: 'Outputs' },
		{ variableId: 'inputs', name: 'Inputs' },
		{ variableId: 'selected_dst_id', name: 'Selected dst id' },
		{ variableId: 'selected_dst_name', name: 'Selected dst name' },
		{ variableId: 'selected_dst_src_id', name: 'Selected destination src id' },
		{ variableId: 'selected_dst_src_name', name: 'Selected destination src name' },
		{ variableId: 'selected_src_id', name: 'Selected src id' },
		{ variableId: 'selected_src_name', name: 'Selected src name' },
		{ variableId: 'active_selected_id', name: 'Active selected id' },
		{ variableId: 'active_selected_name', name: 'Active selected name' },
		{ variableId: 'active_selected_type', name: 'Active selected type' },
	]
	CHOICES_DST = []
	CHOICES_SRC = []
	CHOICES_XPT = []
	CHOICES_VIDEO_FORMAT = [
		{ id: '00', label: '1080/59.94i' },
		{ id: '01', label: '1080/59.94p' },
		{ id: '02', label: '1080/60i' },
		{ id: '03', label: '1080/60p' },
		{ id: '04', label: '1080/50i' },
		{ id: '05', label: '1080/50p' },
		{ id: '06', label: '720/60p' },
		{ id: '07', label: '720/60i' },
		{ id: '08', label: '720/50p' },
		{ id: '09', label: '1080/30p' },
		{ id: '0A', label: '1080/29.97p' },
		{ id: '0B', label: '1080/25p' },
		{ id: '0C', label: '1080/24p' },
		{ id: '0D', label: '1080/23.98p' },
		{ id: '0E', label: '1080/30PsF' },
		{ id: '0F', label: '1080/29.97PsF' },
		{ id: '10', label: '1080/25PsF' },
		{ id: '11', label: '1080/24PsF' },
		{ id: '12', label: '1080/23.98PsF' },
		{ id: '13', label: '525/59.94i' },
		{ id: '14', label: '625/50i' },
	]
	CHOICES_REF = [
		{ id: 'RA', label: 'Auto' },
		{ id: 'RB', label: 'B.B' },
		{ id: 'RT', label: 'Tri-Sync' },
	]
	CHOICES_SWITCHING_POINT = [
		{ id: 'SF', label: 'Field' },
		{ id: 'SO', label: 'Odd' },
		{ id: 'SE', label: 'Even' },
	]
	CHOICES_LOCK = [
		{ id: '0', label: 'Unlock' },
		{ id: '1', label: 'Lock' },
		// { id: '2', label: 'Lock others' }, // only valid if multiple router system
	]

	actions = {
		setDst: {
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

				this.setVariableValues({ selected_dst_id: dst_id })
				this.setVariableValues({ selected_dst_name: dst_name })

				// set the active selection variable values
				this.setVariableValues({ active_selected_id: dst_id })
				this.setVariableValues({ active_selected_name: dst_name })
				this.setVariableValues({ active_selected_type: 'dst' })

				// also set the variable values for the source routed to the destination
				const varIdXpt = (parseInt(dst_id, 16) + 1).toString().padStart(2, '0')
				const dst_src_id_decimal = parseInt(this.getVariableValue(`xpt${varIdXpt}`), 16) + 1
				const xpt_src_name = this.getVariableValue(`src${dst_src_id_decimal.toString().padStart(2, '0')}`)
				this.setVariableValues({ selected_dst_src_id: this.getVariableValue(`xpt${varIdXpt}`) })
				this.setVariableValues({ selected_dst_src_name: xpt_src_name })
				// update feedbacks
				this.checkFeedbacks('RoutedSource','RoutedDestination','SelectedSource','SelectedDestination')
			},
		},
		setSrc: {
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
				this.setVariableValues({ selected_src_id: src_id })
				this.setVariableValues({ selected_src_name: src_name })

				// set the active selection variable values
				this.setVariableValues({ active_selected_id: src_id })
				this.setVariableValues({ active_selected_name: src_name })
				this.setVariableValues({ active_selected_type: 'src' })
				// update feedbacks
				this.checkFeedbacks('RoutedSource','RoutedDestination','SelectedSource','SelectedDestination')
				},
		},
		switchXpt: {
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
				this.checkFeedbacks('RoutedSource','RoutedDestination','SelectedSource','SelectedDestination')
			},
		},
		presetXpt: {
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
				this.checkFeedbacks('RoutedSource','RoutedDestination','SelectedSource','SelectedDestination')
			},
		},
		switchPresetXpts: {
			name: 'Switch preset crosspoint(s)',
			options: [],
			callback: (action) => {
				// Set the preset crosspoints simultaneously.
				// @[sp]B:E
				this.sendCmd(`@ B:E`)

				this.checkFeedbacks('RoutedSource','RoutedDestination','SelectedSource','SelectedDestination')
			},
		},
		setVideoFormat: {
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
		},
		applyVideoFormat: {
			name: 'Apply preset video format',
			options: [],
			callback: (action) => {
				// Apply the preset video fromat, reference and switching point.
				// @[sp]UE:A
				this.sendCmd(`@ UE:A`)
			},
		},
		cancelVideoFormat: {
			name: 'Cancel preset video format',
			options: [],
			callback: (action) => {
				// Cancel the preset video fromat, reference and switching point.
				// @[sp]UE:C
				this.sendCmd(`@ UE:C`)
			},
		},
		renameDst: {
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
		},
		renameSrc: {
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
		},
		lockDst: {
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
		},
	}

	feedbacks = {
		SelectedSource: {
			name: 'Show selected source',
			type: 'boolean',
			description: 'If this source is selected the bank will be highlighted ireespctive of routing',
			defaultStyle: {
				bgcolor: combineRgb(0, 0, 255),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source :',
					default: '00',
					choices: this.CHOICES_SRC,
				},
			],
			callback: (feedback) => {
				if (this.getVariableValue('selected_src_id') === feedback.options.src && this.blink_button) {
					return true
				} else {
					return false
				}
			},
		},
		SelectedDestination: {
			name: 'Show selected destination',
			type: 'boolean',
			description: 'If this destination is selected the bank will be highlighted ireespctive of routing',
			defaultStyle: {
				bgcolor: combineRgb(0, 0, 255),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination :',
					default: '00',
					choices: this.CHOICES_DST,
				},
			],
			callback: (feedback) => {
				if (this.getVariableValue('selected_dst_id') === feedback.options.dst && this.blink_button) {
					return true
				} else {
					return false
				}
			},
		},
		RoutedSource: {
			name: 'Routed source',
			type: 'boolean',
			description: 'True if selected source is routed to the selected destination',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'src',
					label: 'Source :',
					default: '00',
					choices: this.CHOICES_SRC,
				},
			],
			callback: (feedback) => {
				if (
					this.getVariableValue('selected_src_id') === feedback.options.src
				) {
					return true
				} else {
					return false
				}
			},
		},
		RoutedDestination: {
			name: 'Routed destination',
			type: 'boolean',
			description: 'True if selected destination is routed to the selected crosspoint',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'dst',
					label: 'Destination :',
					default: '00',
					choices: this.CHOICES_DST,
				},
			],
			callback: (feedback) => {
				const varIdXpt = (parseInt(feedback.options.dst, 16) + 1).toString().padStart(2, '0')
				if (this.getVariableValue('selected_src_id') === this.getVariableValue(`xpt${varIdXpt}`)) {
					return true
				} else {
					return false
				}
			},
		},
	}

	presets = {
		CutXpt: {
			name: 'Cut selected source to selected destination',
			category: 'Control',
			type: 'button',
			style: {
				text: 'CUT\n$(fora-mfr:selected_src_name)\n>\n$(fora-mfr:selected_dst_name)',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [{ actionId: 'switchXpt' }],
					up: [],
				},
			],
			feedbacks: [],
		},
		PresetXpt: {
			name: 'Preset routing of selected source to selected destination',
			category: 'Control',
			type: 'button',
			style: {
				text: 'PRESET\n$(fora-mfr:selected_src_name)\n>\n$(fora-mfr:selected_dst_name)',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [{ actionId: 'presetXpt' }],
					up: [],
				},
			],
			feedbacks: [],
		},
		SwitchPresetXpt: {
			name: 'Salvo switch preset routes',
			category: 'Control',
			type: 'button',
			style: {
				text: 'CUT\nPRESET\nXPTs',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [{ actionId: 'switchPresetXpts' }],
					up: [],
				},
			],
			feedbacks: [],
		},
		PresetVideoFormat: {
			name: 'Set the router video format',
			category: 'Control',
			type: 'button',
			style: {
				text: 'PRESET\nVIDEO\nFORMAT',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [
						{
							actionId: 'setVideoFormat',
							options: {
								// options values to use
								format: '04',
								ref: 'RA',
								point: 'SO',
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		},
		ApplyVideoFormat: {
			name: 'Apply the preset Video Format',
			category: 'Control',
			type: 'button',
			style: {
				text: 'APPLY\nPRESET\nVIDEO\nFORMAT',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [{ actionId: 'applyVideoFormat' }],
					up: [],
				},
			],
			feedbacks: [],
		},
		CancelVideoFormat: {
			name: 'Cancel the preset Video Format',
			category: 'Control',
			type: 'button',
			style: {
				text: 'CANCEL\nPRESET\nVIDEO\nFORMAT',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [{ actionId: 'cancelVideoFormat' }],
					up: [],
				},
			],
			feedbacks: [],
		},
		RenameDst: {
			name: 'Rename a destination',
			category: 'Control',
			type: 'button',
			style: {
				text: 'RENAME\nDST',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [
						{
							actionId: 'renameDst',
							options: {
								// options values to use
								dst: '00',
								name: `new name`,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		},
		RenameSrc: {
			name: 'Rename a source',
			category: 'Control',
			type: 'button',
			style: {
				text: 'RENAME\nSRC',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [
						{
							actionId: 'renameSrc',
							options: {
								// options values to use
								src: '00',
								name: `new name`,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		},
		LockDst: {
			name: 'Lock / unlock a destination',
			category: 'Control',
			type: 'button',
			style: {
				text: '(UN)LOCK\nDST',
				size: '7',
				color: combineRgb(0, 0, 0),
				png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
				bgcolor: combineRgb(218, 218, 218),
			},
			steps: [
				{
					down: [
						{
							actionId: 'lockDst',
							options: {
								// options values to use
								dst: '00',
								mode: `0`,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		},
	}

	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.init_tcp()

		this.updateActions(this.actions) // export actions
		this.updateFeedbacks(this.feedbacks) // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
		this.setPresetDefinitions(this.presets) // export feedbacks

		this.blink_button = setInterval(() => {
			this.blink_button = !this.blink_button

			this.checkFeedbacks('SelectedSource', 'SelectedDestination')
		}, 1000)
	}

	// When module gets deleted
	async destroy() {
		if (this.socket) {
			this.socket.destroy()
		} else {
			this.updateStatus(InstanceStatus.Disconnected)
		}
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		if (this.socket) {
			this.socket.destroy()
			delete this.socket
		}
		this.config = config

		this.init_tcp()

		this.updateActions(this.actions) // export actions
		this.updateFeedbacks(this.feedbacks) // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
		this.setPresetDefinitions(this.presets) // set preset definitions
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This module will connect to ForA MFR switching router.',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'MFR IP',
				width: 6,
				default: '10.0.1.22',
				regex: Regex.IP,
			},
			{
				type: 'number',
				id: 'port',
				label: 'MFR Port',
				width: 4,
				default: 23,
				regex: Regex.PORT,
			},
		]
	}

	updateActions(actions) {
		this.setActionDefinitions(actions)
	}

	updateFeedbacks(feedbacks) {
		this.setFeedbackDefinitions(feedbacks)
	}

	updateVariableDefinitions() {
		this.setVariableDefinitions(this.variable_array)
	}

	init_tcp() {
		if (this.socket) {
			this.socket.destroy()
			delete this.socket
		}

		this.updateStatus(InstanceStatus.Connecting)

		if (this.config.host) {
			this.socket = new TCPHelper(this.config.host, this.config.port)
			this.socket.on('status_change', (status, message) => {
				this.updateStatus(status, message)
			})

			this.socket.on('connect', () => {
				// request CPU status
				// MFR returns A:<ID> if CPU is active
				// <ID> is required value for making some commands possible
				this.sendCmd('@ A?')

				// request system size
				// MFR registers are zero based so decrement by 1
				// MFR uses hex throughout but max level is 8 so no conversion needed
				// iterate from 0 to 7 with the request to determine the level set on the matrix
				for (let i = 0; i < 8; ++i) {
					this.sendCmd(`@ F? ${i}`)
				}
				// request source names
				// MFR returns blocks of 32 inputs
				// the platform supports upto 256 sources so request 8 times to get them all
				// converting i to offset by multiplying by 32 and converting to hex padded to 3 places with zero
				for (let i = 0; i < 8; i++) {
					let j = i * 32
					let offset = j.toString(16).padStart(3, '0')
					this.sendCmd(`@ K?SA,${offset}`)
				}

				// request destination names
				// MFR returns blocks of 32 inputs
				// the platform supports upto 256 destinations so request 8 times to get them all
				// converting i to offset by multiplying by 32 and converting to hex padded to 3 places with zero
				for (let i = 0; i < 8; i++) {
					let j = i * 32
					let offset = j.toString(16).padStart(3, '0')
					this.sendCmd(`@ K?DA,${offset}`)
				}
			})

			this.socket.on('error', (err) => {
				this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('data', (data) => {
				var i = 0,
					line = '',
					offset = 0
				buffer += data

				while ((i = buffer.indexOf('\n', offset)) !== -1) {
					line = buffer.substr(offset, i - offset)
					offset = i + 1
					this.socket.emit('receiveline', line)
				}
				buffer = buffer.substr(offset)
			})

			this.socket.on('receiveline', (line) => {
				// if (line.length !== 1) {
				// 	this.log('info', `Received Line : ${line}`)
				// }

				// set the 'id' variable value
				if (line.includes('S:')) {
					// Removing leading and trailing whitespace
					let trimmedString = line.trim()

					// Discarding the first 3 characters
					let substringAfter3Chars = trimmedString.substring(3)

					// Extracting characters from 4 up to the comma
					let commaIndex = substringAfter3Chars.indexOf(',')

					let destination_decimal = parseInt(substringAfter3Chars.substring(0, commaIndex), 16) + 1

					// Extracting characters after the comma as a string
					let source = substringAfter3Chars.substring(commaIndex + 1).padStart(2, '0')

					// Generate variable id and name
					const varIdXpt = `xpt${destination_decimal.toString().padStart(2, '0')}`

					this.setVariableValues({ [varIdXpt]: source })

					// update or populate the CROSSPOINTS array
					const obj = { id: source, label: `${this.CHOICES_DST[destination_decimal - 1].label}` }

					if (!this.getVariableValue('selected_dst_src_id')) {
						const dst_id = this.getVariableValue('selected_dst_id')
						const varIdXpt = (parseInt(dst_id, 16) + 1).toString().padStart(2, '0')
						const dst_src_id_decimal = parseInt(this.getVariableValue(`xpt${varIdXpt}`), 16)
						const xpt_src_name = this.getVariableValue(`src${dst_src_id_decimal.toString().padStart(2, '0')}`)
						this.setVariableValues({ selected_dst_src_id: this.getVariableValue(`xpt${varIdXpt}`) })
						this.setVariableValues({ selected_dst_src_name: xpt_src_name })
					}
					this.checkFeedbacks('RoutedDestination','RoutedSource')
				}

				if (line.includes('A:') > 0) {
					let parts = line.trim().split(':')
					this.setVariableValues({ id: `${parts[1]}` })
				}

				// Set the 'level' variable value
				if (line.includes('F:')) {
					this.setVariableValues({ level: line.charAt(line.indexOf('F:') + 2) })
					// request initial switchpoint routing
					// pwerformed here as it is the first place that 'level' is known
					this.sendCmd(`@ S?${this.getVariableValue('level')}`)

					// Extract and parse 'systemsize' values
					const systemsizePart = line.substring(line.indexOf('/') + 1)
					const [hexOutputs, hexInputs] = systemsizePart.split(',')

					// Calculate outputs and inputs
					this.outputs = parseInt(hexOutputs, 16) + 1
					this.inputs = parseInt(hexInputs, 16) + 1

					// Set variable definitions and values
					this.setVariableValues({ outputs: this.outputs, inputs: this.inputs })
				}

				if (line.includes('K:D')) {
					// Extract the hexadecimal value for the current destination
					const hex_dst = line.substring(line.indexOf(',') - 2, line.indexOf(','))
					// Convert it to decimal for GUI readability
					const dst_number = parseInt(hex_dst, 16) + 1

					// Generate variable id and name
					const varId = `dst${dst_number.toString().padStart(2, '0')}`
					const varName = `DST-${dst_number.toString().padStart(2, '0')}`

					// generate xpt variable names and IDs for rouing feedback
					const varIdXpt = `xpt${dst_number.toString().padStart(2, '0')}`
					const varNameXpt = `XPT-${dst_number.toString().padStart(2, '0')}`

					// Add variable definition to the array
					this.variable_array.push({ variableId: varId, name: varName })
					this.variable_array.push({ variableId: varIdXpt, name: varNameXpt })
					this.setVariableDefinitions(this.variable_array)

					// Extract the hex string part and convert it to ASCII
					const hexString = line.substring(line.indexOf(',') + 1)
					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					// Set the variable value for the destination
					this.setVariableValues({ [varId]: asciiString })

					// Update CHOICES_DST and selected destination values
					const obj = { id: hex_dst, label: asciiString }
					this.insertOrUpdate(this.CHOICES_DST, obj, parseInt(hex_dst, 16))

					// Set initial values of selected destination id and name
					if (!this.getVariableValue('selected_dst_id')) {
						this.setVariableValues({ selected_dst_id: this.CHOICES_DST[0].id })
						this.setVariableValues({ selected_dst_name: this.CHOICES_DST[0].label })
					}

					if (!this.getVariableValue('active_selected_id')) {
						// set initial active selection variable values
						this.setVariableValues({ active_selected_id: this.CHOICES_DST[0].id })
						this.setVariableValues({ active_selected_name: this.CHOICES_DST[0].label })
						this.setVariableValues({ active_selected_type: 'dst' })
					}

					// Update actions
					this.updateActions(this.actions)
					this.checkFeedbacks('RoutedDestination','RoutedSource')
				}

				// set the source variable and choices values
				if (line.includes('K:S')) {
					// Extract the hexadecimal value for the current destination
					const hex_src = line.substring(line.indexOf(',') - 2, line.indexOf(','))
					// Convert it to decimal for GUI readability
					const src_number = parseInt(hex_src, 16) + 1

					// Generate variable id and name
					const varId = `src${src_number.toString().padStart(2, '0')}`
					const varName = `SRC-${src_number.toString().padStart(2, '0')}`

					// Add variable definition to the array
					this.variable_array.push({ variableId: varId, name: varName })

					this.setVariableDefinitions(this.variable_array)

					// Extract the hex string part and convert it to ASCII
					const hexString = line.substring(line.indexOf(',') + 1)
					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					// Set the variable value for the destination
					this.setVariableValues({ [varId]: asciiString })

					// Update CHOICES_SRC and selected destination values
					const obj = { id: hex_src, label: asciiString }
					this.insertOrUpdate(this.CHOICES_SRC, obj, parseInt(hex_src, 16))

					// Set initial values of selected destination id and name
					if (!this.getVariableValue('selected_src_id')) {
						this.setVariableValues({ selected_src_id: this.CHOICES_SRC[0].id })
						this.setVariableValues({ selected_src_name: this.CHOICES_SRC[0].label })
					}

					// update feedbacks
					this.checkFeedbacks('RoutedSource','RoutedDestination')

					// Update actions
					this.updateActions(this.actions)
					this.generatePresetsDestinations()
					this.generatePresetsSources()

					this.setPresetDefinitions(this.presets)
				}

				// update feedbacks
				this.checkFeedbacks('RoutedSource','RoutedDestination')

				this.updateActions(this.actions) // export actions
				this.updateFeedbacks(this.feedbacks) // export feedbacks
				this.updateVariableDefinitions() // export variable definitions
			})
		} else {
			this.updateStatus(InstanceStatus.BadConfig)
		}
	}

	sendCmd(cmd) {
		if (cmd !== undefined) {
			cmd += '\r'
		}
		this.socket.send(cmd)
	}

	asciiToHexBytes(asciiString) {
		let hexString = ''
		for (let i = 0; i < asciiString.length; i++) {
			const charCode = asciiString.charCodeAt(i)
			const hexByte = charCode.toString(16).padStart(2, '0')
			hexString += hexByte
		}
		return hexString
	}

	insertOrUpdate(array, newItem, position) {
		if (position >= 0 && position < array.length) {
			// Replace the item at the specified position
			array[position] = newItem
		} else if (position === array.length) {
			// Add the item at the end of the array
			array.push(newItem)
		} else {
			// Invalid position, do nothing
			console.error('Invalid position:', position)
		}
	}
	generatePresetsDestinations() {
		for (let dst = 0; dst < this.outputs; ++dst) {
			let dst_string = (dst + 1).toString().padStart(2, '0')
			this.presets[`dst${dst_string}`] = {
				name: `Dest ${dst_string}`,
				category: 'Destinations',
				type: 'button',
				style: {
					text: `$(fora-mfr:dst${dst_string})`,
					size: '14',
					color: combineRgb(0, 0, 0),
					png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
					bgcolor: combineRgb(255, 255, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'setDst',
								options: {
									// options values to use
									dst: dst.toString(16).padStart(2, '0'),
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'RoutedDestination',
						options: {
							dst: dst.toString(16).padStart(2, '0'),
						},
						style: {
							bgcolor: combineRgb(255, 0, 0),
							color: combineRgb(0, 0, 0),
						},
					},
					{
						feedbackId: 'SelectedDestination',
						options: {
							dst: dst.toString(16).padStart(2, '0'),
						},
						style: {
							bgcolor: combineRgb(0, 0, 255),
							color: combineRgb(0, 0, 0),
						},
					},
				],
			}
		}
	}
	generatePresetsSources() {
		for (let src = 0; src < this.inputs; ++src) {
			let src_string = (src + 1).toString().padStart(2, '0')
			this.presets[`src${src_string}`] = {
				name: `Src ${src_string}`,
				category: 'Sources',
				type: 'button',
				style: {
					text: `$(fora-mfr:src${src_string})`,
					size: '14',
					color: combineRgb(0, 0, 0),
					png64: fs.readFileSync('src/MFR_button_66pc.png', 'base64'),
					bgcolor: combineRgb(0, 255, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'setSrc',
								options: {
									// options values to use
									src: src.toString(16).padStart(2, '0'),
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'RoutedSource',
						options: {
							src: src.toString(16).padStart(2, '0'),
						},
						style: {
							bgcolor: combineRgb(255, 0, 0),
							color: combineRgb(0, 0, 0),
						},
					},
					{
						feedbackId: 'SelectedSource',
						options: {
							src: src.toString(16).padStart(2, '0'),
						},
						style: {
							bgcolor: combineRgb(0, 0, 255),
							color: combineRgb(0, 0, 0),
						},
					},
				],
			}
		}
	}
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
