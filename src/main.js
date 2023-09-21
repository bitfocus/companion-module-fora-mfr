const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
const UpdateFeedbacks = require('./feedbacks.js')
const actions = require('./actions.js')
var buffer = Buffer.alloc(32)

class ForaMfrInstance extends InstanceBase {
	variable_array = []
	CHOICES_DST = []
	CHOICES_SRC = []

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
				this.log('debug', `Selected destination : ${action.options.dst}`)
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
				this.log('debug', `Selected source : ${action.options.src}`)
			},
		},
		action3: {
			name: 'My third action',
			options: [],
			callback: (action) => {
				this.log('debug', 'Hello World! (action 3)')
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

		this.updateVariableDefinitions()
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
				// request system size
				// MFR registers are zero based so decrement by 1
				// MFR uses hex throughout but max level is 8 so no conversion needed
				// iterate from 0 to 7 with the request to determine the level set on the matrix
				for (let i = 0; i < 8; ++i) {
					this.socket.send(`@ F? ${i}\r`)
				}
				// request destination names
				// MFR returns blocks of 32 inputs
				// the platform supports upto 256 destinations so request 8 times to get them all
				// converting i to offset by multiplying by 32 and converting to hex padded to 3 places with zero
				for (let i = 0; i < 8; i++) {
					let j = i * 32
					let offset = j.toString(16).padStart(3, '0')
					this.socket.send(`@ K?DA,${offset}\r`)
				}

				// request source names
				// MFR returns blocks of 32 inputs
				// the platform supports upto 256 sources so request 8 times to get them all
				// converting i to offset by multiplying by 32 and converting to hex padded to 3 places with zero
				for (let i = 0; i < 8; i++) {
					let j = i * 32
					let offset = j.toString(16).padStart(3, '0')
					this.socket.send(`@ K?SA,${offset}\r`)
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
				var match

				if (line.indexOf('F:') > 0) {
					match = line.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)

					this.variable_array.push({ variableId: 'level', name: 'Level' })

					this.setVariableDefinitions(this.variable_array)
					this.setVariableValues({ level: `${match.toString().substring(0, 1)}` })

					var systemsize = line.substring(line.indexOf('/') + 1).split(',')

					this.outputs = parseInt(systemsize[0], 16) + 1

					this.inputs = parseInt(systemsize[1], 16) + 1

					// add dest and source counts to variable_array
					this.variable_array.push({ variableId: 'outputs', name: 'Outputs' })
					this.variable_array.push({ variableId: 'inputs', name: 'Inputs' })

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

					this.updateActions(this.actions)
				}

				this.updateVariableDefinitions
			})
		} else {
			this.updateStatus(InstanceStatus.BadConfig)
		}
	}
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
