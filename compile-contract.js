const fs = require('fs');
const path = require('path');
const solc = require('solc');

function findImports(importPath) {
  // محاولات مختلفة للبحث عن الملف
  const possiblePaths = [
    path.join(__dirname, 'node_modules', importPath),
    path.join(__dirname, 'node_modules', importPath.replace('@openzeppelin/contracts/', '')),
    path.join(__dirname, 'node_modules', '@openzeppelin', 'contracts', importPath.replace('@openzeppelin/contracts/', '')),
  ];

  for (const fullPath of possiblePaths) {
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        return { contents: content };
      }
    } catch (err) {
      // جرب المسار التالي
    }
  }

  console.log('❌ File not found:', importPath);
  console.log('   Tried:', possiblePaths);
  return { error: 'File not found: ' + importPath };
}

const contractPath = path.join(__dirname, 'contracts', 'AgentEscrow.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'AgentEscrow.sol': { content: source },
  },
  settings: {
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
};

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports })
);

if (output.errors) {
  const fatal = output.errors.filter(e => e.severity === 'error');
  output.errors.forEach(e => console.log(e.formattedMessage));
  if (fatal.length > 0) {
    console.log('❌ Compilation failed with errors above.');
    process.exit(1);
  }
}

if (!output.contracts || !output.contracts['AgentEscrow.sol'] || !output.contracts['AgentEscrow.sol']['AgentEscrow']) {
  console.log('❌ Contract not found in compilation output.');
  console.log('Available contracts:', Object.keys(output.contracts || {}));
  process.exit(1);
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
