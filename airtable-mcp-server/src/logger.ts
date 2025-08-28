import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

const redact = [
	'env.AIRTABLE_API_KEY',
	'headers.authorization',
	'config.headers.Authorization',
];

export const logger = pino({
	level,
	redact,
	formatters: {
		level(label) {
			return {level: label} as any;
		},
	},
});
