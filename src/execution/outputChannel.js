"use strict";

const nodePath = require("node:path");
const { LineBuffer } = require("./lineBuffer");
const { createUtf8Emitter } = require("./utf8Emitter");

class OutputChannel {
  constructor(outputChannel, initial, projectRoot, options = {}) {
    this.channel = outputChannel;
    this.projectRoot = projectRoot;
    this.pathModule = options.pathModule || nodePath;
    this.outBuffer = new LineBuffer();
    this.errBuffer = new LineBuffer();
    this.outDecoder = createUtf8Emitter(text => this.outBuffer.append(text));
    this.errDecoder = createUtf8Emitter(text => this.errBuffer.append(text));

    this.channel.clear();
    this.channel.appendLine(initial);
    if (options.reveal === true && typeof this.channel.show === "function") {
      this.channel.show(true);
    }
    this.outBuffer.onLine((line) => this.channel.appendLine(this.absolutizeOutputPaths(line)));
    this.outBuffer.onDone((last) => {
      if (last) {
        this.channel.appendLine(this.absolutizeOutputPaths(last));
      }
    });
    this.errBuffer.onLine((line) => this.channel.appendLine(line));
    this.errBuffer.onDone((last) => {
      if (last) {
        this.channel.appendLine(last);
      }
    });
  }

  absolutizeOutputPaths(line) {
    const markers = [/Specification: /, /at Object\.<anonymous>\s*\(/];
    const lines = line.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      for (const marker of markers) {
        const match = lines[index].match(marker);
        if (match && this.projectRoot) {
          const outputPath = lines[index].slice(match.index + match[0].length);
          if (this.pathModule.isAbsolute(outputPath)
              || outputPath.startsWith(`${this.projectRoot}${this.pathModule.sep}`)) {
            continue;
          }
          lines[index] = lines[index].replace(
            match[0],
            `${match[0]}${this.projectRoot}${this.pathModule.sep}`,
          );
        }
      }
    }

    return lines.join("\n");
  }

  appendOutBuf(line) {
    this.outDecoder.write(line);
  }

  appendErrBuf(line) {
    this.errDecoder.write(line);
  }

  onFinish(resolve, code, successMessage, failureMessage, aborted) {
    this.outDecoder.finish();
    this.errDecoder.finish();
    this.outBuffer.done();
    this.errBuffer.done();

    if (aborted) {
      this.channel.appendLine("Run stopped by user.");
      resolve(false);
      return;
    }

    const passed = code === 0;
    this.channel.appendLine(passed ? successMessage : failureMessage);
    resolve(passed);
  }
}

module.exports = {
  OutputChannel,
};
