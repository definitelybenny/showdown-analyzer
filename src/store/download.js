// Browser-only helper, kept apart from the pure export logic.

/** Offer `obj` as a JSON file download. */
export function downloadJson(filename, obj) {
	const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
