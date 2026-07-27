import { describe, expect, it } from 'vitest';

import { resolveVehicleImpact } from './vehicle-impact';

describe('vehicle impact resolver', () => {
	it('slows player and launches lighter traffic away after a head-on hit', () => {
		const impact = resolveVehicleImpact(
			{
				x: 0,
				z: 0,
				velocityX: 0,
				velocityZ: 18,
				radius: 1.2,
				mass: 1.55,
			},
			{
				x: 0,
				z: 1.7,
				velocityX: 0,
				velocityZ: 0,
				radius: 1,
				mass: 0.72,
			},
			144,
		);

		expect(impact).toBeDefined();
		expect(impact?.first.velocityZ).toBeLessThan(18);
		expect(impact?.second.velocityZ).toBeGreaterThan(0);
		expect(impact?.first.correctionZ).toBeLessThan(0);
		expect(impact?.second.correctionZ).toBeGreaterThan(0);
		expect(impact?.intensity).toBeGreaterThan(0);
	});

	it('applies equal and opposite impulse across unequal masses', () => {
		const firstMass = 1.55;
		const secondMass = 0.72;
		const impact = resolveVehicleImpact(
			{
				x: 0,
				z: 0,
				velocityX: 0,
				velocityZ: 28,
				radius: 1.2,
				mass: firstMass,
			},
			{
				x: 0,
				z: 1.8,
				velocityX: 0,
				velocityZ: 0,
				radius: 1,
				mass: secondMass,
			},
			144,
		);

		expect(impact).toBeDefined();
		expect(
			firstMass * (impact?.first.velocityZ ?? 0) +
				secondMass * (impact?.second.velocityZ ?? 0),
		).toBeCloseTo(0, 8);
	});
});
