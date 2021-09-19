/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */


const { GObject, St, Clutter, GLib, Gio } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const ByteArray = imports.byteArray;

// Refresh interval in second
const refreshInterval = 1;

const netSpeedUnits = [
    'B/s', 'K/s', 'M/s', 'G/s', 'T/s', 'P/s', 'E/s', 'Z/s', 'Y/s'
];

let lastTotalNetDownBytes = 0;
let lastTotalNetUpBytes = 0;

let lastCPUUsed = 0;
let lastCPUTotal = 0;

// See <https://github.com/AlynxZhou/gnome-shell-extension-net-speed>.
const getCurrentNetSpeed = (refreshInterval) => {
    const netSpeed = { 'down': 0, 'up': 0 };

    try {
        const inputFile = Gio.File.new_for_path('/proc/net/dev');
        const fileInputStream = inputFile.read(null);
        // See <https://gjs.guide/guides/gobject/basics.html#gobject-construction>.
        // If we want new operator, we need to pass params in object.
        // Short param is only used for static constructor.
        const dataInputStream = new Gio.DataInputStream({
            'base_stream': fileInputStream
        });

        // Caculate the sum of all interfaces' traffic line by line.
        let totalDownBytes = 0;
        let totalUpBytes = 0;
        let line = null;
        // See <https://gjs-docs.gnome.org/gio20~2.66p/gio.datainputstream#method-read_line>.
        while ((line = dataInputStream.read_line(null)) != null) {
            // See <https://github.com/GNOME/gjs/blob/master/doc/ByteArray.md#tostringauint8array-encodingstringstring>.
            // It seems Uint8Array is only returned at the first time.
            if (line instanceof Uint8Array) {
                line = ByteArray.toString(line).trim();
            } else {
                line = line.toString().trim();
            }
            const fields = line.split(/\W+/);
            if (fields.length <= 2) {
                break;
            }

            // Skip virtual interfaces.
            const interface = fields[0];
            const currentInterfaceDownBytes = Number.parseInt(fields[1]);
            const currentInterfaceUpBytes = Number.parseInt(fields[9]);
            if (interface == 'lo' ||
                // Created by python-based bandwidth manager "traffictoll".
                interface.match(/^ifb[0-9]+/) ||
                // Created by lxd container manager.
                interface.match(/^lxdbr[0-9]+/) ||
                interface.match(/^virbr[0-9]+/) ||
                interface.match(/^br[0-9]+/) ||
                interface.match(/^vnet[0-9]+/) ||
                interface.match(/^tun[0-9]+/) ||
                interface.match(/^tap[0-9]+/) ||
                isNaN(currentInterfaceDownBytes) ||
                isNaN(currentInterfaceUpBytes)) {
                continue;
            }

            totalDownBytes += currentInterfaceDownBytes;
            totalUpBytes += currentInterfaceUpBytes;
        }

        fileInputStream.close(null);

        if (lastTotalNetDownBytes === 0) {
            lastTotalNetDownBytes = totalDownBytes;
        }
        if (lastTotalNetUpBytes === 0) {
            lastTotalNetUpBytes = totalUpBytes;
        }

        netSpeed['down'] = (totalDownBytes - lastTotalNetDownBytes) / refreshInterval;
        netSpeed['up'] = (totalUpBytes - lastTotalNetUpBytes) / refreshInterval;

        lastTotalNetDownBytes = totalDownBytes;
        lastTotalNetUpBytes = totalUpBytes;
    } catch (e) {
        logError(e);
    }

    return netSpeed;
};

// See <https://stackoverflow.com/a/9229580>.
const getCurrentCPUUsage = () => {
    let currentCPUUsage = 0;

    try {
        const inputFile = Gio.File.new_for_path('/proc/stat');
        const fileInputStream = inputFile.read(null);
        const dataInputStream = new Gio.DataInputStream({
            'base_stream': fileInputStream
        });

        let currentCPUUsed = 0;
        let currentCPUTotal = 0;
        let line = null;

        while ((line = dataInputStream.read_line(null)) != null) {
            if (line instanceof Uint8Array) {
                line = ByteArray.toString(line).trim();
            } else {
                line = line.toString().trim();
            }

            const fields = line.split(/\W+/);

            if (fields.length < 2) {
                continue;
            }

            const itemName = fields[0];
            if (itemName == 'cpu' && fields.length >= 5) {
                const user = Number.parseInt(fields[1]);
                const system = Number.parseInt(fields[3]);
                const idle = Number.parseInt(fields[4]);
                currentCPUUsed = user + system;
                currentCPUTotal = user + system + idle;
                break;
            }
        }

        fileInputStream.close(null);

        // Avoid divide by zero
        if (currentCPUTotal - lastCPUTotal !== 0) {
            currentCPUUsage = (currentCPUUsed - lastCPUUsed) / (currentCPUTotal - lastCPUTotal);
        }

        lastCPUTotal = currentCPUTotal;
        lastCPUUsed = currentCPUUsed;
    } catch (e) {
        logError(e);
    }
    return currentCPUUsage;
}

const getCurrentMemoryUsage = () => {
    let currentMemoryUsage = 0;

    try {
        const inputFile = Gio.File.new_for_path('/proc/meminfo');
        const fileInputStream = inputFile.read(null);
        const dataInputStream = new Gio.DataInputStream({
            'base_stream': fileInputStream
        });

        let memTotal = -1;
        let memAvailable = -1;

        let line = null;
        while ((line = dataInputStream.read_line(null)) != null) {
            if (line instanceof Uint8Array) {
                line = ByteArray.toString(line).trim();
            } else {
                line = line.toString().trim();
            }

            const fields = line.split(/\W+/);

            if (fields.length < 2) {
                break;
            }

            const itemName = fields[0];
            const itemValue = Number.parseInt(fields[1]);

            if (itemName == 'MemTotal') {
                memTotal = itemValue;
            }

            if (itemName == 'MemAvailable') {
                memAvailable = itemValue;
            }
            
            if (memTotal !== -1 && memAvailable !== -1) {
                break;
            }
        }

        fileInputStream.close(null);

        if (memTotal !== -1 && memAvailable !== -1) {
            const memUsed = memTotal - memAvailable;
            currentMemoryUsage = memUsed / memTotal;
        }
    } catch (e) {
        logError(e);
    }
    return currentMemoryUsage;
}

const formatNetSpeedWithUnit = (amount) => {
    let unitIndex = 0;
    while (amount >= 1000 && unitIndex < netSpeedUnits.length - 1) {
        amount /= 1000;
        ++unitIndex;
    }

    let digits = 0;
    // Instead of showing 0.00123456 as 0.00, show it as 0.
    if (amount >= 100 || amount - 0 < 0.01) {
        // 100 M/s, 200 K/s, 300 B/s.
        digits = 0;
    } else if (amount >= 10) {
        // 10.1 M/s, 20.2 K/s, 30.3 B/s.
        digits = 1;
    } else {
        // 1.01 M/s, 2.02 K/s, 3.03 B/s.
        digits = 2;
    }

    // See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed>.
    return `${amount.toFixed(digits)} ${netSpeedUnits[unitIndex]}`;
};

const toDisplayString = (cpuUsage, memoryUsage, netSpeed) => {
    return `U ${Math.round(cpuUsage * 100)}% M ${Math.round(memoryUsage * 100)}% ↓ ${formatNetSpeedWithUnit(netSpeed['down'])} ↑ ${formatNetSpeedWithUnit(netSpeed['up'])}`;
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'Simple System Monitor', true);

            this._label = new St.Label({
                'y_align': Clutter.ActorAlign.CENTER,
                'text': 'Initialization',
                'style_class': 'label'
            });

            this.add_child(this._label);
        }

        setText(text) {
            return this._label.set_text(text);
        }
    });



class Extension {
    constructor(uuid) {
        this._uuid = uuid;
    }

    enable() {
        lastTotalNetDownBytes = 0;
        lastTotalNetUpBytes = 0;

        lastCPUUsed = 0;
        lastCPUTotal = 0;

        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator, 0, 'right');

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, refreshInterval, () => {
                const currentMemoryUsage = getCurrentMemoryUsage();
                const currentNetSpeed = getCurrentNetSpeed(refreshInterval);
                const currentCPUUsage = getCurrentCPUUsage(refreshInterval);
                const displayText = toDisplayString(currentCPUUsage, currentMemoryUsage, currentNetSpeed);
                this._indicator.setText(displayText);
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    disable() {
        if (this._indicator != null) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._timeout != null) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}