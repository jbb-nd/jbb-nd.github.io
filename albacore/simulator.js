// Albacore Microprocessor Simulator JavaScript Implementation

console.log('Simulator script loaded');

class AssemblyError extends Error {
    constructor(message, addr = null) {
        super(message);
        this.name = 'AssemblyError';
        this.addr = addr;
    }
}

const INSTRUCTION_SET = {
    'add':  { format: 'R',     opcode: 0x0 },
    'sub':  { format: 'R',     opcode: 0x1 },
    'and':  { format: 'R',     opcode: 0x2 },
    'or':   { format: 'R',     opcode: 0x3 },
    'not':  { format: 'NOT',   opcode: 0x4 },
    'shl':  { format: 'R',     opcode: 0x5 },
    'shr':  { format: 'R',     opcode: 0x6 },
    'ldi':  { format: 'LDI',   opcode: 0x7 },
    'ld':   { format: 'LD',    opcode: 0x8 },
    'st':   { format: 'ST',    opcode: 0x9 },
    'br':   { format: 'BR',    opcode: 0xa },
    'bz':   { format: 'BZ_BN', opcode: 0xb },
    'bn':   { format: 'BZ_BN', opcode: 0xc },
    'jal':  { format: 'JAL',   opcode: 0xd },
    'jr':   { format: 'JR',    opcode: 0xe },
    'quit': { format: 'Q',     opcode: 0xf },
};

const REGISTER_MAP = {};
for (let i = 0; i < 16; i++) {
    REGISTER_MAP[`r${i}`] = i;
}

class AlbacoreSimulator {
    constructor() {
        console.log('AlbacoreSimulator constructor called');
        this.memory = {};
        this.text = {};
        this.data = {};
        this.labels = {};
        this.inverseLabels = {};
        this.dataBase = 0;
        this.lineNumbers = {};
        this.regs = new Array(16).fill(0);
        this.pc = 0;
        this.running = false;
        this.compiled = false;
        
        this.initializeUI();
    }
    
    initializeUI() {
        console.log('initializeUI called');
        console.log('Compile button:', document.getElementById('compileBtn'));
        console.log('Step button:', document.getElementById('stepBtn'));
        
        document.getElementById('compileBtn').addEventListener('click', () => {
            console.log('Compile button clicked');
            this.compile();
        });
        document.getElementById('stepBtn').addEventListener('click', () => {
            console.log('Step button clicked');
            this.singleStep();
        });
        document.getElementById('runBtn').addEventListener('click', () => {
            console.log('Run button clicked');
            this.runToEnd();
        });
        document.getElementById('resetBtn').addEventListener('click', () => {
            console.log('Reset button clicked');
            this.compile(); // Reset now recompiles and restarts
        });
        document.getElementById('helpBtn').addEventListener('click', () => {
            console.log('Help button clicked');
            showHelp();
        });
        
        // New toolbar button event listeners
        document.getElementById('openFileBtn').addEventListener('click', () => {
            console.log('Open file button clicked');
            this.openFile();
        });
        document.getElementById('saveSourceBtn').addEventListener('click', () => {
            console.log('Save source button clicked');
            this.saveFile();
        });
        document.getElementById('saveMemoryBtn').addEventListener('click', () => {
            console.log('Save memory button clicked');
            this.saveMemoryFile();
        });
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            // Check for modifier keys (Ctrl on Windows/Linux, Cmd on Mac)
            const isModifier = event.ctrlKey || event.metaKey;
            
            // Handle Ctrl+O and Ctrl+S globally to prevent browser defaults
            if (isModifier && event.key === 'o') {
                event.preventDefault();
                // Only trigger if we're in the source code textarea or not in any input
                if (event.target.id === 'sourceCode' || !event.target.matches('input, textarea')) {
                    this.openFile();
                    this.log('Open file triggered by Ctrl/Cmd+O');
                }
                return;
            } else if (isModifier && event.key === 's') {
                event.preventDefault();
                // Only trigger if we're in the source code textarea or not in any input
                if (event.target.id === 'sourceCode' || !event.target.matches('input, textarea')) {
                    this.saveFile();
                    this.log('Save file triggered by Ctrl/Cmd+S');
                }
                return;
            }
            
            // Only handle other shortcuts when not typing in the source code textarea
            if (event.target.id === 'sourceCode') return;
            
            if (event.key === 'F9' || (isModifier && event.key === 'F9')) {
                event.preventDefault();
                this.compile();
                this.log('Compile triggered by F9');
            } else if (event.key === 'F10') {
                event.preventDefault();
                if (this.compiled && this.running) {
                    this.singleStep();
                    this.log('Single step triggered by F10');
                }
            } else if (event.key === 'F5') {
                event.preventDefault();
                if (this.compiled && this.running) {
                    this.runToEnd();
                    this.log('Run to end triggered by F5');
                }
            } else if (isModifier && event.key === 'r') {
                event.preventDefault();
                if (this.compiled) {
                    this.compile();
                    this.log('Reset (recompile) triggered by Ctrl/Cmd+R');
                }
            }
        });
        
        // Add textarea-specific shortcuts for the source code editor
        document.getElementById('sourceCode').addEventListener('keydown', (event) => {
            const isModifier = event.ctrlKey || event.metaKey;
            
            if (isModifier && event.key === '/') {
                event.preventDefault();
                this.toggleComment();
                this.log('Comment/uncomment triggered by Ctrl/Cmd+/');
            } else if (event.key === 'Tab') {
                event.preventDefault();
                this.insertTab();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this.autoIndent();
            }
            // Note: Ctrl+O and Ctrl+S are now handled at the document level
        });
        
        this.updateDisplay();
    }
    
    log(message, isError = false) {
        const console = document.getElementById('console');
        const timestamp = new Date().toLocaleTimeString();
        const color = isError ? '#ff6666' : '#00ff00';
        console.innerHTML += `<span style="color: ${color}">[${timestamp}] ${message}</span><br>\n`;
        console.scrollTop = console.scrollHeight;
    }
    
    toggleComment() {
        const textarea = document.getElementById('sourceCode');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        // Find the start and end of the lines that contain the selection
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEndIndex = text.indexOf('\n', end - 1);
        const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
        
        // Get the selected lines
        const beforeSelection = text.substring(0, lineStart);
        const selectedText = text.substring(lineStart, lineEnd);
        const afterSelection = text.substring(lineEnd);
        
        // Split into individual lines
        const lines = selectedText.split('\n');
        
        // Check if all non-empty lines are commented
        const nonEmptyLines = lines.filter(line => line.trim().length > 0);
        const allCommented = nonEmptyLines.length > 0 && nonEmptyLines.every(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('//');
        });
        
        // Toggle comments on each line
        const toggledLines = lines.map(line => {
            const trimmed = line.trim();
            
            if (trimmed.length === 0) {
                // Leave empty lines unchanged
                return line;
            }
            
            if (allCommented) {
                // Uncomment: remove first occurrence of '//' and optional space
                return line.replace(/^(\s*)\/\/\s?/, '$1');
            } else {
                // Comment: add '//' after leading whitespace
                const leadingWhitespace = line.match(/^(\s*)/)[1];
                const restOfLine = line.substring(leadingWhitespace.length);
                return leadingWhitespace + '// ' + restOfLine;
            }
        });
        
        // Calculate the new text and cursor positions
        const newSelectedText = toggledLines.join('\n');
        const newText = beforeSelection + newSelectedText + afterSelection;
        
        // Calculate new cursor positions
        const lengthDiff = newSelectedText.length - selectedText.length;
        const newStart = start;
        const newEnd = end + lengthDiff;
        
        // Update the textarea
        textarea.value = newText;
        textarea.setSelectionRange(newStart, newEnd);
        textarea.focus();
    }
    
    insertTab() {
        const textarea = document.getElementById('sourceCode');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        // Insert 4 spaces at the cursor position
        const spaces = '    '; // 4 spaces
        const newText = text.substring(0, start) + spaces + text.substring(end);
        
        // Update the textarea
        textarea.value = newText;
        
        // Move cursor to after the inserted spaces
        const newCursorPos = start + spaces.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
    }
    
    autoIndent() {
        const textarea = document.getElementById('sourceCode');
        const start = textarea.selectionStart;
        const text = textarea.value;
        
        // Find the start of the current line
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const currentLine = text.substring(lineStart, start);
        
        // Calculate indentation of current line
        const indentMatch = currentLine.match(/^(\s*)/);
        let currentIndent = indentMatch ? indentMatch[1] : '';
        
        // Determine if we need to add extra indentation
        let extraIndent = '';
        const trimmedLine = currentLine.trim();
        
        // If current line ends with a colon (label), add indentation for next line
        if (trimmedLine.endsWith(':')) {
            extraIndent = '    '; // 4 spaces for instruction after label
        }
        // If current line is a directive (.text, .data), add indentation
        else if (trimmedLine === '.text' || trimmedLine === '.data') {
            extraIndent = '    '; // 4 spaces after directives
        }
        // If current line is an instruction and we're at base level, maintain same level
        else if (trimmedLine && !currentIndent && !trimmedLine.startsWith('.')) {
            // This is an instruction at base level, maintain no indentation
            currentIndent = '';
        }
        
        // Insert newline with appropriate indentation
        const newIndent = currentIndent + extraIndent;
        const insertText = '\n' + newIndent;
        
        // Update the textarea
        const newText = text.substring(0, start) + insertText + text.substring(start);
        textarea.value = newText;
        
        // Move cursor to end of inserted text
        const newCursorPos = start + insertText.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
    }
    
    openFile() {
        // Create a hidden file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.asm,.s,.txt';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    document.getElementById('sourceCode').value = content;
                    this.initialize(); // Reset simulator state when loading new file
                    this.log(`File "${file.name}" loaded successfully`);
                };
                reader.onerror = () => {
                    this.log(`Error reading file "${file.name}"`, true);
                };
                reader.readAsText(file);
            }
            // Clean up
            document.body.removeChild(fileInput);
        });
        
        // Add to DOM and trigger click
        document.body.appendChild(fileInput);
        fileInput.click();
    }
    
    saveFile() {
        const sourceCode = document.getElementById('sourceCode').value;
        if (!sourceCode.trim()) {
            this.log('No content to save', true);
            return;
        }
        
        // Create a blob with the source code content
        const blob = new Blob([sourceCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        // Create a temporary download link
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'assembly_program.asm';
        downloadLink.style.display = 'none';
        
        // Add to DOM, click, and clean up
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        
        this.log('File saved as "assembly_program.asm"');
    }
    
    saveMemoryFile() {
        if (!this.compiled) {
            this.log('No compiled program to save. Please compile first.', true);
            return;
        }
        
        // Generate memory file content in enhanced .mem format
        let memContent = '';
        
        // Add header comment
        memContent += '// Memory dump from Albacore Simulator\n';
        memContent += '// Format: @address value // comments\n';
        memContent += '// Generated: ' + new Date().toLocaleString() + '\n\n';
        
        // Text segment
        memContent += '// .text\n';
        const textAddresses = Object.keys(this.text).map(Number).sort((a, b) => a - b);
        for (const addr of textAddresses) {
            const value = this.memory[addr];
            const label = this.inverseLabels[addr] || '';
            const sourceCode = this.text[addr];
            memContent += `@${addr.toString(16).padStart(4, '0').toUpperCase()} ${value.toString(16).padStart(4, '0').toUpperCase()}  // ${label}${sourceCode}\n`;
        }
        
        // Data segment
        if (Object.keys(this.data).length > 0) {
            memContent += '// .data\n';
            const dataAddresses = Object.keys(this.data).map(Number).sort((a, b) => a - b);
            for (const addr of dataAddresses) {
                const actualAddr = addr + this.dataBase;
                const value = this.memory[actualAddr];
                const label = this.inverseLabels[actualAddr] || '';
                const sourceCode = this.data[addr];
                memContent += `@${actualAddr.toString(16).padStart(4, '0').toUpperCase()} ${value.toString(16).padStart(4, '0').toUpperCase()}  // ${label}${sourceCode}\n`;
            }
        }
        
        // Create and download the file
        const blob = new Blob([memContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'memory_dump.mem';
        downloadLink.style.display = 'none';
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        
        this.log(`Memory file saved (${textAddresses.length + Object.keys(this.data).length} addresses)`);
    }
    
    parseAsm(lines) {
        const text = {};
        const data = {};
        const labels = {};
        const inverseLabels = {};
        const lineNumbers = {};
        const dataLineNumbers = {};
        
        let currentSegment = null;
        let address = 0;
        let dataAddress = 0;
        const dataLabels = {};
        
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            let line = lines[lineNumber].split('//')[0].trim();
            if (!line) continue;
            
            if (line === '.text') {
                currentSegment = 'text';
                continue;
            } else if (line === '.data') {
                currentSegment = 'data';
                continue;
            }
            
            if (currentSegment === 'text') {
                if (line.includes(':')) {
                    const [label, rest] = line.split(':', 2);
                    const labelName = label.trim();
                    labels[labelName] = address;
                    inverseLabels[address] = labelName + ': ';
                    line = rest.trim();
                    if (!line) continue;
                }
                text[address] = line;
                lineNumbers[address] = lineNumber + 1;
                address++;
            } else if (currentSegment === 'data') {
                if (line.includes(':')) {
                    const [label, rest] = line.split(':', 2);
                    const labelName = label.trim();
                    dataLabels[labelName] = dataAddress;
                    line = rest.trim();
                }
                
                if (line.startsWith('.word')) {
                    const value = line.split(/\s+/)[1];
                    data[dataAddress] = value.trim();
                    dataLineNumbers[dataAddress] = lineNumber + 1;
                    dataAddress++;
                } else {
                    const values = line.split(',');
                    for (const value of values) {
                        data[dataAddress] = value.trim();
                        dataLineNumbers[dataAddress] = lineNumber + 1;
                        dataAddress++;
                    }
                }
            }
        }
        
        // Set data labels to their actual addresses
        const dataBase = address;
        for (const [label, offset] of Object.entries(dataLabels)) {
            labels[label] = dataBase + offset;
            inverseLabels[dataBase + offset] = label + ': ';
        }
        
        // Set data line numbers to their actual addresses
        for (const [offset, lineNum] of Object.entries(dataLineNumbers)) {
            lineNumbers[dataBase + parseInt(offset)] = lineNum;
        }
        
        return { text, data, labels, inverseLabels, dataBase, lineNumbers };
    }
    
    encodeInstruction(addr, instruction, labels) {
        try {
            const tokens = instruction.split(/[,\s()]+/).filter(t => t);
            
            const reg = (token) => {
                if (!(token in REGISTER_MAP)) {
                    throw new AssemblyError(`Invalid register ${token}`, addr);
                }
                return REGISTER_MAP[token];
            };
            
            const checkArgCount = (n) => {
                if (tokens.length !== n + 1) {
                    throw new AssemblyError(`${tokens[0]} must have ${n} arguments`, addr);
                }
            };
            if (!tokens.length) return 0;
            
            const mnemonic = tokens[0];
            if (!(mnemonic in INSTRUCTION_SET)) {
                throw new AssemblyError(`Unknown instruction: ${mnemonic}`, addr);
            }
            
            const { format, opcode } = INSTRUCTION_SET[mnemonic];
            let code = 0;
            
            switch (format) {
                case 'R':
                    checkArgCount(3);
                    const rd = reg(tokens[1]);
                    const rs1 = reg(tokens[2]);
                    const rs2 = reg(tokens[3]);
                    code = (opcode << 12) | (rd << 8) | (rs1 << 4) | rs2;
                    break;
                    
                case 'NOT':
                    checkArgCount(2);
                    const rdNot = reg(tokens[1]);
                    const rs1Not = reg(tokens[2]);
                    code = (opcode << 12) | (rdNot << 8) | (rs1Not << 4);
                    break;
                    
                case 'LDI':
                    // no checkArgCount, detailed check below like in Python
                    const rdLdi = reg(tokens[1]);
                    let imm;
                    
                    // Try to parse as integer first
                    imm = parseInt(tokens[2], 0);
                    if (isNaN(imm)) {
                        // If parsing fails, check for 'low' or 'high'
                        if (tokens[2] === 'low') {
                            const label = tokens[3];
                            if (!(label in labels)) {
                                throw new AssemblyError(`Undefined label: ${label}`, addr);
                            }
                            imm = labels[label] & 0xFF;
                        } else if (tokens[2] === 'high') {
                            const label = tokens[3];
                            if (!(label in labels)) {
                                throw new AssemblyError(`Undefined label: ${label}`, addr);
                            }
                            imm = (labels[label] >> 8) & 0xFF;
                        } else {
                            throw new AssemblyError(`Invalid immediate expression: ${tokens[2]}`, addr);
                        }
                    }
                    if (imm < -128 || imm > 255) {
                        throw new AssemblyError(`Immediate value 0x${imm.toString(16)} (${imm}) out of 8-bit range`, addr);
                    }
                    code = (opcode << 12) | (rdLdi << 8) | (imm & 0xFF);
                    break;
                    
                case 'LD':
                    checkArgCount(3);
                    const rdLd = reg(tokens[1]);
                    const rs1Ld = reg(tokens[2]);
                    const immLd = parseInt(tokens[3], 0);
                    if (isNaN(immLd)) {
                        throw new AssemblyError(`Invalid immediate value: ${tokens[3]}`, addr);
                    }
                    code = (opcode << 12) | (rdLd << 8) | ((immLd & 0xF) << 4) | rs1Ld;
                    break;
                    
                case 'ST':
                    checkArgCount(3);
                    const rs1St = reg(tokens[1]);
                    const rs2St = reg(tokens[2]);
                    const immSt = parseInt(tokens[3], 0);
                    if (isNaN(immSt)) {
                        throw new AssemblyError(`Invalid immediate value: ${tokens[3]}`, addr);
                    }
                    code = (opcode << 12) | ((immSt & 0xF) << 8) | (rs1St << 4) | rs2St;
                    break;
                    
                case 'BZ_BN':
                    checkArgCount(2);
                    const rs1Br = reg(tokens[1]);
                    const labelBr = tokens[2];
                    if (!(labelBr in labels)) {
                        throw new AssemblyError(`Undefined label: ${labelBr}`, addr);
                    }
                    const offsetBr = (labels[labelBr] - addr) & 0xFF;
                    code = (opcode << 12) | (offsetBr << 4) | rs1Br;
                    break;
                    
                case 'BR':
                    checkArgCount(1);
                    const labelBrUn = tokens[1];
                    if (!(labelBrUn in labels)) {
                        throw new AssemblyError(`Undefined label: ${labelBrUn}`, addr);
                    }
                    const offsetBrUn = (labels[labelBrUn] - addr) & 0xFF;
                    code = (opcode << 12) | (offsetBrUn << 4) | 0;
                    break;
                    
                case 'JAL':
                    checkArgCount(1);
                    const labelJal = tokens[1];
                    if (!(labelJal in labels)) {
                        throw new AssemblyError(`Undefined label: ${labelJal}`, addr);
                    }
                    const target = labels[labelJal] & 0x0FFF;
                    code = (opcode << 12) | target;
                    break;
                    
                case 'JR':
                    checkArgCount(1);
                    const rs1Jr = reg(tokens[1]);
                    code = (opcode << 12) | 0 | (rs1Jr << 4) | 0;
                    break;
                    
                case 'Q':
                    code = (opcode << 12) | 0 | 0 | 0;
                    break;
                    
                default:
                    code = 0;
            }
            
            return code;
        } catch (error) {
            if (error instanceof AssemblyError) {
                throw error;
            }
            throw new AssemblyError(error.toString(), addr);
        }
    }
    
    encodeDataValue(str, addr) {
        const value = parseInt(str, 0);
        if (isNaN(value)) {
            throw new AssemblyError(`Invalid integer format ${str}`, addr);
        }
        if (value < -32768 || value > 65535) {
            throw new AssemblyError(`Integer ${value.toString(16)} (${value}) outside 16-bit range`, addr);
        }
        return value & 0xFFFF;
    }
    
    assemble(sourceCode) {
        const lines = sourceCode.split('\n');
        const { text, data, labels, inverseLabels, dataBase, lineNumbers } = this.parseAsm(lines);
        
        const memory = {};
        
        // Assemble text segment
        for (const addr of Object.keys(text).map(Number).sort((a, b) => a - b)) {
            try {
                const code = this.encodeInstruction(addr, text[addr], labels);
                memory[addr] = code;
            } catch (error) {
                if (error instanceof AssemblyError) {
                    throw new Error(`Assembly error line ${lineNumbers[error.addr]}: ${error.message}`);
                }
                throw error;
            }
        }
        
        // Assemble data segment
        for (const addr of Object.keys(data).map(Number).sort((a, b) => a - b)) {
            const token = data[addr];
            const actualAddr = addr + dataBase;
            
            try {
                const value = this.encodeDataValue(token, actualAddr);
                memory[actualAddr] = value;
            } catch (error) {
                if (error instanceof AssemblyError) {
                    throw new Error(`Assembly error line ${lineNumbers[error.addr]}: ${error.message}`);
                }
                throw error;
            }
        }
        
        return { memory, text, data, dataBase, labels, inverseLabels };
    }
    
    compile() {
        try {
            const sourceCode = document.getElementById('sourceCode').value;
            const result = this.assemble(sourceCode);
            
            this.memory = result.memory;
            this.text = result.text;
            this.data = result.data;
            this.dataBase = result.dataBase;
            this.labels = result.labels;
            this.inverseLabels = result.inverseLabels;
            this.compiled = true;
            
            this.log('Compilation successful');
            this.updateAssembledProgram();
            this.updateMemoryDisplay();
            this.updateDataLabelsDisplay();
            this.reset();
            
        } catch (error) {
            this.log(`Compilation failed: ${error.message}`, true);
            this.compiled = false;
            this.updateControls();
        }
    }
    
    signExtend(val, bits) {
        if (val & (1 << (bits - 1))) {
            return val | (~((1 << bits) - 1));
        }
        return val;
    }
    
    singleStep() {
        console.log('singleStep called - compiled:', this.compiled, 'running:', this.running);
        if (!this.running || !this.compiled) {
            console.log('singleStep early return - not running or not compiled');
            return;
        }
        
        try {
            if (!(this.pc in this.memory)) {
                this.log(`Program counter ${this.pc.toString(16)} not in memory`, true);
                this.running = false;
                this.updateControls();
                return;
            }
            
            const instruction = this.text[this.pc] || '';
            this.log(`Executing: ${this.pc.toString(16).padStart(4, '0')}  ${this.memory[this.pc].toString(16).padStart(4, '0')}  ${instruction}`);
            
            const result = this.executeInstruction();
            this.pc = result.pc;
            this.running = result.running;
            
            this.log(`Effect: ${result.effect}`);
            this.updateDisplay();
            this.highlightCurrentLine();
            
            if (!this.running) {
                this.log('Program completed');
                this.updateControls();
            }
            
        } catch (error) {
            this.log(`Execution error: ${error.message}`, true);
            this.running = false;
            this.updateControls();
        }
    }
    
    executeInstruction() {
        const instr = this.memory[this.pc];
        const opcode = (instr >> 12) & 0xF;
        const rd = (instr >> 8) & 0xF;
        const rs1 = (instr >> 4) & 0xF;
        const rs2 = instr & 0xF;
        const ldi_imm8 = instr & 0xFF;
        const ld_imm4 = (instr >> 4) & 0xF;
        const st_imm4 = (instr >> 8) & 0xF;
        const b_imm8 = (instr >> 4) & 0xFF;
        const imm12 = instr & 0xFFF;
        
        let pc = this.pc;
        let running = true;
        let effect = '';
        
        switch (opcode) {
            case 0x0: // add
                this.regs[rd] = (this.regs[rs1] + this.regs[rs2]) & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x1: // sub
                this.regs[rd] = (this.regs[rs1] - this.regs[rs2]) & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x2: // and
                this.regs[rd] = this.regs[rs1] & this.regs[rs2];
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x3: // or
                this.regs[rd] = this.regs[rs1] | this.regs[rs2];
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x4: // not
                this.regs[rd] = (~this.regs[rs1]) & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x5: // shl
                this.regs[rd] = (this.regs[rs1] << this.regs[rs2]) & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x6: // shr
                this.regs[rd] = (this.regs[rs1] >>> this.regs[rs2]) & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x7: // ldi
                this.regs[rd] = ldi_imm8 & 0xFFFF;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x8: // ld
                const addr_mem = (this.regs[rs2] + ld_imm4) & 0xFFFF;
                this.regs[rd] = this.memory[addr_mem] || 0;
                pc += 1;
                effect = `r${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x9: // st
                const addr_mem_st = (this.regs[rs2] + st_imm4) & 0xFFFF;
                this.memory[addr_mem_st] = this.regs[rs1];
                pc += 1;
                effect = `mem[${addr_mem_st.toString(16).padStart(4, '0')}] = 0x${this.memory[addr_mem_st].toString(16)} (${this.signExtend(this.memory[addr_mem_st], 16)})`;
                break;
                
            case 0xA: // br
                const imm_br = this.signExtend(b_imm8, 8);
                pc += imm_br;
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xB: // bz
                const imm_bz = this.signExtend(b_imm8, 8);
                if (this.regs[rs2] === 0) {
                    pc += imm_bz;
                } else {
                    pc += 1;
                }
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xC: // bn
                const imm_bn = this.signExtend(b_imm8, 8);
                if (this.regs[rs2] & 0x8000) {
                    pc += imm_bn;
                } else {
                    pc += 1;
                }
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xD: // jal
                this.regs[15] = pc + 1;
                pc = (pc & 0xF000) | imm12;
                effect = `r15 = ${this.regs[15]}, pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xE: // jr
                pc = this.regs[rs1];
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xF: // quit
                running = false;
                effect = 'Program terminated';
                break;
                
            default:
                throw new Error(`Unknown opcode ${opcode.toString(16)} at ${pc.toString(16)}`);
        }
        
        return { pc, running, effect };
    }
    
    runToEnd() {
        if (!this.running || !this.compiled) return;
        
        let stepCount = 0;
        const maxSteps = 10000; // Prevent infinite loops
        
        while (this.running && stepCount < maxSteps) {
            this.singleStep();
            stepCount++;
        }
        
        if (stepCount >= maxSteps) {
            this.log('Program stopped: Maximum step count reached (possible infinite loop)', true);
            this.running = false;
            this.updateControls();
        }
    }
    
    reset() {
        this.regs = new Array(16).fill(0);
        this.pc = 0;
        this.running = this.compiled;
        console.log('reset called - compiled:', this.compiled, 'setting running to:', this.running);
        this.updateDisplay();
        this.highlightCurrentLine();
        this.updateControls();
        this.log('Processor reset');
    }
    
    initialize() {
        this.memory = {};
        this.text = {};
        this.data = {};
        this.labels = {};
        this.inverseLabels = {};
        this.dataBase = 0;
        this.lineNumbers = {};
        this.regs = new Array(16).fill(0);
        this.pc = 0;
        this.running = false;
        this.compiled = false;
        
        this.updateDisplay();
        this.updateControls();
        this.log('Simulator initialized');
        
        // Clear all displays
        document.getElementById('assembledProgram').innerHTML = '';
        document.getElementById('memoryDisplay').innerHTML = '';
        document.getElementById('dataLabelsDisplay').innerHTML = '';
    }
    
    updateDisplay() {
        this.updateRegisters();
        this.updatePC();
        this.updateStatus();
        this.updateMemoryDisplay();
        this.updateDataLabelsDisplay();
    }
    
    updateRegisters() {
        const regDisplay = document.getElementById('registersDisplay');
        let html = '';
        for (let reg = 0; reg < 16; reg += 2) {
            const signedVal1 = this.signExtend(this.regs[reg], 16);
            const reg1Text = `r${reg}=0x${this.regs[reg].toString(16).padStart(4, '0')}(${signedVal1})`;
            html += reg1Text.padEnd(20, ' ');
            
            if (reg + 1 < 16) {
                const signedVal2 = this.signExtend(this.regs[reg + 1], 16);
                const reg2Text = `r${reg + 1}=0x${this.regs[reg + 1].toString(16).padStart(4, '0')}(${signedVal2})`;
                html += reg2Text.padEnd(20, ' ');
            }
            html += '\n';
        }
        regDisplay.textContent = html;
    }
    
    updatePC() {
        document.getElementById('pcDisplay').textContent = `0x${this.pc.toString(16).padStart(4, '0')}`;
    }
    
    updateStatus() {
        let status = 'Not compiled';
        if (this.compiled) {
            status = this.running ? 'Running' : 'Stopped';
        }
        document.getElementById('statusDisplay').textContent = status;
    }
    
    updateControls() {
        const canExecute = this.compiled && this.running;
        console.log('updateControls - compiled:', this.compiled, 'running:', this.running, 'canExecute:', canExecute);
        document.getElementById('stepBtn').disabled = !canExecute;
        document.getElementById('runBtn').disabled = !canExecute;
        document.getElementById('resetBtn').disabled = !this.compiled;
    }
    
    updateAssembledProgram() {
        const display = document.getElementById('assembledProgram');
        let html = '// .text\n';
        
        for (const addr of Object.keys(this.text).map(Number).sort((a, b) => a - b)) {
            const label = this.inverseLabels[addr] || '';
            const line = `@${addr.toString(16).padStart(4, '0')}: ${this.memory[addr].toString(16).padStart(4, '0')}  // ${label}${this.text[addr]}\n`;
            html += line;
        }
        
        html += '// .data\n';
        for (const addr of Object.keys(this.data).map(Number).sort((a, b) => a - b)) {
            const actualAddr = addr + this.dataBase;
            const label = this.inverseLabels[actualAddr] || '';
            const line = `@${actualAddr.toString(16).padStart(4, '0')}: ${this.memory[actualAddr].toString(16).padStart(4, '0')}  // ${label}${this.data[addr]}\n`;
            html += line;
        }
        
        display.innerHTML = html;
    }
    
    updateMemoryDisplay() {
        const display = document.getElementById('memoryDisplay');
        let html = '';
        
        const sortedAddrs = Object.keys(this.memory).map(Number).sort((a, b) => a - b);
        for (const addr of sortedAddrs) {
            const value = this.memory[addr];
            const signedVal = this.signExtend(value, 16);
            html += `@${addr.toString(16).padStart(4, '0')}: 0x${value.toString(16).padStart(4, '0')} (${signedVal})\n`;
        }
        
        display.textContent = html;
    }
    
    updateDataLabelsDisplay() {
        const display = document.getElementById('dataLabelsDisplay');
        let html = '';
        
        for (const [label, addr] of Object.entries(this.labels)) {
            if (addr >= this.dataBase) {
                const value = this.memory[addr] || 0;
                const signedVal = this.signExtend(value, 16);
                html += `${label}: @${addr.toString(16).padStart(4, '0')} = 0x${value.toString(16).padStart(4, '0')} (${signedVal})\n`;
            }
        }
        
        display.textContent = html;
    }
    
    highlightCurrentLine() {
        const display = document.getElementById('assembledProgram');
        const lines = display.innerHTML.split('\n');
        
        // Remove previous highlighting
        for (let i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/<span class="highlighted-line">(.*?)<\/span>/, '$1');
        }
        
        if (this.running && this.compiled) {
            // Find the line corresponding to current PC
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/@([0-9a-f]{4}):/);
                if (match) {
                    const addr = parseInt(match[1], 16);
                    if (addr === this.pc) {
                        lines[i] = `<span class="highlighted-line">${lines[i]}</span>`;
                        break;
                    }
                }
            }
        }
        
        display.innerHTML = lines.join('\n');
    }
}

// Help functionality
function loadReadmeContent() {
    return `# Albacore Microprocessor Simulator

A web-based JavaScript implementation of the Albacore microprocessor simulator.

## Features

- **Professional Toolbar**: Organized controls with grouped buttons for file operations, compilation, and execution
- **Assembly Code Editor**: Enter assembly language source code with advanced editor features
- **Compilation**: Compile assembly code and display any errors
- **Step-by-step Execution**: Execute instructions one at a time
- **Memory Display**: View current memory contents
- **Register Display**: Monitor all 16 registers
- **Data Labels**: View data segment labels and values
- **File Operations**: Load and save assembly files, export memory dumps
- **Resizable Interface**: Drag column dividers and panel corners to customize layout

## How to Use

### Getting Started
1. Open the simulator in a web browser
2. Load an assembly file using the "Open" button or type directly in the source editor
3. Click the "Compile" button in the toolbar to assemble your code
4. Use "Step" for single-step execution or "Run" for full execution
5. Monitor registers, memory, and data labels in real-time

### Toolbar Controls
The main toolbar contains all essential controls organized by function:

#### File Operations
- **Open**: Load assembly source files (.asm, .s, .txt)
- **Save Source**: Export current source code to .asm file
- **Save Memory**: Export compiled memory contents to .mem file

#### Compilation & Execution
- **Compile**: Assemble the source code
- **Step**: Execute one instruction at a time
- **Run**: Execute program to completion
- **Reset**: Recompile and restart execution from beginning

#### Status & Help
- **PC Display**: Shows current program counter
- **Status Display**: Shows compilation/execution status
- **Help**: Access this documentation

### Interface Layout
The simulator features a three-column resizable layout:
- **Left**: Source code editor and console output
- **Middle**: Assembled program and register display
- **Right**: Data labels and memory contents

You can resize columns by dragging the vertical handles between them, and resize panels vertically by dragging their corners.

## Assembly Language Syntax

### Instruction Set
- **Arithmetic**: add, sub, and, or, not, shl, shr
- **Load/Store**: ldi, ld, st
- **Control Flow**: br, bz, bn, jal, jr
- **System**: quit

### Example Program
\`\`\`
.text
main:
    ldi r1, 10
    ldi r2, 5
    add r3, r1, r2
    quit

.data
result: .word 0
\`\`\`

## Keyboard Shortcuts

### Simulator Controls
- **F9**: Compile the assembly code
- **F10**: Single step execution
- **F5**: Run to end
- **Ctrl+R**: Reset (recompile and restart) execution

### File Operations
- **Ctrl+O**: Open assembly file
- **Ctrl+S**: Save current source code

### Editor Features
- **Tab**: Insert 4 spaces
- **Ctrl+/**: Toggle comment/uncomment for selected lines
- **Enter**: Auto-indent new line

## Troubleshooting

- **Compilation Errors**: Check the console panel for detailed error messages
- **Program Not Running**: Ensure you have compiled the code first
- **Unexpected Behavior**: Use single-step mode for debugging`;
}

function parseMarkdown(markdown) {
    return markdown
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^- (.*$)/gm, '<li>$1</li>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(?!<)/gm, '<p>')
        .replace(/$/gm, '</p>')
        .replace(/<p><\/p>/g, '')
        .replace(/<p>(<h)/g, '$1')
        .replace(/(<\/h[1-6]>)<\/p>/g, '$1')
        .replace(/<p>(<li>)/g, '<ul>$1')
        .replace(/(<\/li>)<\/p>/g, '$1</ul>');
}

function showHelp() {
    try {
        const helpContent = document.getElementById('helpContent');
        const helpModalElement = document.getElementById('helpModal');
        
        if (!helpContent || !helpModalElement) {
            console.error('Help modal elements not found');
            return;
        }
        
        const readmeContent = loadReadmeContent();
        const htmlContent = parseMarkdown(readmeContent);
        helpContent.innerHTML = htmlContent;
        
        const helpModal = new bootstrap.Modal(helpModalElement);
        helpModal.show();
        
    } catch (error) {
        console.error('Error showing help:', error);
    }
}

// Initialize the simulator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    console.log('Creating AlbacoreSimulator instance');
    new AlbacoreSimulator();
});
