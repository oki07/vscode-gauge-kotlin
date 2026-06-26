"use strict";

class LineBuffer {
  constructor() {
    this.buffer = "";
    this.lineListeners = [];
    this.doneListeners = [];
  }

  append(chunk) {
    this.buffer += String(chunk);
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index === -1) {
        break;
      }

      this.fireLine(this.buffer.substring(0, index));
      this.buffer = this.buffer.substring(index + 1);
    }
  }

  done() {
    this.fireDone(this.buffer !== "" ? this.buffer : null);
  }

  fireLine(line) {
    for (const listener of this.lineListeners) {
      listener(line);
    }
  }

  fireDone(last) {
    for (const listener of this.doneListeners) {
      listener(last);
    }
  }

  onLine(listener) {
    this.lineListeners.push(listener);
  }

  onDone(listener) {
    this.doneListeners.push(listener);
  }
}

module.exports = {
  LineBuffer,
};
