import { describe, expect, it } from 'vitest';

import { pointDriveInput } from './point-drive';
import { createVehicleController } from './vehicle';

describe('point drive input', () => {
	it('accelerates and steers toward a side target in front of the reverse cone', () => {
		const input = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 0 },
			{ x: 8, z: 0 },
		);

		expect(input).toMatchObject({ accelerate: true, brake: false });
		expect(input.left || input.right).toBe(true);
	});

	it('brakes first then keeps reverse engaged for a target behind the car', () => {
		const input = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 12 },
			{ x: 0, z: -8 },
		);

		expect(input).toMatchObject({ accelerate: false, brake: true, left: false, right: false });
	});

	it('reverses steering direction while vehicle is moving backward', () => {
		const forward = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: 4 },
			{ x: 8, z: 8 },
		);
		const reverse = pointDriveInput(
			{ x: 0, z: 0, heading: 0, speed: -4 },
			{ x: 8, z: 8 },
		);

		expect([forward.left, forward.right]).toEqual([reverse.right, reverse.left]);
	});

	it('drives east from a north-facing start and reverses for a southern target', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		for (let frame = 0; frame < 30; frame += 1) {
			vehicle.step(0.05, pointDriveInput(vehicle.state, { x: 60, z: 0 }));
		}
		expect(vehicle.state.x).toBeGreaterThan(4);

		const beforeReverseZ = vehicle.state.z;
		for (let frame = 0; frame < 60; frame += 1) {
			vehicle.step(0.05, pointDriveInput(vehicle.state, { x: vehicle.state.x, z: -60 }));
		}
		expect(vehicle.state.z).toBeLessThan(beforeReverseZ);
	});
});
