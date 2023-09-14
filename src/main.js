const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
const UpdateActions = require('./actions.js')
const UpdateFeedbacks = require('./feedbacks.js')
const UpdateVariableDefinitions = require('./variables.js')

var variable_array = []

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

		this.init_variables()
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
				default: '10.0.1.21',
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
			{
				type: 'number',
				id: 'level',
				label: 'MFR Level',
				width: 4,
				default: 1,
				min: 1,
				max: 8,
			},
			// {
			// 	type: 'number',
			// 	id: 'inputCount',
			// 	label: 'Input Count',
			// 	width: 3,
			// 	default: 48,
			// 	min: 0,
			// 	max: 128,
			// },
			// {
			// 	type: 'number',
			// 	id: 'outputCount',
			// 	label: 'Output Count',
			// 	width: 3,
			// 	default: 48,
			// 	min: 0,
			// 	max: 128,
			// },
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
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
				let level = this.config.level - 1
				// for (level = 0; level < 8; ++level) {
				this.socket.send(`@ F? ${level}\r`)
				// }

				this.socket.send(`@ K?DA,000\r`)
			})

			this.socket.on('error', (err) => {
				this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('data', (data) => {
				// this.log('debug',data)

				// let buffer = ''
				var i = 0,
					line = '',
					offset = 0
				buffer += data

				while ((i = buffer.indexOf('\n', offset)) !== -1) {
					line = buffer.substr(offset, i - offset)
					offset = i + 1
					// this.log('debug',`on(data) : ${line}`)
					this.socket.emit('receiveline', line)
				}
				buffer = buffer.substr(offset)
			})

			this.socket.on('receiveline', (line) => {
				// if (line.trim().length > 0) {
				// 	this.log('debug', `Received line: ${line}`)
				// }

				var match

				if (line.indexOf('F:') > 0) {
					match = line.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)

					this.log('debug', `Sys size response : ${line.substring(line.indexOf('F:'))}`)

					var systemsize = line.substring(line.indexOf('/') + 1).split(',')

					this.outputs = parseInt(systemsize[0], 16) + 1

					this.inputs = parseInt(systemsize[1], 16) + 1

					// add input and aouput counts to variable_array
					variable_array.push({ variableId: 'input_count', name: 'Input Count' })
					variable_array.push({ variableId: 'output_count', name: 'Output Count' })

					this.setVariableDefinitions(variable_array)

					this.setVariableValues({ input_count: this.inputs })
					this.setVariableValues({ output_count: this.outputs })

					this.updateVariableDefinitions
				}
				if (line.startsWith('K:')) {
					this.log('debug', `Dst name response : ${line}`)
				}
			})
		} else {
			this.updateStatus(InstanceStatus.BadConfig)
		}
	}
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
