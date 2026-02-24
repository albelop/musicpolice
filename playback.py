#!/usr/bin/env python3
"""
MIDI Playback Module for MusicPolice

Handles playing back recorded MIDI files through the piano's speakers.
"""

import logging
import threading
import time
from pathlib import Path
from typing import Optional, Callable
from enum import Enum

import mido
from mido import MidiFile

logger = logging.getLogger(__name__)


class PlaybackState(Enum):
    """Playback state enumeration."""
    STOPPED = "stopped"
    PLAYING = "playing"
    PAUSED = "paused"


class MidiPlayer:
    """
    MIDI file player that plays recordings back through a MIDI output device.
    Supports play, pause, stop, and seeking.
    """
    
    def __init__(self, recordings_dir: str = "recordings"):
        self.recordings_dir = Path(recordings_dir)
        
        # Playback state
        self._state = PlaybackState.STOPPED
        self._current_file: Optional[str] = None
        self._output_port: Optional[mido.ports.BaseOutput] = None
        self._playback_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._lock = threading.Lock()
        
        # Progress tracking
        self._current_position = 0.0  # seconds
        self._total_duration = 0.0  # seconds
        
        # Callback for state changes
        self._on_state_change: Optional[Callable] = None
        self._on_progress: Optional[Callable] = None
    
    @property
    def state(self) -> PlaybackState:
        """Get current playback state."""
        return self._state
    
    @property
    def current_file(self) -> Optional[str]:
        """Get currently playing file."""
        return self._current_file
    
    @property
    def position(self) -> float:
        """Get current position in seconds."""
        return self._current_position
    
    @property
    def duration(self) -> float:
        """Get total duration in seconds."""
        return self._total_duration
    
    def set_state_callback(self, callback: Callable):
        """Set callback for state changes."""
        self._on_state_change = callback
    
    def set_progress_callback(self, callback: Callable):
        """Set callback for progress updates."""
        self._on_progress = callback
    
    def _notify_state_change(self):
        """Notify listeners of state change."""
        if self._on_state_change:
            try:
                self._on_state_change(self._state, self._current_file)
            except Exception as e:
                logger.debug(f"State callback error: {e}")
    
    def _find_output_device(self) -> Optional[str]:
        """Find and return the name of an available MIDI output device."""
        try:
            available = mido.get_output_names()
            logger.info(f"Available MIDI outputs: {available}")
            
            if not available:
                return None
            
            # Return first available
            return available[0]
            
        except Exception as e:
            logger.error(f"Error finding MIDI output: {e}")
            return None
    
    def _send_all_notes_off(self):
        """Send all notes off to prevent stuck notes."""
        if self._output_port is None:
            return
        
        try:
            # Send note off for all notes on all channels
            for channel in range(16):
                # Control change 123 = All Notes Off
                msg = mido.Message('control_change', channel=channel, control=123, value=0)
                self._output_port.send(msg)
                
                # Also send CC 64 (sustain pedal) off
                msg = mido.Message('control_change', channel=channel, control=64, value=0)
                self._output_port.send(msg)
        except Exception as e:
            logger.debug(f"Error sending all notes off: {e}")
    
    def _playback_worker(self, filepath: Path):
        """Worker thread for playback."""
        try:
            mid = MidiFile(str(filepath))
            self._total_duration = mid.length  # Total duration in seconds
            self._current_position = 0.0
            
            logger.info(f"Playing: {filepath.name} ({self._total_duration:.1f}s)")
            
            start_time = time.time()
            
            for msg in mid.play():
                # Check for stop
                if self._stop_event.is_set():
                    logger.info("Playback stopped by user")
                    break
                
                # Handle pause
                while self._pause_event.is_set() and not self._stop_event.is_set():
                    time.sleep(0.1)
                
                if self._stop_event.is_set():
                    break
                
                # Send message
                if not msg.is_meta and self._output_port:
                    try:
                        self._output_port.send(msg)
                    except Exception as e:
                        logger.debug(f"Error sending message: {e}")
                
                # Update position
                self._current_position = time.time() - start_time
                
                # Progress callback
                if self._on_progress:
                    try:
                        self._on_progress(self._current_position, self._total_duration)
                    except Exception:
                        pass
            
            logger.info("Playback finished")
            
        except Exception as e:
            logger.error(f"Playback error: {e}")
        
        finally:
            self._send_all_notes_off()
            
            with self._lock:
                self._state = PlaybackState.STOPPED
                self._current_file = None
            
            self._notify_state_change()
    
    def play(self, filename: str) -> bool:
        """
        Start playing a MIDI file.
        
        Args:
            filename: Name of the file in recordings directory
            
        Returns:
            True if playback started, False otherwise
        """
        with self._lock:
            # Stop any current playback
            if self._state != PlaybackState.STOPPED:
                self._stop_internal()
            
            # Find file
            filepath = self.recordings_dir / filename
            if not filepath.exists():
                # Check favorites folder
                filepath = self.recordings_dir / "favs" / filename
                if not filepath.exists():
                    logger.error(f"File not found: {filename}")
                    return False
            
            # Open output port
            device_name = self._find_output_device()
            if not device_name:
                logger.error("No MIDI output device found")
                return False
            
            try:
                self._output_port = mido.open_output(device_name)
                logger.info(f"Opened MIDI output: {device_name}")
            except Exception as e:
                logger.error(f"Failed to open MIDI output: {e}")
                return False
            
            # Start playback thread
            self._stop_event.clear()
            self._pause_event.clear()
            self._current_file = filename
            self._state = PlaybackState.PLAYING
            
            self._playback_thread = threading.Thread(
                target=self._playback_worker,
                args=(filepath,),
                daemon=True
            )
            self._playback_thread.start()
            
            self._notify_state_change()
            return True
    
    def _stop_internal(self):
        """Internal stop without lock."""
        self._stop_event.set()
        self._pause_event.clear()
        
        if self._playback_thread and self._playback_thread.is_alive():
            self._playback_thread.join(timeout=2.0)
        
        self._send_all_notes_off()
        
        if self._output_port:
            try:
                self._output_port.close()
            except Exception:
                pass
            self._output_port = None
        
        self._state = PlaybackState.STOPPED
        self._current_file = None
    
    def stop(self) -> bool:
        """Stop playback."""
        with self._lock:
            if self._state == PlaybackState.STOPPED:
                return True
            
            self._stop_internal()
            self._notify_state_change()
            return True
    
    def pause(self) -> bool:
        """Pause playback."""
        with self._lock:
            if self._state != PlaybackState.PLAYING:
                return False
            
            self._pause_event.set()
            self._state = PlaybackState.PAUSED
            self._notify_state_change()
            return True
    
    def resume(self) -> bool:
        """Resume paused playback."""
        with self._lock:
            if self._state != PlaybackState.PAUSED:
                return False
            
            self._pause_event.clear()
            self._state = PlaybackState.PLAYING
            self._notify_state_change()
            return True
    
    def toggle_pause(self) -> PlaybackState:
        """Toggle between playing and paused states."""
        with self._lock:
            if self._state == PlaybackState.PLAYING:
                self._pause_event.set()
                self._state = PlaybackState.PAUSED
            elif self._state == PlaybackState.PAUSED:
                self._pause_event.clear()
                self._state = PlaybackState.PLAYING
            
            self._notify_state_change()
            return self._state
    
    def get_status(self) -> dict:
        """Get current playback status."""
        return {
            "state": self._state.value,
            "current_file": self._current_file,
            "position": self._current_position,
            "duration": self._total_duration,
            "progress": (self._current_position / self._total_duration * 100) 
                       if self._total_duration > 0 else 0
        }
    
    def cleanup(self):
        """Clean up resources."""
        self.stop()


# Global player instance for use by web app
_player: Optional[MidiPlayer] = None


def get_player(recordings_dir: str = "recordings") -> MidiPlayer:
    """Get or create the global player instance."""
    global _player
    if _player is None:
        _player = MidiPlayer(recordings_dir)
    return _player
