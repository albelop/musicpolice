#!/usr/bin/env python3
"""
MusicPolice Web Application

Flask-based web interface for managing MIDI recordings, viewing practice
statistics, and controlling playback.
"""

import os
import sys
from datetime import datetime
from pathlib import Path
import zipfile
import io
import tempfile

import yaml
import mido
from flask import Flask, jsonify, render_template, request, send_file, abort

from metadata import MetadataManager
from playback import get_player, PlaybackState

# Initialize Flask app
app = Flask(__name__)

# Load configuration
def load_config(config_path: str = "config.yaml") -> dict:
    """Load configuration from YAML file."""
    try:
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {
            "storage": {"recordings_dir": "recordings", "favorites_dir": "favs"},
            "web": {"host": "0.0.0.0", "port": 5000, "debug": False}
        }

config = load_config()

# Initialize managers
recordings_dir = Path(config["storage"]["recordings_dir"])
recordings_dir.mkdir(parents=True, exist_ok=True)

metadata = MetadataManager(
    str(recordings_dir),
    config["storage"]["favorites_dir"]
)

# Sync with filesystem on startup
metadata.sync_with_filesystem()

player = get_player(str(recordings_dir))


# =============================================================================
# Web Routes
# =============================================================================

@app.route('/')
def index():
    """Main dashboard with calendar journal view."""
    now = datetime.now()
    return render_template('index.html', 
                          current_year=now.year, 
                          current_month=now.month)


@app.route('/playback')
def playback():
    """MIDI playback page with falling notes visualization."""
    return render_template('playback.html')


# =============================================================================
# API Routes - Recordings
# =============================================================================

@app.route('/api/recordings')
def api_get_recordings():
    """Get all recordings with metadata."""
    recordings = metadata.get_all_recordings()
    return jsonify({
        "success": True,
        "recordings": recordings,
        "count": len(recordings)
    })


@app.route('/api/recordings/<filename>')
def api_get_recording(filename: str):
    """Get metadata for a specific recording."""
    recording = metadata.get_recording(filename)
    if recording:
        return jsonify({"success": True, "recording": recording})
    return jsonify({"success": False, "error": "Recording not found"}), 404


@app.route('/api/recordings/<filename>', methods=['DELETE'])
def api_delete_recording(filename: str):
    """Delete a recording."""
    # Stop playback if this file is playing
    if player.current_file == filename:
        player.stop()
    
    success = metadata.delete_recording(filename)
    if success:
        return jsonify({"success": True, "message": f"Deleted {filename}"})
    return jsonify({"success": False, "error": "Failed to delete recording"}), 400


@app.route('/api/recordings/date/<date>')
def api_get_recordings_by_date(date: str):
    """Get recordings for a specific date (YYYY-MM-DD)."""
    recordings = metadata.get_recordings_by_date(date)
    return jsonify({
        "success": True,
        "date": date,
        "recordings": recordings,
        "count": len(recordings)
    })


# =============================================================================
# API Routes - Favorites
# =============================================================================

@app.route('/api/favorites')
def api_get_favorites():
    """Get all favorited recordings."""
    favorites = metadata.get_favorites()
    return jsonify({
        "success": True,
        "recordings": favorites,
        "count": len(favorites)
    })


@app.route('/api/favorite/<filename>', methods=['POST'])
def api_toggle_favorite(filename: str):
    """Toggle favorite status for a recording."""
    new_state = metadata.toggle_favorite(filename)
    if new_state is not None:
        return jsonify({
            "success": True,
            "filename": filename,
            "favorite": new_state
        })
    return jsonify({"success": False, "error": "Recording not found"}), 404


# =============================================================================
# API Routes - Calendar & Statistics
# =============================================================================

@app.route('/api/calendar/<int:year>/<int:month>')
def api_get_calendar(year: int, month: int):
    """Get calendar data for a specific month."""
    if not (1 <= month <= 12):
        return jsonify({"success": False, "error": "Invalid month"}), 400
    
    calendar_data = metadata.get_calendar_data(year, month)
    return jsonify({
        "success": True,
        "year": year,
        "month": month,
        "days": calendar_data
    })


@app.route('/api/stats')
def api_get_stats():
    """Get overall practice statistics."""
    stats = metadata.get_practice_stats()
    return jsonify({
        "success": True,
        "stats": stats
    })


# =============================================================================
# API Routes - Playback
# =============================================================================

@app.route('/api/playback/play/<filename>', methods=['POST'])
def api_play(filename: str):
    """Start playing a MIDI file."""
    success = player.play(filename)
    if success:
        return jsonify({
            "success": True,
            "message": f"Playing {filename}",
            "status": player.get_status()
        })
    return jsonify({
        "success": False,
        "error": "Failed to start playback"
    }), 400


@app.route('/api/playback/stop', methods=['POST'])
def api_stop():
    """Stop playback."""
    player.stop()
    return jsonify({
        "success": True,
        "message": "Playback stopped",
        "status": player.get_status()
    })


@app.route('/api/playback/pause', methods=['POST'])
def api_pause():
    """Toggle pause/resume."""
    state = player.toggle_pause()
    return jsonify({
        "success": True,
        "state": state.value,
        "status": player.get_status()
    })


@app.route('/api/playback/status')
def api_playback_status():
    """Get current playback status."""
    return jsonify({
        "success": True,
        "status": player.get_status()
    })


@app.route('/api/midi/status')
def api_midi_status():
    """Get MIDI device status."""
    try:
        input_devices = mido.get_input_names()
        output_devices = mido.get_output_names()
        
        # Try to match the configured device pattern
        device_pattern = config.get("midi", {}).get("device_pattern", "")
        
        connected_input = None
        connected_output = None
        
        if input_devices:
            if device_pattern:
                for name in input_devices:
                    if device_pattern.lower() in name.lower():
                        connected_input = name
                        break
            if not connected_input:
                connected_input = input_devices[0]
        
        if output_devices:
            if device_pattern:
                for name in output_devices:
                    if device_pattern.lower() in name.lower():
                        connected_output = name
                        break
            if not connected_output:
                connected_output = output_devices[0]
        
        return jsonify({
            "success": True,
            "midi": {
                "input_device": connected_input,
                "output_device": connected_output,
                "input_available": len(input_devices),
                "output_available": len(output_devices),
                "all_inputs": input_devices,
                "all_outputs": output_devices
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "midi": {
                "input_device": None,
                "output_device": None,
                "input_available": 0,
                "output_available": 0
            }
        })


# =============================================================================
# File Download
# =============================================================================

@app.route('/download/<filename>')
def download_file(filename: str):
    """Download a MIDI file."""
    # Security: prevent path traversal
    if '..' in filename or '/' in filename:
        abort(400)
    
    filepath = recordings_dir / filename
    if not filepath.exists():
        # Check favorites folder
        filepath = recordings_dir / config["storage"]["favorites_dir"] / filename
    
    if filepath.exists():
        return send_file(
            filepath,
            as_attachment=True,
            download_name=filename,
            mimetype='audio/midi'
        )
    
    abort(404)


@app.route('/download/zip/day/<date>')
def download_day_zip(date: str):
    """Download all recordings from a specific day as a zip file."""
    try:
        # Validate date format
        datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        abort(400)
    
    recordings = metadata.get_recordings_by_date(date)
    if not recordings:
        return jsonify({"success": False, "error": "No recordings for this date"}), 404
    
    # Create zip file in memory
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for recording in recordings:
            filepath = recordings_dir / recording['filename']
            if filepath.exists():
                zf.write(filepath, recording['filename'])
    
    memory_file.seek(0)
    download_name = f"musicpolice_{date}.zip"
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=download_name,
        mimetype='application/zip'
    )


@app.route('/download/zip/month/<int:year>/<int:month>')
def download_month_zip(year: int, month: int):
    """Download all recordings from a specific month as a zip file."""
    if not (1 <= month <= 12):
        abort(400)
    
    # Get all recordings for the month
    from calendar import monthrange
    _, num_days = monthrange(year, month)
    
    all_recordings = []
    for day in range(1, num_days + 1):
        date_str = f"{year:04d}-{month:02d}-{day:02d}"
        all_recordings.extend(metadata.get_recordings_by_date(date_str))
    
    if not all_recordings:
        return jsonify({"success": False, "error": "No recordings for this month"}), 404
    
    # Create zip file in memory
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for recording in all_recordings:
            filepath = recordings_dir / recording['filename']
            if filepath.exists():
                zf.write(filepath, recording['filename'])
    
    memory_file.seek(0)
    download_name = f"musicpolice_{year:04d}-{month:02d}.zip"
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=download_name,
        mimetype='application/zip'
    )


@app.route('/download/zip/year/<int:year>')
def download_year_zip(year: int):
    """Download all recordings from a specific year as a zip file."""
    all_recordings = []
    
    for month in range(1, 13):
        from calendar import monthrange
        _, num_days = monthrange(year, month)
        
        for day in range(1, num_days + 1):
            date_str = f"{year:04d}-{month:02d}-{day:02d}"
            all_recordings.extend(metadata.get_recordings_by_date(date_str))
    
    if not all_recordings:
        return jsonify({"success": False, "error": "No recordings for this year"}), 404
    
    # Create zip file in memory
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for recording in all_recordings:
            filepath = recordings_dir / recording['filename']
            if filepath.exists():
                zf.write(filepath, recording['filename'])
    
    memory_file.seek(0)
    download_name = f"musicpolice_{year:04d}.zip"
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=download_name,
        mimetype='application/zip'
    )


@app.route('/download/zip/all')
def download_all_zip():
    """Download the entire library as a zip file."""
    all_recordings = metadata.get_all_recordings()
    
    if not all_recordings:
        return jsonify({"success": False, "error": "No recordings available"}), 404
    
    # Create zip file in memory
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for recording in all_recordings:
            filepath = recordings_dir / recording['filename']
            if filepath.exists():
                zf.write(filepath, recording['filename'])
    
    memory_file.seek(0)
    download_name = f"musicpolice_library_{datetime.now().strftime('%Y-%m-%d')}.zip"
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=download_name,
        mimetype='application/zip'
    )


@app.route('/download/zip/favorites')
def download_favorites_zip():
    """Download all favorited recordings as a zip file."""
    favorites = metadata.get_favorites()
    
    if not favorites:
        return jsonify({"success": False, "error": "No favorites available"}), 404
    
    # Create zip file in memory
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for recording in favorites:
            # Try main dir first, then favorites dir
            filepath = recordings_dir / recording['filename']
            if not filepath.exists():
                filepath = recordings_dir / config["storage"]["favorites_dir"] / recording['filename']
            
            if filepath.exists():
                zf.write(filepath, recording['filename'])
    
    memory_file.seek(0)
    download_name = f"musicpolice_favorites_{datetime.now().strftime('%Y-%m-%d')}.zip"
    
    return send_file(
        memory_file,
        as_attachment=True,
        download_name=download_name,
        mimetype='application/zip'
    )


# =============================================================================
# Error Handlers
# =============================================================================

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": "Not found"}), 404
    return render_template('404.html'), 404


@app.errorhandler(500)
def server_error(e):
    """Handle 500 errors."""
    if request.path.startswith('/api/'):
        return jsonify({"success": False, "error": "Internal server error"}), 500
    return render_template('500.html'), 500


# =============================================================================
# Main
# =============================================================================

def main():
    """Main entry point."""
    # Change to script directory
    script_dir = Path(__file__).parent.absolute()
    os.chdir(script_dir)
    
    # Run Flask app
    host = config["web"]["host"]
    port = config["web"]["port"]
    debug = config["web"]["debug"]
    
    print(f"Starting MusicPolice web interface at http://{host}:{port}")
    app.run(host=host, port=port, debug=debug, threaded=True)


if __name__ == "__main__":
    main()
