import domdomegg from 'eslint-config-domdomegg';

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.ConfigFile} */
export default [
	...domdomegg,
	{
		ignores: [
			'dist/**',
			'**/*.md',
			'**/*.MD',
			'**/*.markdown',
			'**/*.env',
			'**/.env',
			'**/.env.*',
			'.github/**',
			'**/*.yml',
			'**/*.yaml',
		],
	},
	{
		files: ['src/**/*.ts'],
	},
];
