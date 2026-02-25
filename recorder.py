#!/usr/bin/env python3
"""
MusicPolice MIDI Recorder

Continuously records MIDI input from a digital piano, automatically splitting
recordings on silence and supporting favorite marking via key combination.
"""

import time
import logging
import signal
import sys
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Set
import threading
import yaml

import mido
from mido import MidiFile, MidiTrack, Message, MetaMessage

from metadata import MetadataManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class MidiRecorder:
    """
    MIDI recorder that captures all events from a piano and saves to .mid files.
    Automatically splits recordings on silence and supports favorite marking.
    """
    
    def __init__(self, config_path: str = "config.yaml"):
        self.config = self._load_config(config_path)
        
        # Configuration
        self.pause_threshold = self.config["midi"]["pause_threshold"]
        self.favorite_key_combo = set(self.config["favorite"]["key_combo"])
        self.favorite_detection_window = self.config["favorite"]["detection_window_ms"] / 1000.0
        self.recordings_dir = Path(self.config["storage"]["recordings_dir"])
        self.favorites_dir = self.config["storage"]["favorites_dir"]
        
        # Ensure directories exist
        self.recordings_dir.mkdir(parents=True, exist_ok=True)
        (self.recordings_dir / self.favorites_dir).mkdir(parents=True, exist_ok=True)
        
        # Metadata manager
        self.metadata = MetadataManager(
            str(self.recordings_dir),
            self.favorites_dir
        )
        
        # Recording state
        self.is_recording = False
        self.current_track: Optional[MidiTrack] = None
        self.current_filename: Optional[str] = None
        self.recording_start_time: Optional[datetime] = None
        self.last_event_time: float = 0
        self.last_event_ticks: int = 0
        self.note_count: int = 0
        self.held_notes: Set[int] = set()  # Track currently held notes
        self.active_notes: Set[int] = set()  # For favorite detection
        self.favorite_detect_times: dict = {}  # Track when favorite keys were pressed
        
        # Control
        self.running = False
        self.input_port: Optional[mido.ports.BaseInput] = None
        self._mark_favorite_pending = False  # Flag to mark current recording as favorite
        
        # MIDI timing
        self.ticks_per_beat = 480
        self.tempo = 500000  # microseconds per beat (120 BPM)
        
        # Setup signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _load_config(self, config_path: str) -> dict:
        """Load configuration from YAML file."""
        try:
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
                logger.info(f"Loaded configuration from {config_path}")
                return config
        except FileNotFoundError:
            logger.warning(f"Config file not found: {config_path}, using defaults")
            return {
                "midi": {"pause_threshold": 3.0, "device_pattern": ""},
                "favorite": {"key_combo": [87, 90, 92], "detection_window_ms": 150},
                "storage": {"recordings_dir": "recordings", "favorites_dir": "favs"},
                "logging": {"level": "INFO"}
            }
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        logger.info(f"Received signal {signum}, shutting down...")
        self.stop()
    
    def _find_midi_device(self) -> Optional[str]:
        """Find and return the name of an available MIDI input device."""
        try:
            available = mido.get_input_names()
            logger.info(f"Available MIDI inputs: {available}")
            
            if not available:
                return None
            
            # If pattern specified, try to match
            pattern = self.config["midi"]["device_pattern"]
            if pattern:
                for name in available:
                    if pattern.lower() in name.lower():
                        logger.info(f"Found matching device: {name}")
                        return name
            
            # Return first available
            logger.info(f"Using first available device: {available[0]}")
            return available[0]
            
        except Exception as e:
            logger.error(f"Error finding MIDI device: {e}")
            return None
    
    def _generate_filename(self) -> str:
        """Generate a timestamp-based filename for a new recording."""
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        return f"recording_{timestamp}.mid"
    
    def _start_new_recording(self):
        """Start a new recording session."""
        self.current_filename = self._generate_filename()
        self.current_track = MidiTrack()
        self.recording_start_time = datetime.now()
        self.last_event_time = 0  # Reset to 0 so first message has delta 0
        self.last_event_ticks = 0
        self.note_count = 0
        self.held_notes.clear()
        self._mark_favorite_pending = False
        
        # Add tempo meta message
        self.current_track.append(MetaMessage('set_tempo', tempo=self.tempo, time=0))
        
        self.is_recording = True
        logger.info(f"Started new recording: {self.current_filename}")
    
    def _save_current_recording(self):
        """Save the current recording to a file."""
        if not self.is_recording or self.current_track is None:
            return
        
        if len(self.current_track) <= 1:  # Only tempo message
            logger.debug("No events recorded, skipping save")
            self.is_recording = False
            return
        
        # Add end of track
        self.current_track.append(MetaMessage('end_of_track', time=0))
        
        # Create MIDI file
        mid = MidiFile(ticks_per_beat=self.ticks_per_beat)
        mid.tracks.append(self.current_track)
        
        # Save file
        filepath = self.recordings_dir / self.current_filename
        try:
            mid.save(str(filepath))
            file_size = filepath.stat().st_size
            
            # Calculate duration
            end_time = datetime.now()
            duration = (end_time - self.recording_start_time).total_seconds()
            
            # Add to metadata
            self.metadata.add_recording(
                filename=self.current_filename,
                start_time=self.recording_start_time,
                end_time=end_time,
                duration_seconds=duration,
                file_size=file_size,
                note_count=self.note_count
            )
            
            logger.info(f"Saved recording: {self.current_filename} "
                       f"({duration:.1f}s, {self.note_count} notes, {file_size} bytes)")
            
            # Handle favorite marking
            if self._mark_favorite_pending:
                self.metadata.set_favorite(self.current_filename, True)
                logger.info(f"Marked as favorite: {self.current_filename}")
            
        except Exception as e:
            logger.error(f"Failed to save recording: {e}")
        
        self.is_recording = False
        self.current_track = None
    
    def _seconds_to_ticks(self, seconds: float) -> int:
        """Convert seconds to MIDI ticks based on current tempo."""
        # tempo is microseconds per beat
        # ticks_per_beat is ticks per beat
        # seconds * 1_000_000 = microseconds
        # microseconds / tempo = beats
        # beats * ticks_per_beat = ticks
        if seconds < 0:
            return 0
        microseconds = seconds * 1_000_000
        beats = microseconds / self.tempo
        ticks = int(beats * self.ticks_per_beat)
        return max(0, ticks)  # Ensure non-negative
    
    def _check_favorite_combo(self) -> bool:
        """Check if all favorite keys are currently pressed within the detection window."""
        if not self.favorite_key_combo.issubset(self.active_notes):
            return False
        
        # Check that all keys were pressed within the detection window
        current_time = time.time()
        press_times = [self.favorite_detect_times.get(note, 0) for note in self.favorite_key_combo]
        
        if not press_times:
            return False
        
        earliest = min(press_times)
        latest = max(press_times)
        
        # All keys must have been pressed within the detection window
        return (latest - earliest) <= self.favorite_detection_window
    
    def _process_message(self, msg: mido.Message):
        """Process a single MIDI message."""
        current_time = time.time()
        
        # Filter out system real-time messages that don't represent actual playing
        if msg.type in ('clock', 'active_sensing', 'start', 'stop', 'continue',
                        'reset', 'songpos', 'song_select'):
            return
        
        # Check for pause/silence (only if we have held notes released)
        if self.is_recording and len(self.held_notes) == 0:
            silence_duration = current_time - self.last_event_time
            if silence_duration >= self.pause_threshold:
                logger.info(f"Pause detected ({silence_duration:.1f}s), saving recording")
                self._save_current_recording()
        
        # Start new recording if needed
        if not self.is_recording:
            # Only start on actual note events
            if msg.type == 'note_on' and hasattr(msg, 'velocity') and msg.velocity > 0:
                self._start_new_recording()
            else:
                return  # Don't start recording on non-note events
        
        # Calculate delta time in ticks
        if self.last_event_time > 0:
            delta_seconds = current_time - self.last_event_time
            # Ensure delta is non-negative (protect against timing edge cases)
            delta_seconds = max(0, delta_seconds)
            delta_ticks = self._seconds_to_ticks(delta_seconds)
        else:
            delta_ticks = 0
        
        # Track held notes
        if msg.type == 'note_on':
            if hasattr(msg, 'velocity') and msg.velocity > 0:
                self.held_notes.add(msg.note)
                self.active_notes.add(msg.note)
                self.favorite_detect_times[msg.note] = current_time
                self.note_count += 1
                
                # Check for favorite combo
                if self._check_favorite_combo():
                    self._mark_favorite_pending = True
                    logger.info("Favorite key combo detected! Will mark as favorite on save.")
            else:
                # Note-on with velocity 0 is note-off
                self.held_notes.discard(msg.note)
                self.active_notes.discard(msg.note)
                if msg.note in self.favorite_detect_times:
                    del self.favorite_detect_times[msg.note]
        
        elif msg.type == 'note_off':
            self.held_notes.discard(msg.note)
            self.active_notes.discard(msg.note)
            if msg.note in self.favorite_detect_times:
                del self.favorite_detect_times[msg.note]
        
        # Create MIDI message with delta time
        try:
            # Convert mido message to track message with timing
            midi_msg = msg.copy(time=delta_ticks)
            self.current_track.append(midi_msg)
        except Exception as e:
            logger.debug(f"Could not add message to track: {e}")
        
        self.last_event_time = current_time
    
    def start(self):
        """Start the MIDI recorder."""
        logger.info("Starting MusicPolice MIDI Recorder...")
        
        # Find MIDI device
        device_name = self._find_midi_device()
        if not device_name:
            logger.error("No MIDI input device found. Please connect your piano.")
            logger.info("Waiting for MIDI device...")
            
            # Wait for device
            while not device_name and self.running:
                time.sleep(2)
                device_name = self._find_midi_device()
            
            if not device_name:
                return
        
        # Open MIDI port
        try:
            self.input_port = mido.open_input(device_name)
            logger.info(f"Opened MIDI input: {device_name}")
        except Exception as e:
            logger.error(f"Failed to open MIDI input: {e}")
            return
        
        self.running = True
        logger.info("Recording... Press Ctrl+C to stop.")
        logger.info(f"Favorite combo: MIDI notes {sorted(self.favorite_key_combo)}")
        logger.info(f"Pause threshold: {self.pause_threshold} seconds")
        
        # Main recording loop
        try:
            while self.running:
                # Use timeout to allow checking self.running periodically
                msg = self.input_port.receive(block=True)
                if msg:
                    self._process_message(msg)
                    
        except Exception as e:
            logger.error(f"Error in recording loop: {e}")
        finally:
            self._cleanup()
    
    def stop(self):
        """Stop the recorder gracefully."""
        logger.info("Stopping recorder...")
        self.running = False
        
        # Save current recording if any
        if self.is_recording:
            self._save_current_recording()
    
    def _cleanup(self):
        """Clean up resources."""
        if self.input_port:
            try:
                self.input_port.close()
                logger.info("Closed MIDI input port")
            except Exception as e:
                logger.debug(f"Error closing port: {e}")
        
        logger.info("Recorder stopped.")


def main():
    """Main entry point."""
    # Determine config path
    config_path = "config.yaml"
    if len(sys.argv) > 1:
        config_path = sys.argv[1]
    
    # Change to script directory
    script_dir = Path(__file__).parent.absolute()
    os.chdir(script_dir)
    
    # Create and start recorder
    recorder = MidiRecorder(config_path)
    recorder.running = True  # Set before start to allow device waiting
    recorder.start()


if __name__ == "__main__":
    main()
