var tcp = require('../../tcp')
var instance_skel = require('../../instance_skel')
var debug
var log

/* 
	++ LINK TO USER MANUAL WITH CONTROL PROTOCOL COMMANDS
*/

function instance(system, id, config) {
	var self = this

	self.CHOICES_INPUTS = []
	self.CHOICES_OUTPUTS = []
	self.CHOICES_PRESETS = []

	self.presets = {}
	self.outputs = 0
	self.inputs = 0
	self.variables = []

	// super-constructor
	instance_skel.apply(this, arguments)

	self.init_actions() // export actions

	return self
}

instance.prototype.updateConfig = function (config) {
	var self = this

	self.config = config
	self.init_tcp()
}

instance.prototype.init = function () {
	var self = this

	debug = self.debug
	log = self.log

	self.numPresets = 0
	self.xpt = {}

	self.status(self.STATE_UNKNOWN)

	self.init_tcp()
	self.init_feedbacks()
}

instance.prototype.init_tcp = function () {
	var self = this
	var receivebuffer = ''
	self.responseHandlers = {}

	if (self.socket !== undefined) {
		self.socket.destroy()
		delete self.socket
	}

	if (self.config.host) {
		self.socket = new tcp(self.config.host, self.config.port)

		self.socket.on('status_change', function (status, message) {
			self.status(status, message)
		})

		self.socket.on('connect', function () {
			// request system size
			// MFR registers are zero based so decrement by 1
			// MFR uses hex throughout but max level is 8 so no conversion needed
			let level = self.config.level - 1
			self.socket.send('@ F?' + level + '\r\n')

			// self.checkNumpresets();
		})

		self.socket.on('error', function (err) {
			self.debug('Network error', err)
			self.log('error', 'Network error: ' + err.message)
		})

		self.socket.on('data', function (chunk) {
			var i = 0,
				line = '',
				offset = 0
			receivebuffer += chunk

			while ((i = receivebuffer.indexOf('\n', offset)) !== -1) {
				line = receivebuffer.substr(offset, i - offset)
				offset = i + 1
				self.socket.emit('receiveline', line.trim())
			}
			receivebuffer = receivebuffer.substr(offset)
		})

		self.socket.on('receiveline', function (line) {
			var match

			if (line.startsWith('@ F?' + (self.config.level - 1).toString())) {
				match = line.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)

				var systemsize = match[1]
					.match(/[A-Za-z0-9]+,[A-Za-z0-9]+/gm)
					.toString()
					.split(',')

				// self.CHOICES_OUTPUTS.length = 0;

				self.outputs = parseInt(systemsize[0], 16) + 1
				self.variables.push({ label: 'Total outputs', name: 'output-count' })
				self.setVariable('output-count', self.outputs)

				// self.CHOICES_INPUTS.length = 0;

				self.inputs = parseInt(systemsize[1], 16) + 1
				self.variables.push({ label: 'Total inputs', name: 'input-count' })
				self.setVariable('input-count', self.inputs)

				// Update inputs/outputs
				self.init_actions()
				self.getIO()
				// self.init_feedbacks()
				// self.checkFeedbacks('xpt_color');
				// self.init_presets();
				self.init_variables()
			}
			// catch all channel names by matching "@ K?"
			// then match D or S ( output or input
			else if (line.match('K:')) {
				//	process output channel names (ascii)
				if (line.match('K:DA')) {
					let regex = '[^K:DA][A-Za-z0-9]{2}'
					let channelNumber = parseInt(line.match(regex), 16)

					var channelName = line.split(',')[1]
					channelName = Buffer.from(channelName, 'hex').toString()

					self.variables.push({ label: 'Output ' + channelNumber, name: 'output-' + channelNumber })
					self.setVariable('output-' + channelNumber, channelName)
					self.CHOICES_OUTPUTS[channelNumber - 1] = { id: channelNumber - 1, label: channelName }

					self.setVariableDefinitions(self.variables)
					self.init_actions()
				}
				//	process input channel names (ascii)
				else if (line.match('K:SA')) {
					let regex = '[^K:SA][A-Za-z0-9]{2}'
					let channelNumber = parseInt(line.match(regex), 16)

					var channelName = line.split(',')[1]
					channelName = Buffer.from(channelName, 'hex').toString()

					self.variables.push({ label: 'Input + ' + channelNumber, name: 'input-' + channelNumber })
					self.setVariable('input-' + channelNumber, channelName)
					self.CHOICES_INPUTS[channelNumber - 1] = { id: channelNumber - 1, label: channelName }

					self.setVariableDefinitions(self.variables)
					self.init_actions()
				}
			} else if (line.match('^S')) {
				// self.debug("caught S response " + line);

				line = line.match('[^S:][^0-9].+')[0].split(',')
				// self.debug("\td,s == " + parseInt(line[0],16) + " : " + parseInt(line[1],16));
				self.xpt[parseInt(line[0], 16)] = parseInt(line[1], 16)
				self.checkFeedbacks('xpt_color')
			}
			// else if (match = line.match(/\(O(\d+) I(\d+)\)/i)) {
			// 	self.xpt[parseInt(match[1])] = parseInt(match[2]);
			// 	self.checkFeedbacks('xpt_color');
			// }
			// else if (match = line.match(/\(i:\s*(.+)\)$/i)) {
			// 	log('info', 'Connected to ' + match[1]);
			// }
			else {
				// catch any non-empty unprocessed lines and print them to console
				if (line.trim().length > 0) {
					if (line !== '>') {
						self.debug('unhandled respnose received : ' + line)
					}
				}
			}
			// else if (match = line.match(/(ERR04)/i)) {
			// 	if (self.checkPresets !== undefined) {
			// 		self.checkNumpresets();
			// 	}
			// }
			// else if (match = line.match(/\(INAME#(\d+)=([^)]+)\)$/i)) {
			// 	var id = parseInt(match[1]);
			// 	var name = match[2];

			// 	self.setVariable('input_' + id, name);
			// 	self.CHOICES_INPUTS[id - 1] = { label: name, id: id };

			// 	// This is (regrettably) needed to update the dropdown boxes of inputs/outputs
			// 	self.init_actions();
			// 	self.init_presets();
			// 	self.init_feedbacks()
			// }
			// else if (match = line.match(/\(ONAME#(\d+)=([^)]+)\)$/i)) {
			// 	var id = parseInt(match[1]);
			// 	var name = match[2];

			// 	self.setVariable('output_' + id, name);
			// 	self.CHOICES_OUTPUTS[id - 1] = { label: name, id: id };

			// 	// This is (regrettably) needed to update the dropdown boxes of inputs/outputs
			// 	self.init_actions();
			// 	self.init_presets();
			// 	self.init_feedbacks()
			// }
			// else if (match = line.match(/\(PNAME#(\d+)=([^)]+)\)$/i)) {
			// 	var id = parseInt(match[1]);
			// 	var name = match[2];

			// 	if (self.checkPresets !== undefined) {
			// 		self.debug('Detected ' + id + ' presets on LW2 device');
			// 		self.numPresets = id;
			// 		self.checkPresets = undefined;
			// 		self.getPresets();
			// 		self.init_variables();
			// 		self.init_presets();
			// 	} else {
			// 		self.presets[id] = name;
			// 		self.setVariable('preset_' + id, self.presets[id]);
			// 		self.CHOICES_PRESETS[id - 1] = { label: 'Preset ' + id + ': ' + name, id: id };
			// 		self.init_actions();
			// 	}
			// }
			// else if (match = line.match(/\(O(\d+) I(\d+)\)/i)) {
			// 	self.xpt[parseInt(match[1])] = parseInt(match[2]);
			// 	self.checkFeedbacks('xpt_color');
			// }
			// else if (match = line.match(/\(i:\s*(.+)\)$/i)) {
			// 	log('info', 'Connected to ' + match[1]);
			// }
		})
	}
}

instance.prototype.getIO = function () {
	var self = this

	//	Up to 32 channel names can be obtained per a single request.
	//	Note that the number of request channels exceeds the system maximum size,
	//	no data will return for the exceeded channels.

	// divide (decimal) number of output channels by 32
	let outputChannelRequests = Math.ceil(self.outputs / 32)

	for (var i = 0; i < outputChannelRequests; ++i) {
		self.socket.send('@ K?DA,' + (i * 32).toString(16).padStart(3, '0') + '\r\n')
	}

	// divide (decimal) number of input channels by 32
	let inputChannelRequests = Math.ceil(self.inputs / 32)

	for (var i = 0; i < inputChannelRequests; ++i) {
		self.socket.send('@ K?SA,' + (i * 32).toString(16).padStart(3, '0') + '\r\n')
	}
}

// instance.prototype.getPresets = function() {
// 	var self = this;

// 	for (var i = 0; i < self.numPresets; ++i) {
// 		self.socket.send("{pname#" + (i+1) + "=?}\r\n");
// 	}
// };

// instance.prototype.checkNumpresets = function() {
// 	var self = this;

// 	if (self.checkPresets === undefined) {
// 		self.CHOICES_PRESETS.length = 0;
// 		self.checkPresets = 64;
// 		self.socket.send("{pname#64=?}\r\n");
// 	} else if (self.checkPresets == 64) {
// 		self.checkPresets = 32;
// 		self.socket.send("{pname#32=?}\r\n");
// 	} else if (self.checkPresets == 32) {
// 		self.checkPresets = 16;
// 		self.socket.send("{pname#16=?}\r\n");
// 	} else if (self.checkPresets == 16) {
// 		self.checkPresets = 8;
// 		self.socket.send("{pname#8=?}\r\n");
// 	} else {
// 		self.debug('Found no presets on device');
// 		self.checkPresets = undefined;
// 	}
// };

// Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this
	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'This module is for controlling For.A MFR routing switchers using Crosspoint remote control protocol 2. Tested on MFR-3000',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP',
			width: 12,
			regex: self.REGEX_IP,
		},
		{
			type: 'number',
			id: 'port',
			label: 'TCP Port',
			default: 23,
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

instance.prototype.init_variables = function () {
	var self = this
	// var variables = [];

	for (var i = 0; i < self.numPresets; ++i) {
		self.variables.push({ label: 'Label of preset ' + (i + 1), name: 'preset_' + (i + 1) })
	}

	self.setVariableDefinitions(self.variables)
}

instance.prototype.init_feedbacks = function () {
	var self = this

	self.setFeedbackDefinitions({
		xpt_color: {
			label: 'Change background color',
			description: 'If the input specified is in use by the output specified, change colors of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: self.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: self.rgb(255, 0, 0),
				},
				{
					type: 'dropdown',
					label: 'Input',
					id: 'input',
					default: '1',
					choices: self.CHOICES_INPUTS,
				},
				{
					type: 'dropdown',
					label: 'Output',
					id: 'output',
					default: '1',
					choices: self.CHOICES_OUTPUTS,
				},
			],
		},
	})
}

instance.prototype.init_presets = function () {
	var self = this
	var presets = []

	for (var o = 0; o < self.CHOICES_OUTPUTS.length; ++o) {
		for (var i = 0; i < self.CHOICES_INPUTS.length; ++i) {
			presets.push({
				category: 'Output ' + (o + 1),
				label: 'Feedback button for input ' + (i + 1) + ' on output ' + (o + 1),
				bank: {
					style: 'text',
					text: '$(instance:input_' + (i + 1) + ')\\n$(instance:output_' + (o + 1) + ')',
					size: 'auto',
					color: '16777215',
					bgcolor: 0,
				},
				feedbacks: [
					{
						type: 'xpt_color',
						options: {
							bg: self.rgb(255, 0, 0),
							fg: self.rgb(255, 255, 255),
							input: i + 1,
							output: o + 1,
						},
					},
				],
				actions: [
					{
						action: 'xpt',
						options: {
							input: i + 1,
							output: o + 1,
						},
					},
				],
			})
		}
	}

	if (self.numPresets) {
		for (var i = 0; i < self.numPresets; ++i) {
			presets.push({
				category: 'Load presets',
				label: 'Load button for preset ' + (i + 1),
				bank: {
					style: 'text',
					text: '$(instance:preset_' + (i + 1) + ')',
					size: 'auto',
					color: '16777215',
					bgcolor: 0,
				},
				actions: [
					{
						action: 'preset',
						options: {
							preset: i + 1,
						},
					},
				],
			})
			presets.push({
				category: 'Save presets',
				label: 'Save button for preset ' + (i + 1),
				bank: {
					style: 'text',
					text: '$(instance:preset_' + (i + 1) + ')',
					size: 'auto',
					color: '16777215',
					bgcolor: 0,
				},
				actions: [
					{
						action: 'savepreset',
						options: {
							preset: i + 1,
						},
					},
				],
			})
		}
	}

	self.setPresetDefinitions(presets)
}

// When module gets deleted
instance.prototype.destroy = function () {
	var self = this

	if (self.socket !== undefined) {
		self.socket.destroy()
	}

	self.debug('destroy', self.id)
}

instance.prototype.init_actions = function (system) {
	var self = this

	var actions = {
		xpt: {
			label: 'Switch route - one input to one output',
			options: [
				{
					label: 'Input',
					type: 'dropdown',
					id: 'input',
					choices: self.CHOICES_INPUTS,
					default: 0,
				},
				{
					label: 'Output',
					type: 'dropdown',
					id: 'output',
					choices: self.CHOICES_OUTPUTS,
					default: 0,
				},
			],
		},
		presetXpt: {
			label: 'Preset route - one input to one output',
			options: [
				{
					label: 'Input',
					type: 'dropdown',
					id: 'input',
					choices: self.CHOICES_INPUTS,
					default: 0,
				},
				{
					label: 'Output',
					type: 'dropdown',
					id: 'output',
					choices: self.CHOICES_OUTPUTS,
					default: 0,
				},
			],
		},
		switchPresetXpt: {
			label: 'Set the preset crosspoints simultaneously',
			id: 'switchPresetXpt',
		},
		clearPresetXpt: {
			label: 'Clear preset crosspoints',
			id: 'clearPresetXpt',
		},
		getSignalNames: {
			label: 'Update signal names',
			id: 'getSignalNames',
		},
	}

	if (self.numPresets > 0) {
		actions['preset'] = {
			label: 'Load preset',
			options: [
				{
					label: 'Preset',
					type: 'dropdown',
					id: 'preset',
					choices: self.CHOICES_PRESETS,
					default: 1,
				},
			],
		}
		actions['savepreset'] = {
			label: 'Save preset',
			options: [
				{
					label: 'Preset',
					type: 'dropdown',
					id: 'preset',
					choices: self.CHOICES_PRESETS,
					default: 1,
				},
			],
		}
	}

	self.setActions(actions)
}

instance.prototype.action = function (action) {
	var self = this
	var cmd
	var opt = action.options

	switch (action.action) {
		case 'xpt':
			cmd = '@ X:' + (self.config.level - 1) + '/' + opt.output.toString(16) + ',' + opt.input.toString(16)
			break

		case 'presetXpt':
			cmd = '@ P:' + (self.config.level - 1) + '/' + opt.output.toString(16) + ',' + opt.input.toString(16)
			break

		case 'switchPresetXpt':
			cmd = '@ B:E'
			break

		case 'clearPresetXpt':
			cmd = '@ B:C'
			break

		case 'getSignalNames':
			self.getIO()
			break

		// case 'preset':
		// 	cmd = '{%' + opt.preset + '}';
		// 	break;

		// case 'savepreset':
		// 	cmd = '{$' + opt.preset + '}';
		// 	break;
	}

	self.debug('action():', action)

	if (cmd !== undefined) {
		if (self.socket !== undefined) {
			debug('sending ', cmd, 'to', self.socket.host)
			self.socket.send(cmd + '\r\n')
		}
	}
}

instance.prototype.feedback = function (feedback, bank) {
	var self = this

	if ((feedback.type = 'xpt_color')) {
		var bg = feedback.options.bg

		if (self.xpt[parseInt(feedback.options.output)] == parseInt(feedback.options.input)) {
			return {
				color: feedback.options.fg,
				bgcolor: feedback.options.bg,
			}
		}
	}
}

instance_skel.extendedBy(instance)
exports = module.exports = instance
