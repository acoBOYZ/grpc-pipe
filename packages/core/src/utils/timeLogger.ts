// import { app } from "@waboyz/config";

const colors = {
  reset: 0,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
};

function colorizeText(text: string, colorCode: number) {
  return `\x1b[${colorCode}m${text}\x1b[0m`;
}

class TimeLogger {
  private startTimes: Map<string, [number, number]> = new Map();

  constructor(debug: boolean) {
    if (!debug) {
      this.start = () => { };
      this.logTime = () => { };
    }
  }

  start(label: string): void {
    this.startTimes.set(label, process.hrtime());
  }

  logTime(label: string): void {
    const startTime = this.startTimes.get(label);
    if (!startTime) {
      console.warn(`No start time found for label: ${label}`);
      return;
    }
    const endTime = process.hrtime(startTime);
    console.log(
      `${colorizeText(label, colors.cyan)}: ${colorizeText(
        `${endTime[0]}s`,
        colors.green
      )} ${colorizeText(`${endTime[1] / 1000000}ms`, colors.yellow)}`
    );
  }
}

export const timeLogger = new TimeLogger(true) //(app.DEBUG);