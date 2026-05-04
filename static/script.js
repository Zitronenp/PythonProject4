// ============================================
// ИСПОРЧЕННЫЙ ТЕЛЕФОН - КЛИЕНТСКАЯ ЛОГИКА
// Фиолетово-сиренево-розовая версия с анимациями
// ============================================

// ────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────
const CONFIG = {
    CANVAS_WIDTH: 900,
    CANVAS_HEIGHT: 600,
    MAX_UNDO_STEPS: 30,
    TOAST_ERROR_DURATION: 3000,
    TOAST_SUCCESS_DURATION: 2000,
    STATUS_CHECK_INTERVAL: 30000,
    CANVAS_COLORS: [
        '#FFFFFF', '#000000', '#808080',  // White, Black, Gray
        '#0000FF', '#00BFFF',             // Blue, Light Blue
        '#008000',                         // Green
        '#FF0000',                         // Red
        '#FFFF00', '#FFA500',             // Yellow, Orange
        '#8B4513', '#F5B5B5',             // Brown, Pinkish Beige
        '#FFC0CB', '#800080'              // Pink, Purple
    ],
    DEFAULT_BRUSH_SIZE: 4,
    DEFAULT_OPACITY: 100,
    MIN_BRUSH_SIZE: 1,
    MAX_BRUSH_SIZE: 40
};

// ────────────────────────────────────────────
// GLOBAL VARIABLES
// ────────────────────────────────────────────
const socket = io();
let mySid = null;
let isHost = false;
let currentPhase = null;
let revealedBranchIndex = 0;
let revealedBranches = [];
let totalBranches = 0;

// Canvas variables
let canvas, ctx;
let drawing = false;
let lastX = 0, lastY = 0;
let currentColor = "#000000";
let currentSize = CONFIG.DEFAULT_BRUSH_SIZE;
let currentOpacity = CONFIG.DEFAULT_OPACITY / 100;
let isErasing = false;
let isFilling = false;
let undoStack = [];
let redoStack = [];

// Current assignment
let currentAssignment = null;

// Prevent duplicate reconnection
let isReconnecting = false;

// ────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────
function showError(message) {
    showToast('error-toast', message, CONFIG.TOAST_ERROR_DURATION);
}

function showSuccess(message) {
    showToast('success-toast', message, CONFIG.TOAST_SUCCESS_DURATION);
}

function showToast(toastId, message, duration) {
    const toast = document.getElementById(toastId);
    if (!toast) return;
    
    const msgSpan = toast.querySelector('.toast-message');
    if (msgSpan) {
        msgSpan.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');

        const card = targetScreen.querySelector('.card');
        if (card) {
            card.style.animation = 'none';
            setTimeout(() => {
                card.style.animation = 'slideInUp 0.5s ease forwards';
            }, 10);
        }
    }
}

function triggerConfetti() {
    if (typeof canvasConfetti === 'function') {
        canvasConfetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#a855f7', '#c084fc', '#f472b6', '#ec4899', '#d8b4fe']
        });
    }
}

function triggerSuccessAnimation() {
    if (typeof canvasConfetti === 'function') {
        canvasConfetti({
            particleCount: 30,
            spread: 45,
            origin: { y: 0.8 },
            colors: ['#a855f7', '#c084fc', '#f472b6']
        });
    }
}

function playButtonSound() {
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

// ────────────────────────────────────────────
// ОБНОВЛЕНИЕ ЛОББИ
// ────────────────────────────────────────────
function updateLobbyList(data) {
    isHost = (data.host_sid === mySid);
    const list = document.getElementById('player-list');

    if (list) {
        if (data.players && data.players.length > 0) {
            list.innerHTML = data.players.map((p, index) =>
                `<li style="animation-delay: ${index * 0.05}s" class="animate-slide-up">
                    ${p.is_host ? '👑' : '🎨'} ${escapeHtml(p.nick)}
                </li>`
            ).join('');
        } else {
            list.innerHTML = '<li>👥 Ожидание игроков...</li>';
        }
    }

    const canStart = data.players && data.players.length >= 2;
    const startBtn = document.getElementById('start-btn');

    if (startBtn) {
        if (isHost && canStart && (!currentPhase || currentPhase === 'lobby')) {
            startBtn.style.display = 'block';
            startBtn.classList.add('animate-pulse');
        } else {
            startBtn.style.display = 'none';
            startBtn.classList.remove('animate-pulse');
        }
    }

    const lobbyTitle = document.getElementById('lobby-title');
    const lobbyText = document.getElementById('lobby-text');
    if (lobbyTitle && lobbyText && (!currentPhase || currentPhase === 'lobby')) {
        lobbyTitle.innerHTML = isHost ? '👋 Лобби (Вы хост)' : '👋 Лобби';
        lobbyText.innerHTML = isHost
            ? 'Нажмите кнопку ниже, чтобы начать игру!'
            : 'Ожидание начала игры...';
    }
}

// ────────────────────────────────────────────
// ОБНОВЛЕНИЕ ЭКРАНА РЕЗУЛЬТАТОВ
// ────────────────────────────────────────────
function updateRevealUI() {
    const branchCounter = document.getElementById('branch-counter');
    const revealSteps = document.getElementById('reveal-steps');
    const nextBtn = document.getElementById('next-branch-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const spectatorWait = document.getElementById('spectator-wait');

    if (!branchCounter || !revealSteps) return;

    if (revealedBranchIndex >= totalBranches) {
        branchCounter.textContent = '🎉 Игра завершена! 🎉';
        if (nextBtn) nextBtn.style.display = 'none';
        if (newGameBtn) newGameBtn.style.display = isHost ? 'block' : 'none';
        if (spectatorWait) spectatorWait.style.display = 'none';
        revealSteps.innerHTML = '<div class="celebrate-pop" style="text-align:center; padding: 40px;"><div style="font-size: 3em;">🎨✨🎭</div><p style="margin-top: 20px; color: #a855f7; font-weight: 600;">Все цепочки показаны!</p></div>';

        triggerConfetti();
        return;
    }

    branchCounter.textContent = `📖 Ветка ${revealedBranchIndex + 1} из ${totalBranches}`;
    if (nextBtn) nextBtn.style.display = isHost ? 'block' : 'none';
    if (newGameBtn) newGameBtn.style.display = 'none';
    if (spectatorWait) spectatorWait.style.display = isHost ? 'none' : 'block';

    const branch = revealedBranches[revealedBranchIndex];
    if (!branch) return;

    let html = '';

    branch.chain.forEach((step, i) => {
        const content = step.type === 'text'
            ? `<div class="content-text" style="font-size: 1.1em; padding: 10px; background: linear-gradient(135deg, #faf5ff, #fff); border-radius: 20px;">📝 ${escapeHtml(step.content)}</div>`
            : `<img src="${step.content}" alt="Рисунок" loading="lazy" style="max-width: 100%; border-radius: 16px;">`;

        html += `
            <div class="reveal-step animate-slide-up" style="animation-delay: ${i * 0.1}s">
                <div class="nick">🎨 ${escapeHtml(step.author_nick)}</div>
                <div class="content">${content}</div>
            </div>
        `;
        if (i < branch.chain.length - 1) {
            html += `<div class="reveal-arrow">👇</div>`;
        }
    });

    revealSteps.innerHTML = html;
    if (revealSteps.scrollTo) revealSteps.scrollTo(0, 0);
}

// ────────────────────────────────────────────
// ОБРАБОТКА ИГРОВЫХ ФАЗ
// ────────────────────────────────────────────
function handleGamePhase(data) {
    currentPhase = data.phase;

    switch (data.phase) {
        case 'writing':
            showScreen('writing-screen');
            const phraseInput = document.getElementById('phrase-input');
            if (phraseInput) {
                phraseInput.value = '';
                phraseInput.disabled = false;
                phraseInput.focus();
            }
            const submitPhraseBtn = document.getElementById('submit-phrase-btn');
            if (submitPhraseBtn) submitPhraseBtn.disabled = false;
            const writingStatus = document.getElementById('writing-status');
            if (writingStatus) writingStatus.innerHTML = '✍️ Придумайте интересную фразу...';
            break;

        case 'drawing':
            showScreen('drawing-screen');
            const assignment = data.assignments?.[mySid];
            if (assignment) {
                currentAssignment = assignment;
                const drawingPrompt = document.getElementById('drawing-prompt');
                if (drawingPrompt) {
                    drawingPrompt.innerHTML = `🎯 Нарисуйте: <strong style="color: #ec4899;">"${escapeHtml(assignment.content)}"</strong>`;
                }
            }
            initCanvas();
            const submitDrawingBtn = document.getElementById('submit-drawing-btn');
            if (submitDrawingBtn) submitDrawingBtn.disabled = false;
            const drawingStatus = document.getElementById('drawing-status');
            if (drawingStatus) drawingStatus.innerHTML = '🖌️ Рисуйте!';
            break;

        case 'guessing':
            showScreen('guessing-screen');
            const guessAssignment = data.assignments?.[mySid];
            if (guessAssignment) {
                currentAssignment = guessAssignment;
                const imgElement = document.getElementById('guess-image');
                if (imgElement) {
                    imgElement.src = guessAssignment.content;
                    imgElement.alt = 'Рисунок для угадывания';
                    imgElement.classList.add('animate-scale-in');
                    setTimeout(() => imgElement.classList.remove('animate-scale-in'), 500);
                }
            }
            const guessInput = document.getElementById('guess-input');
            if (guessInput) {
                guessInput.value = '';
                guessInput.disabled = false;
                guessInput.focus();
            }
            const submitGuessBtn = document.getElementById('submit-guess-btn');
            if (submitGuessBtn) submitGuessBtn.disabled = false;
            const guessingStatus = document.getElementById('guessing-status');
            if (guessingStatus) guessingStatus.innerHTML = '👁️ Что здесь нарисовано?';
            break;

        case 'lobby':
            showScreen('lobby-screen');
            const lobbyTitle = document.getElementById('lobby-title');
            const lobbyText = document.getElementById('lobby-text');
            if (lobbyTitle) lobbyTitle.innerHTML = data.message ? '👋 Игра завершена' : '👋 Лобби';
            if (lobbyText) lobbyText.innerHTML = data.message || 'Хост может запустить новую игру';
            currentPhase = 'lobby';
            break;

        case 'reveal':
            break;
    }
}

// ────────────────────────────────────────────
// CANVAS ФУНКЦИИ (УЛУЧШЕННАЯ ВЕРСИЯ)
// ────────────────────────────────────────────

// Save canvas state for undo
function saveToUndo() {
    if (!canvas || !ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    redoStack = [];

    // Limit undo stack size
    while (undoStack.length > CONFIG.MAX_UNDO_STEPS) {
        undoStack.shift();
    }
}

// Undo last action
function undo() {
    if (undoStack.length === 0) {
        showError('Нечего отменять!');
        return;
    }

    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    redoStack.push(currentState);

    const previousState = undoStack.pop();
    ctx.putImageData(previousState, 0, 0);

    animateCanvasContainer('animate-wobble');
}

// Redo action
function redo() {
    if (redoStack.length === 0) {
        showError('Нечего повторять!');
        return;
    }

    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(currentState);

    const nextState = redoStack.pop();
    ctx.putImageData(nextState, 0, 0);

    animateCanvasContainer('animate-wobble');
}

function animateCanvasContainer(animationClass) {
    const container = document.querySelector('.canvas-container');
    if (container) {
        container.classList.add(animationClass);
        setTimeout(() => container.classList.remove(animationClass), 500);
    }
}

// Draw a continuous stroke with opacity
function startStroke(x, y) {
    if (!ctx) return;

    drawing = true;
    [lastX, lastY] = [x, y];
    ctx.beginPath();
    ctx.globalAlpha = isErasing ? 1 : currentOpacity;
    ctx.strokeStyle = isErasing ? '#FFFFFF' : currentColor;
    ctx.moveTo(lastX, lastY);
}

function drawStroke(x, y) {
    if (!drawing || !ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
}

function endStroke() {
    if (!ctx) return;
    drawing = false;
    ctx.closePath();
    ctx.globalAlpha = 1;
}

// Fill canvas with current color
function fillCanvas() {
    if (!ctx) return;
    
    ctx.globalAlpha = currentOpacity;
    ctx.fillStyle = currentColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    
    saveToUndo();
    animateCanvasContainer('animate-shake');
    showSuccess('Заливка применена! 🪣');
}

// Toggle eraser
function toggleEraser() {
    isErasing = !isErasing;
    isFilling = false;
    
    const eraserBtn = document.getElementById('eraser-btn');
    const fillBtn = document.getElementById('fill-canvas-btn');
    
    if (eraserBtn) {
        eraserBtn.classList.toggle('active', isErasing);
    }
    if (fillBtn) {
        fillBtn.classList.remove('active');
    }
    
    if (isErasing) {
        showSuccess('Ластик активирован! 🧽');
    }
}

// Очистить весь холст с подтверждением
function clearCanvasWithConfirm() {
    if (confirm('🗑️ Очистить весь рисунок? Отменить будет нельзя!')) {
        clearCanvas();
        saveToUndo();
        triggerSuccessAnimation();
    }
}

function clearCanvas() {
    if (!ctx) return;
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;

    saveToUndo();
    animateCanvasContainer('animate-shake');
}

function isSameAsLastState() {
    if (undoStack.length === 0) return false;
    const lastState = undoStack[undoStack.length - 1];
    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (lastState.data.length !== currentState.data.length) return false;
    for (let i = 0; i < lastState.data.length; i++) {
        if (lastState.data[i] !== currentState.data[i]) return false;
    }
    return true;
}

// Add eraser button once
let eraserButtonAdded = false;
function addEraserButton() {
    if (eraserButtonAdded) return;
    
    const buttonGroup = document.querySelector('#drawing-screen .button-group');
    if (buttonGroup && !document.getElementById('eraser-btn')) {
        const eraserBtn = document.createElement('button');
        eraserBtn.id = 'eraser-btn';
        eraserBtn.className = 'btn btn-secondary';
        eraserBtn.innerHTML = '🧽 Ластик';
        eraserBtn.onclick = toggleEraser;
        buttonGroup.insertBefore(eraserBtn, buttonGroup.firstChild);
        eraserButtonAdded = true;
    }
}

// Add undo/redo buttons once
let undoRedoButtonsAdded = false;
function addUndoRedoButtons() {
    if (undoRedoButtonsAdded) return;
    
    const buttonGroup = document.querySelector('#drawing-screen .button-group');
    if (buttonGroup) {
        if (!document.getElementById('undo-btn')) {
            const undoBtn = document.createElement('button');
            undoBtn.id = 'undo-btn';
            undoBtn.className = 'btn btn-secondary';
            undoBtn.innerHTML = '↩️ Отменить';
            undoBtn.onclick = undo;
            buttonGroup.appendChild(undoBtn);
        }

        if (!document.getElementById('redo-btn')) {
            const redoBtn = document.createElement('button');
            redoBtn.id = 'redo-btn';
            redoBtn.className = 'btn btn-secondary';
            redoBtn.innerHTML = '↪️ Повторить';
            redoBtn.onclick = redo;
            buttonGroup.appendChild(redoBtn);
        }

        if (!document.getElementById('clear-canvas-btn')) {
            const newClearBtn = document.createElement('button');
            newClearBtn.id = 'clear-canvas-btn';
            newClearBtn.className = 'btn btn-secondary';
            newClearBtn.innerHTML = '🗑️ Очистить всё';
            newClearBtn.onclick = clearCanvasWithConfirm;
            buttonGroup.appendChild(newClearBtn);
        }

        // Hide old clear button
        const oldClearBtn = buttonGroup.querySelector('button[onclick="window.clearCanvas?.()"]');
        if (oldClearBtn) {
            oldClearBtn.style.display = 'none';
        }
        
        undoRedoButtonsAdded = true;
    }
}

function renderColorPalette() {
    const palette = document.getElementById('palette');
    if (!palette) return;

    palette.innerHTML = '';

    CONFIG.CANVAS_COLORS.forEach(color => {
        const btn = document.createElement('div');
        btn.className = 'color-btn';
        if (color.toUpperCase() === currentColor.toUpperCase() && !isErasing) {
            btn.classList.add('active');
        }
        btn.style.backgroundColor = color;
        btn.setAttribute('data-color', color);
        btn.onclick = () => setDrawingColor(color, btn);
        palette.appendChild(btn);
    });

    // Add color picker
    const pickerWrapper = document.createElement('label');
    pickerWrapper.className = 'color-picker-wrapper';
    pickerWrapper.title = 'Цветовой круг';

    const pickerText = document.createElement('span');
    pickerText.className = 'color-picker-label';
    pickerText.textContent = 'Цветовой круг';

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.className = 'color-wheel';
    colorPicker.value = normalizeColorToHex(currentColor);
    colorPicker.oninput = (event) => {
        setDrawingColor(event.target.value);
    };

    pickerWrapper.appendChild(pickerText);
    pickerWrapper.appendChild(colorPicker);
    palette.appendChild(pickerWrapper);
}

function normalizeColorToHex(color) {
    if (!color) return '#000000';
    if (color.startsWith('#')) {
        if (color.length === 4) {
            return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
        }
        return color;
    }

    const temp = document.createElement('canvas').getContext('2d');
    temp.fillStyle = color;
    const normalized = temp.fillStyle;
    return normalized.startsWith('#') ? normalized : '#000000';
}

// Set drawing color
function setDrawingColor(color, sourceBtn = null) {
    if (isErasing) toggleEraser();
    if (isFilling) isFilling = false;
    
    currentColor = color;

    document.querySelectorAll('.color-btn').forEach(b => {
        b.classList.toggle('active', b === sourceBtn);
    });

    const colorPicker = document.getElementById('color-wheel');
    if (colorPicker) {
        colorPicker.value = normalizeColorToHex(color);
    }

    // Reset fill button active state
    const fillBtn = document.getElementById('fill-canvas-btn');
    if (fillBtn) {
        fillBtn.classList.remove('active');
    }
}

function initCanvas() {
    canvas = document.getElementById('draw-canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d');

    // Set canvas dimensions
    canvas.width = CONFIG.CANVAS_WIDTH;
    canvas.height = CONFIG.CANVAS_HEIGHT;

    // Style canvas
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = `${CONFIG.CANVAS_WIDTH}px`;
    canvas.style.borderRadius = '16px';
    canvas.style.boxShadow = '0 10px 30px rgba(139, 92, 246, 0.2)';

    // Initialize canvas context
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Reset undo/redo stacks
    undoStack = [];
    redoStack = [];
    saveToUndo();

    renderColorPalette();
    setupBrushSliders();
    addEraserButton();
    addUndoRedoButtons();

    setupCanvasEvents();
}

function setupBrushSliders() {
    const sizeSlider = document.getElementById('brush-size-slider');
    const sizeValue = document.getElementById('brush-size-value');
    const opacitySlider = document.getElementById('brush-opacity-slider');
    const opacityValue = document.getElementById('brush-opacity-value');

    if (sizeSlider && sizeValue) {
        sizeSlider.min = String(CONFIG.MIN_BRUSH_SIZE);
        sizeSlider.max = String(CONFIG.MAX_BRUSH_SIZE);
        sizeSlider.value = String(currentSize);
        sizeValue.textContent = String(currentSize);

        sizeSlider.oninput = (event) => {
            currentSize = Number(event.target.value);
            sizeValue.textContent = String(currentSize);
            if (ctx) ctx.lineWidth = currentSize;
        };
    }

    if (opacitySlider && opacityValue) {
        const opacityPercent = Math.round(currentOpacity * 100);
        opacitySlider.value = String(opacityPercent);
        opacityValue.textContent = String(opacityPercent);

        opacitySlider.oninput = (event) => {
            const value = Number(event.target.value);
            currentOpacity = value / 100;
            opacityValue.textContent = String(value);
        };
    }
}

function setupCanvasEvents() {
    const getCoords = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
    };

    // Clear previous event listeners
    canvas.onmousedown = null;
    canvas.onmouseup = null;
    canvas.onmouseout = null;
    canvas.onmousemove = null;
    canvas.ontouchstart = null;
    canvas.ontouchend = null;
    canvas.ontouchmove = null;

    // Mouse events
    canvas.onmousedown = (e) => {
        const [x, y] = getCoords(e.clientX, e.clientY);
        startStroke(x, y);

        if (undoStack.length === 0 || !isSameAsLastState()) {
            saveToUndo();
        }
    };

    canvas.onmouseup = () => { endStroke(); };
    canvas.onmouseout = () => { endStroke(); };
    canvas.onmousemove = (e) => {
        if (drawing) {
            const [x, y] = getCoords(e.clientX, e.clientY);
            drawStroke(x, y);
        }
    };

    // Touch events
    canvas.ontouchstart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const [x, y] = getCoords(touch.clientX, touch.clientY);
        startStroke(x, y);

        if (undoStack.length === 0 || !isSameAsLastState()) {
            saveToUndo();
        }
    };
    canvas.ontouchend = () => { endStroke(); };
    canvas.ontouchmove = (e) => {
        e.preventDefault();
        if (drawing) {
            const touch = e.touches[0];
            const [x, y] = getCoords(touch.clientX, touch.clientY);
            drawStroke(x, y);
        }
    };
}

// ────────────────────────────────────────────
// ОТПРАВКА ДЕЙСТВИЙ
// ────────────────────────────────────────────
function submitPhrase() {
    const input = document.getElementById('phrase-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
        showError('Введите фразу! ✍️');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }

    socket.emit('submit_text', { text: text });
    input.disabled = true;
    const submitBtn = document.getElementById('submit-phrase-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('writing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Отправлено! Ожидание остальных...';
    triggerSuccessAnimation();
    playButtonSound();
}

function submitDrawing() {
    if (!canvas) return;

    const imageData = canvas.toDataURL('image/png');
    socket.emit('submit_drawing', { image: imageData });
    const submitBtn = document.getElementById('submit-drawing-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('drawing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Рисунок отправлен! Ожидание...';
    triggerSuccessAnimation();
    playButtonSound();
}

function submitGuess() {
    const input = document.getElementById('guess-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
        showError('Введите описание рисунка! 👁️');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }

    socket.emit('submit_guess', { text: text });
    input.disabled = true;
    const submitBtn = document.getElementById('submit-guess-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('guessing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Отправлено! Ожидание...';
    triggerSuccessAnimation();
    playButtonSound();
}

function startGame() {
    if (isHost) {
        socket.emit('host_start_game');
        showSuccess('Игра начинается! 🚀');
        playButtonSound();
    }
}

function nextBranch() {
    if (isHost) {
        socket.emit('host_next_branch');
        playButtonSound();
    }
}

function newGame() {
    if (isHost) {
        socket.emit('host_new_game');
        showSuccess('Новая игра! 🎨');
        playButtonSound();
    }
}

function joinGame() {
    const input = document.getElementById('nickname-input');
    if (!input) return;
    const nickname = input.value.trim();
    if (!nickname) {
        showError('Введите никнейм! ✨');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }
    socket.emit('join_game', { nickname: nickname });
    playButtonSound();
}

// ────────────────────────────────────────────
// SOCKET ОБРАБОТЧИКИ
// ────────────────────────────────────────────
socket.on('connect', () => {
    mySid = socket.id;
    console.log('✅ Подключено к серверу');

    if (currentPhase && currentPhase !== 'lobby') {
        socket.emit('check_game_status');
    }
});

socket.on('connect_error', () => {
    showError('Ошибка подключения к серверу!');
});

socket.on('disconnect', () => {
    showError('Соединение потеряно. Перезагрузите страницу.');
});

socket.on('error', (data) => {
    if (data && data.message) showError(data.message);
});

socket.on('lobby_update', (data) => {
    updateLobbyList(data);
    if (!currentPhase || currentPhase === 'lobby' || currentPhase === 'reveal') {
        if (currentPhase !== 'reveal') {
            showScreen('lobby-screen');
        }
    }
});

socket.on('joined_mid_round', (data) => {
    showScreen('lobby-screen');
    const lobbyTitle = document.getElementById('lobby-title');
    const lobbyText = document.getElementById('lobby-text');
    if (lobbyTitle) lobbyTitle.innerHTML = '⏳ Ожидание следующего раунда';
    if (lobbyText) lobbyText.innerHTML = data.message;
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.style.display = 'none';
});

socket.on('join_success', (data) => {
    showScreen('lobby-screen');
    isHost = data.is_host;
    showSuccess(`Добро пожаловать! ${isHost ? 'Вы хост' : 'Вы игрок'}`);
});

socket.on('phase_change', (data) => {
    currentPhase = data.phase;

    if (data.phase === 'reveal') {
        revealedBranches = data.branches || [];
        totalBranches = data.branches?.length || 0;
        revealedBranchIndex = data.current_branch || 0;
        isHost = (data.host_sid === mySid);
        showScreen('reveal-screen');
        updateRevealUI();
        triggerConfetti();
    } else if (data.phase === 'lobby') {
        showScreen('lobby-screen');
        const lobbyTitle = document.getElementById('lobby-title');
        const lobbyText = document.getElementById('lobby-text');
        if (lobbyTitle) lobbyTitle.innerHTML = '👋 Игра завершена';
        if (lobbyText) lobbyText.innerHTML = data.message || 'Хост может запустить новый раунд';
    } else {
        handleGamePhase(data);
    }
});

socket.on('reveal_update', (data) => {
    revealedBranchIndex = data.current_branch;
    totalBranches = data.total_branches;
    updateRevealUI();
});

socket.on('player_left', (data) => {
    showError(`Игрок "${data.nickname}" покинул игру`);
    if (currentPhase === 'lobby') {
        socket.emit('request_lobby_update');
    }
});

// ────────────────────────────────────────────
// LOAD AND EVENT BINDING
// ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Expose functions to window for inline handlers
    window.joinGame = joinGame;
    window.startGame = startGame;
    window.submitPhrase = submitPhrase;
    window.submitDrawing = submitDrawing;
    window.submitGuess = submitGuess;
    window.clearCanvas = clearCanvas;
    window.nextBranch = nextBranch;
    window.newGame = newGame;
    window.undo = undo;
    window.redo = redo;
    window.toggleEraser = toggleEraser;

    // Setup enter key handlers
    setupInputHandlers();

    // Animate background shapes
    animateBackgroundShapes();

    console.log('🎨 Игра загружена! Приятной игры!');
});

function setupInputHandlers() {
    const nicknameInput = document.getElementById('nickname-input');
    if (nicknameInput) {
        nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinGame();
        });
    }

    // Add click handler for join button
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', joinGame);
    }

    const phraseInput = document.getElementById('phrase-input');
    if (phraseInput) {
        phraseInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitPhrase();
        });
    }

    const guessInput = document.getElementById('guess-input');
    if (guessInput) {
        guessInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitGuess();
        });
    }
}

function animateBackgroundShapes() {
    const shapes = document.querySelectorAll('.floating-shape');
    shapes.forEach((shape, i) => {
        shape.style.animation = `floatSlow ${15 + i * 2}s ease-in-out infinite`;
        shape.style.animationDelay = `${i * 2}s`;
    });
}

// ────────────────────────────────────────────
// PERIODIC GAME STATUS CHECK
// ────────────────────────────────────────────
setInterval(() => {
    if (currentPhase && currentPhase !== 'lobby' && currentPhase !== 'reveal') {
        socket.emit('check_game_status');
    }
}, CONFIG.STATUS_CHECK_INTERVAL);