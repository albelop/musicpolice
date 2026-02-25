/**
 * MusicPolice - Piano Journal
 * Frontend JavaScript Application
 */

class MusicPoliceApp {
    constructor() {
        // State
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth() + 1;
        this.selectedDate = null;
        this.currentFilter = 'all';
        this.recordings = [];
        this.playbackStatus = null;
        this.playbackPollInterval = null;

        // Bind methods
        this.init = this.init.bind(this);
        this.loadStats = this.loadStats.bind(this);
        this.loadCalendar = this.loadCalendar.bind(this);
        this.loadRecordings = this.loadRecordings.bind(this);
        this.renderRecordings = this.renderRecordings.bind(this);
    }

    async init() {
        // Setup event listeners
        this.setupEventListeners();

        // Initial load
        await Promise.all([
            this.loadStats(),
            this.loadCalendar(),
            this.loadRecordings()
        ]);

        // Start playback status polling
        this.startPlaybackPolling();
    }

    setupEventListeners() {
        // Calendar navigation
        document.getElementById('prev-month').addEventListener('click', () => {
            this.currentMonth--;
            if (this.currentMonth < 1) {
                this.currentMonth = 12;
                this.currentYear--;
            }
            this.loadCalendar();
        });

        document.getElementById('next-month').addEventListener('click', () => {
            this.currentMonth++;
            if (this.currentMonth > 12) {
                this.currentMonth = 1;
                this.currentYear++;
            }
            this.loadCalendar();
        });

        // Filter buttons
        document.querySelectorAll('.btn-filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.renderRecordings();
            });
        });

        // Playback controls
        document.getElementById('btn-stop').addEventListener('click', () => this.stopPlayback());
        document.getElementById('btn-play-pause').addEventListener('click', () => this.togglePause());

        // Download buttons
        document.getElementById('download-all').addEventListener('click', () => this.downloadZip('all'));
        document.getElementById('download-favorites').addEventListener('click', () => this.downloadZip('favorites'));
        document.getElementById('download-selected-day').addEventListener('click', () => {
            if (this.selectedDate) {
                this.downloadZip('day', this.selectedDate);
            }
        });
        document.getElementById('download-today').addEventListener('click', () => {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            this.downloadZip('day', todayStr);
        });
        document.getElementById('download-current-month').addEventListener('click', () => {
            this.downloadZip('month', this.currentYear, this.currentMonth);
        });
        document.getElementById('download-current-year').addEventListener('click', () => {
            this.downloadZip('year', this.currentYear);
        });
        // Set today's label
        const today = new Date();
        const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const todayText = document.getElementById('today-text');
        if (todayText) todayText.textContent = todayStr;
    }

    // ==========================================================================
    // API Methods
    // ==========================================================================

    async fetchApi(endpoint, options = {}) {
        try {
            const response = await fetch(endpoint, options);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API Error:', error);
            return { success: false, error: error.message };
        }
    }

    // ==========================================================================
    // Stats
    // ==========================================================================

    async loadStats() {
        const data = await this.fetchApi('/api/stats');
        if (data.success) {
            const stats = data.stats;
            document.getElementById('stat-streak').textContent = stats.current_streak_days;
            document.getElementById('stat-week').textContent = stats.this_week_formatted;
            document.getElementById('stat-month').textContent = stats.this_month_formatted;
            document.getElementById('stat-total').textContent = stats.total_recordings;
        }
    }

    // ==========================================================================
    // Calendar
    // ==========================================================================

    async loadCalendar() {
        const data = await this.fetchApi(`/api/calendar/${this.currentYear}/${this.currentMonth}`);
        if (!data.success) return;

        // Update title
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        document.getElementById('calendar-title').textContent = 
            `${monthNames[this.currentMonth - 1]} ${this.currentYear}`;

        // Update download button labels
        document.getElementById('current-month-text').textContent = 
            `${monthNames[this.currentMonth - 1]} ${this.currentYear}`;
        document.getElementById('current-year-text').textContent = `${this.currentYear}`;

        // Render calendar days
        const calendarDays = document.getElementById('calendar-days');
        calendarDays.innerHTML = '';

        // Get first day of month (0 = Sunday, convert to Monday-based)
        const firstDay = new Date(this.currentYear, this.currentMonth - 1, 1);
        let startDay = firstDay.getDay();
        startDay = startDay === 0 ? 6 : startDay - 1; // Convert to Monday-based

        // Get number of days in month
        const daysInMonth = new Date(this.currentYear, this.currentMonth, 0).getDate();

        // Get today's date for comparison
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Add empty cells for days before first of month
        for (let i = 0; i < startDay; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day empty';
            calendarDays.appendChild(emptyDay);
        }

        // Add days
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayData = data.days[dateStr] || { duration_category: 0, duration_formatted: '0m', recording_count: 0 };

            const dayEl = document.createElement('div');
            dayEl.className = `calendar-day level-${dayData.duration_category}`;
            dayEl.textContent = day;
            dayEl.dataset.date = dateStr;

            // Mark today
            if (dateStr === todayStr) {
                dayEl.classList.add('today');
            }

            // Mark selected
            if (dateStr === this.selectedDate) {
                dayEl.classList.add('selected');
            }

            // Tooltip
            if (dayData.recording_count > 0) {
                dayEl.title = `${dayData.duration_formatted} (${dayData.recording_count} sessions)`;
            }

            // Click handler
            dayEl.addEventListener('click', () => this.selectDate(dateStr));

            calendarDays.appendChild(dayEl);
        }
    }

    selectDate(dateStr) {
        // Update selection
        this.selectedDate = dateStr;
        
        // Update visual selection
        document.querySelectorAll('.calendar-day').forEach(day => {
            day.classList.toggle('selected', day.dataset.date === dateStr);
        });

        // Update recordings title
        const date = new Date(dateStr);
        const formatted = date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
        document.getElementById('recordings-title').textContent = formatted;

        // Enable download selected day button
        const downloadDayBtn = document.getElementById('download-selected-day');
        downloadDayBtn.disabled = false;
        downloadDayBtn.innerHTML = `📅 ${formatted}`;

        // Filter recordings
        this.renderRecordings();
    }

    // ==========================================================================
    // Recordings
    // ==========================================================================

    async loadRecordings() {
        const data = await this.fetchApi('/api/recordings');
        if (data.success) {
            this.recordings = data.recordings;
            this.renderRecordings();
        }
    }

    renderRecordings() {
        const container = document.getElementById('recordings-list');
        container.innerHTML = '';

        // Filter recordings
        let filtered = this.recordings;

        // Filter by date if selected
        if (this.selectedDate) {
            filtered = filtered.filter(r => r.date === this.selectedDate);
        }

        // Filter by favorites
        if (this.currentFilter === 'favorites') {
            filtered = filtered.filter(r => r.favorite);
        }

        // Show empty state
        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${this.selectedDate ? 'No recordings for this day' : 'No recordings yet'}</p>
                    <p style="font-size: 0.85rem;">Start playing your piano to begin recording!</p>
                </div>
            `;
            return;
        }

        // Render recordings
        filtered.forEach(recording => {
            const el = this.createRecordingElement(recording);
            container.appendChild(el);
        });
    }

    createRecordingElement(recording) {
        const template = document.getElementById('recording-template');
        const el = template.content.cloneNode(true).querySelector('.recording-item');

        el.dataset.filename = recording.filename;

        // Time (extract from filename or use start_time)
        const startTime = new Date(recording.start_time);
        const timeStr = startTime.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit'
        });
        el.querySelector('.recording-time').textContent = timeStr;

        // Duration
        el.querySelector('.recording-duration').textContent = 
            this.formatDuration(recording.duration_seconds);

        // Notes count
        if (recording.note_count > 0) {
            el.querySelector('.recording-notes').textContent = 
                `${recording.note_count} notes`;
        }

        // Favorite button
        const favBtn = el.querySelector('.btn-favorite');
        if (recording.favorite) {
            favBtn.classList.add('active');
            favBtn.textContent = '★';
        }
        favBtn.addEventListener('click', () => this.toggleFavorite(recording.filename));

        // Play button
        el.querySelector('.btn-play').addEventListener('click', () => 
            this.playRecording(recording.filename));

        // Download link
        const downloadBtn = el.querySelector('.btn-download');
        downloadBtn.href = `/download/${recording.filename}`;

        // Delete button
        el.querySelector('.btn-delete').addEventListener('click', () => 
            this.deleteRecording(recording.filename));

        // Mark if currently playing
        if (this.playbackStatus?.current_file === recording.filename) {
            el.classList.add('playing');
        }

        return el;
    }

    formatDuration(seconds) {
        if (!seconds) return '0s';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        
        if (mins === 0) return `${secs}s`;
        if (secs === 0) return `${mins}m`;
        return `${mins}m ${secs}s`;
    }

    async toggleFavorite(filename) {
        const data = await this.fetchApi(`/api/favorite/${filename}`, { method: 'POST' });
        if (data.success) {
            // Update local state
            const recording = this.recordings.find(r => r.filename === filename);
            if (recording) {
                recording.favorite = data.favorite;
            }
            this.renderRecordings();
        }
    }

    async deleteRecording(filename) {
        if (!confirm(`Delete ${filename}?`)) return;

        const data = await this.fetchApi(`/api/recordings/${filename}`, { method: 'DELETE' });
        if (data.success) {
            // Remove from local state
            this.recordings = this.recordings.filter(r => r.filename !== filename);
            this.renderRecordings();
            this.loadStats();
            this.loadCalendar();
        }
    }

    // ==========================================================================
    // Playback
    // ==========================================================================

    async playRecording(filename) {
        // Redirect to dedicated playback page with visualizer
        window.location.href = `/playback?file=${encodeURIComponent(filename)}`;
    }

    async stopPlayback() {
        const data = await this.fetchApi('/api/playback/stop', { method: 'POST' });
        if (data.success) {
            this.updatePlaybackUI(data.status);
        }
    }

    async togglePause() {
        const data = await this.fetchApi('/api/playback/pause', { method: 'POST' });
        if (data.success) {
            this.updatePlaybackUI(data.status);
        }
    }

    startPlaybackPolling() {
        this.playbackPollInterval = setInterval(async () => {
            const data = await this.fetchApi('/api/playback/status');
            if (data.success) {
                this.updatePlaybackUI(data.status);
            }
        }, 1000);
    }

    updatePlaybackUI(status) {
        this.playbackStatus = status;
        const bar = document.getElementById('playback-bar');
        const title = document.getElementById('playback-title');
        const time = document.getElementById('playback-time');
        const progress = document.getElementById('progress-fill');
        const playPauseBtn = document.getElementById('btn-play-pause');

        if (status.state === 'stopped') {
            bar.classList.remove('active');
            title.textContent = 'Not playing';
            time.textContent = '0:00 / 0:00';
            progress.style.width = '0%';
            playPauseBtn.textContent = '▶';
        } else {
            bar.classList.add('active');
            title.textContent = status.current_file || 'Playing...';
            
            const currentTime = this.formatTime(status.position);
            const totalTime = this.formatTime(status.duration);
            time.textContent = `${currentTime} / ${totalTime}`;
            
            progress.style.width = `${status.progress}%`;
            
            playPauseBtn.textContent = status.state === 'playing' ? '⏸' : '▶';
        }

        // Update recording list to show playing state
        document.querySelectorAll('.recording-item').forEach(el => {
            el.classList.toggle('playing', el.dataset.filename === status.current_file);
        });
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ==========================================================================
    // Download
    // ==========================================================================

    downloadZip(type, ...args) {
        let url;
        
        switch(type) {
            case 'all':
                url = '/download/zip/all';
                break;
            case 'favorites':
                url = '/download/zip/favorites';
                break;
            case 'day':
                url = `/download/zip/day/${args[0]}`;
                break;
            case 'month':
                url = `/download/zip/month/${args[0]}/${args[1]}`;
                break;
            case 'year':
                url = `/download/zip/year/${args[0]}`;
                break;
            default:
                console.error('Unknown download type:', type);
                return;
        }

        // Trigger download
        window.location.href = url;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new MusicPoliceApp();
    app.init();
});
