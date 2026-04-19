// VRISC-V Microprocessor Simulator JavaScript Implementation

// console.log('VRISC-V Simulator script loaded');

class AssemblyError extends Error {
    constructor(message, addr = null) {
        super(message);
        this.name = 'AssemblyError';
        this.addr = addr;
    }
}

const INSTRUCTION_SET = {
    'add':    { format: 'R',      opcode: 0x0 },
    'sub':    { format: 'R',      opcode: 0x1 },
    'and':    { format: 'R',      opcode: 0x2 },
    'or':     { format: 'R',      opcode: 0x3 },
    'xor':    { format: 'R',      opcode: 0x4 },
    'sll':    { format: 'R',      opcode: 0x5 },
    'srl':    { format: 'R',      opcode: 0x6 },
    'li':     { format: 'LI',     opcode: 0x7 },
    'lw':     { format: 'LW',     opcode: 0x8 },
    'sw':     { format: 'SW',     opcode: 0x9 },
    'slt':    { format: 'R',      opcode: 0xa },
    'beqz':   { format: 'BEQZ',   opcode: 0xb },
    'jal':    { format: 'JAL',    opcode: 0xc },
    'jr':     { format: 'JR',     opcode: 0xd },
    'trap':   { format: 'TRAP',   opcode: 0xe },
};

const REGISTER_MAP = {
    // Standard register names x0-x15
    ...Object.fromEntries(Array.from({length: 16}, (_, i) => [`x${i}`, i])),
    // ABI names
    'zero': 0,
    'ra': 1,
    'sp': 2,
    ...Object.fromEntries(Array.from({length: 4}, (_, i) => [`t${i}`, i + 3])),  // t0-t3
    ...Object.fromEntries(Array.from({length: 4}, (_, i) => [`s${i}`, i + 7])),  // s0-s3
    ...Object.fromEntries(Array.from({length: 5}, (_, i) => [`a${i}`, i + 11])), // a0-a4
};

// ExecutionState enum
const ExecutionState = Object.freeze({
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    STOPPED: 'STOPPED'
});

// Trap Vector Table for handling trap instructions
class TrapVectorTable {
    constructor(simulator) {
        this.simulator = simulator;
        this.syscallOutput = [];
    }

    handleTrap(cause, registers, memory, currentPc) {
        switch (cause) {
            case 0:
                return this.handleHalt(registers, memory, currentPc);
            case 1:
                return this.handleBreakpoint(registers, memory, currentPc);
            case 2:
                return this.handleInvalidInstruction(registers, memory, currentPc);
            case 3:
                return this.handleSystemCall(registers, memory, currentPc);
            default:
                return this.handleUndefinedTrap(cause, registers, memory, currentPc);
        }
    }

    handleHalt(registers, memory, currentPc) {
        // Halt the processor - don't advance PC
        return { state: ExecutionState.STOPPED, message: 'Program halted (trap 0)', pc: currentPc };
    }

    handleBreakpoint(registers, memory, currentPc) {
        // Breakpoint - pause execution but advance PC so we resume at next instruction
        return { state: ExecutionState.PAUSED, message: 'Breakpoint hit (trap 1)', pc: currentPc + 1 };
    }

    handleInvalidInstruction(registers, memory, currentPc) {
        // Invalid instruction trap - keep PC at the faulting address.
        return { state: ExecutionState.STOPPED, message: `Illegal fetch at 0x${currentPc.toString(16).padStart(4, '0')} (trap 2)`, pc: currentPc };
    }

    handleSystemCall(registers, memory, currentPc) {
        // System call interface
        const syscallNum = registers[11]; // a0 register
        
        switch (syscallNum) {
            case 1: // print_int
                const intValue = registers[12]; // a1 register
                const intOutput = intValue.toString();
                this.syscallOutput.push(intOutput);
                return { state: ExecutionState.RUNNING, message: `System call: print_int(${intValue})`, pc: currentPc + 1 };
                
            case 2: // print_char
                const charValue = registers[12]; // a1 register
                const charOutput = String.fromCharCode(charValue);
                this.syscallOutput.push(charOutput);
                return { state: ExecutionState.RUNNING, message: `System call: print_char('${charOutput}')`, pc: currentPc + 1 };
                
            case 10: // exit
                const exitCode = registers[12]; // a1 register
                return { state: ExecutionState.STOPPED, message: `System call: exit(${exitCode})`, pc: currentPc };
                
            default:
                return { state: ExecutionState.RUNNING, message: `Unknown system call: ${syscallNum}`, pc: currentPc + 1 };
        }
    }

    handleUndefinedTrap(cause, registers, memory, currentPc) {
        // Undefined trap causes - act as NOP, advance PC
        return { state: ExecutionState.RUNNING, message: `Undefined trap ${cause} (NOP)`, pc: currentPc + 1 };
    }

    getSyscallOutput() {
        return this.syscallOutput.join('');
    }

    clearSyscallOutput() {
        this.syscallOutput = [];
    }
}

class VRISCVSimulator {
    constructor() {
        // console.log('VRISCVSimulator constructor called');
        this.memory = {};
        this.text = {};
        this.data = {};
        this.labels = {};
        this.inverseLabels = {};
        this.dataBase = 0;
        this.lineNumbers = {};
        this.regs = new Array(16).fill(0);
        this.pc = 0;
        this.execution_state = ExecutionState.STOPPED;
        this.trapVectorTable = new TrapVectorTable(this);
        this.compiled = false;
        this.hasCompilationError = false;
        
        this.initializeUI();
    }
    
    initializeUI() {
        // console.log('initializeUI called');
        // console.log('Compile button:', document.getElementById('compileBtn'));
        // console.log('Step button:', document.getElementById('stepBtn'));
        
        // Set up source code synchronization
        this.setupSourceCodeSync();
        
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
        document.getElementById('stopBtn').addEventListener('click', () => {
            console.log('Stop button clicked');
            this.stop();
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
        
        // Write Memory Listeners
        document.getElementById('writeMemoryBtn').addEventListener('click', () => {
            console.log('Write memory button clicked');
            this.executeWriteMemory();
        });

        // Handle Enter key in the address field
        document.getElementById('memoryAddress').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.executeWriteMemory();
            }
        });

        // Handle Enter key in the value field
        document.getElementById('memoryValue').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.executeWriteMemory();
            }
        });

        // Handle Enter key in the form
        document.getElementById('writeMemoryForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.executeWriteMemory();
        });

        // Add keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            // Check for modifier keys (Ctrl on Windows/Linux, Cmd on Mac)
            const isModifier = event.ctrlKey || event.metaKey;
            
            // Handle Ctrl+O and Ctrl+S globally to prevent browser defaults
            if (isModifier && event.key === 'o') {
                event.preventDefault();
                // Only trigger if we're in the source code display or not in any input
                if (event.target.id === 'sourceDisplay' || !event.target.matches('input, textarea')) {
                    this.openFile();
                    this.log('Open file triggered by Ctrl/Cmd+O');
                }
                return;
            } else if (isModifier && event.key === 's') {
                event.preventDefault();
                // Only trigger if we're in the source code display or not in any input
                if (event.target.id === 'sourceDisplay' || !event.target.matches('input, textarea')) {
                    this.saveFile();
                    this.log('Save file triggered by Ctrl/Cmd+S');
                }
                return;
            }
            
            // Only handle other shortcuts when not typing in the source code display
            if (event.target.id === 'sourceDisplay') return;
            
            if (event.key === 'F9' || (isModifier && event.key === 'F9')) {
                event.preventDefault();
                this.compile();
                this.log('Compile triggered by F9');
            } else if (event.key === 'F10') {
                event.preventDefault();
                if (this.compiled && this.execution_state === ExecutionState.RUNNING) {
                    this.singleStep();
                    this.log('Single step triggered by F10');
                }
            } else if (event.key === 'F5') {
                event.preventDefault();
                if (this.compiled && this.execution_state === ExecutionState.RUNNING) {
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
        document.getElementById('sourceDisplay').addEventListener('keydown', (event) => {
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
    
    setupSourceCodeSync() {
        const sourceDisplay = document.getElementById('sourceDisplay');
        const sourceTextarea = document.getElementById('sourceCode');
        
        // console.log('Setting up source code sync');
        // console.log('sourceDisplay:', sourceDisplay);
        // console.log('sourceTextarea:', sourceTextarea);
        
        // Keep textarea and display in sync
        sourceDisplay.addEventListener('input', () => {
            sourceTextarea.value = sourceDisplay.innerText;
            // console.log('Source display changed, updated textarea');
        });
        
        // Initialize with textarea content
        sourceDisplay.innerText = sourceTextarea.value;
        // console.log('Initialized source display with textarea content');
        
        // Also initialize the display with the escaped HTML version (no highlighting yet)
        this.updateSourceDisplay();
    }
    
    updateSourceDisplay() {
        const sourceDisplay = document.getElementById('sourceDisplay');
        const sourceCode = this.getSourceCode();
        sourceDisplay.innerHTML = this.escapeHtml(sourceCode);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    toggleComment() {
        const sourceDisplay = document.getElementById('sourceDisplay');
        const selection = window.getSelection();
        
        if (selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        const text = sourceDisplay.innerText;
        const lines = text.split('\n');
        
        // Get the actual start and end offsets of the selection
        const startOffset = this.getOffsetFromRange(sourceDisplay, range.startContainer, range.startOffset);
        const endOffset = this.getOffsetFromRange(sourceDisplay, range.endContainer, range.endOffset);
        
        // Find which lines are affected by the selection
        let currentPos = 0;
        let startLine = -1;
        let endLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const lineStart = currentPos;
            const lineEnd = currentPos + lines[i].length;
            
            // Check if this line intersects with the selection
            if (startLine === -1 && (startOffset >= lineStart && startOffset <= lineEnd)) {
                startLine = i;
            }
            if (endOffset >= lineStart && endOffset <= lineEnd) {
                endLine = i;
            }
            
            currentPos = lineEnd + 1; // +1 for the newline character
        }
        
        // If no lines found, default to current cursor line
        if (startLine === -1 || endLine === -1) {
            currentPos = 0;
            for (let i = 0; i < lines.length; i++) {
                const lineStart = currentPos;
                const lineEnd = currentPos + lines[i].length;
                
                if (startOffset >= lineStart && startOffset <= lineEnd) {
                    startLine = endLine = i;
                    break;
                }
                currentPos = lineEnd + 1;
            }
        }
        
        // Ensure we have valid line numbers
        if (startLine === -1) startLine = 0;
        if (endLine === -1) endLine = startLine;
        
        // Toggle comments for the selected lines
        let modified = false;
        for (let i = startLine; i <= endLine; i++) {
            if (i >= lines.length) break;
            
            const trimmedLine = lines[i].trim();
            if (trimmedLine.startsWith('# ') || trimmedLine.startsWith('// ')) {
                // Remove comment (support both # and // styles)
                lines[i] = lines[i].replace(/^(\s*)(# |\/\/ )/, '$1');
                modified = true;
            } else if (trimmedLine.length > 0) {
                // Add comment - use RISC-V standard # style
                const indentMatch = lines[i].match(/^(\s*)/);
                const indent = indentMatch ? indentMatch[1] : '';
                const restOfLine = lines[i].substring(indent.length);
                lines[i] = indent + '# ' + restOfLine;
                modified = true;
            }
        }
        
        if (modified) {
            // Update the display with the modified content
            const newContent = lines.join('\n');
            sourceDisplay.innerHTML = this.escapeHtml(newContent);
            
            // Update the hidden textarea
            document.getElementById('sourceCode').value = newContent;
            
            // Try to restore selection/cursor position
            this.restoreSelectionAfterEdit(sourceDisplay, startLine, endLine);
        }
    }
    
    insertTab() {
        // Insert 4 spaces at cursor position in contenteditable div
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textNode = document.createTextNode('    '); // 4 spaces
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Update the hidden textarea
            document.getElementById('sourceCode').value = document.getElementById('sourceDisplay').innerText;
        }
    }
    
    autoIndent() {
        // Insert newline with auto-indent in contenteditable div
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            
            // Get current line for indentation calculation
            const sourceDisplay = document.getElementById('sourceDisplay');
            const text = sourceDisplay.innerText;
            const cursorOffset = this.getCursorOffset(sourceDisplay);
            
            // Find the start of the current line
            const lineStart = text.lastIndexOf('\n', cursorOffset - 1) + 1;
            const currentLine = text.substring(lineStart, cursorOffset);
            
            // Calculate indentation
            const indentMatch = currentLine.match(/^(\s*)/);
            let currentIndent = indentMatch ? indentMatch[1] : '';
            
            // Determine if we need extra indentation
            let extraIndent = '';
            const trimmedLine = currentLine.trim();
            
            if (trimmedLine.endsWith(':')) {
                extraIndent = '    '; // 4 spaces for instruction after label
            } else if (trimmedLine === '.text' || trimmedLine === '.data') {
                extraIndent = '    '; // 4 spaces after directives
            }
            
            // Insert newline with appropriate indentation
            const newIndent = currentIndent + extraIndent;
            const textNode = document.createTextNode('\n' + newIndent);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Update the hidden textarea
            document.getElementById('sourceCode').value = document.getElementById('sourceDisplay').innerText;
        }
    }
    
    getOffsetInText(container, node, offset) {
        let textOffset = 0;
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let currentNode;
        while (currentNode = walker.nextNode()) {
            if (currentNode === node) {
                return textOffset + offset;
            }
            textOffset += currentNode.textContent.length;
        }
        
        return textOffset;
    }

    getOffsetFromRange(element, container, offset) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(container, offset);
        return range.toString().length;
    }

    restoreSelectionAfterEdit(sourceDisplay, startLine, endLine) {
        try {
            const text = sourceDisplay.innerText;
            const lines = text.split('\n');
            
            // Calculate the start position of the first edited line
            let startPos = 0;
            for (let i = 0; i < startLine && i < lines.length; i++) {
                startPos += lines[i].length + 1; // +1 for newline
            }
            
            // Calculate the end position of the last edited line
            let endPos = startPos;
            for (let i = startLine; i <= endLine && i < lines.length; i++) {
                if (i > startLine) endPos += 1; // Add newline
                endPos += lines[i].length;
            }
            
            // Create a tree walker to find text nodes
            const walker = document.createTreeWalker(
                sourceDisplay,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let currentOffset = 0;
            let startNode = null, startNodeOffset = 0;
            let endNode = null, endNodeOffset = 0;
            
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const nodeLength = node.textContent.length;
                
                // Find start position
                if (!startNode && currentOffset + nodeLength >= startPos) {
                    startNode = node;
                    startNodeOffset = startPos - currentOffset;
                }
                
                // Find end position
                if (!endNode && currentOffset + nodeLength >= endPos) {
                    endNode = node;
                    endNodeOffset = endPos - currentOffset;
                    break;
                }
                
                currentOffset += nodeLength;
            }
            
            // Set the selection
            if (startNode && endNode) {
                const selection = window.getSelection();
                const range = document.createRange();
                
                range.setStart(startNode, Math.min(startNodeOffset, startNode.textContent.length));
                range.setEnd(endNode, Math.min(endNodeOffset, endNode.textContent.length));
                
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (e) {
            // If positioning fails, just place cursor at start
            console.warn('Failed to restore selection:', e);
            const selection = window.getSelection();
            const range = document.createRange();
            range.setStart(sourceDisplay, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    getCursorOffset(element) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(element);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            return preCaretRange.toString().length;
        }
        return 0;
    }
    
    openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.asm,.s,.txt';
        
        input.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    document.getElementById('sourceCode').value = content;
                    document.getElementById('sourceDisplay').innerText = content;
                    this.updateSourceDisplay();
                    this.log(`Loaded file: ${file.name}`);
                };
                reader.readAsText(file);
            }
        });
        
        input.click();
    }
    
    saveFile() {
        const content = this.getSourceCode();
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'assembly_program.asm';
        a.click();
        
        URL.revokeObjectURL(url);
        this.log('File saved as "assembly_program.asm"');
    }
    
    saveMemoryFile() {
        if (!this.compiled) {
            this.log('Please compile first before saving memory file', true);
            return;
        }
        
        const content = this.generateMemoryFileContent();
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'memory_dump.mem';
        a.click();
        
        URL.revokeObjectURL(url);
        this.log(`Memory file saved (${Object.keys(this.text).length + Object.keys(this.data).length} addresses)`);
    }
    
    generateMemoryFileContent() {
        // Add header comment
        let content = '';
        content += '// Memory dump from VRISC-V Simulator\n';
        content += '// Format: @address value // comments\n';
        content += '// Generated: ' + new Date().toLocaleString() + '\n\n';
        
        // Text segment
        content += '// .text\n';
        const textAddresses = Object.keys(this.text).map(Number).sort((a, b) => a - b);
        for (const addr of textAddresses) {
            const value = this.memory[addr] !== undefined ? this.memory[addr] : 0;
            const label = this.inverseLabels[addr] || '';
            const sourceCode = this.text[addr];
            content += `@${addr.toString(16).padStart(4, '0').toUpperCase()} ${value.toString(16).padStart(4, '0').toUpperCase()}  // ${label}${sourceCode}\n`;
        }
        
        // Data segment
        if (Object.keys(this.data).length > 0) {
            content += '// .data\n';
            const dataAddresses = Object.keys(this.data).map(Number).sort((a, b) => a - b);
            for (const addr of dataAddresses) {
                // Use merged/final address directly
                const value = this.memory[addr] !== undefined ? this.memory[addr] : 0;
                const label = this.inverseLabels[addr] || '';
                const sourceCode = this.data[addr];
                content += `@${addr.toString(16).padStart(4, '0').toUpperCase()} ${value.toString(16).padStart(4, '0').toUpperCase()}  // ${label}${sourceCode}\n`;
            }
        }
        
        return content;
    }
    
    getSourceCode() {
        return document.getElementById('sourceCode').value;
    }
    
    writeMemory(labelOrAddr, value) {
        let addr;
        
        // Try to parse as address first
        try {
            addr = parseInt(labelOrAddr, 0); // Supports hex (0x), decimal, etc.
            if (isNaN(addr)) {
                throw new Error('Not a number');
            }
        } catch (e) {
            // If parsing fails, try to look up as label
            if (labelOrAddr in this.labels) {
                addr = this.labels[labelOrAddr];
            } else {
                return `Label ${labelOrAddr} not found`;
            }
        }
        
        // Parse value
        let parsedValue;
        try {
            parsedValue = parseInt(value, 0); // Supports hex (0x), decimal, etc.
            if (isNaN(parsedValue)) {
                throw new Error('Not a number');
            }
        } catch (e) {
            return `Invalid value format: ${value}`;
        }
        
        // Validate address range
        if (addr < 0 || addr > 0xFFFF) {
            return `Address ${addr.toString(16)} out of range`;
        }
        
        // Validate value range (16-bit)
        if (parsedValue < -32768 || parsedValue > 65535) {
            return `Value ${parsedValue.toString(16)} out of range for 16-bit memory`;
        }
        
        // Write to memory
        this.memory[addr] = parsedValue & 0xFFFF;
        
        // Update displays
        this.updateDisplay();
        
        return `mem[${addr.toString(16).padStart(4, '0')}] = 0x${this.memory[addr].toString(16)} (${this.signExtend(this.memory[addr], 16)})`;
    }

    executeWriteMemory() {
        const address = document.getElementById('memoryAddress').value.trim();
        const value = document.getElementById('memoryValue').value.trim();
        
        if (!this.compiled) {
            this.log('Please compile first before writing to memory', true);
            return;
        }
        
        if (!address || !value) {
            this.log('Please enter both address and value', true);
            return;
        }
        
        const result = this.writeMemory(address, value);
        this.log(result, result.includes('not found') || result.includes('out of range') || result.includes('Invalid'));
        
        // Clear the fields on success
        if (!result.includes('not found') && !result.includes('out of range') && !result.includes('Invalid')) {
            document.getElementById('memoryAddress').value = '';
            document.getElementById('memoryValue').value = '';
        }
    }

    log(message, isError = false) {
        const console = document.getElementById('console');
        const timestamp = new Date().toLocaleTimeString();
        const color = isError ? '#ff6666' : '#00ff00';
        console.innerHTML += `<span style="color: ${color}">[${timestamp}] ${message}</span><br>\n`;
        console.scrollTop = console.scrollHeight;
    }
    
    clearOutput() {
        document.getElementById('console').innerHTML = '';
        // Clear system call output when recompiling
        this.clearSyscallOutput();
        updateSyscallOutput();
    }
    
    parseAsm(lines) {
        // --- PYTHON LOGIC ALIGNMENT MIGRATION ---
        // This function is being incrementally aligned with the Python reference implementation (parse_asm)
        // for correct handling of .origin and interleaved segments.
        //
        // Step 4A: Refactor and document buffer merging logic for Python-style clarity.
        // - Variable names now match Python reference for easier comparison.
        // - Buffer merging logic is clearly commented for maintainability and review.
        // - Next steps: isolate merging into a helper, audit address/label/lineNumber assignment, and test edge cases.

        const text = {};
        const labels = {};
        const inverseLabels = {};
        const lineNumbers = {};
        let currentSegment = null;
        let address = 0;
        let dataAddress = 0;
        let hasTextDirective = false;
        // Buffers for pre- and post-origin data, labels, and line numbers
        // Buffers for pre- and post-origin data, labels, and line numbers (JS camelCase)
        const dataPreOriginData = {};
        const dataPreOriginLabels = {};
        const dataPreOriginLineNumbers = {};
        const dataPostOriginData = {};
        const dataPostOriginLabels = {};
        const dataPostOriginLineNumbers = {};
        let dataFirstOriginEncountered = false; // True after first .origin in .data
        let dataBaseCaptured = null;             // Locked on first .data directive
        let pendingDataLabel = undefined;
        for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
            let line = lines[lineNumber - 1];
            if (line.includes('#')) line = line.split('#')[0];
            if (line.includes('//')) line = line.split('//')[0];
            line = line.trim();
            if (!line) continue;

            if (line === '.text') {
                currentSegment = 'text';
                hasTextDirective = true;
                continue;
            } else if (line === '.data') {
                if (dataBaseCaptured === null) {
                    dataBaseCaptured = address; // Lock dataBase at point of first .data
                }
                currentSegment = 'data';
                continue;
            } else if (line.startsWith('.origin')) {
                // Align .origin handling with Python: allow in .text and .data, raise errors otherwise
                const originValue = line.replace('.origin', '').trim();
                const originAddr = parseInt(originValue, 0);
                if (isNaN(originAddr)) {
                    throw new AssemblyError(`Invalid .origin address: ${originValue}`, lineNumber);
                }
                if (originAddr < 0) {
                    throw new AssemblyError(`.origin address ${originAddr} must be non-negative`, lineNumber);
                }
                if (currentSegment === 'text') {
                    address = originAddr;
                    continue;
                } else if (currentSegment === 'data') {
                    if (!dataFirstOriginEncountered) {
                        // First .origin in data segment - switch to post-origin mode
                        dataFirstOriginEncountered = true;
                        dataAddress = originAddr;
                    } else {
                        // Subsequent .origin directives just set dataAddress
                        dataAddress = originAddr;
                    }
                    continue;
                } else {
                    throw new AssemblyError('.origin directive must be used within .text or .data segment', lineNumber);
                }
            }

            // Handle labels
            if (line.endsWith(':')) {
                const label = line.slice(0, -1).trim();
                if (currentSegment === 'text') {
                    labels[label] = address;
                    inverseLabels[address] = label + ': ';
                } else if (currentSegment === 'data') {
                    // Assign any pending label to current data address in correct buffer
                    if (typeof pendingDataLabel !== 'undefined') {
                        if (!dataFirstOriginEncountered) {
                            dataPreOriginLabels[pendingDataLabel] = dataAddress;
                        } else {
                            dataPostOriginLabels[pendingDataLabel] = dataAddress;
                        }
                    }
                    pendingDataLabel = label;
                }
                continue;
            }
            const labelWithContentMatch = line.match(/^\s*([A-Za-z_]\w*):\s*(.*)$/);
            if (labelWithContentMatch) {
                const label = labelWithContentMatch[1];
                const rest = labelWithContentMatch[2];
                if (currentSegment === 'text') {
                    labels[label] = address;
                    inverseLabels[address] = label + ': ';
                    line = rest.trim();
                } else if (currentSegment === 'data') {
                    // Assign any pending label to current data address in correct buffer
                    if (typeof pendingDataLabel !== 'undefined') {
                        if (!dataFirstOriginEncountered) {
                            dataPreOriginLabels[pendingDataLabel] = dataAddress;
                        } else {
                            dataPostOriginLabels[pendingDataLabel] = dataAddress;
                        }
                    }
                    pendingDataLabel = label;
                    line = rest.trim();
                }
            }

            if (currentSegment === 'text') {
                if (line) {
                    text[address] = line;
                    lineNumbers[address] = lineNumber;
                    address += 1;
                }
            } else if (currentSegment === 'data') {
                // Choose correct buffer (JS camelCase variable names)
                let dataRef, dataLabelsRef, dataLineNumbersRef;
                if (!dataFirstOriginEncountered) {
                    dataRef = dataPreOriginData;
                    dataLabelsRef = dataPreOriginLabels;
                    dataLineNumbersRef = dataPreOriginLineNumbers;
                } else {
                    dataRef = dataPostOriginData;
                    dataLabelsRef = dataPostOriginLabels;
                    dataLineNumbersRef = dataPostOriginLineNumbers;
                }
                // Assign any pending data label BEFORE processing the data line
                if (typeof pendingDataLabel !== 'undefined') {
                    dataLabelsRef[pendingDataLabel] = dataAddress;
                    pendingDataLabel = undefined;
                }
                if (line.startsWith('.word')) {
                    const values = line.replace('.word', '').trim().split(',');
                    for (const value of values) {
                        dataRef[dataAddress] = value.trim();
                        dataLineNumbersRef[dataAddress] = lineNumber;
                        dataAddress += 1;
                    }
                } else if (line.startsWith('.ascii')) {
                    let asciiStr = line.replace('.ascii', '').trim();
                    if ((asciiStr.startsWith('"') && asciiStr.endsWith('"')) ||
                        (asciiStr.startsWith("'") && asciiStr.endsWith("'"))) {
                        asciiStr = asciiStr.slice(1, -1);
                    } else {
                        throw new AssemblyError(`ASCII string must be quoted: ${asciiStr}`, dataAddress);
                    }
                    let processedStr = "";
                    for (let i = 0; i < asciiStr.length; i++) {
                        if (asciiStr[i] === '\\' && i + 1 < asciiStr.length) {
                            const nextChar = asciiStr[i + 1];
                            switch (nextChar) {
                                case 'n': processedStr += '\n'; break;
                                case 't': processedStr += '\t'; break;
                                case 'r': processedStr += '\r'; break;
                                case '\\': processedStr += '\\'; break;
                                case '"': processedStr += '"'; break;
                                case "'": processedStr += "'"; break;
                                case '0': processedStr += '\0'; break;
                                default: processedStr += nextChar; break;
                            }
                            i++;
                        } else {
                            processedStr += asciiStr[i];
                        }
                    }
                    for (const char of processedStr) {
                        dataRef[dataAddress] = char.charCodeAt(0).toString();
                        dataLineNumbersRef[dataAddress] = lineNumber;
                        dataAddress += 1;
                    }
                    line = '';
                } else if (line.startsWith('.string')) {
                    let stringStr = line.replace('.string', '').trim();
                    if ((stringStr.startsWith('"') && stringStr.endsWith('"')) ||
                        (stringStr.startsWith("'") && stringStr.endsWith("'"))) {
                        stringStr = stringStr.slice(1, -1);
                    } else {
                        throw new AssemblyError(`String must be quoted: ${stringStr}`, dataAddress);
                    }
                    let processedStr = "";
                    for (let i = 0; i < stringStr.length; i++) {
                        if (stringStr[i] === '\\' && i + 1 < stringStr.length) {
                            const nextChar = stringStr[i + 1];
                            switch (nextChar) {
                                case 'n': processedStr += '\n'; break;
                                case 't': processedStr += '\t'; break;
                                case 'r': processedStr += '\r'; break;
                                case '\\': processedStr += '\\'; break;
                                case '"': processedStr += '"'; break;
                                case "'": processedStr += "'"; break;
                                case '0': processedStr += '\0'; break;
                                default: processedStr += nextChar; break;
                            }
                            i++;
                        } else {
                            processedStr += stringStr[i];
                        }
                    }
                    for (const char of processedStr) {
                        dataRef[dataAddress] = char.charCodeAt(0).toString();
                        dataLineNumbersRef[dataAddress] = lineNumber;
                        dataAddress += 1;
                    }
                    // Add null terminator
                    dataRef[dataAddress] = '0';
                    dataLineNumbersRef[dataAddress] = lineNumber;
                    dataAddress += 1;
                    line = '';
                } else if (line.startsWith('.zero') || line.startsWith('.space')) {
                    let count = parseInt(line.replace(/\.(zero|space)/, '').trim(), 0);
                    if (isNaN(count) || count < 0) throw new AssemblyError(`Invalid .zero/.space count: ${line}`, dataAddress);
                    for (let i = 0; i < count; i++) {
                        dataRef[dataAddress] = '0';
                        dataLineNumbersRef[dataAddress] = lineNumber;
                        dataAddress += 1;
                    }
                    line = '';
                } else if (line) {
                    const values = line.split(',');
                    for (const value of values) {
                        dataRef[dataAddress] = value.trim();
                        dataLineNumbersRef[dataAddress] = lineNumber;
                        dataAddress += 1;
                    }
                }
            } else {
                if (!hasTextDirective) {
                    this.log('Warning: Instructions found without .text directive. Use .text directive to specify text segment.', false);
                    hasTextDirective = true;
                }
            }
        }
        // Assign any trailing pending data label (JS camelCase)
        if (typeof pendingDataLabel !== 'undefined' && currentSegment === 'data') {
            if (!dataFirstOriginEncountered) {
                dataPreOriginLabels[pendingDataLabel] = dataAddress;
            } else {
                dataPostOriginLabels[pendingDataLabel] = dataAddress;
            }
        }

        // --- Buffer merging logic (Python-style, JS camelCase) ---
        // Pre-origin data: placed at dataBase + offset
        // Post-origin data: placed at absolute address
        // Label and line number mappings follow the same rules
        const data = {};
        const dataBase = dataBaseCaptured !== null ? dataBaseCaptured : address;
        for (const [offset, value] of Object.entries(dataPreOriginData)) {
            data[dataBase + parseInt(offset)] = value;
        }
        for (const [label, offset] of Object.entries(dataPreOriginLabels)) {
            labels[label] = dataBase + parseInt(offset);
            inverseLabels[dataBase + parseInt(offset)] = label + ': ';
        }
        for (const [offset, lineNum] of Object.entries(dataPreOriginLineNumbers)) {
            lineNumbers[dataBase + parseInt(offset)] = lineNum;
        }
        for (const [offset, value] of Object.entries(dataPostOriginData)) {
            data[parseInt(offset)] = value;
        }
        for (const [label, offset] of Object.entries(dataPostOriginLabels)) {
            labels[label] = parseInt(offset);
            inverseLabels[parseInt(offset)] = label + ': ';
        }
        for (const [offset, lineNum] of Object.entries(dataPostOriginLineNumbers)) {
            lineNumbers[parseInt(offset)] = lineNum;
        }
        // Indicate if .origin was used
        const dataOriginUsed = Object.keys(dataPostOriginData).length > 0;
        const firstDataOrigin = dataOriginUsed ? Math.min(...Object.keys(dataPostOriginData).map(Number)) : undefined;
        return { text, data, labels, inverseLabels, dataBase, lineNumbers, dataOriginUsed, firstDataOrigin };
    }
    
    encodeInstruction(addr, instruction, labels, labelsWithHi = null) {
        try {
            // Remove comments (support # and //), trim, and skip empty
            const line = instruction.split('#')[0].split('//')[0].trim();
            if (!line) return 0;
            // DEBUG: Log instruction and split parts for troubleshooting
            // console.log('[DEBUG] encodeInstruction input:', instruction);
            // Split at the first whitespace only, so parts[1] is the full argument string
            const parts = line.match(/^(\S+)\s*(.*)$/) || [];
            // parts[0]: full match, parts[1]: mnemonic, parts[2]: rest (args)
            // For compatibility with rest of code, re-map to [mnemonic, args]
            const mnemonic = parts[1];
            const args = parts[2];
            // console.log('[DEBUG] parts after split:', [mnemonic, args]);
            if (!mnemonic) {
                throw new AssemblyError('Missing instruction mnemonic', addr);
            }
            // console.log('[DEBUG] parts after split:', parts);
            if (!(mnemonic in INSTRUCTION_SET)) {
                throw new AssemblyError(`Unknown instruction: ${mnemonic}`, addr);
            }
            const { format, opcode } = INSTRUCTION_SET[mnemonic];
            let code = 0;
            const reg = (token) => {
                if (!(token in REGISTER_MAP)) {
                    throw new AssemblyError(`Invalid register ${token}`, addr);
                }
                return REGISTER_MAP[token];
            };
            switch (format) {
                case 'R': {
                    // e.g. add x5, x2, x3
                    const m = args && args.match(/\s*(\w+),\s*(\w+),\s*(\w+)/);
                    if (!m) throw new AssemblyError(`${mnemonic} must have 3 register arguments`, addr);
                    const rd = reg(m[1]), rs1 = reg(m[2]), rs2 = reg(m[3]);
                    code = (opcode << 12) | (rd << 8) | (rs1 << 4) | rs2;
                    break;
                }
                case 'LI': {
                    // e.g. li x9, %lo(mydata) or li x2, 3
                    if (!args) throw new AssemblyError('li must have 2 arguments', addr);
                    // Match: register, then everything after comma as immediate (allow whitespace, comments already stripped)
                    const m = args.match(/\s*(\w+),\s*(.+)$/);
                    if (!m || !m[2].trim()) throw new AssemblyError('li must have 2 arguments', addr);
                    const rd = reg(m[1]);
                    const immStr = m[2].trim();
                    let imm;
                    const hiMatch = immStr.match(/^%hi\s*\(\s*(\w+)\s*\)$/);
                    const loMatch = immStr.match(/^%lo\s*\(\s*(\w+)\s*\)$/);
                    if (hiMatch) {
                        const label = hiMatch[1];
                        if (!(label in labels)) throw new AssemblyError(`Undefined label: ${label}`, addr);
                        imm = (labels[label] >> 8) & 0xFF;
                    } else if (loMatch) {
                        const label = loMatch[1];
                        if (!(label in labels)) throw new AssemblyError(`Undefined label: ${label}`, addr);
                        imm = labels[label] & 0xFF;
                        if (labels[label] > 0xFF && (!labelsWithHi || !labelsWithHi.has(label))) {
                            console.warn(`WARNING (addr 0x${addr.toString(16).padStart(4,'0')}): %lo(${label}) used alone but address 0x${labels[label].toString(16).padStart(4,'0')} has non-zero high byte -- use %hi/%lo + shift to build the full 16-bit address.`);
                        }
                    } else if (!isNaN(parseInt(immStr, 0))) {
                        imm = parseInt(immStr, 0);
                    } else {
                        throw new AssemblyError(`Invalid immediate expression: ${immStr}`, addr);
                    }
                    if (imm < -128 || imm > 255) {
                        throw new AssemblyError(`Immediate value 0x${imm.toString(16)} (${imm}) out of 8-bit unsigned range`, addr);
                    }
                    code = (opcode << 12) | (rd << 8) | (imm & 0xFF);
                    break;
                }
                case 'LW': {
                    // e.g. lw x10, 0(x9)
                    const m = args && args.match(/\s*(\w+),\s*([0-9]+)\s*\(\s*(\w+)\s*\)/);
                    if (!m) throw new AssemblyError('lw must be of the form lw rd, imm(rs1)', addr);
                    const rd = reg(m[1]);
                    const imm = parseInt(m[2], 0);
                    const rs1 = reg(m[3]);
                    if (imm < 0 || imm > 15) throw new AssemblyError(`Unsigned integer 0x${imm.toString(16)} (${imm}) outside 4-bit range`, addr);
                    code = (opcode << 12) | (rd << 8) | (rs1 << 4) | (imm & 0xF);
                    break;
                }
                case 'SW': {
                    // e.g. sw x2, 0(x9)
                    const m = args && args.match(/\s*(\w+),\s*([0-9]+)\s*\(\s*(\w+)\s*\)/);
                    if (!m) throw new AssemblyError('sw must be of the form sw rs2, imm(rs1)', addr);
                    const rs2 = reg(m[1]);
                    const imm = parseInt(m[2], 0);
                    const rs1 = reg(m[3]);
                    if (imm < 0 || imm > 15) throw new AssemblyError(`Unsigned integer 0x${imm.toString(16)} (${imm}) outside 4-bit range`, addr);
                    code = (opcode << 12) | ((imm & 0xF) << 8) | (rs1 << 4) | rs2;
                    break;
                }
                case 'BEQZ': {
                    const m = args && args.match(/\s*(\w+),\s*([\w_][\w\d_]*)/);
                    if (!m) throw new AssemblyError('beqz must be of the form beqz rs1, label', addr);
                    const rs1 = reg(m[1]);
                    const label = m[2];
                    if (!(label in labels)) throw new AssemblyError(`Undefined label: ${label}`, addr);
                    const offset = labels[label] - addr;
                    if (offset < -128 || offset > 127) throw new AssemblyError(`Integer 0x${offset.toString(16)} (${offset}) outside 8-bit signed range`, addr);
                    code = (opcode << 12) | ((offset & 0xF0) << 4) | (rs1 << 4) | (offset & 0x0F);
                    break;
                }
                case 'JAL': {
                    const m = args && args.match(/\s*([\w_][\w\d_]*)/);
                    if (!m) throw new AssemblyError('jal must be of the form jal label', addr);
                    const label = m[1];
                    if (!(label in labels)) throw new AssemblyError(`Undefined label: ${label}`, addr);
                    const target = labels[label] - addr;
                    if (target < -2048 || target > 2047) throw new AssemblyError(`Integer 0x${target.toString(16)} (${target}) outside 12-bit signed range`, addr);
                    code = (opcode << 12) | (target & 0xFFF);
                    break;
                }
                case 'JR': {
                    const m = args && args.match(/\s*(\w+)/);
                    if (!m) throw new AssemblyError('jr must be of the form jr rs1', addr);
                    const rs1 = reg(m[1]);
                    code = (opcode << 12) | 0 | (rs1 << 4) | 0;
                    break;
                }
                case 'TRAP': {
                    const m = args && args.match(/\s*([0-9]+)/);
                    if (!m) throw new AssemblyError('trap must be of the form trap imm', addr);
                    const cause = parseInt(m[1], 0);
                    if (isNaN(cause) || cause < 0 || cause > 0xFFF) throw new AssemblyError(`Invalid trap cause: ${m[1]}. Must be 0-4095.`, addr);
                    code = (opcode << 12) | (cause & 0xFFF);
                    break;
                }
                default:
                    code = 0;
            }
            return code;
        } catch (error) {
            if (error instanceof AssemblyError) throw error;
            throw new AssemblyError(error.toString(), addr);
        }
    }
    
    encodeDataValue(str, addr) {
        try {
            const value = parseInt(str, 0);
            if (isNaN(value)) {
                throw new AssemblyError(`Invalid integer format ${str}`, addr);
            }
            if (value < -32768 || value > 65535) {
                throw new AssemblyError(`Integer 0x${value.toString(16)} (${value}) outside 16-bit range`, addr);
            }
            return value;
        } catch (error) {
            if (error instanceof AssemblyError) {
                throw error;
            }
            throw new AssemblyError(`Invalid integer format ${str}`, addr);
        }
    }
    
    checkMemoryOverlaps(text, data, dataBase, dataOriginUsed = false, firstDataOrigin = undefined) {
        this.log(`Checking for memory overlaps... (${Object.keys(text).length} text, ${Object.keys(data).length} data)`, false);
        
        // In lowRISC, addresses are word-based, so each address represents one word
        // We only need to check for exact address conflicts, not byte-range overlaps
        
        // Get all text addresses
        const textAddresses = new Set(Object.keys(text).map(a => parseInt(a)));
        
        // Data keys are already final addresses after parseAsm merge.
        const dataAddresses = new Set();
        const dataAddressMap = {};  // final_addr -> content
        for (const addr of Object.keys(data).map(a => parseInt(a))) {
            const finalAddr = addr;
            dataAddresses.add(finalAddr);
            dataAddressMap[finalAddr] = data[addr];
        }
        
        let overlapsFound = false;
        
        // Check for text-data overlaps (exact address conflicts)
        const textDataOverlaps = [...textAddresses].filter(addr => dataAddresses.has(addr));
        if (textDataOverlaps.length > 0) {
            this.log(`WARNING: Text-Data segment overlaps detected!`, false);
            overlapsFound = true;
            for (const addr of textDataOverlaps.sort((a, b) => a - b)) {
                this.log(`  Address 0x${addr.toString(16).padStart(3, '0')}: text instruction conflicts with data`, false);
                this.log(`    Text: ${text[addr]}`, false);
                this.log(`    Data: ${dataAddressMap[addr]}`, false);
            }
            this.log(`WARNING: Data will overwrite text instructions at overlapping addresses!`, false);
        }
        
        // Check for multiple text instructions at same address
        const textAddrCount = {};
        for (const addr of textAddresses) {
            textAddrCount[addr] = (textAddrCount[addr] || 0) + 1;
        }
        
        const textDuplicates = Object.entries(textAddrCount).filter(([addr, count]) => count > 1);
        if (textDuplicates.length > 0) {
            this.log(`WARNING: Multiple text instructions at same address!`, false);
            overlapsFound = true;
            for (const [addr, count] of textDuplicates) {
                this.log(`  Address 0x${parseInt(addr).toString(16).padStart(3, '0')}: ${count} instructions at same address`, false);
                this.log(`    Instruction: ${text[addr]}`, false);
            }
        }
        
        // Check for multiple data values at same address
        const dataAddrCount = {};
        for (const addr of dataAddresses) {
            dataAddrCount[addr] = (dataAddrCount[addr] || 0) + 1;
        }
        
        const dataDuplicates = Object.entries(dataAddrCount).filter(([addr, count]) => count > 1);
        if (dataDuplicates.length > 0) {
            this.log(`WARNING: Multiple data values at same address!`, false);
            overlapsFound = true;
            for (const [addr, count] of dataDuplicates) {
                this.log(`  Address 0x${parseInt(addr).toString(16).padStart(3, '0')}: ${count} data values at same address`, false);
                this.log(`    Data: ${dataAddressMap[addr]}`, false);
            }
        }
        
        if (overlapsFound) {
            this.log(`Consider using different .origin addresses to avoid conflicts.`, false);
        }
    }
    
    clearDisplays() {
        document.getElementById('assembledProgram').innerHTML = '';
        document.getElementById('memoryDisplay').innerHTML = '';
        document.getElementById('dataLabelsDisplay').innerHTML = '';
        document.getElementById('registersDisplay').innerHTML = '';
    }
    
    compile() {
        try {
            this.clearOutput();
            this.clearDisplays();
            this.log('Starting compilation...');
            
            // Reset compilation error flag
            this.hasCompilationError = false;
            
            const sourceCode = this.getSourceCode();
            const lines = sourceCode.split('\n');
            
            const { text, data, labels, inverseLabels, dataBase, lineNumbers, dataOriginUsed, firstDataOrigin } = this.parseAsm(lines);
            
            this.text = text;
            this.data = data;
            this.labels = labels;
            this.inverseLabels = inverseLabels;
            this.dataBase = dataBase;
            this.lineNumbers = lineNumbers;
            
            this.memory = {};
            const labelsWithHi = new Set();
            for (const instruction of Object.values(text)) {
                for (const match of instruction.matchAll(/%hi\s*\(\s*(\w+)\s*\)/g)) {
                    labelsWithHi.add(match[1]);
                }
            }
            
            // Assemble text segment
            for (const addr of Object.keys(text).map(a => parseInt(a)).sort((a, b) => a - b)) {
                try {
                    const code = this.encodeInstruction(addr, text[addr], labels, labelsWithHi);
                    this.memory[addr] = code;
                } catch (error) {
                    if (error instanceof AssemblyError) {
                        this.log(`Assembly error line ${lineNumbers[error.addr]}: ${error.message}`, true);
                        this.hasCompilationError = true;
                        this.compiled = false;
                        this.execution_state = ExecutionState.STOPPED;
                        this.updateStatus();
                        this.updateControls();
                        return;
                    }
                    throw error;
                }
            }
            
            // Check for memory overlaps and warn
            this.checkMemoryOverlaps(text, data, dataBase, dataOriginUsed, firstDataOrigin);
            
            // DEBUG: Starting data segment initialization
            // this.log('DEBUG: Starting data segment initialization', false);
            const dataKeys = Object.keys(data).map(a => parseInt(a)).sort((a, b) => a - b);
            // this.log('DEBUG: Data addresses to initialize: ' + dataKeys.map(a => '0x' + a.toString(16).padStart(4, '0')).join(', '), false);
            // Assemble data segment
            for (const addr of dataKeys) {
                // addr is already the merged/final address
                try {
                    const value = this.encodeDataValue(data[addr], addr);
                    this.memory[addr] = value;
                } catch (error) {
                    if (error instanceof AssemblyError) {
                        this.log(`Assembly error line ${lineNumbers[error.addr]}: ${error.message}`, true);
                        this.hasCompilationError = true;
                        this.compiled = false;
                        this.execution_state = ExecutionState.STOPPED;
                        this.updateStatus();
                        this.updateControls();
                        return;
                    }
                    throw error;
                }
            }

            // DEBUG: Log all memory addresses and values after initialization
            // this.log('DEBUG: Memory contents after initialization:', false);
            // Object.keys(this.memory).sort((a, b) => a - b).forEach(addr => {
            //     this.log(`  [0x${parseInt(addr).toString(16).padStart(4, '0')}] = 0x${this.memory[addr].toString(16).padStart(4, '0')}`, false);
            // });
            
            // Reset processor state
            this.regs.fill(0);
            this.pc = 0;
            this.execution_state = ExecutionState.RUNNING;
            this.compiled = true;
            this.hasCompilationError = false;
            
            this.log('Compilation successful');
            this.updateDisplay();
            this.highlightCurrentLine();
            this.updateStatus();
            this.updateControls();
            
        } catch (error) {
            this.log(`Compilation error: ${error.message}`, true);
            this.hasCompilationError = true;
            this.compiled = false;
            this.execution_state = ExecutionState.STOPPED;
            this.updateStatus();
            this.updateControls();
        }
    }
    
    singleStep() {
        if ((this.execution_state !== ExecutionState.RUNNING && this.execution_state !== ExecutionState.PAUSED) || !this.compiled) return;
        
        // If paused (e.g., from breakpoint), resume execution
        if (this.execution_state === ExecutionState.PAUSED) {
            this.execution_state = ExecutionState.RUNNING;
            this.log('Resuming execution from breakpoint...');
        }
        
        try {
            const instrAddr = this.pc;
            // Strict fetch legality: only .text addresses are executable.
            if (!(instrAddr in this.text)) {
                const trapResult = this.trapVectorTable.handleTrap(2, this.regs, this.memory, instrAddr);
                this.pc = trapResult.pc;
                this.execution_state = trapResult.state;
                this.log(trapResult.message, true);
                this.updateDisplay();
                this.highlightCurrentLine();
                this.updateControls();
                return;
            }
            
            const instruction = this.text[instrAddr] || '';
            this.log(`Executing: ${instrAddr.toString(16).padStart(4, '0')}  ${this.memory[instrAddr].toString(16).padStart(4, '0')}  ${instruction}`);
            
            const result = this.executeInstruction();
            this.pc = result.pc;
            this.execution_state = result.execution_state;
            
            this.log(`Effect: ${result.effect}`);
            this.updateDisplay();
            this.highlightCurrentLine();
            
            if (this.execution_state === ExecutionState.STOPPED) {
                this.log('Program completed');
                this.updateControls();
            } else if (this.execution_state === ExecutionState.PAUSED) {
                this.log('Breakpoint hit - execution paused');
                this.updateControls();
            }
            
        } catch (error) {
            this.log(`Execution error: ${error.message}`, true);
            this.execution_state = ExecutionState.STOPPED;
            this.updateControls();
        }
    }
    
    executeInstruction() {
        const instr = this.memory[this.pc];
        const opcode = (instr >> 12) & 0xF;
        const rd = (instr >> 8) & 0xF;
        const rs1 = (instr >> 4) & 0xF;
        const rs2 = instr & 0xF;
        const li_imm8 = instr & 0xFF;
        const lw_imm4 = instr & 0xF;
        const sw_imm4 = (instr >> 8) & 0xF;
        const b_imm8 = ((instr >> 4) & 0xF0) | (instr & 0xF);
        const imm12 = this.signExtend(instr & 0xFFF, 12);  // Sign-extend 12-bit immediate for jal
        
        let pc = this.pc;
        let execution_state = ExecutionState.RUNNING;
        let effect = '';
        
        switch (opcode) {
            case 0x0: // add
                if (rd !== 0) {
                    this.regs[rd] = (this.regs[rs1] + this.regs[rs2]) & 0xFFFF;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x1: // sub
                if (rd !== 0) {
                    this.regs[rd] = (this.regs[rs1] - this.regs[rs2]) & 0xFFFF;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x2: // and
                if (rd !== 0) {
                    this.regs[rd] = this.regs[rs1] & this.regs[rs2];
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x3: // or
                if (rd !== 0) {
                    this.regs[rd] = this.regs[rs1] | this.regs[rs2];
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x4: // xor
                if (rd !== 0) {
                    this.regs[rd] = this.regs[rs1] ^ this.regs[rs2];
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x5: // sll (shift left logical)
                if (rd !== 0) {
                    this.regs[rd] = (this.regs[rs1] << this.regs[rs2]) & 0xFFFF;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x6: // srl (shift right logical)
                if (rd !== 0) {
                    this.regs[rd] = (this.regs[rs1] >>> this.regs[rs2]) & 0xFFFF;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x7: // li (load immediate)
                if (rd !== 0) {
                    this.regs[rd] = li_imm8 & 0xFFFF;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x8: // lw (load word)
                const addr_mem = (this.regs[rs1] + lw_imm4) & 0xFFFF;
                if (rd !== 0) {
                    this.regs[rd] = this.memory[addr_mem] || 0;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0x9: // sw (store word)
                const addr_mem_sw = (this.regs[rs1] + sw_imm4) & 0xFFFF;
                this.memory[addr_mem_sw] = this.regs[rs2];
                pc += 1;
                effect = `mem[${addr_mem_sw.toString(16).padStart(4, '0')}] = 0x${this.memory[addr_mem_sw].toString(16)} (${this.signExtend(this.memory[addr_mem_sw], 16)})`;
                break;
                
            case 0xA: // slt (set less than)
                if (rd !== 0) {
                    this.regs[rd] = (this.regs[rs1] < this.regs[rs2]) ? 1 : 0;
                }
                pc += 1;
                effect = `x${rd} = 0x${this.regs[rd].toString(16)} (${this.signExtend(this.regs[rd], 16)})`;
                break;
                
            case 0xB: // beqz (branch if equal to zero)
                const imm_beqz = this.signExtend(b_imm8, 8);
                if (this.regs[rs1] === 0) {
                    pc += imm_beqz;
                } else {
                    pc += 1;
                }
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xC: // jal (jump and link)
                this.regs[1] = pc + 1; // ra register
                pc = (pc + imm12) & 0xFFFF;  // jump to target (signed offset), wrap to 16-bit address space
                effect = `x1 = ${this.regs[1]}, pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xD: // jr (jump register)
                pc = this.regs[rs1];
                effect = `pc = ${pc.toString(16).padStart(4, '0')}`;
                break;
                
            case 0xE: // trap
                // Extract the trap cause from bits 11:0
                const trapCause = instr & 0xFFF;
                const trapResult = this.trapVectorTable.handleTrap(trapCause, this.regs, this.memory, pc);
                execution_state = trapResult.state;
                effect = trapResult.message;
                pc = trapResult.pc;
                break;
                
            default:
                throw new Error(`Unknown opcode ${opcode.toString(16)} at ${this.pc.toString(16)}`);
        }
        
        // Ensure x0 stays zero
        this.regs[0] = 0;
        
        return { pc, execution_state, effect };
    }
    
    runToEnd() {
        if ((this.execution_state !== ExecutionState.RUNNING && this.execution_state !== ExecutionState.PAUSED) || !this.compiled) return;
        
        // If paused (e.g., from breakpoint), resume execution
        if (this.execution_state === ExecutionState.PAUSED) {
            this.execution_state = ExecutionState.RUNNING;
            this.log('Resuming execution from breakpoint...');
        }
        
        let stepCount = 0;
        const maxSteps = 10000; // Prevent infinite loops
        
        while (this.execution_state === ExecutionState.RUNNING && stepCount < maxSteps) {
            this.singleStep();
            stepCount++;
        }
        
        if (stepCount >= maxSteps) {
            this.log('Program stopped: Maximum step count reached (possible infinite loop)', true);
            this.execution_state = ExecutionState.STOPPED;
            this.updateControls();
        }
    }
    
    stop() {
        if (this.compiled && this.execution_state === ExecutionState.RUNNING) {
            this.execution_state = ExecutionState.STOPPED;
            this.log('Execution stopped by user');
            this.clearHighlighting();
            this.updateDisplay();
            this.updateControls();
        }
    }
    
    signExtend(value, bits) {
        const signBit = 1 << (bits - 1);
        return (value & signBit) ? value | (~((1 << bits) - 1)) : value;
    }
    
    updateDisplay() {
        this.updateAssembledProgram();
        this.updateRegisterDisplay();
        this.updateMemoryDisplay();
        this.updateDataLabelsDisplay();
        this.updatePCDisplay();
        this.updateStatus();
        updateSyscallOutput(); // Update system call output
    }
    
    updateAssembledProgram() {
        const display = document.getElementById('assembledProgram');
        let html = '// .text\n';
        
        for (const addr of Object.keys(this.text).map(Number).sort((a, b) => a - b)) {
            const label = this.inverseLabels[addr] || '';
            const value = this.memory[addr] !== undefined ? this.memory[addr] : 0;
            const line = `@${addr.toString(16).padStart(4, '0')} ${value.toString(16).padStart(4, '0')}  // ${label}${this.text[addr]}\n`;
            html += line;
        }

        html += '// .data\n';
        for (const addr of Object.keys(this.data).map(Number).sort((a, b) => a - b)) {
            // Use merged/final address directly
            const label = this.inverseLabels[addr] || '';
            const value = this.memory[addr] !== undefined ? this.memory[addr] : 0;
            const line = `@${addr.toString(16).padStart(4, '0')} ${value.toString(16).padStart(4, '0')}  // ${label}${this.data[addr]}\n`;
            html += line;
        }
        
        display.textContent = html;
    }
    
    updateDataLabelsDisplay() {
        const display = document.getElementById('dataLabelsDisplay');
        let html = '';
        
        for (const [label, addr] of Object.entries(this.labels)) {
            const value = this.memory[addr] || 0;
            const signedVal = this.signExtend(value, 16);
            html += `${label}: @${addr.toString(16).padStart(4, '0')} = 0x${value.toString(16).padStart(4, '0')} (${signedVal})\n`;
        }
        
        display.textContent = html;
    }
    
    updateRegisterDisplay() {
        const regDisplay = document.getElementById('registersDisplay');
        let html = '';
        
        for (let i = 0; i < 16; i++) {
            const value = this.regs[i];
            const signedValue = this.signExtend(value, 16);
            
            // Get ABI name for register
            let abiName = '';
            switch(i) {
                case 0: abiName = ' (zero)'; break;
                case 1: abiName = ' (ra)'; break;
                case 2: abiName = ' (sp)'; break;
                case 3: case 4: case 5: case 6: abiName = ` (t${i-3})`; break;
                case 7: case 8: case 9: case 10: abiName = ` (s${i-7})`; break;
                case 11: case 12: case 13: case 14: case 15: abiName = ` (a${i-11})`; break;
            }
            
            html += `<div class="register-row">`;
            html += `<span class="register-name">x${i}${abiName}:</span>`;
            html += `<span class="register-value">0x${value.toString(16).padStart(4, '0')} (${signedValue})</span>`;
            html += `</div>`;
        }
        
        regDisplay.innerHTML = html;
    }
    
    updateMemoryDisplay() {
        const display = document.getElementById('memoryDisplay');
        let html = '';
        
        const sortedAddrs = Object.keys(this.memory).map(Number).sort((a, b) => a - b);
        for (const addr of sortedAddrs) {
            const value = this.memory[addr];
            const signedVal = this.signExtend(value, 16);
            html += `@${addr.toString(16).padStart(4, '0')} 0x${value.toString(16).padStart(4, '0')} (${signedVal})\n`;
        }
        
        display.textContent = html;
    }
    
    updatePCDisplay() {
        const pcDisplay = document.getElementById('pcDisplay');
        pcDisplay.textContent = `0x${this.pc.toString(16).padStart(4, '0')} (${this.pc})`;
    }
    
    updateStatus() {
        let status = 'Not compiled';
        let icon = '⚪';
        let colorClass = 'bg-info';
        
        if (this.compiled) {
            switch(this.execution_state) {
                case ExecutionState.RUNNING:
                    status = 'Ready to Execute';
                    icon = '�';
                    colorClass = 'bg-success';
                    break;
                case ExecutionState.PAUSED:
                    status = 'Paused (Breakpoint)';
                    icon = '🟠';
                    colorClass = 'bg-warning';
                    break;
                case ExecutionState.STOPPED:
                    status = 'Stopped';
                    icon = '🔴';
                    colorClass = 'bg-danger';
                    break;
                default:
                    status = 'Unknown state';
                    icon = '🔴';
                    colorClass = 'bg-danger';
            }
        } else {
            // Check if there were compilation errors
            if (this.hasCompilationError) {
                icon = '🔴';
                colorClass = 'bg-danger';
                status = 'Compilation Error';
            }
        }
        
        const statusDisplay = document.getElementById('statusDisplay');
        const statusIcon = document.getElementById('statusIcon');
        
        statusDisplay.innerHTML = `<span id="statusIcon">${icon}</span> ${status}`;
        statusDisplay.className = `badge ${colorClass}`;
    }
    
    updateControls() {
        const stepBtn = document.getElementById('stepBtn');
        const runBtn = document.getElementById('runBtn');
        const stopBtn = document.getElementById('stopBtn');
        const resetBtn = document.getElementById('resetBtn');
        
        const canExecute = this.compiled && (this.execution_state === ExecutionState.RUNNING || this.execution_state === ExecutionState.PAUSED);
        const isRunning = this.compiled && this.execution_state === ExecutionState.RUNNING;
        
        stepBtn.disabled = !canExecute;
        runBtn.disabled = !canExecute;
        stopBtn.disabled = !isRunning; // Only disable stop when not actively running
        resetBtn.disabled = !this.compiled;
        
        this.updateStatus();
    }
    
    highlightCurrentLine() {
        // console.log('highlightCurrentLine called');
        const display = document.getElementById('assembledProgram');
        const lines = display.innerHTML.split('\n');
        
        // Remove previous highlighting from assembled program
        for (let i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/<span class="highlighted-line">(.*?)<\/span>/, '$1');
        }
        
        let highlightedLineIndex = -1;
        
        // Highlight current line in assembled program
        if ((this.execution_state === ExecutionState.RUNNING || this.execution_state === ExecutionState.PAUSED) && this.compiled) {
            // Find the line corresponding to current PC in assembled program
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/@([0-9a-f]{4}) /);
                if (match) {
                    const addr = parseInt(match[1], 16);
                    if (addr === this.pc) {
                        lines[i] = `<span class="highlighted-line">${lines[i]}</span>`;
                        highlightedLineIndex = i;
                        break;
                    }
                }
            }
        }
        
        display.innerHTML = lines.join('\n');
        
        // Auto-scroll to keep highlighted line visible
        if (highlightedLineIndex >= 0) {
            const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 20;
            const scrollTop = highlightedLineIndex * lineHeight - display.clientHeight / 2;
            const newScrollTop = Math.max(0, Math.min(scrollTop, display.scrollHeight - display.clientHeight));
            
            display.scrollTop = newScrollTop;
        }
        
        // Also highlight corresponding line in source code
        this.highlightSourceLine();
    }
    
    highlightSourceLine() {
        // console.log('highlightSourceLine called');
        // console.log('  - this.execution_state:', this.execution_state);
        // console.log('  - this.compiled:', this.compiled); 
        // console.log('  - this.pc:', this.pc);
        // console.log('  - this.pc in this.lineNumbers:', this.pc in this.lineNumbers);
        // console.log('  - this.lineNumbers:', this.lineNumbers);
        
        const sourceDisplay = document.getElementById('sourceDisplay');
        
        if ((this.execution_state === ExecutionState.RUNNING || this.execution_state === ExecutionState.PAUSED) && this.compiled && this.pc in this.lineNumbers) {
            const currentSourceLine = this.lineNumbers[this.pc];
            const sourceCode = this.getSourceCode();
            const lines = sourceCode.split('\n');
            
            // console.log('Highlighting line:', currentSourceLine, 'out of', lines.length, 'lines');
            
            if (currentSourceLine > 0 && currentSourceLine <= lines.length) {
                // Create highlighted version of the source code
                let highlightedContent = '';
                
                for (let i = 0; i < lines.length; i++) {
                    const lineNumber = i + 1;
                    const line = lines[i];
                    
                    if (lineNumber === currentSourceLine) {
                        highlightedContent += `<span class="highlighted-line">${this.escapeHtml(line)}</span>\n`;
                        // console.log('Added highlighting to line:', lineNumber, 'content:', line);
                    } else {
                        highlightedContent += this.escapeHtml(line) + '\n';
                    }
                }
                
                sourceDisplay.innerHTML = highlightedContent;
                
                // Optionally scroll to make the highlighted line visible
                const lineHeight = parseFloat(getComputedStyle(sourceDisplay).lineHeight) || 20;
                const scrollTop = (currentSourceLine - 1) * lineHeight - sourceDisplay.clientHeight / 2;
                const newScrollTop = Math.max(0, Math.min(scrollTop, sourceDisplay.scrollHeight - sourceDisplay.clientHeight));
                
                sourceDisplay.scrollTop = newScrollTop;
            } else {
                // console.log('Line number out of range:', currentSourceLine, 'total lines:', lines.length);
            }
        }
    }
    
    clearHighlighting() {
        // Clear highlighting in assembled program
        const assembledDisplay = document.getElementById('assembledProgram');
        const assembledLines = assembledDisplay.innerHTML.split('\n');
        
        for (let i = 0; i < assembledLines.length; i++) {
            assembledLines[i] = assembledLines[i].replace(/<span class="highlighted-line">(.*?)<\/span>/, '$1');
        }
        
        assembledDisplay.innerHTML = assembledLines.join('\n');
    }
    
    // System call output methods
    getSyscallOutput() {
        return this.trapVectorTable.getSyscallOutput();
    }
    
    clearSyscallOutput() {
        this.trapVectorTable.clearSyscallOutput();
    }
}

// Global functions for backward compatibility
function loadReadmeContent() {
    return `# VRISC-V Microprocessor Simulator

This simulator implements the VRISC-V RISC-V subset instruction set architecture.

## Instruction Set

### R-Type Instructions (Register-Register Operations)
- **add rd, rs1, rs2** - Add: rd = rs1 + rs2
- **sub rd, rs1, rs2** - Subtract: rd = rs1 - rs2
- **and rd, rs1, rs2** - Bitwise AND: rd = rs1 & rs2
- **or  rd, rs1, rs2**  - Bitwise OR: rd = rs1 | rs2
- **xor rd, rs1, rs2** - Bitwise XOR: rd = rs1 ^ rs2
- **sll rd, rs1, rs2** - Shift Left Logical: rd = rs1 << rs2
- **srl rd, rs1, rs2** - Shift Right Logical: rd = rs1 >> rs2
- **slt rd, rs1, rs2** - Set Less Than: rd = (rs1 < rs2) ? 1 : 0

### I-Type Instructions (Immediate Operations)
- **li rd, imm** - Load Immediate: rd = imm (8-bit)
- **lw rd, imm(rs1)** - Load Word: rd = mem[rs1 + imm] (4-bit offset)

### S-Type Instructions (Store Operations)
- **sw rs2, imm(rs1)** - Store Word: mem[rs1 + imm] = rs2 (4-bit offset)

### B-Type Instructions (Branch Operations)
- **beqz rs1, label** - Branch if Equal Zero: if (rs1 == 0) pc += offset

### J-Type Instructions (Jump Operations)
- **jal label** - Jump and Link: ra = pc + 1, pc += offset
- **jr rs1** - Jump Register: pc = rs1

### System Instructions
- **trap cause** - General trap instruction with specified cause (0-15)

### Trap Causes
- **0** - Halt execution
- **1** - Breakpoint (pause for debugging)  
- **2** - Invalid instruction
- **3** - System call
- **4-15** - Undefined (act as NOP)

### System Calls (trap 3)
System calls use registers a0 (x11) for the call number and a1 (x12) for the argument:
- **1** - print_int: Print integer value from a1
- **2** - print_char: Print character value from a1
- **10** - exit: Exit with code from a1

## Register File

The VRISC-V processor implements a 16-register file (x0-x15) with the following conventions:

- **x0 (zero)** - Always zero (reads 0, writes ignored)
- **x1 (ra)** - Return address
- **x2 (sp)** - Stack pointer
- **x3-x6 (t0-t3)** - Temporary registers
- **x7-x10 (s0-s3)** - Saved registers
- **x11-x15 (a0-a4)** - Argument registers

## Assembly Directives

- **.text** - Start of code section
- **.data** - Start of data section
- **.origin address** - Set the current assembly address (e.g., .origin 0x100)
- **.word value1, value2, ...** - Define 16-bit words in data section
- **.zero count** - Reserve count words initialized to zero
- **.space count** - Reserve count words of uninitialized space
- **.ascii "string"** - Store ASCII string (one character per word)
- **.string "string"** - Store ASCII string with null terminator
- **label:** - Define a label for jumps and branches
- **%hi(label), %lo(label)** - Extract high and low bits of label address, similar to RISC-V
- **# comment** or **// comment** - Comments (ignored by assembler)

## Memory Writing & Debugging

### Manual Memory Writing
The simulator provides an interactive memory writing feature for debugging and testing purposes:

- **Memory Write Interface**: Located in the Memory Contents card header
- **Address Field**: Enter a memory address (hex: 0x100, decimal: 256) or label name
- **Value Field**: Enter a 16-bit value (hex: 0x42, decimal: 66, range: -32768 to 65535)
- **Write Button**: Click to write the value to the specified address

### Address Formats Supported
- **Hexadecimal**: 0x100, 0xFF, 0x1234
- **Decimal**: 256, 255, 4660
- **Labels**: Use any defined label name from your assembly code

### Value Formats Supported
- **Hexadecimal**: 0x42, 0xFF, 0x1234
- **Decimal**: 66, 255, 4660
- **Range**: -32768 to 65535 (16-bit signed/unsigned)

### Memory Writing Examples
\`\`\`
Address: 0x100    Value: 0x42     # Write hex 42 to address 0x100
Address: data     Value: 255      # Write 255 to label 'data'
Address: 256      Value: -1       # Write -1 (0xFFFF) to address 256
\`\`\`

## Memory Layout & Overlap Detection

The assembler includes robust overlap detection to help students understand memory organization:

### Overlap Detection Features
- **Same-section overlaps**: Warns when instructions or data overwrite each other within the same section
- **Cross-section overlaps**: Warns when data overwrites instructions or vice versa
- **Real-time detection**: Warnings appear immediately during assembly parsing
- **Educational feedback**: Clear messages show what is being overwritten and where

### Types of Overlaps Detected
- **Instruction-Instruction**: Multiple instructions at the same address
- **Data-Data**: Multiple data values at the same address  
- **Instruction-Data**: Data section overlapping with instruction addresses
- **Data-Instruction**: Instructions overlapping with data addresses

### Example Overlap Scenarios
\`\`\`assembly
# This will generate overlap warnings:
.text
add x1, x2, x3      # At address 0x0
.origin 0x0
sub x1, x2, x3      # WARNING: Overwrites instruction at 0x0

.data
.origin 0x0
data1: .word 42     # WARNING: Overwrites instruction at 0x0
\`\`\`

### Best Practices
- Always start programs at address 0 to avoid "Program counter not in memory" errors
- Use appropriate spacing between sections (e.g., data at 0x100+ for instruction space)
- Pay attention to overlap warnings - they indicate potential memory layout issues
- Use **.origin** directive carefully to explicitly control memory placement

## Keyboard Shortcuts

- **F9** - Compile the assembly code
- **F10** - Single step execution
- **F5** - Run to end/breakpoint
- **Ctrl/Cmd+R** - Reset (recompile)
- **Ctrl/Cmd+O** - Open file
- **Ctrl/Cmd+S** - Save file
- **Ctrl/Cmd+/** - Toggle comment (uses # style, removes both # and //)

## User Interface

### Status Indicators
The simulator provides visual feedback through color-coded status indicators in the toolbar:

- **⚪ Not compiled** (Blue) - Assembly code has not been compiled yet
- **🟢 Ready to Execute** (Green) - Code compiled successfully, ready to run
- **🟠 Paused (Breakpoint)** (Orange) - Execution paused at a breakpoint
- **🔴 Compilation Error** (Red) - Errors found during compilation
- **🔴 Stopped** (Red) - Execution has stopped (completed or error)

### Layout
- **Left Column**: Assembly source code editor, console output, and system call output
- **Middle Column**: Assembled program display and memory contents
- **Right Column**: Register values and data labels

### Mobile/Responsive Design
The simulator automatically adapts to different screen sizes:
- **Desktop/Laptop**: Three-column resizable layout with drag handles
- **Tablet/Mobile**: Single-column stacked layout for better readability
- All functionality remains available on smaller screens

## Example Program

\`\`\`assembly
.text
    li x1, 10        # Load 10 into x1
    li x2, 5         // Load 5 into x2 (also supported)
    add x3, x1, x2   # x3 = x1 + x2
    li x4, low(data) # Load address of data
    sw x3, 0(x4)     # Store result to memory
    trap 0           # Halt execution
    
    # Example of system calls
    li a0, 1         # System call number for print_int
    li a1, 42        # Value to print
    trap 3           # Make system call
    
    li a0, 10        # System call number for exit
    li a1, 0         # Exit code
    trap 3           # Exit program

.data
data: .word 0               # Reserve space for result
buffer: .zero 10            # Reserve 10 words initialized to zero
workspace: .space 5         # Reserve 5 words of uninitialized space
message: .ascii "Hello"     # ASCII string (one char per word)
greeting: .string "Hi!"     # Null-terminated string
array: .word 1, 2, 3, 4, 5  # Initialize array with values
\`\`\`

## Memory Organization

- **Code Memory**: Instructions are stored in 16-bit words
- **Data Memory**: Data values are stored in 16-bit words
- **Address Space**: 16-bit addresses (64KB total addressable space)

## Execution Model

The simulator follows a simple fetch-decode-execute cycle:
1. Fetch instruction from memory at PC
2. Decode instruction and read registers
3. Execute operation
4. Write results back to registers/memory
5. Update PC (normally PC+1, or jump target)

## ISA Encoding

Instructions are encoded in 16-bit words with the following formats:
- **R-Type**: [15:12] opcode, [11:8] rd, [7:4] rs1, [3:0] rs2
- **I-Type**: [15:12] opcode, [11:8] rd, [7:4] rs1, [3:0] imm4 (or [7:0] imm8 for li)
- **S-Type**: [15:12] opcode, [11:8] rs2, [7:4] rs1, [3:0] imm4
- **B-Type**: [15:12] opcode, [11:8] rs1, [7:0] offset
- **J-Type**: [15:12] opcode, [11:0] offset
`;
}

function parseMarkdown(markdown) {
    // Simple markdown parser for basic formatting
    let html = markdown;
    
    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)\n```/g, '<pre><code class="language-$1">$2</code></pre>');
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Lists
    html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[1-6]>)/g, '$1');
    html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    
    return html;
}

function showHelp() {
    const readmeContent = loadReadmeContent();
    const helpHtml = parseMarkdown(readmeContent);
    
    const helpText = document.getElementById('helpText');
    helpText.innerHTML = helpHtml;
    
    // Use Bootstrap modal API
    const helpModal = new bootstrap.Modal(document.getElementById('helpModal'));
    helpModal.show();
}

// Global function for clearing syscall output
function clearSyscallOutput() {
    if (window.simulator) {
        window.simulator.clearSyscallOutput();
        updateSyscallOutput();
    }
}

// Update syscall output display
function updateSyscallOutput() {
    if (window.simulator) {
        const output = window.simulator.getSyscallOutput();
        const display = document.getElementById('syscallOutput');
        if (display) {
            display.textContent = output;
        }
    }
}

// Initialize simulator when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // console.log('DOM loaded, initializing VRISC-V simulator');
    window.simulator = new VRISCVSimulator();
});
