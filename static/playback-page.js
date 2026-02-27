/**
 * MusicPolice MIDI Playback Page
 * Piano roll visualization with Tone.js audio
 */

class PianoRollVisualizer {
    constructor() {
        // MIDI range: 21 (A0) to 108 (C8) = 88 keys
        this.MIN_MIDI = 21;
        this.MAX_MIDI = 108;
        this.TOTAL_KEYS = this.MAX_MIDI - this.MIN_MIDI + 1;
        
        // Time window in seconds to show notes falling
        this.LOOK_AHEAD_TIME = 4;
        
        // Configuration
        this.filename = null;
        this.midi = null;
        this.notes = [];
        this.duration = 0;
        this.currentTime = 0;
        this.isPlaying = false;
        this.playbackMode = 'browser';
        this.startTimestamp = 0;
        this.pausedTime = 0;
        this.animationId = null;
        
        // Tone.js sampler
        this.sampler = null;
        this.scheduledEvents = [];
        
        // Active notes for keyboard highlighting
        this.activeNotes = new Set();
        
        // Canvas elements
        this.rollCanvas = document.getElementById('piano-roll-canvas');
        this.rollCtx = this.rollCanvas.getContext('2d');
        this.keyboardCanvas = document.getElementById('piano-keyboard-canvas');
        this.keyboardCtx = this.keyboardCanvas.getContext('2d');
        
        // DOM elements
        this.rollContainer = document.getElementById('piano-roll-container');
        this.keyboardContainer = document.getElementById('piano-keyboard-container');
        this.fileTitle = document.getElementById('file-title');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.errorMessage = document.getElementById('error-message');
        this.timeDisplay = document.getElementById('time-display');
        this.progressFill = document.getElementById('progress-fill');
        this.progressBar = document.getElementById('progress-bar');
        this.btnPlayPause = document.getElementById('btn-play-pause');
        this.btnStop = document.getElementById('btn-stop');
        this.btnRestart = document.getElementById('btn-restart');
        this.btnRewind = document.getElementById('btn-rewind');
        this.modeRadios = document.querySelectorAll('input[name="playback-mode"]');
        
        // Cached dimensions
        this.keyWidth = 0;
        this.blackKeyWidth = 0;
        this.blackKeyHeight = 0;
        
        // Key layout info
        this.keyLayout = this.calculateKeyLayout();
        
        this.init();
    }
    
    /**
     * Calculate which keys are black/white and their positions
     */
    calculateKeyLayout() {
        const layout = [];
        const blackKeyPattern = [1, 3, 6, 8, 10]; // Positions in octave for black keys (0-11)
        
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            const noteInOctave = midi % 12;
            const isBlack = blackKeyPattern.includes(noteInOctave);
            layout.push({
                midi,
                isBlack,
                noteInOctave
            });
        }
        return layout;
    }
    
    /**
     * Get X position for a MIDI note on the piano roll
     */
    getNoteX(midi) {
        // Count white keys from MIN_MIDI to this note
        let whiteKeyCount = 0;
        for (let m = this.MIN_MIDI; m < midi; m++) {
            if (!this.isBlackKey(m)) whiteKeyCount++;
        }
        
        const isBlack = this.isBlackKey(midi);
        const whiteKeyWidth = this.rollCanvas.width / this.countWhiteKeys();
        
        if (isBlack) {
            // Black key - centered between adjacent white keys
            return whiteKeyCount * whiteKeyWidth - (whiteKeyWidth * 0.3);
        } else {
            return whiteKeyCount * whiteKeyWidth;
        }
    }
    
    /**
     * Get width for a MIDI note on the piano roll
     */
    getNoteWidth(midi) {
        const whiteKeyWidth = this.rollCanvas.width / this.countWhiteKeys();
        return this.isBlackKey(midi) ? whiteKeyWidth * 0.6 : whiteKeyWidth;
    }
    
    isBlackKey(midi) {
        const noteInOctave = midi % 12;
        return [1, 3, 6, 8, 10].includes(noteInOctave);
    }
    
    countWhiteKeys() {
        let count = 0;
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            if (!this.isBlackKey(midi)) count++;
        }
        return count;
    }
    
    async init() {
        const params = new URLSearchParams(window.location.search);
        this.filename = params.get('file');
        
        if (!this.filename) {
            this.showError('No file specified');
            return;
        }
        
        this.fileTitle.textContent = this.filename;
        document.title = `${this.filename} - MusicPolice`;
        
        this.setupEventListeners();
        this.setupResizeHandler();
        this.resizeCanvases();
        
        await this.loadMIDI();
    }
    
    setupEventListeners() {
        this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
        this.btnStop.addEventListener('click', () => this.stop());
        this.btnRestart.addEventListener('click', () => this.restart());
        this.btnRewind.addEventListener('click', () => this.rewind(5));
        
        this.modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.playbackMode = e.target.value;
                if (this.isPlaying) {
                    this.stop();
                }
            });
        });
        
        // Progress bar seeking
        this.progressBar.addEventListener('click', (e) => this.seekFromProgressBar(e));
        
        // Piano roll click seeking
        this.rollCanvas.addEventListener('click', (e) => this.seekFromCanvas(e));
        
        // Touch support for canvas
        this.rollCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                this.seekFromCanvas(e.touches[0]);
            }
        }, { passive: false });
        
        // Mouse wheel scrolling on piano roll
        this.rollCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 1 : -1;
            const seekAmount = delta * 2; // 2 seconds per scroll
            this.seekTo(Math.max(0, Math.min(this.duration, this.currentTime + seekAmount)));
        }, { passive: false });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'Escape':
                    this.stop();
                    break;
                case 'Home':
                    this.restart();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.rewind(5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.seekTo(Math.min(this.duration, this.currentTime + 5));
                    break;
            }
        });
    }
    
    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.resizeCanvases();
                this.draw();
            }, 100);
        });
    }
    
    resizeCanvases() {
        const dpr = window.devicePixelRatio || 1;
        
        // Piano roll canvas
        const rollRect = this.rollContainer.getBoundingClientRect();
        this.rollCanvas.width = rollRect.width * dpr;
        this.rollCanvas.height = rollRect.height * dpr;
        this.rollCanvas.style.width = `${rollRect.width}px`;
        this.rollCanvas.style.height = `${rollRect.height}px`;
        this.rollCtx.scale(dpr, dpr);
        
        // Keyboard canvas
        const keyRect = this.keyboardContainer.getBoundingClientRect();
        this.keyboardCanvas.width = keyRect.width * dpr;
        this.keyboardCanvas.height = keyRect.height * dpr;
        this.keyboardCanvas.style.width = `${keyRect.width}px`;
        this.keyboardCanvas.style.height = `${keyRect.height}px`;
        this.keyboardCtx.scale(dpr, dpr);
        
        // Update key dimensions
        const whiteKeyCount = this.countWhiteKeys();
        this.keyWidth = rollRect.width / whiteKeyCount;
        this.blackKeyWidth = this.keyWidth * 0.6;
        this.blackKeyHeight = keyRect.height * 0.6;
    }
    
    async loadMIDI() {
        try {
            this.showLoading();
            
            const response = await fetch(`/download/${encodeURIComponent(this.filename)}`);
            if (!response.ok) throw new Error('Failed to load MIDI file');
            
            const arrayBuffer = await response.arrayBuffer();
            this.midi = new Midi(arrayBuffer);
            
            // Flatten all notes from all tracks
            this.notes = [];
            this.midi.tracks.forEach(track => {
                track.notes.forEach(note => {
                    this.notes.push({
                        midi: note.midi,
                        time: note.time,
                        duration: note.duration,
                        velocity: note.velocity,
                        name: note.name
                    });
                });
            });
            
            if (this.notes.length === 0) {
                throw new Error('No notes found in MIDI file');
            }
            
            // Sort by time
            this.notes.sort((a, b) => a.time - b.time);
            
            // Calculate duration
            this.duration = Math.max(...this.notes.map(n => n.time + n.duration));
            
            // Initialize Tone.js sampler
            await this.initSampler();
            
            this.hideLoading();
            this.updateTimeDisplay();
            this.draw();
            
        } catch (error) {
            console.error('Error loading MIDI:', error);
            this.showError(`Error loading MIDI file: ${error.message}`);
        }
    }
    
    async initSampler() {
        return new Promise((resolve, reject) => {
            this.sampler = new Tone.Sampler({
                urls: {
                    A0: "A0.mp3",
                    C1: "C1.mp3",
                    "D#1": "Ds1.mp3",
                    "F#1": "Fs1.mp3",
                    A1: "A1.mp3",
                    C2: "C2.mp3",
                    "D#2": "Ds2.mp3",
                    "F#2": "Fs2.mp3",
                    A2: "A2.mp3",
                    C3: "C3.mp3",
                    "D#3": "Ds3.mp3",
                    "F#3": "Fs3.mp3",
                    A3: "A3.mp3",
                    C4: "C4.mp3",
                    "D#4": "Ds4.mp3",
                    "F#4": "Fs4.mp3",
                    A4: "A4.mp3",
                    C5: "C5.mp3",
                    "D#5": "Ds5.mp3",
                    "F#5": "Fs5.mp3",
                    A5: "A5.mp3",
                    C6: "C6.mp3",
                    "D#6": "Ds6.mp3",
                    "F#6": "Fs6.mp3",
                    A6: "A6.mp3",
                    C7: "C7.mp3",
                    "D#7": "Ds7.mp3",
                    "F#7": "Fs7.mp3",
                    A7: "A7.mp3",
                    C8: "C8.mp3"
                },
                release: 1,
                baseUrl: "https://tonejs.github.io/audio/salamander/",
                onload: resolve,
                onerror: reject
            }).toDestination();
        });
    }
    
    showLoading() {
        this.loadingOverlay.classList.remove('hidden');
        this.errorMessage.classList.add('hidden');
    }
    
    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }
    
    showError(message) {
        this.loadingOverlay.classList.add('hidden');
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }
    
    async togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }
    
    async play() {
        if (!this.midi || !this.sampler) return;
        
        try {
            // Start audio context on user gesture
            await Tone.start();
            
            this.isPlaying = true;
            this.btnPlayPause.textContent = '⏸';
            
            // Schedule notes for browser playback
            if (this.playbackMode === 'browser' || this.playbackMode === 'both') {
                this.scheduleNotes();
            }
            
            // Start piano playback
            if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
                await this.playOnPiano();
            }
            
            // Start animation
            this.startTimestamp = performance.now() - (this.currentTime * 1000);
            this.animationLoop();
            
        } catch (error) {
            console.error('Playback error:', error);
            this.isPlaying = false;
            this.btnPlayPause.textContent = '▶';
        }
    }
    
    scheduleNotes() {
        // Clear any previously scheduled events
        this.clearScheduledEvents();
        
        const now = Tone.now();
        const startTime = this.currentTime;
        
        this.notes.forEach(note => {
            if (note.time >= startTime) {
                const relativeTime = note.time - startTime;
                
                // Schedule note on
                const eventId = Tone.Transport.schedule((time) => {
                    this.sampler.triggerAttack(
                        Tone.Frequency(note.midi, "midi").toNote(),
                        time,
                        note.velocity
                    );
                    this.activeNotes.add(note.midi);
                }, now + relativeTime);
                
                this.scheduledEvents.push(eventId);
                
                // Schedule note off
                const offEventId = Tone.Transport.schedule((time) => {
                    this.sampler.triggerRelease(
                        Tone.Frequency(note.midi, "midi").toNote(),
                        time
                    );
                    this.activeNotes.delete(note.midi);
                }, now + relativeTime + note.duration);
                
                this.scheduledEvents.push(offEventId);
            }
        });
        
        Tone.Transport.start();
    }
    
    clearScheduledEvents() {
        this.scheduledEvents.forEach(id => {
            Tone.Transport.clear(id);
        });
        this.scheduledEvents = [];
        Tone.Transport.stop();
        Tone.Transport.cancel();
        this.sampler.releaseAll();
        this.activeNotes.clear();
    }
    
    async playOnPiano() {
        try {
            await fetch(`/api/playback/play/${encodeURIComponent(this.filename)}`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Error starting piano playback:', error);
        }
    }
    
    pause() {
        this.isPlaying = false;
        this.btnPlayPause.textContent = '▶';
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.playbackMode === 'browser' || this.playbackMode === 'both') {
            this.clearScheduledEvents();
        }
        
        if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
            this.pausePiano();
        }
    }
    
    async pausePiano() {
        try {
            await fetch('/api/playback/pause', { method: 'POST' });
        } catch (error) {
            console.error('Error pausing piano:', error);
        }
    }
    
    stop() {
        this.pause();
        
        if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
            this.stopPiano();
        }
        
        this.currentTime = 0;
        this.activeNotes.clear();
        this.updateTimeDisplay();
        this.updateProgress();
        this.draw();
    }
    
    async stopPiano() {
        try {
            await fetch('/api/playback/stop', { method: 'POST' });
        } catch (error) {
            console.error('Error stopping piano:', error);
        }
    }
    
    restart() {
        const wasPlaying = this.isPlaying;
        this.stop();
        if (wasPlaying) {
            this.play();
        }
    }
    
    rewind(seconds) {
        this.seekTo(Math.max(0, this.currentTime - seconds));
    }
    
    seekTo(time) {
        const wasPlaying = this.isPlaying;
        
        if (wasPlaying) {
            this.pause();
        }
        
        this.currentTime = Math.max(0, Math.min(time, this.duration));
        this.activeNotes.clear();
        this.updateTimeDisplay();
        this.updateProgress();
        this.draw();
        
        if (wasPlaying) {
            this.play();
        }
    }
    
    seekFromProgressBar(event) {
        const rect = this.progressBar.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = x / rect.width;
        this.seekTo(percentage * this.duration);
    }
    
    seekFromCanvas(event) {
        // Get click position relative to canvas
        const rect = this.rollCanvas.getBoundingClientRect();
        const y = event.clientY - rect.clientY || event.pageY - rect.top - window.scrollY;
        const canvasHeight = rect.height;
        
        // Y position corresponds to time
        // Notes fall from top to bottom, so top = future, bottom = current time
        // We reverse: clicking near bottom = current time area, top = look ahead
        const clickRatio = 1 - (y / canvasHeight);
        const clickTime = this.currentTime + (clickRatio * this.LOOK_AHEAD_TIME);
        
        this.seekTo(Math.max(0, Math.min(clickTime, this.duration)));
    }
    
    animationLoop() {
        if (!this.isPlaying) return;
        
        const now = performance.now();
        this.currentTime = (now - this.startTimestamp) / 1000;
        
        if (this.currentTime >= this.duration) {
            this.onPlaybackEnd();
            return;
        }
        
        // Update active notes based on current time
        this.updateActiveNotes();
        
        this.updateTimeDisplay();
        this.updateProgress();
        this.draw();
        
        this.animationId = requestAnimationFrame(() => this.animationLoop());
    }
    
    updateActiveNotes() {
        // Only update for browser playback mode
        if (this.playbackMode === 'piano') return;
        
        this.activeNotes.clear();
        this.notes.forEach(note => {
            if (note.time <= this.currentTime && 
                note.time + note.duration > this.currentTime) {
                this.activeNotes.add(note.midi);
            }
        });
    }
    
    onPlaybackEnd() {
        this.isPlaying = false;
        this.btnPlayPause.textContent = '▶';
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.clearScheduledEvents();
        this.currentTime = this.duration;
        this.activeNotes.clear();
        this.updateTimeDisplay();
        this.updateProgress();
        this.draw();
    }
    
    draw() {
        this.drawPianoRoll();
        this.drawKeyboard();
    }
    
    drawPianoRoll() {
        const ctx = this.rollCtx;
        const dpr = window.devicePixelRatio || 1;
        const width = this.rollCanvas.width / dpr;
        const height = this.rollCanvas.height / dpr;
        
        // Clear canvas
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, width, height);
        
        // Draw piano key guidelines (vertical lines)
        this.drawKeyGuidelines(ctx, width, height);
        
        // Draw notes
        const whiteKeyCount = this.countWhiteKeys();
        const keyW = width / whiteKeyCount;
        
        // Time range to display
        const startTime = this.currentTime;
        const endTime = this.currentTime + this.LOOK_AHEAD_TIME;
        
        // Draw notes
        this.notes.forEach(note => {
            const noteEnd = note.time + note.duration;
            
            // Only draw notes in visible time range
            if (noteEnd < startTime || note.time > endTime) return;
            
            // Calculate note position
            const x = this.getNoteX(note.midi);
            const noteWidth = this.getNoteWidth(note.midi) - 2;
            
            // Y position: notes fall from top (future) to bottom (current)
            // At currentTime, noteY should be at bottom (height)
            // At currentTime + LOOK_AHEAD, noteY should be at top (0)
            const timeRatio = (note.time - this.currentTime) / this.LOOK_AHEAD_TIME;
            const endRatio = (noteEnd - this.currentTime) / this.LOOK_AHEAD_TIME;
            
            const noteY = (1 - timeRatio) * height;
            const noteEndY = (1 - endRatio) * height;
            const noteHeight = noteY - noteEndY;
            
            // Draw note rectangle
            const cornerRadius = 4;
            ctx.fillStyle = `rgba(78, 205, 196, ${0.6 + note.velocity * 0.4})`;
            
            this.roundRect(ctx, x + 1, noteEndY, noteWidth, Math.max(noteHeight, 4), cornerRadius);
        });
        
        // Draw playhead line (at the bottom where notes "hit")
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height - 2);
        ctx.lineTo(width, height - 2);
        ctx.stroke();
    }
    
    drawKeyGuidelines(ctx, width, height) {
        const whiteKeyCount = this.countWhiteKeys();
        const keyW = width / whiteKeyCount;
        let whiteKeyIndex = 0;
        
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            if (!this.isBlackKey(midi)) {
                const x = whiteKeyIndex * keyW;
                
                // Draw white key guideline
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                
                whiteKeyIndex++;
            }
        }
        
        // Draw darker overlay for black key areas
        whiteKeyIndex = 0;
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            if (!this.isBlackKey(midi)) {
                whiteKeyIndex++;
            } else {
                const x = this.getNoteX(midi);
                const w = this.getNoteWidth(midi);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.fillRect(x, 0, w, height);
            }
        }
    }
    
    drawKeyboard() {
        const ctx = this.keyboardCtx;
        const dpr = window.devicePixelRatio || 1;
        const width = this.keyboardCanvas.width / dpr;
        const height = this.keyboardCanvas.height / dpr;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        const whiteKeyCount = this.countWhiteKeys();
        const whiteKeyW = width / whiteKeyCount;
        const blackKeyW = whiteKeyW * 0.6;
        const blackKeyH = height * 0.6;
        
        // Draw white keys first
        let whiteKeyIndex = 0;
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            if (!this.isBlackKey(midi)) {
                const x = whiteKeyIndex * whiteKeyW;
                const isActive = this.activeNotes.has(midi);
                
                // White key background
                ctx.fillStyle = isActive ? '#4ecdc4' : '#f8f8f8';
                ctx.fillRect(x + 1, 0, whiteKeyW - 2, height - 2);
                
                // Key border
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 1, 0, whiteKeyW - 2, height - 2);
                
                // Add glow for active keys
                if (isActive) {
                    ctx.shadowColor = '#4ecdc4';
                    ctx.shadowBlur = 20;
                    ctx.fillStyle = '#4ecdc4';
                    ctx.fillRect(x + 1, 0, whiteKeyW - 2, height - 2);
                    ctx.shadowBlur = 0;
                }
                
                whiteKeyIndex++;
            }
        }
        
        // Draw black keys on top
        whiteKeyIndex = 0;
        for (let midi = this.MIN_MIDI; midi <= this.MAX_MIDI; midi++) {
            if (!this.isBlackKey(midi)) {
                whiteKeyIndex++;
            } else {
                // Position black key between white keys
                const x = whiteKeyIndex * whiteKeyW - blackKeyW / 2;
                const isActive = this.activeNotes.has(midi);
                
                // Black key shadow
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fillRect(x + 3, 3, blackKeyW, blackKeyH);
                
                // Black key background
                ctx.fillStyle = isActive ? '#45b7aa' : '#1a1a1a';
                ctx.fillRect(x, 0, blackKeyW, blackKeyH);
                
                // Highlight at top
                const gradient = ctx.createLinearGradient(x, 0, x, blackKeyH * 0.3);
                gradient.addColorStop(0, isActive ? 'rgba(100, 220, 210, 0.4)' : 'rgba(80, 80, 80, 0.4)');
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.fillRect(x, 0, blackKeyW, blackKeyH * 0.3);
                
                // Add glow for active keys
                if (isActive) {
                    ctx.shadowColor = '#45b7aa';
                    ctx.shadowBlur = 15;
                    ctx.fillStyle = '#45b7aa';
                    ctx.fillRect(x, 0, blackKeyW, blackKeyH);
                    ctx.shadowBlur = 0;
                }
            }
        }
    }
    
    roundRect(ctx, x, y, width, height, radius) {
        if (width < 0 || height < 0) return;
        
        radius = Math.min(radius, width / 2, height / 2);
        
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }
    
    updateTimeDisplay() {
        const current = this.formatTime(this.currentTime);
        const total = this.formatTime(this.duration);
        this.timeDisplay.textContent = `${current} / ${total}`;
    }
    
    updateProgress() {
        const percentage = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
        this.progressFill.style.width = `${percentage}%`;
    }
    
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PianoRollVisualizer();
});
