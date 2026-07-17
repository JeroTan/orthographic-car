import { describe, expect, it } from 'vitest';

import { createVehicleController, toSpeedometerKmh } from './vehicle';
import { createCollisionIndex, createTerrainIndex } from './world';

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

	it('shows reverse motion as positive speedometer speed', () => {
		expect([toSpeedometerKmh(12), toSpeedometerKmh(-12)]).toEqual([62, 62]);
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

	it('does not pass through solid scenery', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			props: [{ kind: 'tree' as const, x: 0, z: 6, rotation: 0, scale: 1 }],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			collision: createCollisionIndex(world),
		});

		for (let frame = 0; frame < 30; frame += 1) {
			vehicle.step(0.05, { accelerate: true, brake: false, left: false, right: false });
		}

		expect(vehicle.state.z).toBeLessThan(6);
	});

	it('reaches a lower top speed on meadow than on road', () => {
		const roadWorld = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: Array.from({ length: 18 }, (_, z) => ({ x: 9, z })),
			props: [],
		};
		const road = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex(roadWorld),
		});
		const meadow = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex({ ...roadWorld, roads: [] }),
		});

		for (let frame = 0; frame < 200; frame += 1) {
			const input = { accelerate: true, brake: false, left: false, right: false };
			road.step(0.05, input);
			meadow.step(0.05, input);
		}

		expect([road.state.speed, meadow.state.speed]).toEqual([26, 14]);
	});

	it('accelerates more slowly on meadow than on road', () => {
		const roadWorld = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: Array.from({ length: 18 }, (_, z) => ({ x: 9, z })),
			props: [],
		};
		const road = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex(roadWorld),
		});
		const meadow = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex({ ...roadWorld, roads: [] }),
		});

		for (let frame = 0; frame < 20; frame += 1) {
			const input = { accelerate: true, brake: false, left: false, right: false };
			road.step(0.05, input);
			meadow.step(0.05, input);
		}

		expect(road.state.speed).toBeCloseTo(9, 6);
		expect(meadow.state.speed).toBeCloseTo(6, 6);
	});

	it('pushes through dense grass while losing speed gradually', () => {
		const meadow = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
		};
		const bareMeadow = createVehicleController({
			worldSpan: 144,
			terrain: createTerrainIndex(meadow),
		});
		const denseGrass = createVehicleController({
			worldSpan: 144,
			terrain: createTerrainIndex({
				...meadow,
				grass: [2, 5, 8, 11].map((z) => ({
					kind: 'field' as const,
					x: 0,
					z,
					rotation: 0,
					scale: 1.3,
				})),
			}),
		});
		const input = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 40; frame += 1) {
			bareMeadow.step(0.05, input);
			denseGrass.step(0.05, input);
		}

		expect(denseGrass.state.speed).toBeGreaterThan(0);
		expect(denseGrass.state.z).toBeGreaterThan(0);
		expect(denseGrass.state.speed).toBeLessThan(bareMeadow.state.speed - 1);
	});

	it('reverses more slowly on meadow than on road', () => {
		const roadWorld = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: Array.from({ length: 18 }, (_, z) => ({ x: 9, z })),
			props: [],
		};
		const road = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex(roadWorld),
		});
		const meadow = createVehicleController({
			worldSpan: roadWorld.worldSpan,
			terrain: createTerrainIndex({ ...roadWorld, roads: [] }),
		});

		for (let frame = 0; frame < 200; frame += 1) {
			const input = { accelerate: false, brake: true, left: false, right: false };
			road.step(0.05, input);
			meadow.step(0.05, input);
		}

		expect([road.state.speed, meadow.state.speed]).toEqual([-12, -7]);
	});

	it('keeps momentum when leaving road for meadow', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [9, 10, 11].map((z) => ({ x: 9, z })),
			props: [],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			terrain: createTerrainIndex(world),
		});
		const input = { accelerate: true, brake: false, left: false, right: false };

		while (vehicle.state.z < 24) vehicle.step(0.05, input);
		const roadExitSpeed = vehicle.state.speed;
		vehicle.step(0.05, input);

		expect(roadExitSpeed).toBeGreaterThan(14);
		expect(vehicle.state.speed).toBeGreaterThan(roadExitSpeed - 1);
	});

	it('loses speed while turning', () => {
		const straight = createVehicleController({ worldSpan: 144 });
		const turning = createVehicleController({ worldSpan: 144 });
		const straightInput = { accelerate: true, brake: false, left: false, right: false };
		const turningInput = { ...straightInput, right: true };

		for (let frame = 0; frame < 40; frame += 1) {
			straight.step(0.05, straightInput);
			turning.step(0.05, straightInput);
		}
		for (let frame = 0; frame < 20; frame += 1) {
			straight.step(0.05, straightInput);
			turning.step(0.05, turningInput);
		}

		expect(turning.state.speed).toBeLessThan(straight.state.speed);
	});

	it('slides laterally when handbraking through a turn', () => {
		const gripping = createVehicleController({ worldSpan: 144 });
		const drifting = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 40; frame += 1) {
			gripping.step(0.05, accelerate);
			drifting.step(0.05, accelerate);
		}
		for (let frame = 0; frame < 12; frame += 1) {
			gripping.step(0.05, { ...accelerate, right: true });
			drifting.step(0.05, { ...accelerate, right: true, handbrake: true });
		}

		expect(Math.abs(drifting.state.slipAngle)).toBeGreaterThan(
			Math.abs(gripping.state.slipAngle) + 0.05,
		);
	});

	it('slows with a modest skid when braking hard through a turn', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const handbraking = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 30; frame += 1) {
			vehicle.step(0.05, accelerate);
			handbraking.step(0.05, accelerate);
		}
		const speedBeforeBraking = vehicle.state.speed;
		let peakBrakingGroundSpeed = 0;
		for (let frame = 0; frame < 6; frame += 1) {
			const previousX = vehicle.state.x;
			const previousZ = vehicle.state.z;
			vehicle.step(0.05, { accelerate: false, brake: true, left: false, right: true });
			peakBrakingGroundSpeed = Math.max(
				peakBrakingGroundSpeed,
				Math.hypot(vehicle.state.x - previousX, vehicle.state.z - previousZ) / 0.05,
			);
			handbraking.step(0.05, {
				accelerate: false,
				brake: false,
				left: false,
				right: true,
				handbrake: true,
			});
		}

		expect(vehicle.state.speed).toBeLessThan(speedBeforeBraking);
		expect(peakBrakingGroundSpeed).toBeLessThan(speedBeforeBraking);
		expect(Math.abs(vehicle.state.slipAngle)).toBeGreaterThan(0.08);
		expect(Math.abs(vehicle.state.slipAngle)).toBeLessThan(0.2);
		expect(Math.abs(handbraking.state.slipAngle)).toBeGreaterThan(
			Math.abs(vehicle.state.slipAngle) + 0.05,
		);
	});

	it('reports opposite chassis loads for acceleration and braking', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(0.05, { accelerate: true, brake: false, left: false, right: false });
		const accelerationLoad = vehicle.state.longitudinalLoad;
		vehicle.step(0.05, { accelerate: false, brake: true, left: false, right: false });

		expect([Math.sign(accelerationLoad), Math.sign(vehicle.state.longitudinalLoad)]).toEqual([
			1, -1,
		]);
	});

	it('reports steering angle and lateral load through a right turn', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 20; frame += 1) vehicle.step(0.05, accelerate);
		vehicle.step(0.05, { ...accelerate, right: true });

		expect({
			steeringDirection: Math.sign(vehicle.state.steeringAngle),
			lateralLoadDirection: Math.sign(vehicle.state.lateralLoad),
		}).toEqual({ steeringDirection: -1, lateralLoadDirection: -1 });
	});

	it('spins the rear tires during a hard launch', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(0.05, { accelerate: true, brake: false, left: false, right: false });

		expect(vehicle.state.rearSlip).toBeGreaterThan(0.5);
	});

	it('reports strong tire skid under hard braking', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 30; frame += 1) vehicle.step(0.05, accelerate);
		vehicle.step(0.05, { accelerate: false, brake: true, left: false, right: false });

		expect(vehicle.state.skidIntensity).toBeGreaterThan(0.5);
	});
});
