import { describe, expect, it } from 'vitest';

import { createVehicleController } from './vehicle';

describe('vehicle controller', () => {
	it('accelerates forward and slows when braking', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });
		expect(vehicle.state.speed).toBeCloseTo(9, 4);

		vehicle.step(0.5, { accelerate: false, brake: true, left: false, right: false });
		expect(vehicle.state.speed).toBeCloseTo(2, 4);
	});

	it('steers right while moving forward', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: true });

		expect(vehicle.state.heading).toBeGreaterThan(0);
		expect(vehicle.state.x).toBeGreaterThan(0);
		expect(vehicle.state.z).toBeGreaterThan(0);
	});

	it('wraps travel inside the repeating world bounds', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		for (let second = 0; second < 10; second += 1) {
			vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });
		}

		expect(vehicle.state.z).toBeGreaterThanOrEqual(-72);
		expect(vehicle.state.z).toBeLessThan(72);
	});
});
