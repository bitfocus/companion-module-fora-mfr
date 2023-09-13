module.exports = async function (self) {
	var variable_array = []
	// var variable_array = [
	// 	{ variableId: 'input_count', name: 'Input Count' },
	// 	{ variableId: 'output_count', name: 'Output Count' },
	// ]

	self.setVariableDefinitions(variable_array)
}

// module.exports = function getOutputNames(outputs) {

// 	for (let i = 0; i < Math.ceil(outputs/32); i++) {
// 		this.log('debug',`outputs  = ${outputs}`)
// 		this.log('debug',`i  = ${i}`)
// 	}

// }