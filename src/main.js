const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper,  } = require('@companion-module/base')
const { combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
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
	CHOICES_LOCK = [
		{ id: '0', label: 'Unlock' },
		{ id: '1', label: 'Lock up' },
		// { id: '2', label: 'Lock others' },
	]
	CROSSPOINTS = []

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
				// // update selected_dst_name variable if required
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
				// // update selected_src_name variable if required
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
		ChannelState: {
			name: 'Example Feedback',
			type: 'boolean',
			label: 'Channel State',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					id: 'num',
					type: 'number',
					label: 'Test',
					default: 5,
					min: 0,
					max: 10,
				},
			],
			callback: (feedback) => {
				console.log('Hello world!', feedback.options.num)
				if (feedback.options.num > 5) {
					return true
				} else {
					return false
				}
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
		this.updateFeedbacks(this.feedbacks) // export feedbacks
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
		this.updateFeedbacks(this.feedbacks) // export feedbacks
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
				// if (line.length !== 1) {
				// 	this.log('debug', `Received Line : ${line}`)
				// }

				// set the 'id' variable value

				if (line.includes('S:')) {
					this.log('debug', `Received Line with \'S:\' : ${line}`)

					// Removing leading and trailing whitespace
					let trimmedString = line.trim()

					// Discarding the first 3 characters
					let substringAfter3Chars = trimmedString.substring(3)

					// Extracting characters from 4 up to the comma
					let commaIndex = substringAfter3Chars.indexOf(',')
					let decimalValue = parseInt(substringAfter3Chars.substring(0, commaIndex), 16)

					// this.log('debug', `crosspoint string = ${decimalValue}`)

					// Extracting characters after the comma as a string
					let charactersAfterComma = substringAfter3Chars.substring(commaIndex + 1)

					// Creating an array and adding characters after the comma at the specified position
					// let resultArray = []
					this.CROSSPOINTS[decimalValue] = charactersAfterComma
					this.log('debug', `crosspoint ${decimalValue} source is ${this.CROSSPOINTS[decimalValue]}`)
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
					this.setVariableDefinitions(this.variable_array)
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

					// Update CHOICES_DST and selected destination values
					const obj = { id: hex_dst, label: asciiString }
					this.insertOrUpdate(this.CHOICES_DST, obj, parseInt(hex_dst, 16))

					// Set initial values of selected destination id and name
					if (!this.getVariableValue('selected_dst_id')) {
						this.setVariableValues({ selected_dst_id: this.CHOICES_DST[0].id })
						this.setVariableValues({ selected_dst_name: this.CHOICES_DST[0].label })
					}

					// Update actions
					this.updateActions(this.actions)
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

					// Update actions
					this.updateActions(this.actions)
				}

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
}

runEntrypoint(ForaMfrInstance, UpgradeScripts)
