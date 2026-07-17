export const PORSCHE_COLORS = [
	{ id: 'silver', label: 'Silver', swatch: '#aeb2b2' },
	{ id: 'red', label: 'Red', swatch: '#c6231d' },
	{ id: 'gold', label: 'Gold', swatch: '#b88b2e' },
	{ id: 'blue', label: 'Blue', swatch: '#454b8f' },
	{ id: 'green', label: 'Green', swatch: '#304f3d' },
	{ id: 'burgundy', label: 'Burgundy', swatch: '#562b31' },
	{ id: 'orange', label: 'Orange', swatch: '#cf5c24' },
	{ id: 'black', label: 'Black', swatch: '#252729' },
] as const;

export type PorscheColor = (typeof PORSCHE_COLORS)[number]['id'];

export const DEFAULT_PORSCHE_COLOR: PorscheColor = 'silver';
