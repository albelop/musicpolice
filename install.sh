#!/bin/bash
# MusicPolice Installation Script
# Run this on your Raspberry Pi to install all dependencies

set -e

echo "======================================"
echo "  MusicPolice Installation Script"
echo "======================================"
echo ""

# Check if running on Raspberry Pi
if [[ ! -f /proc/device-tree/model ]] || ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    echo "Warning: This doesn't appear to be a Raspberry Pi."
    echo "Some steps may not work correctly."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "[1/6] Updating system packages..."
sudo apt update

echo ""
echo "[2/6] Installing system dependencies..."
sudo apt install -y \
    python3-pip \
    python3-venv \
    libasound2-dev \
    libjack-dev \
    alsa-utils

echo ""
echo "[3/6] Adding user to audio group..."
sudo usermod -a -G audio $USER
echo "Note: You may need to log out and back in for this to take effect."

echo ""
echo "[4/6] Creating virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists, skipping..."
else
    python3 -m venv venv
fi

echo ""
echo "[5/6] Installing Python dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "[6/6] Creating directories..."
mkdir -p recordings/favs

echo ""
echo "======================================"
echo "  Installation Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Connect your piano via USB MIDI"
echo ""
echo "2. Test MIDI connection:"
echo "   source venv/bin/activate"
echo "   aplaymidi -l"
echo ""
echo "3. Start the recorder manually:"
echo "   python3 recorder.py"
echo ""
echo "4. Start the web interface:"
echo "   python3 app.py"
echo ""
echo "5. Or install as system services:"
echo "   ./setup_service.sh"
echo ""
echo "Web interface will be available at:"
echo "   http://$(hostname).local:5000"
echo "   http://$(hostname -I | awk '{print $1}'):5000"
echo ""
