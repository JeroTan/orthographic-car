import { describe, expect, it } from 'vitest';

import { createTerrainIndex, generateWorld, type RoadLayout } from './world';
import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	MAX_TRAFFIC_VEHICLES,
	TRAFFIC_VEHICLE_KINDS,
	type TrafficSimulationOptions,
} from './traffic';

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function closestTrafficDistance(
	vehicles: readonly { x: number; z: number }[],
	worldSpan: number,
): number {
	let closest = Number.POSITIVE_INFINITY;
	for (let first = 0; first < vehicles.length; first += 1) {
		for (let second = first + 1; second < vehicles.length; second += 1) {
			closest = Math.min(
				closest,
				Math.hypot(
					wrappedDelta(vehicles[second].x - vehicles[first].x, worldSpan),
					wrappedDelta(vehicles[second].z - vehicles[first].z, worldSpan),
				),
			);
		}
	}
	return closest;
}

describe('ambient traffic simulation', () => {
	it('does not leave a dense collision chain merged after contact resolution', () => {
		const denseLayout: RoadLayout = {
			gridSize: 16,
			tileSize: 0.5,
			worldSpan: 8,
			roads: Array.from({ length: 256 }, (_, id) => ({ x: id % 16, z: Math.floor(id / 16) })),
		};
		const traffic = createTrafficSimulation({ layout: denseLayout, seed: 66767, maxVehicles: 3 });
		let closest = Number.POSITIVE_INFINITY;

		for (let frame = 0; frame < 1; frame += 1) {
			traffic.step(0.05);
			closest = Math.min(
				closest,
				closestTrafficDistance(traffic.vehicles, denseLayout.worldSpan),
			);
		}

		expect(closest).toBeGreaterThan(1.2);
	});

	it('accelerates traffic from spawn speed toward its cruise speed', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const initialSpeed = traffic.vehicles[0].speed;

		for (let frame = 0; frame < 10; frame += 1) traffic.step(0.05);

		expect(traffic.vehicles[0].speed).toBeGreaterThan(initialSpeed);
		expect(traffic.vehicles[0].longitudinalLoad).toBeGreaterThan(0);
	});

	it('brakes and eases aside before reaching a blocked lane', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const initialSpeed = vehicle.speed;

		traffic.step(0.15, {
			x: vehicle.x + forwardX * 4,
			z: vehicle.z + forwardZ * 4,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.speed).toBeLessThan(initialSpeed);
		expect(vehicle.longitudinalLoad).toBeLessThan(0);
		expect(Math.abs(vehicle.avoidanceOffset)).toBeGreaterThan(0);
	});

	it('keeps traffic out of solid map scenery', () => {
		const obstacle = { x: 0, z: 0, radius: 1 };
		const collision = {
			intersectsCircle(x: number, z: number, radius: number) {
				return Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.radius;
			},
			normalAt(x: number, z: number) {
				const distance = Math.hypot(x - obstacle.x, z - obstacle.z);
				return distance > 0
					? { x: (x - obstacle.x) / distance, z: (z - obstacle.z) / distance }
					: { x: 0, z: -1 };
			},
		};
		const options: TrafficSimulationOptions = {
			layout: generateWorld(6767),
			seed: 6767,
			maxVehicles: 1,
			collision,
		};
		const traffic = createTrafficSimulation(options);
		const vehicle = traffic.vehicles[0];
		obstacle.x = vehicle.x + Math.sin(vehicle.heading) * 3;
		obstacle.z = vehicle.z + Math.cos(vehicle.heading) * 3;
		let closestDistance = Number.POSITIVE_INFINITY;

		for (let frame = 0; frame < 30; frame += 1) {
			traffic.step(0.05);
			closestDistance = Math.min(
				closestDistance,
				Math.hypot(vehicle.x - obstacle.x, vehicle.z - obstacle.z),
			);
		}

		expect(closestDistance).toBeGreaterThan(1.3);
	});

	it('escapes a persistent blocker instead of freezing in its lane', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const start = { x: vehicle.x, z: vehicle.z };
		const blocker = {
			x: vehicle.x + forwardX * 3,
			z: vehicle.z + forwardZ * 3,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.4,
			mass: 2,
		};

		for (let frame = 0; frame < 120; frame += 1) traffic.step(0.05, blocker);

		expect(vehicle.speed).toBeGreaterThan(1);
		expect(
			Math.hypot(
				wrappedDelta(vehicle.x - start.x, world.worldSpan),
				wrappedDelta(vehicle.z - start.z, world.worldSpan),
			),
		).toBeGreaterThan(3);
	});

	it('returns player recoil and launches traffic after a collision', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const before = { x: vehicle.x, z: vehicle.z };
		const impacts = traffic.resolvePlayerImpacts({
			x: vehicle.x - forwardX * 0.5,
			z: vehicle.z - forwardZ * 0.5,
			velocityX: forwardX * 20,
			velocityZ: forwardZ * 20,
			radius: 1.2,
			mass: 1.55,
		});

		expect(impacts).toHaveLength(1);
		expect(impacts[0].velocityX * forwardX + impacts[0].velocityZ * forwardZ).toBeLessThan(0);
		expect((vehicle.x - before.x) * forwardX + (vehicle.z - before.z) * forwardZ).toBeGreaterThan(0);
		expect(vehicle.verticalVelocity).toBeGreaterThan(0);
		expect(vehicle.impactIntensity).toBeGreaterThan(0);
		expect(vehicle.damage).toBeGreaterThan(0);
		const speedBeforeRecovery = vehicle.speed;

		traffic.step(0.05);

		expect(vehicle.verticalOffset).toBeGreaterThan(0);
		expect(vehicle.speed).toBeLessThan(speedBeforeRecovery);
		expect(vehicle.longitudinalLoad).toBeLessThan(0);

		for (let frame = 0; frame < 120; frame += 1) traffic.step(0.05);

		expect(vehicle.verticalOffset).toBe(0);
		expect(vehicle.verticalVelocity).toBe(0);
		expect(vehicle.speed).toBeGreaterThan(0);
	});

	it('keeps low-speed overlaps grounded', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];

		traffic.resolvePlayerImpacts({
			x: vehicle.x,
			z: vehicle.z,
			velocityX: vehicle.velocityX,
			velocityZ: vehicle.velocityZ,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.verticalVelocity).toBe(0);
		expect(vehicle.damage).toBe(0);
	});

	it('carries backward recoil after a head-on impact', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);

		traffic.resolvePlayerImpacts({
			x: vehicle.x + forwardX * 0.5,
			z: vehicle.z + forwardZ * 0.5,
			velocityX: -forwardX * 20,
			velocityZ: -forwardZ * 20,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.velocityX * forwardX + vehicle.velocityZ * forwardZ).toBeLessThan(0);
	});

	it('throws damaged traffic into air after a strong player impact', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const impacts = traffic.resolvePlayerImpacts({
			x: vehicle.x - forwardX * 0.5,
			z: vehicle.z - forwardZ * 0.5,
			velocityX: forwardX * 70,
			velocityZ: forwardZ * 70,
			radius: 1.2,
			mass: 1.55,
		});

		expect(impacts).toHaveLength(1);
		expect(impacts[0].damage).toBeGreaterThan(0.25);
		expect(vehicle.verticalVelocity).toBeGreaterThan(7);
		expect(vehicle.damage).toBeGreaterThan(0.25);
		expect(vehicle.damage).toBeCloseTo(impacts[0].damage, 8);
		expect(Math.abs(vehicle.crashPitchVelocity)).toBeGreaterThan(0);

		traffic.step(0.1);

		expect(vehicle.verticalOffset).toBeGreaterThan(0.5);
		expect(Math.abs(vehicle.crashPitch)).toBeGreaterThan(0);
	});

	it('keeps each traffic vehicle facing its direction of travel', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 1 });

		for (let step = 0; step < 9; step += 1) {
			const previous = { ...traffic.vehicles[0] };
			traffic.step(0.05);
			const vehicle = traffic.vehicles[0];
			const deltaX = wrappedDelta(vehicle.x - previous.x, world.worldSpan);
			const deltaZ = wrappedDelta(vehicle.z - previous.z, world.worldSpan);
			const distance = Math.hypot(deltaX, deltaZ);
			const forwardDot =
				(Math.sin(vehicle.heading) * deltaX + Math.cos(vehicle.heading) * deltaZ) / distance;

			expect(forwardDot).toBeGreaterThan(0);
		}
	});

	it('keeps traffic facing its curved road path', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 2 });

		for (let step = 0; step < 240; step += 1) {
			const previous = traffic.vehicles.map(({ x, z }) => ({ x, z }));
			traffic.step(0.05);

			for (let index = 0; index < traffic.vehicles.length; index += 1) {
				const vehicle = traffic.vehicles[index];
				const deltaX = wrappedDelta(vehicle.x - previous[index].x, world.worldSpan);
				const deltaZ = wrappedDelta(vehicle.z - previous[index].z, world.worldSpan);
				const distance = Math.hypot(deltaX, deltaZ);
				const forwardDot =
					(Math.sin(vehicle.heading) * deltaX + Math.cos(vehicle.heading) * deltaZ) / distance;

				expect(forwardDot).toBeGreaterThan(0);
			}
		}
	});

	it('spawns capped varied vehicles on road surface', () => {
		const world = generateWorld(6767);
		const terrain = createTerrainIndex(world);
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: DEFAULT_TRAFFIC_VEHICLE_COUNT,
		});

		expect(traffic.vehicles).toHaveLength(DEFAULT_TRAFFIC_VEHICLE_COUNT);
		expect(new Set(traffic.vehicles.map((vehicle) => vehicle.kind))).toEqual(
		new Set(TRAFFIC_VEHICLE_KINDS),
	);
		expect(traffic.vehicles.every((vehicle) => terrain.isRoadAt(vehicle.x, vehicle.z))).toBe(true);
		expect(
			createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: MAX_TRAFFIC_VEHICLES + 10 })
				.vehicles.length,
		).toBe(MAX_TRAFFIC_VEHICLES);
	});

	it('moves deterministically while staying on connected road tiles', () => {
		const world = generateWorld(1337);
		const terrain = createTerrainIndex(world);
		const first = createTrafficSimulation({ layout: world, seed: 1337, maxVehicles: 6 });
		const second = createTrafficSimulation({ layout: world, seed: 1337, maxVehicles: 6 });
		const initial = first.vehicles.map((vehicle) => ({ x: vehicle.x, z: vehicle.z }));

		first.step(1.25);
		second.step(1.25);

		expect(first.vehicles).toEqual(second.vehicles);
		expect(
			first.vehicles.some(
				(vehicle, index) => vehicle.x !== initial[index].x || vehicle.z !== initial[index].z,
			),
		).toBe(true);
		expect(first.vehicles.every((vehicle) => terrain.isRoadAt(vehicle.x, vehicle.z))).toBe(true);
	});

	it('supports disabling ambient traffic', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(1), seed: 1, maxVehicles: 0 });

		expect(traffic.vehicles).toEqual([]);
	});
});
