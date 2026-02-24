# MusicPolice DIY

A DIY MIDI recorder for Raspberry Pi Zero W that captures everything you play on your digital piano. Inspired by [Jamcorder](https://www.jamcorder.com/).

## Features

- **Automatic Recording**: Continuously captures all MIDI events from your piano
- **Smart Splitting**: Creates new recording files after 3+ seconds of silence
- **Favorite Marking**: Press D#7 + F#7 + G#7 (top 3 black keys) simultaneously to mark current recording as favorite
- **Piano Journal**: Web interface with calendar view showing practice history
- **Practice Statistics**: Color-coded calendar by practice duration (half-hour increments)
- **MIDI Playback**: Play recordings back through your piano's speakers
- **File Management**: Browse, download, delete, and favorite recordings via web UI

## Hardware Requirements

- Raspberry Pi Zero W (or any Raspberry Pi)
- USB OTG Hub (Pi Zero W has only one micro USB port)
- USB MIDI cable or USB connection to your digital piano
- 5V 2A power supply (recommended)
- MicroSD card (16GB+ recommended)

### Important: USB Setup for Pi Zero W

The Pi Zero W has a single micro USB OTG port. You need a **USB OTG hub** to connect both:
1. Power supply
2. MIDI device (piano)

Alternatively, if your piano provides USB bus power, you may be able to power the Pi through the piano's USB port (test carefully).

## Software Requirements

- Raspberry Pi OS Lite (Bookworm or later recommended)
- Python 3.9+
- ALSA (included in Raspberry Pi OS)

## Installation

### 1. Install System Dependencies

```bash
sudo apt update
sudo apt install -y python3-pip python3-venv libasound2-dev libjack-dev
```

### 2. Clone and Setup

```bash
cd /home/pi
git clone <your-repo-url> musicpolice
cd musicpolice

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Add User to Audio Group

```bash
sudo usermod -a -G audio $USER
# Log out and back in for this to take effect
```

### 4. Test MIDI Connection

Connect your piano via USB, then:

```bash
# List MIDI devices
aplaymidi -l

# Or using Python
python3 -c "import mido; print(mido.get_input_names())"
```

### 5. Install Services (Optional but Recommended)

```bash
chmod +x install.sh setup_service.sh
./install.sh
./setup_service.sh
```

## Usage

### Manual Start

```bash
cd /home/pi/musicpolice
source venv/bin/activate

# Start recorder (in one terminal)
python3 recorder.py

# Start web interface (in another terminal)
python3 app.py
```

### Access Web Interface

Open in your browser:
```
http://raspberrypi.local:5000
```
Or use the Pi's IP address: `http://<pi-ip-address>:5000`

### Marking Favorites

While playing (or within 3 seconds after stopping), press these three keys simultaneously:
- D#7 (MIDI note 87)
- F#7 (MIDI note 90)  
- G#7 (MIDI note 92)

These are the top 3 black keys on a standard 88-key piano.

## Configuration

Edit `config.yaml` to customize:

- `midi.pause_threshold`: Silence duration before splitting files (default: 3.0 seconds)
- `favorite.key_combo`: MIDI notes for favorite shortcut (adjust for your piano's range)
- `web.port`: Web server port (default: 5000)

## File Structure

```
musicpolice/
├── recordings/           # All MIDI recordings
│   ├── favs/            # Favorited recordings (copies)
│   └── index.json       # Metadata database
├── templates/           # HTML templates
├── static/              # CSS, JS assets
├── recorder.py          # Main MIDI recorder
├── playback.py          # MIDI playback module
├── metadata.py          # Practice tracking
├── app.py               # Flask web application
├── config.yaml          # Configuration
└── requirements.txt     # Python dependencies
```

## Troubleshooting

### MIDI device not detected

1. Check USB connection
2. Verify device appears: `lsusb`
3. Check ALSA: `aplaymidi -l`
4. Ensure user is in audio group: `groups`

### Web interface not accessible

1. Check Flask is running: `sudo systemctl status musicpolice-web`
2. Verify port is open: `sudo netstat -tlnp | grep 5000`
3. Check firewall settings

### Recording files not created

1. Check disk space: `df -h`
2. Verify write permissions: `ls -la recordings/`
3. Check logs: `sudo journalctl -u musicpolice -f`

## License

MIT License - Feel free to modify and share!

## Acknowledgments

Inspired by [Jamcorder](https://www.jamcorder.com/) by Chip Weinberger.
