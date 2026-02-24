#!/bin/bash
# MusicPolice Service Setup Script
# Installs and enables systemd services for automatic startup

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVICE_DIR="/etc/systemd/system"

echo "======================================"
echo "  MusicPolice Service Setup"
echo "======================================"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "This script requires sudo privileges."
    echo "Re-running with sudo..."
    sudo "$0" "$@"
    exit $?
fi

# Get the actual user (not root when using sudo)
ACTUAL_USER=${SUDO_USER:-$USER}
ACTUAL_HOME=$(getent passwd "$ACTUAL_USER" | cut -d: -f6)

echo "Installing services for user: $ACTUAL_USER"
echo "Home directory: $ACTUAL_HOME"
echo ""

# Update service files with actual paths
echo "[1/5] Preparing service files..."
MUSICPOLICE_DIR="$ACTUAL_HOME/musicpolice"

# Create temporary service files with correct paths
sed "s|/home/pi/musicpolice|$MUSICPOLICE_DIR|g; s|User=pi|User=$ACTUAL_USER|g" \
    "$SCRIPT_DIR/musicpolice.service" > /tmp/musicpolice.service

sed "s|/home/pi/musicpolice|$MUSICPOLICE_DIR|g; s|User=pi|User=$ACTUAL_USER|g" \
    "$SCRIPT_DIR/musicpolice-web.service" > /tmp/musicpolice-web.service

echo "[2/5] Installing service files..."
cp /tmp/musicpolice.service "$SERVICE_DIR/musicpolice.service"
cp /tmp/musicpolice-web.service "$SERVICE_DIR/musicpolice-web.service"
rm /tmp/musicpolice.service /tmp/musicpolice-web.service

echo "[3/5] Reloading systemd daemon..."
systemctl daemon-reload

echo "[4/5] Enabling services..."
systemctl enable musicpolice.service
systemctl enable musicpolice-web.service

echo "[5/5] Starting services..."
systemctl start musicpolice.service
systemctl start musicpolice-web.service

echo ""
echo "======================================"
echo "  Services Installed Successfully!"
echo "======================================"
echo ""
echo "Service status:"
echo ""
systemctl status musicpolice.service --no-pager || true
echo ""
systemctl status musicpolice-web.service --no-pager || true
echo ""
echo "Useful commands:"
echo ""
echo "  View recorder logs:"
echo "    sudo journalctl -u musicpolice -f"
echo ""
echo "  View web interface logs:"
echo "    sudo journalctl -u musicpolice-web -f"
echo ""
echo "  Restart services:"
echo "    sudo systemctl restart musicpolice musicpolice-web"
echo ""
echo "  Stop services:"
echo "    sudo systemctl stop musicpolice musicpolice-web"
echo ""
echo "  Disable services:"
echo "    sudo systemctl disable musicpolice musicpolice-web"
echo ""
