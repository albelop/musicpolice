/**
 * MusicPolice MIDI Playback Page
 * Falling notes visualization using Magenta.js
 */

const mm = window.mm || magenta.music;

class MIDIPlaybackPage {
    constructor() {
        this.filename = null;
        this.noteSequence = null;
        this.visualizer = null;
        this.player = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.animationFrame = null;
        this.playbackMode = 'browser';  // 'browser', 'piano', or 'both'

        // DOM elements
        this.fileTitle = document.getElementById('file-title');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.errorMessage = document.getElementById('error-message');
        this.canvas = document.getElementById('waterfall-canvas');
        this.timeDisplay = document.getElementById('time-display');
        this.progressFill = document.getElementById('progress-fill');
        this.progressBar = document.getElementById('progress-bar');
        this.btnPlayPause = document.getElementById('btn-play-pause');
        this.btnStop = document.getElementById('btn-stop');
        this.btnRestart = document.getElementById('btn-restart');
        this.modeRadios = document.querySelectorAll('input[name="playback-mode"]');

        this.init();
    }

    async init() {
        // Get filename from URL parameter
        const params = new URLSearchParams(window.location.search);
        this.filename = params.get('file');

        if (!this.filename) {
            this.showError('No file specified');
            return;
        }

        // Update title
        this.fileTitle.textContent = this.filename;
        document.title = `${this.filename} - MusicPolice`;

        // Setup event listeners
        this.setupEventListeners();

        // Load MIDI file
        await this.loadMIDIFile();
    }

    setupEventListeners() {
        this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
        this.btnStop.addEventListener('click', () => this.stop());
        this.btnRestart.addEventListener('click', () => this.restart());
        
        // Playback mode selection
        this.modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.playbackMode = e.target.value;
                // Stop current playback when changing mode
                if (this.isPlaying) {
                    this.stop();
                }
            });
        });
        
        // Progress bar seeking
        this.progressBar.addEventListener('click', (e) => this.seek(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.code === 'Escape') {
                this.stop();
            } else if (e.code === 'Home') {
                this.restart();
            }
        });
    }

    async loadMIDIFile() {
        try {
            this.showLoading();

            // Fetch MIDI file
            const response = await fetch(`/download/${this.filename}`);
            if (!response.ok) {
                throw new Error('Failed to load MIDI file');
            }

            const midiArrayBuffer = await response.arrayBuffer();
            
            // Parse MIDI file using Magenta
            this.noteSequence = mm.midiToSequenceProto(midiArrayBuffer);
            
            if (!this.noteSequence || !this.noteSequence.notes || this.noteSequence.notes.length === 0) {
                throw new Error('No notes found in MIDI file');
            }

            this.duration = this.noteSequence.totalTime;

            // Initialize visualizer
            this.initializeVisualizer();

            // Initialize player
            this.initializePlayer();

            this.hideLoading();
            this.updateTimeDisplay();

        } catch (error) {
            console.error('Error loading MIDI:', error);
            this.showError(`Error loading MIDI file: ${error.message}`);
        }
    }

    initializeVisualizer() {
        // Configure visualizer config for falling notes animation
        const config = {
            noteHeight: 6,
            pixelsPerTimeStep: 120,  // Controls scroll speed - higher = faster
            noteSpacing: 1,
            noteRGB: '78, 205, 196',  // Teal color for all notes
            activeNoteRGB: '233, 69, 96',  // Red color for currently playing notes
            minPitch: 21,  // A0
            maxPitch: 108  // C8
        };

        // Create waterfall visualizer - notes fall from top like Guitar Hero
        this.visualizer = new mm.WaterfallSVGVisualizer(
            this.noteSequence,
            this.canvas,
            config
        );
        
        // Initial draw
        this.visualizer.redraw(this.currentTime);
    }

    initializePlayer() {
        // Create player with soundfont
        this.player = new mm.SoundFontPlayer(
            'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus'
        );

        // Setup player callbacks
        this.player.callbackObject = {
            run: (note) => {
                // Called for each note
            },
            stop: () => {
                this.onPlaybackEnd();
            }
        };
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
        if (!this.noteSequence) return;

        try {
            this.isPlaying = true;
            this.btnPlayPause.textContent = '⏸';

            // Start browser playback if mode is 'browser' or 'both'
            if (this.playbackMode === 'browser' || this.playbackMode === 'both') {
                if (this.player) {
                    await this.player.start(this.noteSequence, undefined, this.currentTime);
                }
            }

            // Start piano playback if mode is 'piano' or 'both'
            if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
                await this.playOnPiano();
            }

            // Start visualizer animation
            this.startVisualizerAnimation();

        } catch (error) {
            console.error('Playback error:', error);
            this.isPlaying = false;
            this.btnPlayPause.textContent = '▶';
        }
    }

    async playOnPiano() {
        try {
            const response = await fetch(`/api/playback/play/${encodeURIComponent(this.filename)}`, {
                method: 'POST'
            });
            const data = await response.json();
            if (!data.success) {
                console.error('Piano playback failed:', data.error);
            }
        } catch (error) {
            console.error('Error starting piano playback:', error);
        }
    }

    pause() {
        this.isPlaying = false;
        this.btnPlayPause.textContent = '▶';
        
        // Pause browser playback
        if (this.player && (this.playbackMode === 'browser' || this.playbackMode === 'both')) {
            this.player.stop();
        }

        // Pause piano playback
        if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
            this.pausePiano();
        }

        this.stopVisualizerAnimation();
    }

    async pausePiano() {
        try {
            await fetch('/api/playback/pause', { method: 'POST' });
        } catch (error) {
            console.error('Error pausing piano playback:', error);
        }
    }

    async stopPiano() {
        try {
            await fetch('/api/playback/stop', { method: 'POST' });
        } catch (error) {
            console.error('Error stopping piano playback:', error);
        }
    }

    stop() {
        this.pause();
        
        // Stop piano playback
        if (this.playbackMode === 'piano' || this.playbackMode === 'both') {
            this.stopPiano();
        }
        
        this.currentTime = 0;
        this.updateTimeDisplay();
        this.updateProgress();
        
        // Reset visualizer
        if (this.visualizer) {
            this.visualizer.redraw(this.currentTime);
        }
    }

    restart() {
        const wasPlaying = this.isPlaying;
        this.stop();
        if (wasPlaying) {
            this.play();
        }
    }

    seek(event) {
        const rect = this.progressBar.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = x / rect.width;
        
        this.currentTime = percentage * this.duration;
        this.currentTime = Math.max(0, Math.min(this.currentTime, this.duration));

        const wasPlaying = this.isPlaying;
        
        if (this.isPlaying) {
            this.pause();
        }

        this.updateTimeDisplay();
        this.updateProgress();
        
        if (this.visualizer) {
            this.visualizer.redraw(this.currentTime);
        }

        if (wasPlaying) {
            this.play();
        }
    }

    startVisualizerAnimation() {
        const startTime = performance.now();
        const startPlayTime = this.currentTime;

        const animate = (now) => {
            if (!this.isPlaying) return;

            const elapsed = (now - startTime) / 1000;
            this.currentTime = startPlayTime + elapsed;

            if (this.currentTime >= this.duration) {
                this.onPlaybackEnd();
                return;
            }

            // Update visualizer
            if (this.visualizer) {
                this.visualizer.redraw(this.currentTime);
            }

            this.updateTimeDisplay();
            this.updateProgress();

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    stopVisualizerAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    onPlaybackEnd() {
        this.isPlaying = false;
        this.btnPlayPause.textContent = '▶';
        this.stopVisualizerAnimation();
        this.currentTime = this.duration;
        this.updateTimeDisplay();
        this.updateProgress();
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
    new MIDIPlaybackPage();
});
