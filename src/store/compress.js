// Raw-log compression (gzip via CompressionStream when available) and base64 helpers. No DOM access.

export function canCompress() {
	return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';
}

async function pipe(bytes, transform) {
	const stream = new Blob([bytes]).stream().pipeThrough(transform);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns {Promise<{data: Uint8Array|string, enc: 'gzip'|'plain'}>} plain string fallback when gzip is unavailable */
export async function compressText(text) {
	const str = String(text == null ? '' : text);
	if (!canCompress()) return { data: str, enc: 'plain' };
	try {
		return { data: await pipe(new TextEncoder().encode(str), new CompressionStream('gzip')), enc: 'gzip' };
	} catch (e) {
		return { data: str, enc: 'plain' };
	}
}

/** Inverse of compressText. Throws if gzip data is stored but cannot be decompressed here. */
export async function decompressText(data, enc) {
	if (enc !== 'gzip') return String(data == null ? '' : data);
	if (!canCompress()) throw new Error('Stored log is gzip-compressed but DecompressionStream is unavailable');
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
}

export function bytesToBase64(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

export function base64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
