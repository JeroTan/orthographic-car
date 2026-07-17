import { describe, expect, it } from 'vitest';

import { createVehicleController } from './vehicle';

describe('vehicle controller', () => {
	function screenX(vehicle: ReturnType<typeof createVehicleController>): number {
		// Camera sits at +X/-Z, so screen-right points toward -X/-Z.
		return -(vehicle.state.x + vehicle.state.z);
	}

	it('accelerates forward and slows when braking', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });
		expect(vehicle.state.speed).toBeCloseTo(9, 4);

		vehicle.step(0.5, { accelerate: false, brake: true, left: false, right: false });
		expect(vehicle.state.speed).toBeCloseTo(2, 4);
	});

	it('steers toward the pressed side in the orthographic view', () => {
		const straight = createVehicleController({ worldSpan: 144 });
		const right = createVehicleController({ worldSpan: 144 });
		const left = createVehicleController({ worldSpan: 144 });

		straight.step(1, { accelerate: true, brake: false, left: false, right: false });
		right.step(1, { accelerate: true, brake: false, left: false, right: true });
		left.step(1, { accelerate: true, brake: false, left: true, right: false });

		expect(screenX(right)).toBeGreaterThan(screenX(straight));
		expect(screenX(left)).toBeLessThan(screenX(straight));
	});

	it('reverses when brake remains held after stopping', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });
		vehicle.step(1, { accelerate: false, brake: true, left: false, right: false });
		const stoppedAtZ = vehicle.state.z;
		vehicle.step(1, { accelerate: false, brake: true, left: false, right: false });

		expect(vehicle.state.speed).toBeLessThan(0);
		expect(vehicle.state.z).toBeLessThan(stoppedAtZ);
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
