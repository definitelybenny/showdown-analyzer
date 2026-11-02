// Per-room capture state machine: collects one battle room's protocol lines, feeds the streaming parser,
// tracks the user's `|request|` data, and asks the controller to persist the game when it is over.
import { LogParser } from '../core/parser.js';
import { backfillLog } from './backfill.js';
import { applyRequest, buildGame, readRequest } from './record.js';

const RATING_LINE = /^\|raw\|.*'s rating: \d+ &rarr;/;

/**
 * ctx: {
 *   dex, now(), settleMs, getMe(): string, getMyTeams(): [], getBattleLog(roomid), fetchFn,
 *   commit(session, built): Promise<void>   // persists {record, teams}
 *   changed(): void, log(message): void
 * }
 * states: live -> settling (|win| seen) -> saved | unsaved (no user name) | skipped (not the user's game)
 */
export class Session {
	constructor(roomid, ctx) {
		this.roomid = roomid;
		this.ctx = ctx;
		this.startedAt = ctx.now();
		this.state = 'live';
		this.closed = false;
		this.backfilled = '';
		this.backfillTried = false;
		this.backfillP = null;
		this.saved = false;
		this.timer = null;
		this.chain = Promise.resolve();
		this.reset();
	}

	/** Start over from an empty log (a fresh `|init|` dump on rejoin replaces everything already seen). */
	reset() {
		this.lines = [];
		this.parser = new LogParser({ dex: this.ctx.dex });
		this.sawStart = false;
		this.req = { side: null, preview: null, maxChosen: 0, chosen: null };
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.state !== 'saved') this.state = 'live';
	}

	get complete() {
		return this.parser.g.complete;
	}

	get partial() {
		return !this.sawStart && !this.backfilled;
	}

	/** Summary for the status view. */
	info() {
		const g = this.parser.g;
		const names = [g.players.p1 && g.players.p1.name, g.players.p2 && g.players.p2.name].filter(Boolean);
		return { roomid: this.roomid, state: this.state, players: names, format: g.format, turn: g.turns, partial: this.partial };
	}

	feed(lines) {
		let ended = false;
		let lateRating = false;
		for (const line of lines) {
			if (typeof line !== 'string' || line.charAt(0) !== '|') continue;
			if (line.indexOf('|init|') === 0 || (this.complete && (line === '|clearpoke' || line === '|start'))) {
				if (this.lines.length) this.reset();
				if (line.indexOf('|init|') === 0) continue;
			}
			if (line.indexOf('|title|') === 0) continue;
			if (line.indexOf('|deinit') === 0) {
				this.close();
				continue;
			}
			if (line.indexOf('|request|') === 0) {
				applyRequest(this.req, readRequest(line.slice(9)));
				continue;
			}
			const wasComplete = this.complete;
			if (line === '|clearpoke' || line === '|start') this.sawStart = true;
			this.lines.push(line);
			this.parser.feed(line);
			if (!wasComplete && this.complete) ended = true;
			if (this.saved && RATING_LINE.test(line)) lateRating = true;
		}
		if (ended) this.onEnded();
		else if (lateRating) this.schedule(0);
		this.ctx.changed();
	}

	onEnded() {
		this.state = this.saved ? 'saved' : 'settling';
		const g = this.parser.g;
		const rated = g.ratings.p1 && g.ratings.p2;
		this.schedule(rated ? 0 : this.ctx.settleMs);
	}

	schedule(ms) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.flush();
		}, ms);
		if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
	}

	/** The room closed: write whatever we have if the game ended. */
	close() {
		if (this.closed) return this.chain;
		this.closed = true;
		return this.flush();
	}

	dispose() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/** Persist the current state of a finished game (idempotent: the record is keyed by room id). */
	flush() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.chain = this.chain.then(() => this.write()).catch(err => this.ctx.log(`capture failed for ${this.roomid}: ${err && err.message}`, err));
		return this.chain;
	}

	async write() {
		if (!this.complete) return;
		const me = this.ctx.getMe();
		if (!me) {
			this.state = 'unsaved';
			this.ctx.changed();
			return;
		}
		const built = buildGame({
			roomid: this.roomid,
			lines: this.lines,
			me,
			dex: this.ctx.dex,
			req: this.req,
			myTeams: this.ctx.getMyTeams(),
			ts: this.startedAt,
			partial: this.partial,
			backfill: this.backfilled,
		});
		if (built.skip) {
			this.state = 'skipped';
			this.ctx.changed();
			return;
		}
		await this.ctx.commit(this, built);
		this.saved = true;
		this.state = 'saved';
		this.ctx.changed();
		if (built.record.partial) this.startBackfill();
	}

	/** Non-blocking: recover the full log of a late-joined game, then rewrite the record. */
	startBackfill() {
		if (this.backfillTried) return;
		this.backfillTried = true;
		this.backfillP = backfillLog({ roomid: this.roomid, getBattleLog: this.ctx.getBattleLog, fetchFn: this.ctx.fetchFn, log: this.ctx.log })
			.then(res => {
				if (!res) return;
				this.applyBackfill(res);
				return this.flush();
			})
			.catch(err => this.ctx.log(`backfill failed for ${this.roomid}: ${err && err.message}`, err));
	}

	/** Resolves when queued writes and any running backfill have finished. */
	async idle() {
		await this.chain;
		if (this.backfillP) await this.backfillP;
		await this.chain;
	}

	applyBackfill({ lines, source }) {
		const merged = lines.slice();
		const winAt = this.lines.findIndex(l => /^\|(win|tie)\b/.test(l));
		if (!merged.some(l => /^\|(win|tie)\b/.test(l)) && winAt >= 0) merged.push(...this.lines.slice(winAt));
		else for (const l of this.lines) if (RATING_LINE.test(l) && !merged.includes(l)) merged.push(l);
		this.lines = merged.filter(l => l.indexOf('|request|') !== 0);
		this.parser = new LogParser({ dex: this.ctx.dex });
		this.parser.feed(this.lines.join('\n'));
		this.backfilled = source;
		this.sawStart = true;
	}
}
