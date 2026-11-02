// Shared constants and the shape of a parsed game.

/** Bump when parser output changes so stored raw logs can be re-parsed. */
export const PARSER_VERSION = 1;

export const SIDES = ['p1', 'p2'];

/**
 * Parsed game (output of LogParser.finalize):
 * {
 *   parserVersion, complete,            // complete: a |win| or |tie| was seen
 *   format, gen, gametype, rated,       // from |tier| / |gen| / |gametype| / |rated|
 *   players: {p1:{name,id,rating,avatar}, p2:{...}},
 *   bo3: null | {bestOf, wrapperId, gameNumber, score:{p1,p2}},   // score = wins before this game (null if unknown)
 *   teamSize: {p1,p2},
 *   roster: {p1:[{species,level,gender,shiny,uncertain,inferred}], p2:[...]},   // preview, resolved by switches/showteam
 *   teams:  {p1:[{species,item,ability,moves,nature,gender,level}], p2:[...]},  // |showteam| (open team sheets)
 *   picks:  {p1:[species], p2:[species]},   // distinct species switched in, in order
 *   leads:  {p1:[species], p2:[species]},   // first two distinct switch-ins
 *   mega:   {p1:[{species,forme,stone}], p2:[...]},
 *   tera:   {p1:[{species,type}], p2:[...]},
 *   moves:  {p1:{species:{move:count}}, p2:{...}},
 *   turns, winner: null | {side,name}, tie,
 *   end: 'win' | 'forfeit' | 'inactivity' | 'tie' | 'incomplete', forfeiter: null | side,
 *   ratings: {p1: null | {name,before,after}, p2: ...},
 *   warnings: [string]
 * }
 * With a perspective, parseLog adds {me, side, opp, result: 'win'|'loss'|'tie'|null, sideVia}.
 */
export function newParsedGame() {
	return {
		parserVersion: PARSER_VERSION,
		complete: false,
		format: '',
		gen: 0,
		gametype: '',
		rated: false,
		players: { p1: null, p2: null },
		bo3: null,
		teamSize: { p1: 0, p2: 0 },
		roster: { p1: [], p2: [] },
		teams: { p1: [], p2: [] },
		picks: { p1: [], p2: [] },
		leads: { p1: [], p2: [] },
		mega: { p1: [], p2: [] },
		tera: { p1: [], p2: [] },
		moves: { p1: {}, p2: {} },
		turns: 0,
		winner: null,
		tie: false,
		end: 'incomplete',
		forfeiter: null,
		ratings: { p1: null, p2: null },
		warnings: [],
	};
}
