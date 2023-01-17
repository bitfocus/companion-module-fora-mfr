const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

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
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP,
				required: true,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'TCP Port',
				default: 23,
				width: 4,
				regex: Regex.PORT,
				required: true,
			},
			{
				type: 'number',
				id: 'level',
				label: 'Level',
				min: 1,
				max: 8,
				default: 1,
				required: true,
			},
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
				this.socket.send('@ F?' + level + '\r\n')
	
			})

			this.socket.on('error', (err) => {
				this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('data', (chunk) => {

					let receivebuffer = ''
					var i = 0,
					line = '',
					offset = 0
				receivebuffer += chunk

				while ((i = receivebuffer.indexOf('\n', offset)) !== -1) {
					line = receivebuffer.substr(offset, i - offset)
					offset = i + 1
					this.socket.emit('receiveline', line.trim())
				}
				receivebuffer = receivebuffer.substr(offset)

			})
			
			this.socket.on('receiveline', (line) => {
				this.log('debug','Received line: ' + line)

				var match

				if(line.startsWith('@ F?' + + (this.config.level -1).toString())) {
					match = line.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)

					var systemsize = match[1]
							.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)
							.toString()
							.split(',')
					
					this.outputs = parseInt(systemsize[0], 16) + 1

					this.inputs = parseInt(systemsize[1], 16) + 1
					
					var variable_array =[

						{ variableId: 'input_count', name: 'Input Count' },
						{ variableId: 'output_count', name: 'Output Count' },
					]
					this.setVariableValues({input_count: this.inputs})
					this.setVariableValues({output_count: this.outputs})
					this.updateVariableDefinitions
				}
			})
		} else {
			this.updateStatus(InstanceStatus.BadConfig)
		}
	}

}

runEntrypoint(ForaMfrInstance, UpgradeScripts)