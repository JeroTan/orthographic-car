import { describe, expect, it } from 'vitest';

import {
	createVehicleController,
	PORSCHE_DIMENSIONS_METERS,
	PORSCHE_METERS_PER_WORLD_UNIT,
	PORSCHE_MODEL_DIMENSIONS_WORLD,
	toSpeedometerKmh,
	toWorldSpeed,
	WORLD_METERS_PER_UNIT,
	WORLD_SPEED_TO_KMH,
} from './vehicle';
import { createCollisionIndex, createTerrainIndex } from './world';

describe('vehicle controller', () => {
	function screenX(vehicle: ReturnType<typeof createVehicleController>): number {
		// Camera sits at +X/-Z, so screen-right points toward -X/-Z.
		return -(vehicle.state.x + vehicle.state.z);
	}

	it('accelerates forward and slows when braking', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });
		expect(vehicle.state.speed).toBeGreaterThan(0);

		vehicle.step(0.5, { accelerate: false, brake: true, left: false, right: false });
		expect(vehicle.state.speed).toBeLessThan(1);
	});

	it('reacts to an impact with knockback and a gravity-driven bounce', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		vehicle.applyImpact({
			velocityX: 0,
			velocityZ: -8,
			correctionX: 0,
			correctionZ: -0.4,
			verticalVelocity: 5,
			intensity: 0.8,
			damage: 0.5,
		});

		vehicle.step(0.05, { accelerate: false, brake: false, left: false, right: false });

		expect(vehicle.getCollisionBody().velocityZ).toBeLessThan(0);
		expect(vehicle.state.z).toBeLessThan(-0.4);
		expect(vehicle.state.verticalOffset).toBeGreaterThan(0);
		expect(vehicle.state.impactIntensity).toBeGreaterThan(0);
		expect(vehicle.state.damage).toBeGreaterThan(0);
		expect(Math.abs(vehicle.state.crashPitchVelocity)).toBeGreaterThan(0);

		vehicle.step(0.1, { accelerate: false, brake: false, left: false, right: false });

		expect(Math.abs(vehicle.state.crashPitch)).toBeGreaterThan(0);

		for (let frame = 0; frame < 120; frame += 1) {
			vehicle.step(0.05, { accelerate: false, brake: false, left: false, right: false });
		}

		expect(vehicle.state.verticalOffset).toBe(0);
		expect(vehicle.state.verticalVelocity).toBe(0);
	});

	it('recoils from immovable scenery instead of deleting motion', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			props: [],
			buildings: [{ variant: 0 as const, x: 0, z: 6, rotation: 0, scale: 1 }],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			collision: createCollisionIndex(world),
		});
		vehicle.state.speed = toWorldSpeed(80);

		vehicle.step(0.05, { accelerate: false, brake: false, left: false, right: false });

		expect(vehicle.getCollisionBody().velocityZ).toBeLessThan(0);
		expect(vehicle.state.impactIntensity).toBeGreaterThan(0);
		expect(vehicle.state.damage).toBeGreaterThan(0);
	});

	it('ejects car when a hard impact leaves it embedded in solid scenery', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			props: [],
			buildings: [{ variant: 0 as const, x: 0, z: 0, rotation: 0, scale: 1 }],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			collision: createCollisionIndex(world),
		});

		vehicle.step(0.05, { accelerate: false, brake: false, left: false, right: false });

		expect(Math.hypot(vehicle.state.x, vehicle.state.z)).toBeGreaterThan(4);
	});

	it('offers manual unstack recovery for an embedded car', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			props: [],
			buildings: [{ variant: 0 as const, x: 0, z: 0, rotation: 0, scale: 1 }],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			collision: createCollisionIndex(world),
		});

		expect(vehicle.unstick()).toBe(true);
		expect(Math.hypot(vehicle.state.x, vehicle.state.z)).toBeGreaterThan(4);
		expect(vehicle.unstick()).toBe(false);
	});

	it('shows reverse motion as positive speedometer speed', () => {
		const reverseWorldSpeed = toWorldSpeed(120);
		expect([toSpeedometerKmh(reverseWorldSpeed), toSpeedometerKmh(-reverseWorldSpeed)]).toEqual([
			120,
			120,
		]);
	});

	it('maps Porsche 911 GT2 top speed to 329 km/h', () => {
		expect(toSpeedometerKmh(toWorldSpeed(329))).toBe(329);
	});

	it('maps 20 km/h to calibrated Porsche dimensions', () => {
		const worldSpeed = toWorldSpeed(20);
		const metersPerSecond = worldSpeed * WORLD_METERS_PER_UNIT;
		const carLengthsPerSecond = worldSpeed / PORSCHE_MODEL_DIMENSIONS_WORLD.length;

		expect({
			lengthMeters: PORSCHE_DIMENSIONS_METERS.length,
			widthMeters: PORSCHE_DIMENSIONS_METERS.width,
			kmhPerWorldSpeed: WORLD_SPEED_TO_KMH,
		}).toEqual({
			lengthMeters: 4.469,
			widthMeters: 1.852,
			kmhPerWorldSpeed: WORLD_SPEED_TO_KMH,
		});
		expect(PORSCHE_METERS_PER_WORLD_UNIT.width).toBeCloseTo(
			PORSCHE_DIMENSIONS_METERS.width / PORSCHE_MODEL_DIMENSIONS_WORLD.width,
			6,
		);
		expect(metersPerSecond).toBeCloseTo(20 / 3.6, 6);
		expect(carLengthsPerSecond).toBeGreaterThan(1);
	});

	it('moves more than one packed-car length in one second at 20 km/h', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		vehicle.state.speed = toWorldSpeed(20);
		const startZ = vehicle.state.z;

		vehicle.step(1, { accelerate: true, brake: false, left: false, right: false });

		expect(vehicle.state.z - startZ).toBeGreaterThan(PORSCHE_MODEL_DIMENSIONS_WORLD.length);
	});

	it('tapers acceleration as speed rises and reaches 100 km/h in Porsche-like time', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const input = { accelerate: true, brake: false, left: false, right: false };
		vehicle.step(0.05, input);
		const launchIncrement = vehicle.state.speed;
		let elapsedSeconds = 0.05;

		while (toSpeedometerKmh(vehicle.state.speed) < 100 && elapsedSeconds < 10) {
			vehicle.step(0.05, input);
			elapsedSeconds += 0.05;
		}

		const speedAt100 = vehicle.state.speed;
		vehicle.step(0.05, input);
		const incrementAt100 = vehicle.state.speed - speedAt100;
		let speedNearTop = vehicle.state.speed;
		while (speedNearTop < toWorldSpeed(300) + 0.25) {
			vehicle.step(0.05, input);
			speedNearTop = vehicle.state.speed;
		}
		const speedBeforeTopStep = vehicle.state.speed;
		vehicle.step(0.05, input);
		const incrementNearTop = vehicle.state.speed - speedBeforeTopStep;

		expect(elapsedSeconds).toBeGreaterThanOrEqual(3.5);
		expect(elapsedSeconds).toBeLessThanOrEqual(3.9);
		expect(incrementAt100).toBeLessThan(launchIncrement);
		expect(toSpeedometerKmh(speedBeforeTopStep)).toBeGreaterThan(300);
		expect(incrementNearTop).toBeLessThan(launchIncrement * 0.4);
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

	it('sweeps high-speed travel so scenery cannot be skipped between frames', () => {
		const world = {
			gridSize: 18,
			tileSize: 8,
			worldSpan: 144,
			roads: [],
			props: [{ kind: 'tree' as const, x: 2.3, z: 2.5, rotation: 0, scale: 1 }],
		};
		const vehicle = createVehicleController({
			worldSpan: world.worldSpan,
			collision: createCollisionIndex(world),
		});
		vehicle.state.speed = toWorldSpeed(329);

		vehicle.step(0.05, { accelerate: false, brake: false, left: false, right: false });

		expect(vehicle.state.z).toBe(0);
		expect(vehicle.state.impactIntensity).toBeGreaterThan(0);
		expect(vehicle.state.damage).toBeGreaterThan(0);
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

		for (let frame = 0; frame < 500; frame += 1) {
			const input = { accelerate: true, brake: false, left: false, right: false };
			road.step(0.05, input);
			meadow.step(0.05, input);
		}

		expect([toSpeedometerKmh(road.state.speed), toSpeedometerKmh(meadow.state.speed)]).toEqual([
			329,
			177,
		]);
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

		expect(road.state.speed).toBeGreaterThan(meadow.state.speed);
		expect(meadow.state.speed).toBeGreaterThan(0);
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

		expect([toSpeedometerKmh(road.state.speed), toSpeedometerKmh(meadow.state.speed)]).toEqual([
			152,
			89,
		]);
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

		expect(roadExitSpeed).toBeGreaterThan(8);
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

	it('loses speed while drifting even with throttle held', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 100; frame += 1) vehicle.step(0.05, accelerate);
		const speedBeforeDrift = vehicle.state.speed;

		for (let frame = 0; frame < 20; frame += 1) {
			vehicle.step(0.05, { ...accelerate, right: true, handbrake: true });
		}

		expect(vehicle.state.speed).toBeLessThan(speedBeforeDrift - 2);
	});

	it('slows with a modest skid when braking hard through a turn', () => {
		const vehicle = createVehicleController({ worldSpan: 144 });
		const handbraking = createVehicleController({ worldSpan: 144 });
		const accelerate = { accelerate: true, brake: false, left: false, right: false };

		for (let frame = 0; frame < 150; frame += 1) {
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

		for (let frame = 0; frame < 100; frame += 1) vehicle.step(0.05, accelerate);
		vehicle.step(0.05, { accelerate: false, brake: true, left: false, right: false });

		expect(vehicle.state.skidIntensity).toBeGreaterThan(0.5);
	});
});
