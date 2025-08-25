// Simple E2E smoke: verify AIRTABLE_API_KEY works by listing bases
// Usage: AIRTABLE_API_KEY=pat... node scripts/smoke.mjs

async function main() {
	const token = process.env.AIRTABLE_API_KEY;
	if (!token) {
		console.error('AIRTABLE_API_KEY is required');
		process.exit(1);
	}

	const res = await fetch('https://api.airtable.com/v0/meta/bases', {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		console.error(`Smoke failed: ${res.status} ${res.statusText} — ${text}`);
		process.exit(2);
	}

	const data = await res.json();
	const count = Array.isArray(data?.bases) ? data.bases.length : 0;
	console.log(`Smoke OK: accessible bases = ${count}`);
}

main().catch((err) => {
	console.error('Smoke errored:', err);
	process.exit(3);
});
