const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
const UpdateFeedbacks = require('./feedbacks.js')
const actions = require('./actions.js')
var buffer = Buffer.alloc(32)

class ForaMfrInstance extends InstanceBase {
	variable_array = [
		{ variableId: 'id', name: 'ID' },
		{ variableId: 'level', name: 'Level' },
		{ variableId: 'outputs', name: 'Outputs' },
		{ variableId: 'inputs', name: 'Inputs' },
		{ variableId: 'selected_dst_id', name: 'Selected dst id' },
		{ variableId: 'selected_dst_name', name: 'Selected dst name' },
		{ variableId: 'selected_src_id', name: 'Selected src' },
		{ variableId: 'selected_src_name', name: 'Selected src name' },
	]
	CHOICES_DST = []
	CHOICES_SRC = []
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
			},
		},
		switchPresetXpts: {
			name: 'Switch preset crosspoint(s)',
			options: [],
			callback: (action) => {
				// Set the preset crosspoints simultaneously.
				// @[sp]B:E
				this.sendCmd(`@ B:E`)
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
					// tooltip? : 'Optional',
				},
				{
					type: 'dropdown',
					id: 'point',
					label: 'Set switching point :',
					default: 'SF',
					choices: this.CHOICES_SWITCHING_POINT,
					// tooltip? : 'Optional',
				},
			],
			callback: (action) => {
				// Set video format, reference and switching point
				// @[sp]UF:<YY>/<R#>,<S$>
				// this.log('debug',`@ UF:${action.options.format}/${action.options.ref},${action.options.point}`)
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
	}

	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions(this.actions) // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
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
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
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

	updateFeedbacks() {
		UpdateFeedbacks(this)
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
				// request destination names
				// MFR returns blocks of 32 inputs
				// the platform supports upto 256 destinations so request 8 times to get them all
				// converting i to offset by multiplying by 32 and converting to hex padded to 3 places with zero
				for (let i = 0; i < 8; i++) {
					let j = i * 32
					let offset = j.toString(16).padStart(3, '0')
					this.sendCmd(`@ K?DA,${offset}`)
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
				if (line.length > 1) {
					this.log('debug', line)
				}

				if (line.includes('A:') > 0) {
					let parts = line.split(':')
					this.setVariableValues({ id: `${parts[1]}` })
				}

				if (line.indexOf('F:') > 0) {
					var match = line.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)

					// set level variable value
					this.setVariableValues({ id: `${line.substring(line.indexOf('F:') + 2, line.indexOf('F:') + 3)}` })

					var systemsize = line.substring(line.indexOf('/') + 1).split(',')

					this.outputs = parseInt(systemsize[0], 16) + 1
					this.inputs = parseInt(systemsize[1], 16) + 1

					this.setVariableDefinitions(this.variable_array)
					this.setVariableValues({ outputs: this.outputs })
					this.setVariableValues({ inputs: this.inputs })
				}
				if (line.startsWith('K:D')) {
					// get the hex value for the current dst
					let hex_dst = line.substring(line.indexOf(',') - 2, line.indexOf(','))
					// convert to decimal for GUI readability
					let dst_number = parseInt(hex_dst, 16) + 1

					let varId = `dst${dst_number.toString().padStart(2, '0')}`
					let varName = `DST-${dst_number.toString().padStart(2, '0')}`

					this.variable_array.push({ variableId: `${varId}`, name: `${varName}` })
					this.setVariableDefinitions(this.variable_array)
					let hexString = line.substring(line.indexOf(',') + 1)

					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					this.setVariableValues({ [`${varId}`]: asciiString })
					let obj = {}
					obj.id = hex_dst
					obj.label = asciiString
					this.CHOICES_DST.push({ id: [`${hex_dst}`], label: asciiString })

					// set the initial values of selected dst id and value to avoid annoying $NA
					this.setVariableValues({ selected_dst_id: this.CHOICES_DST[0].id })
					this.setVariableValues({ selected_dst_name: this.CHOICES_DST[0].label })

					this.updateActions(this.actions)
				}

				if (line.startsWith('K:S')) {
					// get the hex value for the current dst
					let hex_src = line.substring(line.indexOf(',') - 2, line.indexOf(','))
					// convert to decimal for GUI readability
					let src_number = parseInt(hex_src, 16) + 1

					let varId = `src${src_number.toString().padStart(2, '0')}`
					let varName = `SRC-${src_number.toString().padStart(2, '0')}`

					this.variable_array.push({ variableId: `${varId}`, name: `${varName}` })
					this.setVariableDefinitions(this.variable_array)
					let hexString = line.substring(line.indexOf(',') + 1)

					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					this.setVariableValues({ [`${varId}`]: asciiString })
					let obj = {}
					obj.id = hex_src
					obj.label = asciiString
					this.CHOICES_SRC.push({ id: [`${hex_src}`], label: asciiString })

					// set the initial values of selected dst id and value to avoid annoying $NA
					this.setVariableValues({ selected_src_id: this.CHOICES_SRC[0].id })
					this.setVariableValues({ selected_src_name: this.CHOICES_SRC[0].label })

					this.updateActions(this.actions)
				}

				this.updateActions(this.actions) // export actions
				this.updateFeedbacks() // export feedbacks
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
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
