const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
// const UpdateActions = require('./actions.js')
const UpdateFeedbacks = require('./feedbacks.js')
// const actions = require('./actions.js')
// const UpdateVariableDefinitions = require('./variables.js')

var variable_array = []
var CHOICES_DST = []
var CHOICES_SRC = []
var DST_MAX, SRC_MAX
var level
var buffer = Buffer.alloc(32)

class ForaMfrInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions() // export actions
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

	updateActions() {
		this.setActionDefinitions({
			action1: {
				name: 'My first action',
				options: [],
				callback: (action) => {
					this.log('debug', `DST_MAX = ${DST_MAX}\nSRC_MAX = ${SRC_MAX}`)
				},
			},
			action2: {
				name: 'My second action',
				options: [],
				callback: (action) => {
					this.log('debug', 'Hello World! (action 2)')
				},
			},
			action3: {
				name: 'My third action',
				options: [],
				callback: (action) => {
					this.log('debug', 'Hello World! (action 3)')
				},
			},
		})
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		this.setVariableDefinitions(variable_array)
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
				for (level = 0; level < 8; ++level) {
					this.socket.send(`@ F? ${level}\r`)
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

					var systemsize = line.substring(line.indexOf('/') + 1).split(',')

					this.outputs = parseInt(systemsize[0], 16) + 1

					this.inputs = parseInt(systemsize[1], 16) + 1

					// add dest and source counts to variable_array
					variable_array.push({ variableId: 'output_count', name: 'Output Count' })
					variable_array.push({ variableId: 'input_count', name: 'Input Count' })

					this.setVariableDefinitions(variable_array)

					this.setVariableValues({ output_count: this.outputs })
					this.setVariableValues({ input_count: this.inputs })

					DST_MAX = this.outputs
					SRC_MAX = this.inputs
				}
				if (line.startsWith('K:D')) {
					let dst_number = parseInt(line.substring(line.indexOf(',') - 2, line.indexOf(',')), 16) + 1

					let varId = `dst${dst_number.toString().padStart(2, '0')}_name`
					let varName = `Dest ${dst_number.toString().padStart(2, '0')} Name`

					variable_array.push({ variableId: `${varId}`, name: `${varName}` })
					this.setVariableDefinitions(variable_array)
					let hexString = line.substring(line.indexOf(',') + 1)

					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					this.setVariableValues({ [`${varId}`]: asciiString })
				}

				if (line.startsWith('K:S')) {
					let src_number = parseInt(line.substring(line.indexOf(',') - 2, line.indexOf(',')), 16) + 1

					let varId = `src${src_number.toString().padStart(2, '0')}_name`
					let varName = `Source ${src_number.toString().padStart(2, '0')} Name`

					variable_array.push({ variableId: `${varId}`, name: `${varName}` })
					this.setVariableDefinitions(variable_array)
					let hexString = line.substring(line.indexOf(',') + 1)

					let asciiString = ''
					for (let i = 0; i < hexString.length; i += 2) {
						const hexPair = hexString.substr(i, 2)
						const decimalValue = parseInt(hexPair, 16)
						asciiString += String.fromCharCode(decimalValue)
					}

					this.setVariableValues({ [`${varId}`]: asciiString })
				}

				this.updateVariableDefinitions
			})
		} else {
			this.updateStatus(InstanceStatus.BadConfig)
		}
	}
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
