"""
Metadata management and practice time tracking for MusicPolice.
Handles recording index, practice statistics, and calendar data.
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import threading
import logging

logger = logging.getLogger(__name__)


class MetadataManager:
    """Manages recording metadata and practice statistics."""
    
    def __init__(self, recordings_dir: str, favorites_dir: str = "favs"):
        self.recordings_dir = Path(recordings_dir)
        self.favorites_dir = self.recordings_dir / favorites_dir
        self.index_file = self.recordings_dir / "index.json"
        self._lock = threading.Lock()
        
        # Ensure directories exist
        self.recordings_dir.mkdir(parents=True, exist_ok=True)
        self.favorites_dir.mkdir(parents=True, exist_ok=True)
        
        # Load or initialize index
        self._index = self._load_index()
    
    def _load_index(self) -> dict:
        """Load index from file or create new one."""
        if self.index_file.exists():
            try:
                with open(self.index_file, 'r') as f:
                    data = json.load(f)
                    logger.info(f"Loaded index with {len(data.get('recordings', {}))} recordings")
                    return data
            except (json.JSONDecodeError, IOError) as e:
                logger.error(f"Failed to load index: {e}, creating new one")
        
        return {
            "recordings": {},
            "version": 1,
            "created_at": datetime.now().isoformat()
        }
    
    def _save_index(self):
        """Save index to file."""
        try:
            with open(self.index_file, 'w') as f:
                json.dump(self._index, f, indent=2, default=str)
        except IOError as e:
            logger.error(f"Failed to save index: {e}")
    
    def add_recording(self, filename: str, start_time: datetime, end_time: datetime,
                      duration_seconds: float, file_size: int, note_count: int = 0) -> dict:
        """Add a new recording to the index."""
        with self._lock:
            record = {
                "filename": filename,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "duration_seconds": duration_seconds,
                "file_size": file_size,
                "note_count": note_count,
                "favorite": False,
                "date": start_time.strftime("%Y-%m-%d"),
                "created_at": datetime.now().isoformat()
            }
            
            self._index["recordings"][filename] = record
            self._save_index()
            logger.info(f"Added recording: {filename} ({duration_seconds:.1f}s, {note_count} notes)")
            return record
    
    def get_recording(self, filename: str) -> Optional[dict]:
        """Get metadata for a specific recording."""
        return self._index["recordings"].get(filename)
    
    def get_all_recordings(self) -> list:
        """Get all recordings sorted by start time (newest first)."""
        recordings = list(self._index["recordings"].values())
        recordings.sort(key=lambda x: x["start_time"], reverse=True)
        return recordings
    
    def get_favorites(self) -> list:
        """Get all favorited recordings."""
        return [r for r in self.get_all_recordings() if r.get("favorite")]
    
    def set_favorite(self, filename: str, is_favorite: bool) -> bool:
        """Set or unset favorite status for a recording."""
        with self._lock:
            if filename not in self._index["recordings"]:
                logger.warning(f"Recording not found: {filename}")
                return False
            
            self._index["recordings"][filename]["favorite"] = is_favorite
            self._save_index()
            
            # Copy or remove from favorites directory
            source = self.recordings_dir / filename
            dest = self.favorites_dir / filename
            
            try:
                if is_favorite and source.exists() and not dest.exists():
                    import shutil
                    shutil.copy2(source, dest)
                    logger.info(f"Copied to favorites: {filename}")
                elif not is_favorite and dest.exists():
                    dest.unlink()
                    logger.info(f"Removed from favorites: {filename}")
            except IOError as e:
                logger.error(f"Failed to update favorites folder: {e}")
            
            return True
    
    def toggle_favorite(self, filename: str) -> Optional[bool]:
        """Toggle favorite status and return new state."""
        if filename not in self._index["recordings"]:
            return None
        current = self._index["recordings"][filename].get("favorite", False)
        self.set_favorite(filename, not current)
        return not current
    
    def delete_recording(self, filename: str) -> bool:
        """Delete a recording and its metadata."""
        with self._lock:
            if filename not in self._index["recordings"]:
                logger.warning(f"Recording not found in index: {filename}")
                return False
            
            # Remove files
            main_file = self.recordings_dir / filename
            fav_file = self.favorites_dir / filename
            
            try:
                if main_file.exists():
                    main_file.unlink()
                if fav_file.exists():
                    fav_file.unlink()
            except IOError as e:
                logger.error(f"Failed to delete file: {e}")
                return False
            
            # Remove from index
            del self._index["recordings"][filename]
            self._save_index()
            logger.info(f"Deleted recording: {filename}")
            return True
    
    def get_recordings_by_date(self, date: str) -> list:
        """Get all recordings for a specific date (YYYY-MM-DD)."""
        return [r for r in self.get_all_recordings() if r.get("date") == date]
    
    def get_practice_time_by_date(self, date: str) -> float:
        """Get total practice time in seconds for a specific date."""
        recordings = self.get_recordings_by_date(date)
        return sum(r.get("duration_seconds", 0) for r in recordings)
    
    def get_calendar_data(self, year: int, month: int) -> dict:
        """
        Get calendar data for a month with practice duration categories.
        
        Returns dict with date keys and values containing:
        - duration_seconds: total practice time
        - duration_category: 0-4 (none, <30min, 30-60min, 1-2hr, 2hr+)
        - recording_count: number of recordings
        """
        from calendar import monthrange
        
        _, num_days = monthrange(year, month)
        calendar_data = {}
        
        for day in range(1, num_days + 1):
            date_str = f"{year:04d}-{month:02d}-{day:02d}"
            recordings = self.get_recordings_by_date(date_str)
            total_seconds = sum(r.get("duration_seconds", 0) for r in recordings)
            
            # Categorize by half-hour increments
            # 0: no practice, 1: <30min, 2: 30-60min, 3: 1-2hr, 4: 2hr+
            if total_seconds == 0:
                category = 0
            elif total_seconds < 1800:  # < 30 min
                category = 1
            elif total_seconds < 3600:  # 30-60 min
                category = 2
            elif total_seconds < 7200:  # 1-2 hr
                category = 3
            else:  # 2+ hr
                category = 4
            
            calendar_data[date_str] = {
                "duration_seconds": total_seconds,
                "duration_category": category,
                "duration_formatted": self._format_duration(total_seconds),
                "recording_count": len(recordings)
            }
        
        return calendar_data
    
    def get_practice_stats(self) -> dict:
        """Get overall practice statistics."""
        recordings = self.get_all_recordings()
        
        if not recordings:
            return {
                "total_recordings": 0,
                "total_duration_seconds": 0,
                "total_duration_formatted": "0m",
                "total_notes": 0,
                "longest_session_seconds": 0,
                "longest_session_formatted": "0m",
                "average_session_seconds": 0,
                "average_session_formatted": "0m",
                "favorite_count": 0,
                "first_recording_date": None,
                "last_recording_date": None,
                "current_streak_days": 0,
                "this_week_seconds": 0,
                "this_week_formatted": "0m",
                "this_month_seconds": 0,
                "this_month_formatted": "0m"
            }
        
        total_duration = sum(r.get("duration_seconds", 0) for r in recordings)
        total_notes = sum(r.get("note_count", 0) for r in recordings)
        durations = [r.get("duration_seconds", 0) for r in recordings]
        longest = max(durations) if durations else 0
        average = total_duration / len(recordings) if recordings else 0
        
        # Calculate streak
        today = datetime.now().date()
        streak = 0
        check_date = today
        
        while True:
            date_str = check_date.strftime("%Y-%m-%d")
            if self.get_practice_time_by_date(date_str) > 0:
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break
        
        # This week and month
        week_start = today - timedelta(days=today.weekday())
        month_start = today.replace(day=1)
        
        this_week = sum(
            r.get("duration_seconds", 0) for r in recordings
            if r.get("date") and datetime.fromisoformat(r["start_time"]).date() >= week_start
        )
        
        this_month = sum(
            r.get("duration_seconds", 0) for r in recordings
            if r.get("date") and datetime.fromisoformat(r["start_time"]).date() >= month_start
        )
        
        return {
            "total_recordings": len(recordings),
            "total_duration_seconds": total_duration,
            "total_duration_formatted": self._format_duration(total_duration),
            "total_notes": total_notes,
            "longest_session_seconds": longest,
            "longest_session_formatted": self._format_duration(longest),
            "average_session_seconds": average,
            "average_session_formatted": self._format_duration(average),
            "favorite_count": len([r for r in recordings if r.get("favorite")]),
            "first_recording_date": recordings[-1].get("date") if recordings else None,
            "last_recording_date": recordings[0].get("date") if recordings else None,
            "current_streak_days": streak,
            "this_week_seconds": this_week,
            "this_week_formatted": self._format_duration(this_week),
            "this_month_seconds": this_month,
            "this_month_formatted": self._format_duration(this_month)
        }
    
    @staticmethod
    def _format_duration(seconds: float) -> str:
        """Format duration in human-readable format."""
        if seconds < 60:
            return f"{int(seconds)}s"
        elif seconds < 3600:
            minutes = int(seconds / 60)
            secs = int(seconds % 60)
            return f"{minutes}m {secs}s" if secs > 0 else f"{minutes}m"
        else:
            hours = int(seconds / 3600)
            minutes = int((seconds % 3600) / 60)
            return f"{hours}h {minutes}m" if minutes > 0 else f"{hours}h"
    
    def sync_with_filesystem(self):
        """
        Sync index with actual files on disk.
        Adds missing files to index, removes entries for deleted files.
        """
        with self._lock:
            # Find all .mid files
            existing_files = set(f.name for f in self.recordings_dir.glob("*.mid"))
            indexed_files = set(self._index["recordings"].keys())
            
            # Remove entries for deleted files
            for filename in indexed_files - existing_files:
                logger.info(f"Removing stale index entry: {filename}")
                del self._index["recordings"][filename]
            
            # Add entries for new files (with minimal metadata)
            for filename in existing_files - indexed_files:
                filepath = self.recordings_dir / filename
                stat = filepath.stat()
                
                # Try to parse timestamp from filename
                try:
                    # Expected format: recording_YYYY-MM-DD_HHMMSS.mid
                    parts = filename.replace("recording_", "").replace(".mid", "")
                    date_str, time_str = parts.split("_")
                    start_time = datetime.strptime(f"{date_str}_{time_str}", "%Y-%m-%d_%H%M%S")
                except (ValueError, IndexError):
                    start_time = datetime.fromtimestamp(stat.st_mtime)
                
                self._index["recordings"][filename] = {
                    "filename": filename,
                    "start_time": start_time.isoformat(),
                    "end_time": start_time.isoformat(),
                    "duration_seconds": 0,  # Unknown for synced files
                    "file_size": stat.st_size,
                    "note_count": 0,
                    "favorite": (self.favorites_dir / filename).exists(),
                    "date": start_time.strftime("%Y-%m-%d"),
                    "created_at": datetime.now().isoformat(),
                    "synced": True  # Mark as synced (not recorded by this instance)
                }
                logger.info(f"Added synced file to index: {filename}")
            
            self._save_index()
