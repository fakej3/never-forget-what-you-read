// Centralized rate limiter for all AI API calls
// Enforces Gemini free-tier safe limits: max 12 RPM, min 5 s between calls

const MAX_RPM   = 12;
const MIN_DELAY = 5000;  // ms minimum gap between consecutive call starts
const WINDOW_MS = 60000; // rolling 1-minute window

class RateLimiter {
  constructor() {
    this._timestamps   = []; // start times of calls still inside the rolling window
    this._lastCallEnd  = 0;  // ms timestamp when the last call finished
    this._sessionTotal = 0;  // total calls made since page load
  }

  get sessionTotal()        { return this._sessionTotal; }
  get callsThisMinute()     { this._prune(); return this._timestamps.length; }
  get remainingThisMinute() { this._prune(); return Math.max(0, MAX_RPM - this._timestamps.length); }

  _prune() {
    const cutoff = Date.now() - WINDOW_MS;
    while (this._timestamps.length && this._timestamps[0] <= cutoff) {
      this._timestamps.shift();
    }
  }

  /**
   * Await before every AI request.
   * Blocks until both the minimum inter-call gap and the RPM ceiling are satisfied.
   */
  async throttle() {
    // Enforce minimum gap since the last call ended
    if (this._lastCallEnd > 0) {
      const elapsed = Date.now() - this._lastCallEnd;
      if (elapsed < MIN_DELAY) {
        await new Promise(r => setTimeout(r, MIN_DELAY - elapsed));
      }
    }

    // Enforce RPM ceiling — if window is full, wait for the oldest entry to expire
    while (true) {
      this._prune();
      if (this._timestamps.length < MAX_RPM) break;
      const waitMs = this._timestamps[0] + WINDOW_MS - Date.now() + 100;
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    }

    this._timestamps.push(Date.now());
    this._sessionTotal++;
  }

  /** Call immediately after each AI call completes or errors. */
  markEnd() {
    this._lastCallEnd = Date.now();
  }
}

export const rateLimiter = new RateLimiter();
