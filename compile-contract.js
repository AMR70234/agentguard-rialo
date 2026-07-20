const fs = require('fs');
const path = require('path');
const solc = require('solc');

const contractPath = path.join(__dirname, 'contracts', 'AgentEscrow.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'AgentEscrow.sol': { content: source },
  },
  settings: {
    evmVersion: 'paris', // avoids PUSH0 opcode, required for Arc Testnet
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter(e => e.severity === 'error');
  output.errors.forEach(e => console.log(e.formattedMessage));
  if (fatal.length > 0) {
    console.log('❌ Compilation failed with errors above.');
    process.exit(1);
  }
}

const contract = output.contracts['AgentEscrow.sol']['AgentEscrow'];
const abi = contract.abi;
const bytecode = '0x' + contract.evm.bytecode.object;

fs.writeFileSync('contract-abi.json', JSON.stringify(abi, null, 2));
fs.writeFileSync('contract-bytecode.txt', bytecode);

console.log('✅ Compiled successfully.');
console.log('ABI saved to contract-abi.json');
console.log('Bytecode saved to contract-bytecode.txt');
console.log('Bytecode length:', bytecode.length, 'characters');
